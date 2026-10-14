import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startModelService, type ModelService } from './model-service';
import {
  assertIsolatedDataDir,
  assertLoopbackUrl,
  UI_DATA_PREFIX,
  UI_HOME_PREFIX
} from './guard';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const desktopRoot = resolve(repoRoot, 'apps/desktop');

/**
 * One isolated Molibot instance for a UI test worker: a throwaway data
 * directory and HOME, an idle port, a loopback-only scripted model, external
 * channels disabled, and a whitelisted child environment. The App, HTTP
 * handlers, Runner, tools, queue, approvals and storage are all real code.
 *
 * The launch reuses the evals approach — `scripts/start-server.mjs`, so the
 * run gets the service lease, signal handling and forced exit — but the child
 * environment is built from scratch instead of inheriting the owner's shell.
 */

/** Only these variables cross into the isolated children; secrets and proxies do not. */
export const PASSTHROUGH_ENV = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL', 'TMPDIR'] as const;

/**
 * Build the whitelisted child environment. Only the passthrough allowlist and
 * the explicitly-required values appear; the owner's shell environment (API
 * keys, channel credentials, proxies) is never inherited.
 */
export function buildIsolatedEnv(input: {
  home: string;
  dataDir: string;
  port: number;
  modelUrl: string;
  forbiddenDir: string;
  base?: NodeJS.ProcessEnv;
  extra?: Record<string, string>;
}): NodeJS.ProcessEnv {
  const base = input.base ?? process.env;
  const env: NodeJS.ProcessEnv = {
    HOME: input.home,
    DATA_DIR: input.dataDir,
    PORT: String(input.port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    MOLIBOT_DISABLE_EXTERNAL_CHANNELS: '1',
    UI_TEST_PROVIDER_URL: input.modelUrl,
    UI_TEST_FORBIDDEN_DIR: input.forbiddenDir
  };
  for (const key of PASSTHROUGH_ENV) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...input.extra };
}

async function freePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((res, rej) => {
    const server = net.createServer();
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return rej(new Error('no port'));
      const { port } = address;
      server.close(() => res(port));
    });
  });
}

function stopChild(child: ChildProcess | undefined, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  child.kill(signal);
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  return exited.finally(() => clearTimeout(timer));
}

export async function startIsolatedInstance() {
  const home = await mkdtemp(join(tmpdir(), UI_HOME_PREFIX));
  const dataDir = await mkdtemp(join(tmpdir(), UI_DATA_PREFIX));
  assertIsolatedDataDir(home, 'UI temp HOME');
  assertIsolatedDataDir(dataDir, 'UI');

  const model = await startModelService();
  assertLoopbackUrl(model.url, 'UI model service');
  // Fail closed on a leaked real data directory: the isolated run must never be
  // able to read or write the owner's ~/.molibot.
  const forbiddenRealDir = join(process.env.HOME ?? home, '.molibot');

  const logs: string[] = [];
  let vite: ChildProcess | undefined;
  let service: ChildProcess | undefined;

  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;

  function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return buildIsolatedEnv({ home, dataDir, port, modelUrl: model.url, forbiddenDir: forbiddenRealDir, extra });
  }

  async function waitForHealth(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 90_000;
    let detail = 'no response';
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`service exited before ready (${detail})`);
      try {
        const response = await fetch(`${endpoint}/api/desktop/health?deep=1`);
        const body = await response.json().catch(() => null);
        if (response.ok && body?.ok !== false) return;
        detail = `HTTP ${response.status} ${JSON.stringify(body).slice(0, 200)}`;
      } catch (error) {
        detail = error instanceof Error ? error.message : String(error);
      }
      await new Promise(done => setTimeout(done, 250));
    }
    throw new Error(`service not ready within 90s (${detail})\n${logs.join('').slice(-4000)}`);
  }

  async function startService(): Promise<void> {
    service = spawn(process.execPath, [join(repoRoot, 'scripts', 'start-server.mjs')], {
      cwd: repoRoot,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    for (const stream of [service.stdout, service.stderr]) stream?.on('data', chunk => logs.push(String(chunk)));
    await waitForHealth(service);
  }

  async function stopService(): Promise<void> {
    await stopChild(service);
    service = undefined;
  }

  async function restartService(): Promise<void> {
    await stopService();
    await startService();
  }

  async function runSeed(): Promise<void> {
    const seed = spawn(process.execPath, ['--import', './scripts/register-loader.js', '--import', 'tsx', 'tests/ui/support/seed.ts'], {
      cwd: repoRoot,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    for (const stream of [seed.stdout, seed.stderr]) stream?.on('data', chunk => (output += String(chunk)));
    const code = await new Promise<number | null>((done, reject) => {
      seed.once('error', reject);
      seed.once('exit', done);
    });
    if (code !== 0) throw new Error(`UI settings seed failed (${code}): ${output}`);
  }

  async function startFrontend(): Promise<string> {
    const frontendPort = await freePort();
    vite = spawn(process.execPath, [resolve(repoRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort)], {
      cwd: desktopRoot,
      env: childEnv({ VITE_MOLIBOT_PREVIEW: '1', MOLIBOT_DESKTOP_PREVIEW_TARGET: endpoint }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    for (const stream of [vite.stdout, vite.stderr]) stream?.on('data', chunk => logs.push(String(chunk)));
    const frontend = `http://127.0.0.1:${frontendPort}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (vite.exitCode !== null) throw new Error(`UI frontend exited: ${logs.join('').slice(-4000)}`);
      try {
        if ((await fetch(frontend)).ok) return frontend;
      } catch {
        // Vite has not bound the port yet.
      }
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error('UI frontend did not start within 30s');
  }

  async function close(): Promise<void> {
    await stopChild(vite);
    await stopChild(service, 'SIGKILL');
    await model.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }

  try {
    await runSeed();
    await startService();
    const frontend = await startFrontend();
    return {
      home,
      dataDir,
      endpoint,
      port,
      frontend,
      model,
      logs,
      startService,
      stopService,
      restartService,
      close
    };
  } catch (error) {
    await close();
    throw new Error(`${String(error)}\n${logs.join('').slice(-5000)}`);
  }
}

export type IsolatedInstance = Awaited<ReturnType<typeof startIsolatedInstance>>;
