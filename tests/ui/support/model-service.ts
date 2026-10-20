import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * The only faked dependency in the UI test system: an OpenAI-compatible
 * chat-completions endpoint whose replies are scripted per test.
 *
 * Everything else is real — the App, HTTP handlers, Runner, tools, queue,
 * approvals and storage. Control is expressed by registering reply scripts that
 * match requests on their observable shape (last user text, presence of tool
 * results, tool list, system prompt), never by smuggling markers into the
 * prompt. See docs/requirements/feature-verification-spec.md.
 */

export interface ModelMessage {
  role: string;
  content?: unknown;
  name?: string;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  tool_call_id?: string;
}

export interface ModelRequest {
  /** 1-based arrival order across the whole instance. */
  index: number;
  model: string;
  /** Concatenated `system` message contents (pi sends the system prompt as the first message). */
  system: string;
  messages: ModelMessage[];
  /** Names of the tools offered with this request. */
  tools: string[];
  stream: boolean;
  /** Name of the script that answered, or null when nothing matched. */
  matched: string | null;
}

export interface ToolCallSpec {
  name: string;
  args: unknown;
  id?: string;
  /** Split `arguments` JSON into this many streaming deltas. */
  argChunks?: number;
}

export type ModelReply =
  /** Pause after reasoning so tests can inspect the handoff to the answer. */
  | { type: 'thinking'; thinking: string; text: string; key: string; delayMs?: number }
  /** Streamed text, split into `chunks` deltas (optionally spaced by `delayMs`). */
  | { type: 'text'; text: string; chunks?: number; delayMs?: number }
  /** Streamed tool calls, preceded by optional text. */
  | { type: 'toolCalls'; calls: ToolCallSpec[]; text?: string }
  /** Stream `text`, then pause until `release(key)` or the client disconnects. */
  | { type: 'hold'; text: string; key: string; tail?: string; delayMs?: number }
  /** Reject before any bytes: HTTP status (429, 500, …) with an error body. */
  | { type: 'error'; status: number; message?: string }
  /** Stream optional text, then drop the connection mid-response. */
  | { type: 'markerThenDrop'; kind: 'mid-stream-error' | 'disconnect'; text?: string }
  /** Reply with a single JSON body even though the client asked to stream. */
  | { type: 'nonStream'; text: string };

export interface ReplyScript {
  name: string;
  when?: (request: ModelRequest) => boolean;
  reply: ModelReply | ((request: ModelRequest) => ModelReply);
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function modelRequestMatchers(request: ModelRequest) {
  const lastUser = [...request.messages].reverse().find(message => message.role === 'user');
  const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
  const lastUserIndex = lastUser ? request.messages.lastIndexOf(lastUser) : -1;
  return {
    lastUserText,
    systemIncludes: (needle: string) => request.system.includes(needle),
    hasTools: request.tools.length > 0,
    afterToolResults: lastUserIndex >= 0 && request.messages.slice(lastUserIndex + 1).some(message => message.role === 'tool'),
    hasToolResults: request.messages.some(message => message.role === 'tool')
  };
}

export async function startModelService() {
  const requests: ModelRequest[] = [];
  const unmatched: ModelRequest[] = [];
  const scripts: ReplyScript[] = [];
  const held = new Map<string, () => void>();
  const pendingReleases = new Set<string>();
  const sockets = new Set<ServerResponse>();
  let counter = 0;

  async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  }

