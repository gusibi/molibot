#!/bin/bash
# Tavily Search API — 每月 1000 次免费（无需信用卡）
# Usage: ./tavily_search.sh '{"query": "AI trends", "max_results": 5}'

set -e

# ---- Token discovery (inherited from tavily-search skill) ----

decode_jwt_payload() {
    local token="$1"
    local payload=$(echo "$token" | cut -d'.' -f2)
    local padded_payload="$payload"
    case $((${#payload} % 4)) in
        2) padded_payload="${payload}==" ;;
        3) padded_payload="${payload}=" ;;
    esac
    echo "$padded_payload" | base64 -d 2>/dev/null
}

is_valid_tavily_token() {
    local token="$1"
    local payload=$(decode_jwt_payload "$token")
    local iss=$(echo "$payload" | jq -r '.iss // empty' 2>/dev/null)
    if [ "$iss" != "https://mcp.tavily.com/" ]; then
        return 1
    fi
    local exp=$(echo "$payload" | jq -r '.exp // empty' 2>/dev/null)
    if [ -n "$exp" ] && [ "$exp" != "null" ]; then
        local current_time=$(date +%s)
        if [ "$current_time" -ge "$exp" ]; then
            return 1
        fi
    fi
    return 0
}

get_mcp_token() {
    MCP_AUTH_DIR="$HOME/.mcp-auth"
    if [ -d "$MCP_AUTH_DIR" ]; then
        while IFS= read -r token_file; do
            if [ -f "$token_file" ]; then
                token=$(jq -r '.access_token // empty' "$token_file" 2>/dev/null)
                if [ -n "$token" ] && [ "$token" != "null" ]; then
                    if is_valid_tavily_token "$token"; then
                        echo "$token"
                        return 0
                    fi
                fi
            fi
        done < <(find "$MCP_AUTH_DIR" -name "*_tokens.json" 2>/dev/null)
    fi
    return 1
}

# Try to load OAuth token if TAVILY_API_KEY is not set
if [ -z "$TAVILY_API_KEY" ]; then
    token=$(get_mcp_token) || true
    if [ -n "$token" ]; then
        export TAVILY_API_KEY="$token"
    fi
fi

# ---- Main ----

JSON_INPUT="$1"

if [ -z "$JSON_INPUT" ]; then
    echo "Usage: ./tavily_search.sh '<json>'"
    echo ""
    echo "Tavily Search API — 每月 1000 次免费"
    echo "文档: https://docs.tavily.com/documentation/api-reference/endpoint/search"
    echo ""
    echo "Required:"
    echo "  query: string - 搜索关键词 (max 400 chars)"
    echo ""
    echo "Optional:"
    echo "  max_results: number - 最大结果数 (default: 5, max: 20)"
    echo "  search_depth: string - \"basic\" (default) | \"advanced\""
    echo "  time_range: string - \"day\" | \"week\" | \"month\" | \"year\""
    echo "  include_domains: array - 限定搜索域名"
    echo "  exclude_domains: array - 排除域名"
    echo ""
    echo "Environment:"
    echo "  TAVILY_API_KEY - Tavily API Key (or auto-detected from MCP OAuth)"
    echo ""
    echo "Example:"
    echo "  ./tavily_search.sh '{\"query\": \"React hooks\", \"max_results\": 10}'"
    exit 1
fi

# Try OAuth flow if still no key
if [ -z "$TAVILY_API_KEY" ]; then
    set +e
    echo "No Tavily token found. Initiating OAuth flow..." >&2
    npx -y mcp-remote https://mcp.tavily.com/mcp </dev/null >/dev/null 2>&1 &
    MCP_PID=$!
    TIMEOUT=60
    ELAPSED=0
    while [ $ELAPSED -lt $TIMEOUT ]; do
        sleep 3
        ELAPSED=$((ELAPSED + 3))
        token=$(get_mcp_token) || true
        if [ -n "$token" ]; then
            export TAVILY_API_KEY="$token"
            break
        fi
    done
    kill $MCP_PID 2>/dev/null || true
    wait $MCP_PID 2>/dev/null || true
    set -e
fi

if [ -z "$TAVILY_API_KEY" ]; then
    echo "Error: TAVILY_API_KEY not found"
    echo "Set TAVILY_API_KEY or sign up at https://tavily.com"
    exit 1
fi

# Validate JSON
if ! echo "$JSON_INPUT" | jq empty 2>/dev/null; then
    echo "Error: Invalid JSON input"
    exit 1
fi

QUERY=$(echo "$JSON_INPUT" | jq -r '.query // empty')
if [ -z "$QUERY" ]; then
    echo "Error: 'query' field is required"
    exit 1
fi

# Build request — pass through all fields, set defaults
REQUEST_BODY=$(echo "$JSON_INPUT" | jq '{
    query: .query,
    max_results: (.max_results // 5),
    search_depth: (.search_depth // "basic"),
    topic: (.topic // "general")
} + (if .time_range then {time_range: .time_range} else {} end)
  + (if .include_domains then {include_domains: .include_domains} else {} end)
  + (if .exclude_domains then {exclude_domains: .exclude_domains} else {} end)
  + (if .country then {country: .country} else {} end)')

# Call Tavily REST API directly
RESPONSE=$(curl -s --request POST \
    --url "https://api.tavily.com/search" \
    --header "Authorization: Bearer $TAVILY_API_KEY" \
    --header 'Content-Type: application/json' \
    --data "$REQUEST_BODY")

if [ -z "$RESPONSE" ]; then
    echo "Error: No response from Tavily API"
    exit 1
fi

# Check for errors
ERROR=$(echo "$RESPONSE" | jq -r '.detail // .error // empty' 2>/dev/null)
if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo "Error: $ERROR"
    exit 1
fi

# Parse and output results
RESULT_COUNT=$(echo "$RESPONSE" | jq '.results | length' 2>/dev/null || echo "0")

if [ "$RESULT_COUNT" -eq 0 ]; then
    echo "No results found for: $QUERY"
    exit 0
fi

MAX_RESULTS=$(echo "$JSON_INPUT" | jq -r '.max_results // 5')
for i in $(seq 0 $((RESULT_COUNT - 1))); do
    if [ "$i" -ge "$MAX_RESULTS" ]; then
        break
    fi

    TITLE=$(echo "$RESPONSE" | jq -r ".results[$i].title // \"Untitled\"")
    URL=$(echo "$RESPONSE" | jq -r ".results[$i].url // \"N/A\"")
    SNIPPET=$(echo "$RESPONSE" | jq -r ".results[$i].content // \"\"")

    echo "--- Result $((i + 1)) ---"
    echo "Title: $TITLE"
    echo "URL: $URL"
    echo "Snippet: $SNIPPET"
    echo ""
done
