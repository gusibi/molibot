# Writing a Mini App

A Mini App extends Molibot with a new domain — todos, expenses, a reading list —
without touching the main application. One app owns three things over one
private database:

- **Agent tools**, so the user can say "帮我加个待办" in any channel.
- **A UI**, hosted by Molibot and shown in the desktop app's right-hand panel.
- **A data directory**, the single source of truth both entrances read and write.

The shipped **Todo** app is the worked example. Its source lives at
`src/lib/server/miniapps/builtin/todo/`, and it is installed into your workspace
at `~/.molibot/miniapps/apps/todo/` on first start — read it alongside this
guide.

---

## 1. Install layout

## Using an installed Mini App

In any Molibot chat, run `/miniapps` (also `/mini-apps` or `/apps`) to see installed apps and their tools. To target one app for the current request, put its id first: `@todo add milk` or `@todo 添加任务：买牛奶`. The selector is not kept in conversation context; it applies only to that turn. Its tools are preloaded directly and no generic fallback tools are available for that run.

```
~/.molibot/miniapps/
  apps/<app-id>/          # your code — an upgrade replaces this whole directory
    manifest.json
    server/index.mjs
    ui/index.html
    ui/app.js
    ui/styles.css
  data/<app-id>/          # your data — never touched by install or upgrade
```

Rules that the host enforces, not merely suggests:

- The directory name **must equal** the manifest `id`.
- `runtime.entry` must be a `.mjs` file inside your app directory. Molibot does
  not compile TypeScript, does not run install scripts, and never runs
  `npm install` for you. Bundle third-party dependencies into your app.
- Everything `ui.entry` references must live under `ui/`.
- Symlinks that leave the app directory are rejected.
- **Installing or replacing app code requires a Molibot restart.** There is no
  hot reload in V1. Your data is unaffected.

### Installing

When an Agent is authoring the app, it first scaffolds into the current Session
scratch directory. The Agent then uses `miniAppManage validate` to load the
Runtime against temporary data, `miniAppManage install` for the staged atomic
replace, and `miniAppManage inspect` to read the installed version and manifest
hash back from the live directory. A code block or a planned version number is
not an installation receipt.

Open **Mini Apps** in the Chat sidebar (it is also mounted in Settings ›
Plugins). The manager installs from three sources:

| Source | What to give it |
| --- | --- |
| Local folder | An app folder containing `manifest.json` |
| ZIP archive | A `.zip` of the app, with or without a wrapping folder |
| GitHub repo | `owner/repo` or a `github.com` URL, plus an optional branch/tag |

All three validate the manifest **before** anything reaches the install root, so
a bad source installs nothing and a failed replace leaves the previous version
untouched. **Installed code does not run until you restart the Molibot
service** (V1 has no hot reload); your data is unaffected either way.

You can still install by hand — put the directory in `~/.molibot/miniapps/apps/`
and restart — which is exactly what the folder option automates.

To remove an app, use the manager's overflow menu, which asks whether to keep
its data.

---

## 2. `manifest.json`

```json
{
  "manifestVersion": 1,
  "id": "expenses",
  "name": "Expenses",
  "version": "1.0.0",
  "description": "Track spending from chat and from the desktop panel.",
  "engines": { "molibot": ">=2.8.0 <4" },
  "runtime": { "entry": "server/index.mjs" },
  "ui": { "entry": "ui/index.html", "icon": "ui/icon.svg" },
  "data": { "schemaVersion": 1 },
  "tools": [
    {
      "name": "add",
      "title": "Add Expense",
      "description": "Record one expense. Use when the user mentions spending money.",
      "keywords": ["expense", "spend", "记账", "花了"],
      "inputSchema": {
        "type": "object",
        "properties": {
          "amount": { "type": "number", "exclusiveMinimum": 0 },
          "note": { "type": "string", "maxLength": 200 }
        },
        "required": ["amount"],
        "additionalProperties": false
      },
      "readOnlyHint": false,
      "destructiveHint": false
    }
  ]
}
```

Validation is strict, and a failure produces a visible error row in Settings
rather than a silently missing app:

| Field | Rule |
| --- | --- |
| `manifestVersion` | Must be `1`. |
| `id` | `^[a-z][a-z0-9-]{1,62}$`, equal to the directory name. |
| `version` | Valid SemVer. |
| `engines.molibot` | Valid SemVer range that the running Molibot satisfies. |
| `ui.icon` | Optional. An SVG or PNG inside `ui/`, at most 64 KB. Shown in the sidebar and the manager. A *declared but unloadable* icon is an error, not a silent fallback. |
| `data.schemaVersion` | Integer ≥ 1. See §6. |
| `tools[].name` | `^[a-z][a-z0-9_-]{0,63}$`, unique within the app. |
| `tools[].inputSchema` | An object JSON Schema. Compiled with Ajv at discovery. |
| `contributions.messageActions` | Optional host actions with bilingual labels, a non-destructive declared tool, and `text/image/file` accepts. |
| `ai.capabilities` | Optional host AI facade; v1 supports `text` and `transcription`. |
| `ai.uploadLimits` | Transcription apps only; explicit `/api/*` raw-body routes, capped at 25 MiB. |
| `host.capabilities` | Optional device capability grant. V1 supports only `audioCapture`; declaring it does not bypass Desktop and service-side authorization checks. |
| unknown top-level keys | **Rejected** — a typo must not be silently ignored. |

