function normalizeRoutePrefix(value) {
  const raw = String(value ?? "/html").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return raw ? `/${raw}` : "/html";
}

function normalizeObjectPrefix(value) {
  const raw = String(value ?? "html/").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return raw ? `${raw}/` : "html/";
}

function createError(status, message) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

function extractFileName(pathname, routePrefix) {
  if (!pathname.startsWith(`${routePrefix}/`)) return null;
  const fileName = pathname.slice(routePrefix.length + 1).trim();
  if (!fileName) return null;
  if (fileName.includes("/") || fileName.includes("\\")) return null;
  if (!/^[a-z0-9][a-z0-9._-]*\.html$/i.test(fileName)) return null;
  return fileName;
}

async function handleRequest(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return createError(405, "Method Not Allowed");
  }

  const url = new URL(request.url);
  const routePrefix = normalizeRoutePrefix(typeof ROUTE_PREFIX === "string" ? ROUTE_PREFIX : "/html");
  const objectPrefix = normalizeObjectPrefix(typeof OBJECT_PREFIX === "string" ? OBJECT_PREFIX : "html/");
  const fileName = extractFileName(url.pathname, routePrefix);

  if (!fileName) {
    return createError(404, "Not Found");
  }

  const objectKey = `${objectPrefix}${fileName}`;
  const object = await HTML_BUCKET.get(objectKey);
  if (!object) {
    return createError(404, "Not Found");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "cache-control",
    (typeof CACHE_CONTROL === "string" && CACHE_CONTROL.trim()) || "public, max-age=300"
  );

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

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});
