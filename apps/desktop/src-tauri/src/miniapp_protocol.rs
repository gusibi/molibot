use std::time::Duration;

use tauri::http::{Request, Response, StatusCode};
use tauri::UriSchemeResponder;

/// Custom-protocol transport for Mini App UIs.
///
/// The Molibot server port is chosen at runtime by the supervisor, but a Tauri
/// CSP is fixed at build time — so a `frame-src` naming the real loopback URL is
/// impossible, and widening it to every localhost port would let any page in the
/// WebView frame anything listening locally.
///
/// Instead each Mini App gets a fixed, isolated origin,
/// `molibot-miniapp://<app-id>/…`, and this module forwards those requests to
/// `http://127.0.0.1:<current-port>/miniapps/<app-id>/…`. The CSP then needs
/// only `frame-src molibot-miniapp:`.
///
/// This is an HTTP transport adapter and nothing more. It is not an MCP bridge,
/// it does not let a Mini App call agent tools, and the upstream it forwards to
/// comes from the supervisor's own state — never from anything the iframe says.
const PROXY_HEADER: &str = "x-molibot-miniapp-proxy";
const PROXY_VALUE: &str = "v1";
// Transport ceiling only. The server applies the manifest's per-App/per-route
// allowance before the Mini App runtime sees any bytes.
const MAX_REQUEST_BYTES: usize = 25 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Response headers worth passing back. Anything else (cookies, auth, CORS
/// grants, hop-by-hop headers) is dropped rather than forwarded blindly.
const FORWARDED_RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "cache-control",
    "content-security-policy",
    "x-content-type-options",
    "x-molibot-miniapp-revision",
];

/// Request headers worth forwarding. Deliberately excludes `cookie`,
/// `authorization` and `origin`.
const FORWARDED_REQUEST_HEADERS: &[&str] = &["accept", "accept-language", "content-type"];

