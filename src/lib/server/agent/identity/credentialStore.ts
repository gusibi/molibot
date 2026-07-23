import {
  chmod,
  mkdir,
  readFile,
  rename,
  rmdir,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Credential,
  CredentialInfo,
  CredentialStore
} from "@earendil-works/pi-ai";

export type CredentialData = Record<string, Credential>;

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

function isNodeError(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCredentialData(raw: string): CredentialData {
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" ? parsed as CredentialData : {};
}

export class FileCredentialStore implements CredentialStore {
  private readonly providerQueues = new Map<string, Promise<void>>();

  constructor(private readonly filePath: string) {}

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.readAll())[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const data = await this.readAll();
    return Object.entries(data).map(([providerId, credential]) => ({
      providerId,
      type: credential.type
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    return this.serialize(providerId, async () => this.withFileLock(async () => {
      const data = await this.readAll();
      const next = await fn(data[providerId]);
      if (next === undefined) return data[providerId];
      data[providerId] = next;
      await this.writeAll(data);
      return next;
    }));
  }

  async delete(providerId: string): Promise<void> {
    await this.serialize(providerId, async () => this.withFileLock(async () => {
      const data = await this.readAll();
      if (!(providerId in data)) return;
      delete data[providerId];
      await this.writeAll(data);
    }));
  }

  private async serialize<T>(providerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.providerQueues.get(providerId) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => {}).then(() => current);
    this.providerQueues.set(providerId, queued);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.providerQueues.get(providerId) === queued) {
        this.providerQueues.delete(providerId);
      }
    }
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    const parent = dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const lockPath = `${this.filePath}.lock`;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (true) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        break;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        try {
          const lockStat = await stat(lockPath);
          if (Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
            await rmdir(lockPath);
            continue;
          }
        } catch (lockError) {
          if (!isNodeError(lockError, "ENOENT")) throw lockError;
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for credential lock: ${lockPath}`);
        }
        await sleep(LOCK_RETRY_MS);
      }
    }

    try {
      return await operation();
    } finally {
      try {
        await rmdir(lockPath);
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
    }
  }

  private async readAll(): Promise<CredentialData> {
    try {
      return parseCredentialData(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) return {};
      throw error;
    }
  }

  private async writeAll(data: CredentialData): Promise<void> {
    const parent = dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    try {
      await chmod(this.filePath, 0o600);
    } catch {
      // Some filesystems do not support POSIX permissions.
    }
  }
}
