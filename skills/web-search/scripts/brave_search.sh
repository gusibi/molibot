#!/bin/bash
# Brave Search API — 每月 ~1000 次免费（需信用卡）
# Usage: ./brave_search.sh '{"query": "AI news", "max_results": 5}'

set -e

JSON_INPUT="$1"

if [ -z "$JSON_INPUT" ]; then
    echo "Usage: ./brave_search.sh '<json>'"
    echo ""
    echo "Brave Search API — 每月 ~1000 次免费"
    echo "文档: https://brave.com/search/api/"
    echo ""
    echo "Required:"
    echo "  query: string - 搜索关键词"
    echo ""
    echo "Optional:"
    echo "  max_results: number - 最大结果数 (default: 5, max: 20)"
    echo "  country: string - 国家代码，如 \"US\", \"CN\" (default: US)"
    echo "  freshness: string - 时间过滤: \"pd\"(天) \"pw\"(周) \"pm\"(月) \"py\"(年)"
    echo ""
    echo "Environment:"
    echo "  BRAVE_API_KEY - Required. Brave Search API Key"
    echo ""
    echo "Example:"
    echo "  ./brave_search.sh '{\"query\": \"machine learning\", \"freshness\": \"pw\"}'"
    exit 1
fi

if [ -z "$BRAVE_API_KEY" ]; then
    echo "Error: BRAVE_API_KEY environment variable is required"
    echo "Get your API key at: https://api-dashboard.search.brave.com/app/keys"
    exit 1
fi

# Validate JSON
if ! echo "$JSON_INPUT" | jq empty 2>/dev/null; then
    echo "Error: Invalid JSON input"
    exit 1
fi

QUERY=$(echo "$JSON_INPUT" | jq -r '.query // empty')
MAX_RESULTS=$(echo "$JSON_INPUT" | jq -r '.max_results // 5')
COUNTRY=$(echo "$JSON_INPUT" | jq -r '.country // "US"')
FRESHNESS=$(echo "$JSON_INPUT" | jq -r '.freshness // empty')

if [ -z "$QUERY" ]; then
    echo "Error: 'query' field is required"
    exit 1
fi

# Limit max results to 20
if [ "$MAX_RESULTS" -gt 20 ]; then
    MAX_RESULTS=20
fi

# Build URL with parameters
ENCODED_QUERY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")
URL="https://api.search.brave.com/res/v1/web/search?q=${ENCODED_QUERY}&count=${MAX_RESULTS}&country=${COUNTRY}"

if [ -n "$FRESHNESS" ] && [ "$FRESHNESS" != "null" ]; then
    URL="${URL}&freshness=${FRESHNESS}"
fi

# Call Brave Search API
RESPONSE=$(curl -s "$URL" \
    -H "Accept: application/json" \
    -H "Accept-Encoding: gzip" \
    -H "X-Subscription-Token: $BRAVE_API_KEY" \
    --compressed)

if [ -z "$RESPONSE" ]; then
    echo "Error: No response from Brave Search API"
    exit 1
fi

# Check for errors
ERROR=$(echo "$RESPONSE" | jq -r '.error // empty' 2>/dev/null)
if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo "Error: $ERROR"
    exit 1
fi

# Parse web results
RESULT_COUNT=$(echo "$RESPONSE" | jq '.web.results | length' 2>/dev/null || echo "0")

if [ "$RESULT_COUNT" -eq 0 ]; then
    echo "No results found for: $QUERY"
    exit 0
fi

for i in $(seq 0 $((RESULT_COUNT - 1))); do
    if [ "$i" -ge "$MAX_RESULTS" ]; then
        break
    fi

    TITLE=$(echo "$RESPONSE" | jq -r ".web.results[$i].title // \"Untitled\"")
    URL_R=$(echo "$RESPONSE" | jq -r ".web.results[$i].url // \"N/A\"")
    SNIPPET=$(echo "$RESPONSE" | jq -r ".web.results[$i].description // \"\"")
    AGE=$(echo "$RESPONSE" | jq -r ".web.results[$i].age // empty")

    echo "--- Result $((i + 1)) ---"
    echo "Title: $TITLE"
    echo "URL: $URL_R"
    if [ -n "$AGE" ] && [ "$AGE" != "null" ]; then
        echo "Age: $AGE"
    fi
    echo "Snippet: $SNIPPET"
    echo ""
done
