import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

/** Only the model is scripted; the App, HTTP handlers, Runner and tools remain real. */
export async function startFixtureProvider() {
  const requests: Array<{ marker: string; toolResult: boolean }> = [];
  const held = new Map<string, () => void>();
  const sockets = new Set<ServerResponse>();
  const server = createServer(async (req, res) => {
    sockets.add(res);
    res.on('close', () => sockets.delete(res));
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const messages = body.messages ?? [];
      const lastUser = messages.filter((m: any) => m.role === 'user').at(-1);
      const content = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
      const match = body.tools?.length ? content.match(/\[\[ui:(reply|hold|approve|fail):([a-z0-9-]+)\]\]/) : null;
      const mode = match?.[1] ?? 'reply';
      const marker = match?.[2] ?? 'background';
      const userIndex = messages.lastIndexOf(lastUser);
      const toolResult = messages.slice(userIndex + 1).some((m: any) => m.role === 'tool');
      requests.push({ marker, toolResult });
      if (mode === 'fail') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'UI fixture unavailable', type: 'server_error' } }));
        return;
      }
      const id = `chatcmpl-${randomUUID()}`;
      const tool = mode === 'approve' && !toolResult ? {
        id: `call-${marker}`, type: 'function', function: {
          name: 'write', arguments: JSON.stringify({ label: `UI approval ${marker}`, path: `ui-probe-${marker}.txt`, content: `approved:${marker}` })
        }
      } : null;
      const answer = mode === 'approve' ? `DECISION_COMPLETE:${marker}` : `UI_REPLY:${marker}`;
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, object: 'chat.completion', created: 1, model: 'fixture',
          choices: [{ index: 0, message: { role: 'assistant', content: tool ? null : answer, ...(tool ? { tool_calls: [tool] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const frame = (delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      frame({ role: 'assistant', content: '' });
      if (tool) frame({ tool_calls: [{ index: 0, ...tool }] });
      else {
        frame({ content: mode === 'hold' ? `UI_WAITING:${marker}` : answer.slice(0, 9) });
        if (mode === 'hold') {
          await new Promise<void>(resolve => {
            held.set(marker, resolve);
            res.once('close', resolve);
          });
          held.delete(marker);
          if (res.destroyed) return;
          frame({ content: `\n${answer}` });
        } else {
          await new Promise(resolve => setTimeout(resolve, 80));
          if (res.destroyed) return;
          frame({ content: answer.slice(9) });
        }
      }
      frame({}, tool ? 'tool_calls' : 'stop');
      res.end('data: [DONE]\n\n');
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture provider has no port');
  return {
    url: `http://127.0.0.1:${address.port}/v1`, requests,
    release(marker: string) { held.get(marker)?.(); },
    async close() {
      for (const release of held.values()) release();
      for (const res of sockets) res.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}
