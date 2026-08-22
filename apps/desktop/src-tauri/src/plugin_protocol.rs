use std::time::Duration;

use tauri::http::{Request, Response, StatusCode};
use tauri::UriSchemeResponder;

/// Fixed-origin transport for installable-plugin settings UIs.
///
/// The service port is selected at runtime, while Tauri's CSP is fixed at
/// build time. `molibot-plugin://<plugin-id>/...` lets the CSP name one narrow
/// source without granting iframe access to every process listening locally.
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const FORWARDED_RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "cache-control",
    "content-security-policy",
    "x-content-type-options",
];

fn is_valid_plugin_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 2 || bytes.len() > 63 || !bytes[0].is_ascii_lowercase() {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn is_safe_path(path: &str) -> bool {
    if path.is_empty() || path.len() > 1024 || path.contains('\0') || path.contains('\\') {
        return false;
    }
    let lowered = path.to_ascii_lowercase();
    if lowered.contains("%2e%2e") || lowered.contains("%252e") || lowered.contains("%2f%2e%2e") {
        return false;
    }
    !path
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

/// Maps one custom-protocol request to the matching plugin's UI-only mount.
/// Kept pure so the origin, traversal, and loopback constraints stay tested.
pub fn upstream_url(endpoint: &str, uri: &str) -> Option<String> {
    let rest = uri
        .strip_prefix("molibot-plugin://")
        .or_else(|| uri.strip_prefix("http://molibot-plugin."))
        .or_else(|| uri.strip_prefix("https://molibot-plugin."))?;
    let (authority, tail) = match rest.find(['/', '?']) {
        Some(index) => rest.split_at(index),
        None => (rest, ""),
    };
    let plugin_id = authority
        .strip_suffix(".localhost")
        .unwrap_or(authority)
        .to_ascii_lowercase();
    if !is_valid_plugin_id(&plugin_id) {
        return None;
    }

    let (path, query) = match tail.find('?') {
        Some(index) => (&tail[..index], &tail[index..]),
        None => (tail, ""),
    };
    let asset_path = path.trim_start_matches('/');
    if !is_safe_path(asset_path) || query.contains('\0') || query.contains('\\') {
        return None;
    }

    let endpoint = endpoint.trim_end_matches('/');
    if !endpoint.starts_with("http://127.0.0.1:") && !endpoint.starts_with("http://localhost:") {
        return None;
    }
    Some(format!(
        "{endpoint}/plugins/{plugin_id}/ui/{asset_path}{query}"
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
            "Invalid plugin UI request.",
        ));
        return;
    };

    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
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
        let response = match client.get(&url).send().await {
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
                    "Plugin UI response could not be read.",
                ));
                return;
            }
        };
        if bytes.len() > MAX_RESPONSE_BYTES {
            responder.respond(error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Plugin UI response too large.",
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
    fn maps_only_to_the_plugins_own_ui_mount() {
        assert_eq!(
            upstream_url(
                ENDPOINT,
                "molibot-plugin://external-subagent/index.html"
            ),
            Some(
                "http://127.0.0.1:3117/plugins/external-subagent/ui/index.html".into()
            )
        );
    }

    #[test]
    fn supports_webview_rewritten_custom_origins() {
        assert_eq!(
            upstream_url(
                ENDPOINT,
                "http://molibot-plugin.external-subagent.localhost/assets/app.js"
            ),
            Some(
                "http://127.0.0.1:3117/plugins/external-subagent/ui/assets/app.js".into()
            )
        );
    }

    #[test]
    fn refuses_traversal_invalid_ids_and_foreign_endpoints() {
        for uri in [
            "molibot-plugin://external-subagent/../../secret",
            "molibot-plugin://external-subagent/%2e%2e%2fsecret",
            "molibot-plugin://bad_id/index.html",
            "https://example.com/external-subagent/index.html",
        ] {
            assert_eq!(upstream_url(ENDPOINT, uri), None, "{uri} must be refused");
        }
        assert_eq!(
            upstream_url(
                "http://example.com:80",
                "molibot-plugin://external-subagent/index.html"
            ),
            None
        );
    }
}