Apps using `contributions` or `ai` must require `engines.molibot >=2.9.8`. Older hosts reject the manifest; there are no compatibility aliases.

### Tool naming and risk

Molibot registers your tool internally as `miniapp__<appId>__<toolName>` and
displays it as `<appId>.<toolName>`. You never write these names yourself.

Risk comes from your semantic hints, never from the tool's name:

| Hints | Risk | Effect |
| --- | --- | --- |
| `readOnlyHint: true` | low | Runs through the policy pipeline. |
| `destructiveHint: true` | high | Requires owner approval before each call. |
| neither / both absent | medium | Runs through the policy pipeline. |

`readOnlyHint` and `destructiveHint` cannot both be true.

### Discoverability

Your tools are **deferred**: they are not in the model's prompt by default. The
agent finds them with `toolSearch` using domain keywords, so `keywords` is what
makes your app reachable. Include the words your users actually say, in every
language they use — `["todo", "task", "待办", "任务"]`, not just `["todo"]`.

---

## 3. `server/index.mjs`

Default-export a factory. Molibot calls it **once** per app and routes both tool
calls and HTTP requests into that one instance — which is what lets a single
database connection and a single set of business rules serve both entrances.

```js
export default function create(context) {
  // context.appId  — your app id
  // context.dataDir — your private data directory, already created
  // context.logger  — info/warn/error into the service log

  return {
    tools: { /* one handler per manifest tool, exactly */ },
    async handleHttp(request) { /* your UI's API */ },
    dispose() { /* close files, sockets, database handles */ }
  };
}
```

The handler set must match the manifest **exactly**. A missing handler is a tool
the agent can call and that would fail at runtime; an extra handler is an
undeclared capability with no schema and no risk classification. Either one
fails the load with a visible error.

### Tool handlers

```js
async function add(input, { toolCallId, signal }) {
  return {
    content: [{ type: "text", text: "Added: milk" }],
    structuredContent: { id: "…", title: "milk" },
    changed: true
  };
}
```

`input` has already been validated against your `inputSchema`, so you can trust
its shape — but still enforce your own business rules (an amount must be
positive, a title must not be blank). Set `changed: true` whenever the call
mutated data: that is what advances the revision counter your UI polls.

Throw a plain `Error` to fail a call. The message reaches the agent with host
paths stripped; the stack goes to the service log only.

### The HTTP handler

Your UI calls `./api/*`, relative to its own document. The host normalizes the
request and hands you a plain JSON object:

```js
async handleHttp(request) {
  // request.method — "GET" | "POST" | "PATCH" | "DELETE"
  // request.path   — app-relative, e.g. "/todos/abc123"
  // request.query  — Record<string, string[]>
  // request.body   — parsed JSON, or undefined for GET
  // request.signal — AbortSignal

  if (request.path === "/todos" && request.method === "GET") {
    return { body: { todos: store.list() } };
  }
  return { status: 404, body: { error: "Unknown endpoint." } };
}
```

The host owns the envelope, so you cannot and need not set headers, cookies,
CORS or CSP. It also reserves `/_host/state`, which returns
`{ appId, enabled, revision, schemaVersion }` without reaching your code.

**Share one domain module.** The single most important rule in this guide: your
tool handlers and your HTTP handler must call the same functions. If `todo.add`
and `POST /todos` each write their own SQL, the agent and the UI will eventually
disagree, and the bug will only appear for users who use both.

### Host actions, composer bridge, AI, and jobs

- Message actions invoke a declared non-destructive tool with `{ capture }` directly, without a model. Captures never contain conversation ids or host paths; resources are opaque paths relative to the app's `incoming/` directory.
- The v1 UI bridge posts `{ protocol: "molibot-miniapp", version: 1, action: "composer.insert", payload: { text, mode } }`. It can append or replace at most 32 KiB in an editable draft, never send it. Keep the app useful if the host ignores the bridge.
- `context.ai.generateText()` and `.transcribe()` use the owner's live host routing and credentials. The app declares capabilities, but never chooses a Provider or sees a key. Transcription accepts only a real file contained by the app data directory, at most 25 MiB and 10 minutes.
- A declared non-JSON upload route receives `Uint8Array` in `request.body` and normalized `request.contentType`; undeclared routes retain the 1 MiB JSON contract.
- Stable AI errors are `capability_not_declared`, `capability_unavailable`, `invalid_request`, `rate_limited`, `provider_failed`, and `aborted`.
- Persist jobs and segment states before starting asynchronous work. Catch every background promise, make repeated segment requests idempotent, and convert active states to `interrupted` when the runtime starts after a service restart.

