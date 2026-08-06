use std::time::Duration;

use tauri::http::{Request, Response, StatusCode};
use tauri::UriSchemeResponder;

/// Custom-protocol transport for the Artifact Panel's HTML preview.
///
/// Mirrors `miniapp_protocol.rs`: a fixed, isolated origin
/// `molibot-artifact://artifact/<scope>/<token>/<path>` the build-time CSP can
/// name, forwarded to `http://127.0.0.1:<port>/api/desktop/artifacts/<scope>/<token>/<path>`.
/// The CSP then needs only `frame-src molibot-artifact:`, and the server gates
/// every request on a marker header no web page can forge.
///
/// The upstream endpoint comes from the supervisor's state, never from the
/// iframe. The route validates the path against its registered root, so this
/// adapter only needs to refuse traversal and pin the loopback origin.
const PROXY_HEADER: &str = "x-molibot-artifact-proxy";
const PROXY_VALUE: &str = "v1";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Response headers worth passing back. Anything else (cookies, auth, CORS
/// grants, hop-by-hop headers) is dropped rather than forwarded blindly.
const FORWARDED_RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "cache-control",
    "content-security-policy",
    "x-content-type-options",
];

/// Request headers worth forwarding. Deliberately excludes `cookie`,
/// `authorization` and `origin`.
const FORWARDED_REQUEST_HEADERS: &[&str] = &["accept", "accept-language", "content-type"];

/// A scope/token pair is the artifact route's identity. Project ids are UUIDs or
/// readable slugs; both are safe when limited to alphanumerics, `-` and `_`.
fn is_valid_token(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return false;
    }
    bytes
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-' || *byte == b'_')
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

