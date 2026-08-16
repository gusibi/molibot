import path from "node:path";
import fs from "node:fs";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * MD Preview Mini App.
 *
 * One domain over the app's own SQLite database: Markdown documents, the local
 * image files they reference, and the Cloudflare R2 upload mapping for those
 * images.
 *
 * The central contract, and the reason this app exists: the Markdown *source*
 * is never rewritten. `![](assets/shot.png)` stays exactly that on disk and in
 * the stored document; the mapping local-file -> public URL lives in the
 * `assets` table and is applied only when the panel copies 公众号 rich text.
 * Upload, therefore, is not a mutation of the document - it is a mutation of
 * the mapping.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  staged_path TEXT,
  original_name TEXT,
  mime TEXT,
  bytes INTEGER,
  sha256 TEXT,
  uploaded_url TEXT,
  uploaded_key TEXT,
  uploaded_at TEXT
);
CREATE INDEX IF NOT EXISTS assets_doc_idx ON assets (doc_id);
CREATE INDEX IF NOT EXISTS assets_sha_idx ON assets (sha256);
CREATE UNIQUE INDEX IF NOT EXISTS assets_doc_ref_idx ON assets (doc_id, ref);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Longest markdown text accepted through the JSON surface (panel paste/picker). */
const MAX_MARKDOWN_BYTES = 512 * 1024;
/** Cap for the remote-image proxy: it exists for preview, not as a downloader. */
const MAX_PROXY_IMAGE_BYTES = 8 * 1024 * 1024;
/** Hard cap per R2 upload, matching the staging default (64 MiB). */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
/** Image extensions the ref scanner treats as a local image candidate. */
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"
]);

const MIME_BY_EXTENSION = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif"
};

class PreviewError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function openDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "md-preview.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

// - Markdown image references - ------------------------------------------------

/**
 * Every image reference in the document, in order of appearance, deduplicated.
 *
 * Both syntaxes are recognized: standard `![alt](path)` and Obsidian-style
 * `![[path|alt]]`. A reference is *remote* when it is an http(s) or data: URL;
 * everything else is a local reference the panel may resolve against staged
 * files.
 */