---

## 4. The UI

Molibot serves `ui/` at `/miniapps/<app-id>/`, and the desktop app loads it in a
sandboxed iframe on its own origin. Your page:

- **Cannot** reach the parent DOM, Tauri IPC or another app's origin. This is
  deliberate and not configurable.
- **Can** use `fetch` against `./api/*` with ordinary relative URLs.
- Runs under a host-set CSP: same-origin scripts and styles only, no `<object>`,
  no external form actions, no `<base>` rewriting. Inline `<script>` will not
  run — put your code in a `.js` file.

The iframe URL carries two non-sensitive display hints:

```
molibot-miniapp://todo/index.html?locale=zh-CN&theme=dark
```

Read them from `location.search` and ship your own strings and light/dark
tokens; your app cannot inherit Molibot's. Changing language or theme reloads
the iframe, so you only need to read the hints at startup.

### Staying fresh

There is no push channel in V1. Poll `./api/_host/state` and refetch only when
`revision` changes:

```js
setInterval(async () => {
  if (document.hidden) return;             // a background panel costs nothing
  const { revision } = await (await fetch("./api/_host/state")).json();
  if (revision !== lastRevision) { lastRevision = revision; await loadList(); }
}, 2000);
```

Always load your data once on startup regardless of revision — a panel opened
after the fact has no baseline to compare against.

Handle the two terminal statuses so a switched-off app does not look broken:

| Status | Meaning | What to show |
| --- | --- | --- |
| `403` | The app is disabled | "Turn it back on in Settings › Plugins", stop polling |
| `503` | The app failed to load | "Check Settings › Plugins for the error", stop polling |
| network error | Molibot restarting | A recoverable notice; keep polling, keep the list |

---

## 5. Trust model

App server code is **owner-installed, fully trusted code** that runs in a
dedicated child process. Exits, crashes, OOMs, and synchronous stalls are
contained there, but this is not a permission sandbox: the code still has the
owner's OS permissions. The directory convention ("an app only touches its own
`data/`") is enforced at the HTTP routing boundary, not as a security guarantee.

The UI has a separate isolation boundary: a distinct origin, sandboxed iframe,
and no host APIs.

Two obligations follow for you as an author:

1. Never return host absolute paths, credentials or API keys in an HTTP
   response. Use opaque ids.
2. Treat anything that arrives from a channel as untrusted input, exactly as the
   rest of Molibot does.

**This applies to every source equally.** Installing from GitHub or a ZIP does
not sandbox anything — it runs someone else's code with your privileges. What
the installer does guarantee is narrower: the archive cannot write outside the
staging directory (traversal entries, symlinks, oversized and zip-bomb archives
are refused), the manifest must validate before anything reaches the install
root, and the app's origin is recorded and shown in the manager so you can
always see what you are running.

Signing, permission scopes and subprocess sandboxing remain unbuilt. Until they
exist, install only apps you wrote or have read.

---

## 6. Data and upgrades

Your data lives at `~/.molibot/miniapps/data/<app-id>/`. SQLite (via Node's
built-in `node:sqlite`) or JSON both work; Todo uses SQLite with WAL, a busy
timeout and a transaction per mutation.

The host writes one file of its own there, `_host.json`, recording your
`data.schemaVersion`.

- **Ordinary upgrade** — keep `schemaVersion` the same, replace `apps/<id>`,
  restart. Data is untouched.
- **Schema change** — bump `schemaVersion`. Molibot does **not** migrate your
  data. It stops the app with an error instead of guessing, so migrate the data
  yourself before shipping the new code.

Uninstalling asks the owner whether to delete `data/<id>`. If they keep it,
reinstalling the code restores their history.

---

## 7. Checklist

Before you call an app done:

- [ ] Directory name equals `manifest.id`; `runtime.entry` is `.mjs`.
- [ ] Tool handlers match the manifest exactly — no missing, no extra.
- [ ] Tool handlers and the HTTP handler call one shared domain module.
- [ ] `keywords` cover every phrase your users say, in every language.
- [ ] `destructiveHint: true` on anything that permanently deletes data.
- [ ] Mutating calls return `changed: true`.
- [ ] The UI polls `_host/state` and handles 403, 503 and connection loss.
- [ ] No absolute paths or secrets in any HTTP response.
- [ ] `ui.icon` points at a real SVG/PNG under `ui/` (or is omitted entirely).
- [ ] Install or update the app and open it immediately — the new code must be active without restarting Molibot.
- [ ] Restart Molibot and open the panel cold — first open must not be blank.