  function writeJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  }

  function errorBody(message: string): unknown {
    return { error: { message, type: 'invalid_request_error', code: 'fixture_error' } };
  }

  /** A single-body (non-streaming) completion that mirrors the scripted reply. */
  function nonStreamBody(model: string, reply: ModelReply): unknown {
    let content: string | null = null;
    let toolCalls: unknown[] | undefined;
    let finish: 'stop' | 'tool_calls' = 'stop';
    if (reply.type === 'text' || reply.type === 'nonStream' || reply.type === 'thinking') content = reply.text;
    else if (reply.type === 'hold') content = `${reply.text}${reply.tail ?? ''}`;
    else if (reply.type === 'markerThenDrop') content = reply.text ?? null;
    else if (reply.type === 'toolCalls') {
      content = reply.text ?? null;
      finish = 'tool_calls';
      toolCalls = reply.calls.map((call, index) => ({
        index,
        id: call.id ?? `call-${randomUUID()}`,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) }
      }));
    }
    return {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
        finish_reason: finish
      }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
    };
  }

  function match(request: ModelRequest): ReplyScript | undefined {
    return scripts.find(script => (script.when ? script.when(request) : true));
  }

  /** Split text into at most `chunks` pieces; keeps short replies as one delta. */
  function splitText(text: string, chunks = 3): string[] {
    if (text.length <= 1) return [text];
    const count = Math.max(1, Math.min(chunks, text.length));
    const size = Math.ceil(text.length / count);
    return Array.from({ length: count }, (_, i) => text.slice(i * size, (i + 1) * size)).filter(part => part.length > 0);
  }

  function splitJson(value: unknown, chunks = 3): string[] {
    return splitText(JSON.stringify(value), chunks);
  }

  interface SseWriter {
    frame(delta: Record<string, unknown>, finish: string | null): void;
    finish(reason: 'stop' | 'tool_calls'): void;
    model: string;
    id: string;
    response: ServerResponse;
  }

  function openStream(response: ServerResponse, model: string): SseWriter {
    const id = `chatcmpl-${randomUUID()}`;
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.flushHeaders?.();
    const frame = (delta: Record<string, unknown>, finish: string | null) => {
      response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    };
    return {
      model,
      id,
      response,
      frame,
      finish(reason) {
        frame({}, reason);
        response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model, choices: [], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })}\n\n`);
        response.end('data: [DONE]\n\n');
      }
    };
  }

  async function streamReply(writer: SseWriter, reply: ModelReply): Promise<void> {
    writer.frame({ role: 'assistant', content: '' }, null);
    switch (reply.type) {
      case 'thinking': {
        let open!: () => void;
        const gate = new Promise<void>(resolve => { open = resolve; });
        held.set(reply.key, open);
        writer.response.once('close', open);
        if (pendingReleases.delete(reply.key)) open();
        for (const part of splitText(reply.thinking)) {
          writer.frame({ reasoning_content: part }, null);
          await delay(reply.delayMs ?? 8);
        }
        await gate;
        held.delete(reply.key);
        if (writer.response.destroyed || writer.response.writableEnded) return;
        for (const part of splitText(reply.text, 12)) {
          writer.frame({ content: part }, null);
          await delay(reply.delayMs ?? 8);
        }
        writer.finish('stop');
        return;
      }
      case 'text': {
        for (const part of splitText(reply.text, reply.chunks)) {
          writer.frame({ content: part }, null);
          await delay(reply.delayMs ?? 8);
        }
        writer.finish('stop');
        return;
      }
      case 'toolCalls': {
        if (reply.text) {
          for (const part of splitText(reply.text)) {
            writer.frame({ content: part }, null);
            await delay(8);
          }
        }
        for (const [index, call] of reply.calls.entries()) {
          const id = call.id ?? `call-${randomUUID()}`;
          const args = splitJson(call.args, call.argChunks);
          writer.frame({ tool_calls: [{ index, id, type: 'function', function: { name: call.name, arguments: '' } }] }, null);
          for (const part of args) {
            writer.frame({ tool_calls: [{ index, function: { arguments: part } }] }, null);
            await delay(8);
          }
        }
        writer.finish('tool_calls');
        return;
      }
      case 'hold': {
        let open!: () => void;
        const gate = new Promise<void>(resolve => { open = resolve; });
        held.set(reply.key, open);
        writer.response.once('close', open);
        // A release may arrive before this hold starts (the test can race the
        // first streamed chunks); honour it so the gate never sticks.
        if (pendingReleases.delete(reply.key)) open();
        for (const part of splitText(reply.text)) {
          writer.frame({ content: part }, null);
          await delay(reply.delayMs ?? 8);
        }
        await gate;
        held.delete(reply.key);
        if (writer.response.destroyed || writer.response.writableEnded) return;
        if (reply.tail) for (const part of splitText(reply.tail)) writer.frame({ content: part }, null);
        writer.finish('stop');
        return;
      }
      case 'markerThenDrop': {
        if (reply.text) for (const part of splitText(reply.text)) writer.frame({ content: part }, null);
        await delay(20);
        if (reply.kind === 'mid-stream-error') {
          writer.response.write(`data: ${JSON.stringify({ error: { message: 'scripted mid-stream error', type: 'server_error' } })}\n\n`);
          writer.response.end();
        } else {
          writer.response.destroy();
        }
        return;
      }
      case 'error':
      case 'nonStream':
        // Handled before a stream is opened.
        return;
    }
  }

  const server = createServer((request, response) => {
    void (async () => {
      sockets.add(response);
      response.on('close', () => sockets.delete(response));
      const body = await readBody(request);
      const rawMessages = Array.isArray(body.messages) ? (body.messages as ModelMessage[]) : [];
      const tools = Array.isArray(body.tools)
        ? (body.tools as Array<{ function?: { name?: string } }>).map(tool => tool.function?.name ?? '').filter(Boolean)
        : [];
      const modelRequest: ModelRequest = {
        index: ++counter,
        model: String(body.model ?? ''),
        system: rawMessages.filter(message => message.role === 'system').map(message => String(message.content ?? '')).join('\n'),
        messages: rawMessages,
        tools,
        // pi always streams; a client that omits `stream` (or sets false) is
        // answered with a single JSON body.
        stream: body.stream === true,
        matched: null
      };
      const script = match(modelRequest);
      modelRequest.matched = script?.name ?? null;
      requests.push(modelRequest);
      if (!script) {
        unmatched.push(modelRequest);
        writeJson(response, 500, errorBody(`unmatched model request #${modelRequest.index}`));
        return;
      }

      const reply = typeof script.reply === 'function' ? script.reply(modelRequest) : script.reply;
      if (reply.type === 'error') {
        writeJson(response, reply.status, errorBody(reply.message ?? `scripted ${reply.status}`));
        return;
      }
      if (reply.type === 'nonStream' || body.stream !== true) {
        writeJson(response, 200, nonStreamBody(modelRequest.model, reply));
        return;
      }

      const writer = openStream(response, modelRequest.model);
      await streamReply(writer, reply);
    })().catch(error => {
      if (!response.headersSent) writeJson(response, 500, errorBody(String(error)));
      else response.destroy();
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('model service has no port');
  const url = `http://127.0.0.1:${address.port}/v1`;

  return {
    url,
    requests,
    unmatched,
    script(script: ReplyScript) {
      scripts.push(script);
      return script;
    },
    /** Drop all registered scripts; requests/unmatched history is kept. */
    resetScripts() {
      scripts.length = 0;
      held.clear();
      pendingReleases.clear();
    },
    release(key: string) {
      const open = held.get(key);
      if (open) open();
      else pendingReleases.add(key);
    },
    /** Requests matched by a given script name. */
    matched(name: string): ModelRequest[] {
      return requests.filter(request => request.matched === name);
    },
    /** Cursor for per-test request counting; pair with `since()`. */
    mark(): number {
      return requests.length;
    },
    since(cursor: number): ModelRequest[] {
      return requests.slice(cursor);
    },
    async close() {
      for (const release of held.values()) release();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}

export type ModelService = Awaited<ReturnType<typeof startModelService>>;