function scanImageRefs(markdown) {
  const refs = [];
  const seen = new Set();
  const push = (ref) => {
    if (!seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  };

  const MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const WIKI_EMBED = /!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;

  let match;
  while ((match = MD_IMAGE.exec(markdown))) push(decodeRef(match[2]));
  while ((match = WIKI_EMBED.exec(markdown))) push(decodeRef(match[1]));

  return refs
    .map((ref) => ({
      ref,
      remote: /^(https?:)?\/\//i.test(ref) || ref.startsWith("data:"),
      baseName: baseNameOf(ref)
    }))
    .filter((entry) => entry.remote || isImageName(entry.baseName));
}

/** Decode %xx without letting a malformed escape throw. */
function decodeRef(ref) {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}

function baseNameOf(ref) {
  const clean = ref.split(/[?#]/, 1)[0];
  const segments = clean.split("/");
  return segments[segments.length - 1].trim().toLowerCase();
}

function isImageName(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Resolves a stored dataDir-relative path, refusing anything that would leave
 * the data directory. Staged paths arrive from the host's own staging code,
 * but a persisted path is not proof of anything (pitfall 20) - re-check on
 * every use, never only on write.
 */
function resolveInside(dataDir, relative) {
  if (typeof relative !== "string" || relative.length === 0) return null;
  const root = path.resolve(dataDir);
  const resolved = path.resolve(root, relative);
  if (resolved === root || !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

// - Settings - -----------------------------------------------------------------

/** Keys persisted in `settings`; the secret is write-only. */
const SETTING_KEYS = [
  "accountId", "endpoint", "region", "bucket", "accessKeyId",
  "secretAccessKey", "publicBaseUrl", "keyPrefix", "theme"
];
const SECRET_KEYS = new Set(["secretAccessKey"]);

function readSettings(db) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

function writeSettings(db, patch) {
  const write = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const key of SETTING_KEYS) {
      if (patch[key] === undefined) continue;
      // An empty string is a real value here ("clear this field"), not a no-op.
      write.run(key, String(patch[key] ?? "").trim());
    }
    db.exec("COMMIT");
  } catch (cause) {
    try { db.exec("ROLLBACK"); } catch { /* keep the original error */ }
    throw cause;
  }
}

/** What the panel may see: every field except secrets, which become a flag. */
function settingsView(db) {
  const settings = readSettings(db);
  const view = {};
  for (const key of SETTING_KEYS) {
    if (SECRET_KEYS.has(key)) continue;
    view[key] = settings[key] ?? "";
  }
  view.secretSet = Boolean(settings.secretAccessKey);
  return view;
}

// - R2 / S3 SigV4 - --------------------------------------------------------------

/**
 * AWS Signature V4 signing, ported from the reference Obsidian plugin onto
 * node:crypto so it runs in the app's own process. Deterministic given the
 * inputs - which is what the unit test pins.
 */
function signRequest({ host, method, canonicalUri, canonicalQuery, region, accessKeyId, secretAccessKey, payloadHash, contentType, amzDate }) {
  const dateStamp = amzDate.slice(0, 8);
  const headers = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, scope,
    createHash("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");

  const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** RFC3986-encode one key segment; `/` is a separator, not a character to encode. */
function encodeS3Key(key) {
  return key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join("/");
}

function r2Endpoint(settings) {
  let raw = (settings.endpoint ?? "").trim();
  if (!raw) {
    const accountId = (settings.accountId ?? "").trim();
    if (!accountId) throw new PreviewError("R2 needs an Account ID or an Endpoint in settings.", 400);
    raw = `https://${accountId}.r2.cloudflarestorage.com`;
  }
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  return new URL(raw);
}

function requireUploadSettings(settings) {
  if (!settings.bucket) throw new PreviewError("R2 needs a Bucket in settings.", 400);
  if (!settings.accessKeyId || !settings.secretAccessKey) {
    throw new PreviewError("R2 needs an Access Key and Secret in settings.", 400);
  }
}

/**
 * Uploads one staged asset row. The object key is content-addressed
 * (`sha256.ext`, under the optional prefix) so the same image across documents
 * - or a re-open after the mapping row was replaced - maps to one object,
 * never a duplicate.
 */
async function uploadStagedAsset({ dataDir, db, settings, assetRow, fetchImpl = fetch, now = new Date() }) {
  requireUploadSettings(settings);
  const file = resolveInside(dataDir, assetRow.staged_path);
  if (!file || !fs.existsSync(file)) {
    throw new PreviewError(`The staged file for "${assetRow.ref}" is gone; re-open the document from chat.`, 410);
  }
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new PreviewError(`"${assetRow.original_name}" is larger than the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MiB upload limit.`, 413);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const extension = extensionOf(assetRow.original_name ?? "");
  const prefix = (settings.keyPrefix ?? "").replace(/^\/+|\/+$/g, "");
  const key = `${prefix ? `${prefix}/` : ""}${sha256}${extension ? `.${extension}` : ""}`;

  const endpoint = r2Endpoint(settings);
  const region = (settings.region || "auto").trim();
  const contentType = assetRow.mime || MIME_BY_EXTENSION[extension] || "application/octet-stream";
  const canonicalUri = `/${encodeS3Key(settings.bucket)}/${encodeS3Key(key)}`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const payloadHash = createHash("sha256").update(bytes).digest("hex");
  const authorization = signRequest({
    host: endpoint.host,
    method: "PUT",
    canonicalUri,
    canonicalQuery: "",
    region,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    payloadHash,
    contentType,
    amzDate
  });

  const response = await fetchImpl(`${endpoint.protocol}//${endpoint.host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      authorization,
      "content-type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    },
    body: bytes
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new PreviewError(`R2 upload failed (${response.status}): ${detail || "unknown error"}`, 502);
  }

  const base = (settings.publicBaseUrl ?? "").replace(/\/+$/, "");
  const url = base ? `${base}/${encodeS3Key(key)}` : `${endpoint.protocol}//${endpoint.host}${canonicalUri}`;

  db.prepare(
    "UPDATE assets SET sha256 = ?, uploaded_url = ?, uploaded_key = ?, uploaded_at = ? WHERE id = ?"
  ).run(sha256, url, key, now.toISOString(), assetRow.id);

  return { id: assetRow.id, ref: assetRow.ref, url, key, sha256 };
}

/** A zero-key LIST against the configured bucket: proves credentials + endpoint. */
async function testR2Connection(settings, fetchImpl = fetch, now = new Date()) {
  requireUploadSettings(settings);
  const endpoint = r2Endpoint(settings);
  const region = (settings.region || "auto").trim();
  const canonicalUri = `/${encodeS3Key(settings.bucket)}/`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const payloadHash = createHash("sha256").update("").digest("hex");
  const authorization = signRequest({
    host: endpoint.host,
    method: "GET",
    canonicalUri,
    canonicalQuery: "max-keys=0",
    region,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    payloadHash,
    contentType: "application/xml",
    amzDate
  });
  const response = await fetchImpl(
    `${endpoint.protocol}//${endpoint.host}${canonicalUri}?max-keys=0`,
    {
      method: "GET",
      headers: {
        authorization,
        "content-type": "application/xml",
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate
      }
    }
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new PreviewError(`Connection test failed (${response.status}): ${detail || "unknown error"}`, 502);
  }
  return { ok: true };
}

// - Document store - -------------------------------------------------------------

class DocumentStore {
  constructor(dataDir, db) {
    this.dataDir = dataDir;
    this.db = db;
  }

  listDocuments() {
    return this.db
      .prepare(
        `SELECT d.id, d.title, d.updated_at,
                COUNT(a.id) AS asset_count,
                SUM(CASE WHEN a.staged_path IS NOT NULL THEN 1 ELSE 0 END) AS local_count,
                SUM(CASE WHEN a.uploaded_url IS NOT NULL THEN 1 ELSE 0 END) AS uploaded_count
         FROM documents d LEFT JOIN assets a ON a.doc_id = d.id
         GROUP BY d.id ORDER BY d.updated_at DESC`
      )
      .all()
      .map((row) => ({
        id: row.id,
        title: row.title,
        updatedAt: row.updated_at,
        assetCount: row.asset_count ?? 0,
        localCount: row.local_count ?? 0,
        uploadedCount: row.uploaded_count ?? 0
      }));
  }

  getDocument(id) {
    return this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) ?? null;
  }

  /** Raw asset rows (staged paths included) - server-side callers only. */
  assetRows(docId) {
    return this.db.prepare("SELECT * FROM assets WHERE doc_id = ? ORDER BY ref ASC").all(docId);
  }

  /** The asset list the panel may see: metadata only, no staged paths. */
  getAssets(docId) {
    return this.assetRows(docId).map((row) => ({
      id: row.id,
      ref: row.ref,
      remote: row.staged_path === null,
      originalName: row.original_name,
      mime: row.mime,
      bytes: row.bytes,
      uploadedUrl: row.uploaded_url,
      uploadedKey: row.uploaded_key
    }));
  }

  /**
   * Creates or replaces a document from Markdown text plus (optionally) staged
   * image files. The Markdown is stored verbatim; assets are matched to local
   * references by basename, and every unmatched local reference is reported
   * back so the caller - the agent, or the panel - can supply the file.
   */
  upsertDocument({ title, markdown, stagedImages = [], documentId }) {
    const trimmed = String(markdown ?? "");
    if (!trimmed.trim()) throw new PreviewError("A document needs Markdown content.", 400);
    if (Buffer.byteLength(trimmed, "utf8") > MAX_MARKDOWN_BYTES) {
      throw new PreviewError("Markdown is limited to 512 KiB.", 413);
    }

    const now = new Date().toISOString();
    const refs = scanImageRefs(trimmed);
    const id = documentId ?? randomUUID();
    const derivedTitle = (title ?? "").trim() || deriveTitle(trimmed);

    // Index staged images by basename for matching. Two staged files with the
    // same basename are ambiguous by definition: first wins, the rest are
    // reported unused rather than silently dropped.
    const byBaseName = new Map();
    const unusedImages = [];
    for (const image of stagedImages) {
      const base = String(image.name ?? "").toLowerCase();
      if (!base) continue;
      if (byBaseName.has(base)) unusedImages.push(image.name);
      else byBaseName.set(base, image);
    }

    const resolvedRefs = new Set();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO documents (id, title, markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, markdown = excluded.markdown, updated_at = excluded.updated_at"
        )
        .run(id, derivedTitle, trimmed, now, now);
      this.db.prepare("DELETE FROM assets WHERE doc_id = ?").run(id);

      const insertAsset = this.db.prepare(
        "INSERT INTO assets (id, doc_id, ref, staged_path, original_name, mime, bytes, sha256, uploaded_url, uploaded_key, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      // A previously uploaded image may come back with the same content: look
      // the sha256 up among other rows so a re-open does not force a re-upload.
      const findPriorUpload = this.db.prepare(
        "SELECT uploaded_url, uploaded_key FROM assets WHERE sha256 = ? AND uploaded_url IS NOT NULL LIMIT 1"
      );

      // Resolved refs leave the map, so "still in the map" cannot distinguish
      // "matched" from "never had a candidate" - track resolution explicitly.
      for (const entry of refs) {
        if (entry.remote) {
          insertAsset.run(randomUUID(), id, entry.ref, null, null, null, null, null, null, null, null);
          continue;
        }
        const staged = byBaseName.get(entry.baseName);
        if (!staged) continue; // unresolved; reported below, never stored half-way
        resolvedRefs.add(entry.ref);
        const sha256 = sha256OfStaged(this.dataDir, staged.path);
        const prior = sha256 ? findPriorUpload.get(sha256) : null;
        insertAsset.run(
          randomUUID(), id, entry.ref, staged.path ?? null, staged.name ?? null,
          staged.mime ?? null, staged.bytes ?? null, sha256,
          prior?.uploaded_url ?? null, prior?.uploaded_key ?? null, prior ? now : null
        );
        byBaseName.delete(entry.baseName);
      }

      this.db.exec("COMMIT");
    } catch (cause) {
      try { this.db.exec("ROLLBACK"); } catch { /* keep the original error */ }
      throw cause;
    }

    return {
      documentId: id,
      title: derivedTitle,
      unresolvedRefs: refs
        .filter((entry) => !entry.remote && !resolvedRefs.has(entry.ref))
        .map((entry) => entry.ref),
      unusedImages
    };
  }

  deleteDocument(id) {
    const existing = this.getDocument(id);
    if (!existing) throw new PreviewError("No document with that id.", 404);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM assets WHERE doc_id = ?").run(id);
      this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
      this.db.exec("COMMIT");
    } catch (cause) {
      try { this.db.exec("ROLLBACK"); } catch { /* keep the original error */ }
      throw cause;
    }
    return existing;
  }

  /** The staged asset data as a data URI - the only image form the panel CSP allows. */
  assetDataUri(assetId) {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId);
    if (!row) throw new PreviewError("No asset with that id.", 404);
    if (!row.staged_path) throw new PreviewError("This asset has no local file.", 400);
    const file = resolveInside(this.dataDir, row.staged_path);
    if (!file || !fs.existsSync(file)) {
      throw new PreviewError("The staged file is gone; re-open the document from chat.", 410);
    }
    const extension = extensionOf(row.original_name ?? "");
    const mime = row.mime || MIME_BY_EXTENSION[extension] || "application/octet-stream";
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  }
}

function sha256OfStaged(dataDir, relative) {
  const file = resolveInside(dataDir, relative);
  if (!file || !fs.existsSync(file)) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function deriveTitle(markdown) {
  for (const line of markdown.split(/\r?\n/, 20)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) return heading[1].trim().slice(0, 120);
  }
  const firstText = markdown.split(/\r?\n/).find((line) => line.trim().length > 0);
  return (firstText ?? "Untitled").trim().replace(/^[#>\-*\s]+/, "").slice(0, 120) || "Untitled";
}

// - Tool output helpers - ----------------------------------------------------------

function text(value) {
  return { content: [{ type: "text", text: value }] };
}

function previewCard(appId, doc) {
  return {
    title: doc.title,
    subtitle: "Opened in MD Preview",
    icon: "eye",
    fields: [],
    link: `molibot://miniapp/${appId}/doc/${encodeURIComponent(doc.documentId)}`
  };
}

// - App factory - -------------------------------------------------------------------

export default function createMdPreviewApp(context) {
  const db = openDatabase(context.dataDir);
  const store = new DocumentStore(context.dataDir, db);
  context.logger?.info("ready");

  return {
    tools: {
      /**
       * `markdownPath` and `images` arrive already staged by the host
       * (fileParams): values are dataDir-relative paths, and
       * `callContext.stagedFiles` carries each file's original name, mime and
       * size. The panel-facing flow never sees workspace paths.
       */
      preview: async (input, callContext) => {
        const markdownPath = typeof input?.markdownPath === "string" ? input.markdownPath : "";
        if (!markdownPath) {
          return text("A markdownPath is required. Pass the path to the Markdown file.");
        }
        const file = resolveInside(context.dataDir, markdownPath);
        if (!file || !fs.existsSync(file)) {
          return text(`The staged markdown file "${markdownPath}" is not readable. Pass a workspace path and let the host stage it.`);
        }
        const markdown = fs.readFileSync(file, "utf8");

        const stagedImages = callContext?.stagedFiles?.images
          ?? (Array.isArray(input?.images)
            ? input.images.map((p) => ({ name: path.basename(String(p)), path: String(p), mime: null, bytes: null }))
            : []);

        const doc = store.upsertDocument({ markdown, stagedImages });
        const unresolved = doc.unresolvedRefs.length > 0
          ? ` ${doc.unresolvedRefs.length} local image reference(s) could not be resolved: ${doc.unresolvedRefs.join(", ")}. Call again with those files in "images" so preview and upload can use them.`
          : "";
        return {
          ...text(`Previewing "${doc.title}" in MD Preview.${unresolved}`),
          structuredContent: doc,
          changed: true,
          card: previewCard(context.appId, doc)
        };
      }
    },

    async handleHttp(request) {
      try {
        return await route(request);
      } catch (cause) {
        if (cause instanceof PreviewError) {
          return { status: cause.status, body: { error: cause.message } };
        }
        throw cause;
      }
    },

    dispose() {
      db.close();
    }
  };

  async function route(request) {
    const { method, path: requestPath, query, body } = request;

    if (requestPath === "/documents") {
      if (method === "GET") return { body: { documents: store.listDocuments() } };
      if (method === "POST") {
        if (typeof body?.markdown !== "string") {
          throw new PreviewError("POST /documents requires a \"markdown\" field.", 400);
        }
        const doc = store.upsertDocument({ markdown: body.markdown, title: body?.title });
        return { status: 201, body: { document: doc }, changed: true };
      }
      return { status: 405, body: { error: `${method} is not allowed on /documents.` } };
    }

    const docMatch = requestPath.match(/^\/documents\/([^/]+)$/);
    if (docMatch) {
      const id = docMatch[1];
      if (method === "GET") {
        const document = store.getDocument(id);
        if (!document) throw new PreviewError("No document with that id.", 404);
        return { body: { document, assets: store.getAssets(id) } };
      }
      if (method === "PATCH") {
        const existing = store.getDocument(id);
        if (!existing) throw new PreviewError("No document with that id.", 404);
        if (typeof body?.markdown !== "string") {
          throw new PreviewError("PATCH requires a \"markdown\" field.", 400);
        }
        const result = store.upsertDocument({
          markdown: body.markdown,
          title: body?.title ?? existing.title,
          documentId: id
        });
        return { body: { document: result }, changed: true };
      }
      if (method === "DELETE") {
        store.deleteDocument(id);
        return { body: { deleted: true }, changed: true };
      }
      return { status: 405, body: { error: `${method} is not allowed on a document.` } };
    }

    const assetMatch = requestPath.match(/^\/documents\/([^/]+)\/assets\/([^/]+)$/);
    if (assetMatch) {
      if (method === "GET") {
        return { body: { dataUri: store.assetDataUri(assetMatch[2]) } };
      }
      return { status: 405, body: { error: `${method} is not allowed on an asset.` } };
    }

    const uploadMatch = requestPath.match(/^\/documents\/([^/]+)\/upload$/);
    if (uploadMatch) {
      if (method !== "POST") {
        return { status: 405, body: { error: `${method} is not allowed on /upload.` } };
      }
      const id = uploadMatch[1];
      if (!store.getDocument(id)) throw new PreviewError("No document with that id.", 404);
      const settings = readSettings(db);
      const only = Array.isArray(body?.assetIds) ? new Set(body.assetIds) : null;
      const pending = store.assetRows(id).filter(
        (row) => row.staged_path !== null && row.uploaded_url === null && (!only || only.has(row.id))
      );
      const uploaded = [];
      const failures = [];
      for (const row of pending) {
        try {
          uploaded.push(await uploadStagedAsset({ dataDir: context.dataDir, db, settings, assetRow: row }));
        } catch (cause) {
          failures.push({ ref: row.ref, error: cause instanceof Error ? cause.message : String(cause) });
        }
      }
      return { body: { uploaded, failures }, changed: uploaded.length > 0 };
    }

    if (requestPath === "/settings") {
      if (method === "GET") return { body: { settings: settingsView(db) } };
      if (method === "PUT") {
        writeSettings(db, body ?? {});
        return { body: { settings: settingsView(db) }, changed: true };
      }
      return { status: 405, body: { error: `${method} is not allowed on /settings.` } };
    }

    if (requestPath === "/settings/test" && method === "POST") {
      // Never a `changed` bump: a credential test mutates nothing.
      return { body: { result: await testR2Connection(readSettings(db)) } };
    }

    if (requestPath === "/proxy-image" && method === "GET") {
      const url = query?.url?.[0] ?? "";
      if (!/^https?:\/\//i.test(url)) throw new PreviewError("proxy-image requires an http(s) url.", 400);
      return { body: { dataUri: await proxyImage(url) } };
    }

    return { status: 404, body: { error: "Unknown MD Preview endpoint." } };
  }

  async function proxyImage(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new PreviewError(`Image fetch failed (${response.status}).`, 502);
    const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim();
    if (!mime.startsWith("image/")) throw new PreviewError("That URL did not return an image.", 415);
    const received = new Uint8Array(await response.arrayBuffer());
    if (received.byteLength > MAX_PROXY_IMAGE_BYTES) {
      throw new PreviewError("Image exceeds the 8 MiB proxy limit.", 413);
    }
    return `data:${mime};base64,${Buffer.from(received).toString("base64")}`;
  }
}