/// `^[a-z][a-z0-9-]{1,62}$`, matching the server's Mini App id rule.
fn is_valid_app_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 2 || bytes.len() > 63 {
        return false;
    }
    if !bytes[0].is_ascii_lowercase() {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

/// A path is forwardable only if it is plainly relative-safe: no traversal, no
/// null byte, no backslash, no encoded traversal that would decode server-side.
fn is_safe_path(path: &str) -> bool {
    if path.len() > 1024 || path.contains('\0') || path.contains('\\') {
        return false;
    }
    let lowered = path.to_ascii_lowercase();
    if lowered.contains("%2e%2e") || lowered.contains("%252e") || lowered.contains("%2f%2e%2e") {
        return false;
    }
    !path
        .split('/')
        .any(|segment| segment == ".." || segment == ".")
}

/// The upstream URL for one Mini App request, or `None` when the request must be
/// refused. `endpoint` is the supervisor's current service endpoint.
///
/// Kept pure so the containment rules are testable without a running WebView.
pub fn upstream_url(endpoint: &str, uri: &str) -> Option<String> {
    let rest = uri
        .strip_prefix("molibot-miniapp://")
        // Windows and some WebView versions rewrite a custom scheme to this form.
        .or_else(|| uri.strip_prefix("http://molibot-miniapp."))
        .or_else(|| uri.strip_prefix("https://molibot-miniapp."))?;

    let (authority, tail) = match rest.find(['/', '?']) {
        Some(index) => rest.split_at(index),
        None => (rest, ""),
    };

    // On the rewritten form the authority is `<app-id>.localhost`.
    let app_id = authority
        .strip_suffix(".localhost")
        .unwrap_or(authority)
        .to_ascii_lowercase();
    if !is_valid_app_id(&app_id) {
        return None;
    }

    let (path, query) = match tail.find('?') {
        Some(index) => (&tail[..index], &tail[index..]),
        None => (tail, ""),
    };
    if !is_safe_path(path) || !is_safe_path(query) {
        return None;
    }

    let endpoint = endpoint.trim_end_matches('/');
    if !endpoint.starts_with("http://127.0.0.1:") && !endpoint.starts_with("http://localhost:") {
        return None;
    }

    let normalized_path = path.trim_start_matches('/');
    if normalized_path.is_empty() {
        // The server normalizes `/miniapps/<id>/` to the slash-free form with a
        // 308, and this transport deliberately does not follow redirects — so
        // forwarding the trailing-slash form would leave the panel blank. Ask
        // for the entry document directly, which also keeps the app's relative
        // `./api/*` calls resolving under its own mount point.
        return Some(format!("{endpoint}/miniapps/{app_id}/index.html{query}"));
    }
    Some(format!(
        "{endpoint}/miniapps/{app_id}/{normalized_path}{query}"
    ))
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json; charset=utf-8")
        .header("cache-control", "no-store")
        .body(format!("{{\"error\":{message:?}}}").into_bytes())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Handles one `molibot-miniapp://` request. `endpoint` is `None` while the
/// service is still starting, which is a recoverable 503 rather than an error.
pub fn handle(request: Request<Vec<u8>>, endpoint: Option<String>, responder: UriSchemeResponder) {
    let Some(endpoint) = endpoint else {
        responder.respond(error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "Molibot service is not ready.",
        ));
        return;
    };

    let Some(url) = upstream_url(&endpoint, &request.uri().to_string()) else {
        responder.respond(error_response(
            StatusCode::BAD_REQUEST,
            "Invalid Mini App request.",
        ));
        return;
    };

    if request.body().len() > MAX_REQUEST_BYTES {
        responder.respond(error_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Request body too large.",
        ));
        return;
    }

    let method = request.method().clone();
    let mut headers = Vec::new();
    for name in FORWARDED_REQUEST_HEADERS {
        if let Some(value) = request.headers().get(*name) {
            if let Ok(text) = value.to_str() {
                headers.push(((*name).to_string(), text.to_string()));
            }
        }
    }
    let body = request.body().clone();

    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            // A redirect is the one way an upstream could pull this request off
            // the loopback origin it was pinned to.
            .redirect(reqwest::redirect::Policy::none())
            .build()
        {
            Ok(client) => client,
            Err(_) => {
                responder.respond(error_response(
                    StatusCode::BAD_GATEWAY,
                    "Could not reach the Molibot service.",
                ));
                return;
            }
        };

        let mut builder = client.request(method, &url);
        for (name, value) in headers {
            builder = builder.header(name, value);
        }
        // Set last and unconditionally: the marker must be ours, never the
        // iframe's. The server refuses any request without it, which is what
        // stops an ordinary web page from driving a Mini App over loopback.
        builder = builder.header(PROXY_HEADER, PROXY_VALUE);
        if !body.is_empty() {
            builder = builder.body(body);
        }

        let response = match builder.send().await {
            Ok(response) => response,
            Err(_) => {
                responder.respond(error_response(
                    StatusCode::BAD_GATEWAY,
                    "Could not reach the Molibot service.",
                ));
                return;
            }
        };

        let status = response.status();
        let mut out = Response::builder().status(status);
        for name in FORWARDED_RESPONSE_HEADERS {
            if let Some(value) = response.headers().get(*name) {
                out = out.header(*name, value.clone());
            }
        }

        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(_) => {
                responder.respond(error_response(
                    StatusCode::BAD_GATEWAY,
                    "Mini App response could not be read.",
                ));
                return;
            }
        };
        if bytes.len() > MAX_RESPONSE_BYTES {
            responder.respond(error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Mini App response too large.",
            ));
            return;
        }

        responder.respond(
            out.body(bytes.to_vec())
                .unwrap_or_else(|_| Response::new(Vec::new())),
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENDPOINT: &str = "http://127.0.0.1:3117";

    #[test]
    fn maps_an_app_request_onto_the_runtime_endpoint() {
        assert_eq!(
            upstream_url(ENDPOINT, "molibot-miniapp://todo/index.html"),
            Some("http://127.0.0.1:3117/miniapps/todo/index.html".into())
        );
    }

    #[test]
    fn a_bare_app_root_asks_for_the_entry_document_instead_of_a_redirect() {
        // The server 308s the trailing-slash form, and this transport does not
        // follow redirects — a bare root must resolve to a real document or the
        // panel renders blank.
        for uri in ["molibot-miniapp://todo/", "molibot-miniapp://todo"] {
            assert_eq!(
                upstream_url(ENDPOINT, uri),
                Some("http://127.0.0.1:3117/miniapps/todo/index.html".into()),
                "{uri} must reach the entry document"
            );
        }
        assert_eq!(
            upstream_url(ENDPOINT, "molibot-miniapp://todo/?locale=zh-CN&theme=dark"),
            Some("http://127.0.0.1:3117/miniapps/todo/index.html?locale=zh-CN&theme=dark".into())
        );
    }

    #[test]
    fn preserves_the_query_string_for_locale_and_theme_hints() {
        assert_eq!(
            upstream_url(ENDPOINT, "molibot-miniapp://todo/index.html?locale=zh-CN&theme=dark"),
            Some("http://127.0.0.1:3117/miniapps/todo/index.html?locale=zh-CN&theme=dark".into())
        );
    }

    #[test]
    fn accepts_the_rewritten_subdomain_form() {
        assert_eq!(
            upstream_url(ENDPOINT, "http://molibot-miniapp.todo.localhost/app.js"),
            Some("http://127.0.0.1:3117/miniapps/todo/app.js".into())
        );
    }

    #[test]
    fn refuses_path_traversal_in_every_encoding() {
        for uri in [
            "molibot-miniapp://todo/../../etc/passwd",
            "molibot-miniapp://todo/ui/../../../secret",
            "molibot-miniapp://todo/%2e%2e%2fsecret",
            "molibot-miniapp://todo/%252e%252e/secret",
            "molibot-miniapp://todo/./hidden",
        ] {
            assert_eq!(upstream_url(ENDPOINT, uri), None, "{uri} must be refused");
        }
    }

    #[test]
    fn normalizes_host_case_because_url_authorities_are_case_insensitive() {
        // The WebView lowercases the authority itself; matching that keeps a
        // legitimate request working instead of failing as an "invalid id".
        assert_eq!(
            upstream_url(ENDPOINT, "molibot-miniapp://ToDo/index.html"),
            Some("http://127.0.0.1:3117/miniapps/todo/index.html".into())
        );
    }

    #[test]
    fn refuses_invalid_app_ids() {
        for uri in [
            "molibot-miniapp:///index.html",
            "molibot-miniapp://../index.html",
            "molibot-miniapp://a/index.html",
            "molibot-miniapp://9todo/index.html",
            "molibot-miniapp://to_do/index.html",
        ] {
            assert_eq!(upstream_url(ENDPOINT, uri), None, "{uri} must be refused");
        }
    }

    #[test]
    fn refuses_a_foreign_scheme() {
        assert_eq!(upstream_url(ENDPOINT, "https://evil.example/todo/index.html"), None);
        assert_eq!(upstream_url(ENDPOINT, "file:///etc/passwd"), None);
    }

    #[test]
    fn refuses_a_non_loopback_endpoint() {
        // The upstream comes from supervisor state; if that state were ever
        // something other than loopback, the transport still must not follow it.
        assert_eq!(upstream_url("http://example.com:80", "molibot-miniapp://todo/"), None);
        assert_eq!(upstream_url("https://127.0.0.1:3117", "molibot-miniapp://todo/"), None);
    }

    #[test]
    fn always_targets_the_apps_own_mount_point() {
        // No input may produce an upstream path outside /miniapps/<app-id>/.
        for uri in [
            "molibot-miniapp://todo/index.html",
            "molibot-miniapp://todo/api/_host/state",
            "molibot-miniapp://expenses/assets/icon.svg",
        ] {
            let url = upstream_url(ENDPOINT, uri).expect("should map");
            let app_id = uri
                .trim_start_matches("molibot-miniapp://")
                .split('/')
                .next()
                .unwrap();
            assert!(
                url.starts_with(&format!("{ENDPOINT}/miniapps/{app_id}/")),
                "{url} escaped its mount point"
            );
        }
    }
}
