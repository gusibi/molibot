import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureProvider } from './provider';
import { findFreePort, startScratchService, stopScratchService } from '../../../evals/lib/service.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const desktopRoot = resolve(repoRoot, 'apps/desktop');

async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

export async function startUiHarness() {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'molibot-ui-'));
  const provider = await startFixtureProvider();
  const logs: string[] = [];
  let vite: ChildProcess | undefined;
  let service: Awaited<ReturnType<typeof startScratchService>> | undefined;
  const port = await findFreePort();
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), MOLIBOT_DISABLE_EXTERNAL_CHANNELS: '1', UI_TEST_PROVIDER_URL: provider.url };
  const close = async () => {
    await stopChild(vite);
    if (service) await stopScratchService(service);
    await provider.close();
    await rm(dataDir, { recursive: true, force: true });
  };
  try {
    const seed = spawn(process.execPath, ['--import', './scripts/register-loader.js', '--import', 'tsx', 'tests/ui/support/seed.ts'], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let seedOutput = '';
    for (const stream of [seed.stdout, seed.stderr]) stream.on('data', chunk => seedOutput += chunk);
    const seedCode = await new Promise<number | null>((done, reject) => { seed.once('error', reject); seed.once('exit', done); });
    if (seedCode !== 0) throw new Error(`UI settings seed failed (${seedCode}): ${seedOutput}`);
    service = await startScratchService({ repoRoot, dataDir, port, onLog: (chunk: string) => logs.push(chunk) });
    const frontendPort = await findFreePort();
    const frontend = `http://127.0.0.1:${frontendPort}`;
    vite = spawn(process.execPath, [resolve(repoRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort)], {
      cwd: desktopRoot,
      env: { ...env, VITE_MOLIBOT_PREVIEW: '1', MOLIBOT_DESKTOP_PREVIEW_TARGET: service.endpoint },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    for (const stream of [vite.stdout!, vite.stderr!]) stream.on('data', chunk => logs.push(String(chunk)));
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      if (vite.exitCode !== null) throw new Error(`UI frontend exited: ${logs.join('').slice(-4000)}`);
      try { ready = (await fetch(frontend)).ok; } catch { /* Vite has not bound the port yet. */ }
      if (ready) break;
      await new Promise(done => setTimeout(done, 100));
    }
    if (!ready) throw new Error('UI frontend did not start within 30s');
    return {
      dataDir, frontend, endpoint: service.endpoint, provider, logs,
      async restartService() {
        await stopScratchService(service!);
        service = await startScratchService({ repoRoot, dataDir, port, onLog: (chunk: string) => logs.push(chunk) });
      },
      close
    };
  } catch (error) {
    await close();
    throw new Error(`${String(error)}\n${logs.join('').slice(-5000)}`);
  }
}
