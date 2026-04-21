# Cloudflare HTML Publish Plugin

This plugin lets Molibot publish complete HTML documents to Cloudflare R2 and return a shareable link.

## Two public-link modes

This plugin now supports two ways to build the final public URL.

### 1. Worker mode

Use this when you want a Cloudflare Worker in front of the bucket.

- Molibot uploads HTML into R2
- the final link uses `workerBaseHost + routePrefix + fileName`
- your Worker reads the matching object from R2 and returns it

Example:

- `workerBaseHost = https://molibot-page.example.workers.dev`
- `routePrefix = /page`
- `objectPrefix = html/`
- final URL: `https://molibot-page.example.workers.dev/page/gold_daily_20260420_v5.html`
- R2 object key: `html/gold_daily_20260420_v5.html`

### 2. Direct R2 mode

Use this when your bucket already has a public host and you do not need a Worker in front of it.

- Molibot uploads HTML into R2
- the final link uses `publicBaseHost + objectKey`
- the browser loads the file directly from the public R2 host

Example:

- `publicBaseHost = https://pub-xxxxxxxx.r2.dev`
- `objectPrefix = html/`
- final URL: `https://pub-xxxxxxxx.r2.dev/html/gold_daily_20260420_v5.html`
- R2 object key: `html/gold_daily_20260420_v5.html`

## Which one should you choose?

- Choose Worker mode if you want custom routing, stricter control, custom 404 behavior, or future logic in front of R2.
- Choose Direct R2 mode if you just want the shortest path from upload to public URL.

## Files in this plugin directory

- `plugin.ts`: plugin declaration and settings metadata
- `publishHtmlTool.ts`: upload tool used by Molibot
- `worker/`: optional Worker-side template and notes
