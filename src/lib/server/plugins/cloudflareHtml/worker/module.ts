export interface Env {
  HTML_BUCKET: R2Bucket;
  ROUTE_PREFIX?: string;
  OBJECT_PREFIX?: string;
  CACHE_CONTROL?: string;
}

function normalizeRoutePrefix(value: string | undefined): string {
  const raw = String(value ?? "/html").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return raw ? `/${raw}` : "/html";
}

function normalizeObjectPrefix(value: string | undefined): string {
  const raw = String(value ?? "html/").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return raw ? `${raw}/` : "html/";
}

function createError(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

function extractFileName(pathname: string, routePrefix: string): string | null {
  if (!pathname.startsWith(`${routePrefix}/`)) return null;
  const fileName = pathname.slice(routePrefix.length + 1).trim();
  if (!fileName) return null;
  if (fileName.includes("/") || fileName.includes("\\")) return null;
  if (!/^[a-z0-9][a-z0-9._-]*\.html$/i.test(fileName)) return null;
  return fileName;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return createError(405, "Method Not Allowed");
    }

    const url = new URL(request.url);
    const routePrefix = normalizeRoutePrefix(env.ROUTE_PREFIX);
    const objectPrefix = normalizeObjectPrefix(env.OBJECT_PREFIX);
    const fileName = extractFileName(url.pathname, routePrefix);

    if (!fileName) {
      return createError(404, "Not Found");
    }

    const objectKey = `${objectPrefix}${fileName}`;
    const object = await env.HTML_BUCKET.get(objectKey);
    if (!object) {
      return createError(404, "Not Found");
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("x-content-type-options", "nosniff");
    headers.set("cache-control", String(env.CACHE_CONTROL ?? "public, max-age=300").trim() || "public, max-age=300");

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers
      });
    }

    return new Response(object.body, {
      status: 200,
      headers
    });
  }
};
