import { CodemodeSandbox, renderDeclarations } from "@earendil-works/pi-codemode";
import { writeFile } from "node:fs/promises";

const pending = new Map();
let sequence = 0;
const controller = new AbortController();
const send = value => { if (process.connected) process.send(value); };
process.on("message", async message => {
  if (message.kind === "abort") { controller.abort(); return; }
  if (message.kind === "reply") {
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    message.error ? call.reject(new Error(message.error)) : call.resolve(message.value);
    return;
  }
  if (message.kind !== "execute") return;
  const tools = message.tools.map(tool => ({ ...tool, execute(args, { signal }) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      signal.addEventListener("abort", () => send({ kind: "cancel", id }), { once: true });
      send({ kind: "call", id, name: tool.name, args });
    });
  } }));
  const metadata = tools.map(({ execute, ...tool }) => tool);
  const sandbox = new CodemodeSandbox({ tools, timeoutMs: message.timeoutMs, memoryLimitBytes: 64 * 1024 * 1024,
    globals: [
      { name: "searchTools", execute: query => metadata.filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(String(query).toLowerCase())).map(({ name, description }) => ({ name, description })) },
      { name: "describeTool", execute: name => { const tool = metadata.find(tool => tool.name === name); return tool ? renderDeclarations({ tools: [{ ...tool, execute() {} }] }) : null; } }
    ] });
  try {
    const result = await sandbox.execute(message.code, { signal: controller.signal });
    const text = result.output.map(block => block.type === "text" ? block.text : "[Image output omitted; use the image tool's artifact reference.]");
    if (result.ok && result.value !== undefined) text.push(JSON.stringify(result.value));
    if (!result.ok) text.push(`Script error: ${result.error.message}`);
    const full = text.join("\n");
    const truncated = full.length > message.maxChars;
    if (truncated) await writeFile(message.outputPath, full, { mode: 0o600 });
    send({ kind: "result", ok: result.ok, errorKind: result.ok ? undefined : result.error.kind,
      text: truncated ? `${full.slice(0, message.maxChars)}\n[Output truncated; full output: ${message.outputRef}]` : full,
      calls: result.calls, truncated });
  } catch (error) {
    send({ kind: "result", ok: false, errorKind: "sandbox", text: `Script failed: ${error.message}` });
  } finally {
    await sandbox.close();
    process.disconnect();
  }
});
