# Cloudflare HTML Worker

This folder contains the Worker-side code for the built-in `Cloudflare HTML Publish` plugin.

Important: the Worker is optional now. If you choose `Direct R2` mode in Molibot plugin settings, you can skip this Worker entirely and return the public R2 URL directly.

## Which file should you use?

- `index.js`: use this if you paste code into the Cloudflare dashboard or run in classic script mode
- `module.ts`: use this if you deploy with Wrangler in module mode

## What this Worker does

- accepts `GET` and `HEAD`
- matches `/<routePrefix>/<fileName>.html`
- reads the matching object from R2
- returns it as `text/html`
- returns `404` if the object is missing or the path is invalid
- allows normal safe HTML file names such as `gold_daily_20260420_v5.html`

## Expected config

- R2 binding: `HTML_BUCKET`
- Worker var: `ROUTE_PREFIX`
- Worker var: `OBJECT_PREFIX`
- Worker var: `CACHE_CONTROL`

## Default route shape

If you keep the defaults:

- `ROUTE_PREFIX=/html`
- `OBJECT_PREFIX=html/`

Then:

- request URL: `/html/ab12cd34ef56ab78cd90.html`
- R2 object key: `html/ab12cd34ef56ab78cd90.html`

Custom names also work, for example:

- request URL: `/html/gold_daily_20260420_v5.html`
- R2 object key: `html/gold_daily_20260420_v5.html`

## Deployment notes

1. If you use the Cloudflare dashboard quick editor, paste `index.js`.
2. If you use Wrangler, copy `wrangler.example.toml` and use `module.ts`.
3. Bind `HTML_BUCKET` to the same R2 bucket used by Molibot upload settings.
4. Keep `ROUTE_PREFIX` aligned with the plugin setting in Molibot.
5. Keep `OBJECT_PREFIX` aligned with the plugin setting in Molibot.
6. Deploy the Worker and point your public host to it.