/// The upstream URL for one artifact request, or `None` when the request must be
/// refused. `endpoint` is the supervisor's current service endpoint.
///
/// Kept pure so the containment rules are testable without a running WebView.
pub fn upstream_url(endpoint: &str, uri: &str) -> Option<String> {
    let rest = uri
        .strip_prefix("molibot-artifact://")
        // Windows and some WebView versions rewrite a custom scheme to this form.
        .or_else(|| uri.strip_prefix("http://molibot-artifact."))
        .or_else(|| uri.strip_prefix("https://molibot-artifact."))?;

    let (authority, tail) = match rest.find(['/', '?']) {
        Some(index) => rest.split_at(index),
        None => (rest, ""),
    };

    // The authority is the fixed `artifact` host (or `artifact.localhost` on the
    // rewritten form); the scope, token and file path live in the URL path.
    let auth = authority
        .strip_suffix(".localhost")
        .unwrap_or(authority)
        .to_ascii_lowercase();
    if auth != "artifact" {
        return None;
    }

    let (path, query) = match tail.find('?') {
        Some(index) => (&tail[..index], &tail[index..]),
        None => (tail, ""),
    };
    if !is_safe_path(path) || !is_safe_path(query) {
        return None;
    }

    // path is "/<scope>/<token>/<rest...>"; the scope and token are the first two
    // segments, the rest is the Project-relative file path.
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let scope = segments.next()?;
    let token = segments.next()?;
    if scope != "project" {
        return None;
    }
    if !is_valid_token(token) {
        return None;
    }
    let rest_path: String = segments.collect::<Vec<_>>().join("/");
    if rest_path.is_empty() {
        // No file path - the route has nothing to serve. Refuse rather than
        // forward a directory request the server would 404 anyway.
        return None;
    }

    let endpoint = endpoint.trim_end_matches('/');
    if !endpoint.starts_with("http://127.0.0.1:") && !endpoint.starts_with("http://localhost:") {
        return None;
    }

    Some(format!(
        "{endpoint}/api/desktop/artifacts/{scope}/{token}/{rest_path}{query}"
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

/// Handles one `molibot-artifact://` request. `endpoint` is `None` while the
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
            "Invalid artifact request.",
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
        // stops an ordinary web page from driving the artifact route over loopback.
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
                    "Artifact response could not be read.",
                ));
                return;
            }
        };
        if bytes.len() > MAX_RESPONSE_BYTES {
            responder.respond(error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Artifact response too large.",
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
    fn maps_a_project_html_request_onto_the_runtime_endpoint() {
        assert_eq!(
            upstream_url(ENDPOINT, "molibot-artifact://artifact/project/abc-123/report.html"),
            Some("http://127.0.0.1:3117/api/desktop/artifacts/project/abc-123/report.html".into())
        );
    }

    #[test]
    fn preserves_a_nested_relative_asset_path_and_query() {
        assert_eq!(
            upstream_url(
                ENDPOINT,
                "molibot-artifact://artifact/project/abc-123/assets/style.css?locale=zh-CN&theme=dark"
            ),
            Some(
                "http://127.0.0.1:3117/api/desktop/artifacts/project/abc-123/assets/style.css?locale=zh-CN&theme=dark"
                    .into()
            )
        );
    }

    #[test]
    fn accepts_the_rewritten_subdomain_form() {
        assert_eq!(
            upstream_url(ENDPOINT, "http://molibot-artifact.artifact.localhost/project/abc-123/app.js"),
            Some("http://127.0.0.1:3117/api/desktop/artifacts/project/abc-123/app.js".into())
        );
    }

    #[test]
    fn refuses_path_traversal_in_every_encoding() {
        for uri in [
            "molibot-artifact://artifact/project/abc-123/../../etc/passwd",
            "molibot-artifact://artifact/project/abc-123/%2e%2e%2fsecret",
            "molibot-artifact://artifact/project/abc-123/%252e%252e/secret",
            "molibot-artifact://artifact/project/abc-123/./hidden",
        ] {
            assert_eq!(upstream_url(ENDPOINT, uri), None, "{uri} must be refused");
        }
    }

    #[test]
    fn refuses_a_scope_other_than_project() {
        // Session-scope artifact serving arrives in Slice 1b; until then the
        // transport refuses the scope rather than forwarding an unsupported route.
        assert_eq!(
            upstream_url(ENDPOINT, "molibot-artifact://artifact/session/abc-123/report.html"),
            None
        );
    }

    #[test]
    fn refuses_an_invalid_token() {
        for uri in [
            "molibot-artifact://artifact/project//report.html",
            "molibot-artifact://artifact/project/ab%20cd/report.html",
            "molibot-artifact://artifact/project/../report.html",
        ] {
            assert_eq!(upstream_url(ENDPOINT, uri), None, "{uri} must be refused");
        }
    }

    #[test]
    fn refuses_a_request_with_no_file_path() {
        assert_eq!(
            upstream_url(ENDPOINT, "molibot-artifact://artifact/project/abc-123"),
            None
        );
        assert_eq!(
            upstream_url(ENDPOINT, "molibot-artifact://artifact/project/abc-123/"),
            None
        );
    }

    #[test]
    fn refuses_a_foreign_scheme() {
        assert_eq!(
            upstream_url(ENDPOINT, "https://evil.example/artifact/project/abc-123/report.html"),
            None
        );
        assert_eq!(upstream_url(ENDPOINT, "file:///etc/passwd"), None);
    }

    #[test]
    fn refuses_a_non_loopback_endpoint() {
        assert_eq!(
            upstream_url("http://example.com:80", "molibot-artifact://artifact/project/abc-123/report.html"),
            None
        );
        assert_eq!(
            upstream_url("https://127.0.0.1:3117", "molibot-artifact://artifact/project/abc-123/report.html"),
            None
        );
    }

    #[test]
    fn refuses_an_authority_other_than_artifact() {
        assert_eq!(
            upstream_url(ENDPOINT, "molibot-artifact://evil/project/abc-123/report.html"),
            None
        );
    }

    #[test]
    fn always_targets_the_artifact_route() {
        // No input may produce an upstream path outside /api/desktop/artifacts/<scope>/<token>/.
        let prefix = format!("{ENDPOINT}/api/desktop/artifacts/project/abc-123/");
        for uri in [
            "molibot-artifact://artifact/project/abc-123/report.html",
            "molibot-artifact://artifact/project/abc-123/assets/style.css",
            "molibot-artifact://artifact/project/abc-123/nested/deep/page.html?locale=en",
        ] {
            let url = upstream_url(ENDPOINT, uri).expect("should map");
            assert!(url.starts_with(&prefix), "{url} escaped the artifact route");
        }
    }
}
