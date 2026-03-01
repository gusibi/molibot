import type { SessionStore } from "../services/sessionStore.js";
import { JsonFileMemoryBackend } from "./jsonFileCore.js";
import { MoryMemoryBackend } from "./moryCore.js";
import type { MemoryBackend } from "./types.js";

export interface MemoryBackendDefinition {
  key: string;
  name: string;
  description: string;
  create: (sessions: SessionStore) => MemoryBackend;
}

export const builtInMemoryBackends: MemoryBackendDefinition[] = [
  {
    key: "json-file",
    name: "JSON File",
    description: "Flat-file memory backend with local JSON storage and markdown mirrors.",
    create: (sessions) => new JsonFileMemoryBackend(sessions)
  },
  {
    key: "mory",
    name: "Mory",
    description: "SDK-backed SQLite memory backend powered by the Mory engine.",
    create: (sessions) => new MoryMemoryBackend(sessions)
  }
];
