#!/bin/bash
# Serper Google Search API — 首次 2500 次免费
# Usage: ./serper_search.sh '{"query": "AI news", "max_results": 5}'

set -e

JSON_INPUT="$1"

if [ -z "$JSON_INPUT" ]; then
    echo "Usage: ./serper_search.sh '<json>'"
    echo ""
    echo "Serper API — Google 搜索结果，首次 2500 次免费"
    echo "注册: https://serper.dev"
    echo ""
    echo "Required:"
    echo "  query: string - 搜索关键词"
    echo ""
    echo "Optional:"
    echo "  max_results: number - 最大结果数 (default: 5, max: 10)"
    echo "  country: string - 国家代码，如 \"cn\", \"us\" (default: us)"
    echo "  language: string - 语言代码，如 \"zh-cn\", \"en\" (default: en)"
    echo "  time_range: string - 时间过滤: \"d\"(天) \"w\"(周) \"m\"(月) \"y\"(年)"
    echo ""
    echo "Environment:"
    echo "  SERPER_API_KEY - Required. Serper API Key"
    echo ""
    echo "Example:"
    echo "  ./serper_search.sh '{\"query\": \"latest AI models\", \"time_range\": \"w\"}'"
    exit 1
fi

if [ -z "$SERPER_API_KEY" ]; then
    echo "Error: SERPER_API_KEY environment variable is required"
    echo "Get your API key at: https://serper.dev"
    exit 1
fi

# Validate JSON
if ! echo "$JSON_INPUT" | jq empty 2>/dev/null; then
    echo "Error: Invalid JSON input"
    exit 1
fi

QUERY=$(echo "$JSON_INPUT" | jq -r '.query // empty')
MAX_RESULTS=$(echo "$JSON_INPUT" | jq -r '.max_results // 5')
COUNTRY=$(echo "$JSON_INPUT" | jq -r '.country // "us"')
LANGUAGE=$(echo "$JSON_INPUT" | jq -r '.language // "en"')
TIME_RANGE=$(echo "$JSON_INPUT" | jq -r '.time_range // empty')

if [ -z "$QUERY" ]; then
    echo "Error: 'query' field is required"
    exit 1
fi

# Limit max results
if [ "$MAX_RESULTS" -gt 10 ]; then
    MAX_RESULTS=10
fi

# Build request body
REQUEST_BODY=$(jq -n \
    --arg q "$QUERY" \
    --argjson num "$MAX_RESULTS" \
    --arg gl "$COUNTRY" \
    --arg hl "$LANGUAGE" \
    '{q: $q, num: $num, gl: $gl, hl: $hl}')

if [ -n "$TIME_RANGE" ] && [ "$TIME_RANGE" != "null" ]; then
    REQUEST_BODY=$(echo "$REQUEST_BODY" | jq --arg tbs "qdr:$TIME_RANGE" '. + {tbs: $tbs}')
fi

# Call Serper API
RESPONSE=$(curl -s --request POST \
    --url "https://google.serper.dev/search" \
    --header "X-API-KEY: $SERPER_API_KEY" \
    --header "Content-Type: application/json" \
    --data "$REQUEST_BODY")

if [ -z "$RESPONSE" ]; then
    echo "Error: No response from Serper API"
    exit 1
fi

# Check for errors
ERROR=$(echo "$RESPONSE" | jq -r '.message // empty' 2>/dev/null)
if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo "Error: $ERROR"
    exit 1
fi

# Parse organic results
RESULT_COUNT=$(echo "$RESPONSE" | jq '.organic | length' 2>/dev/null || echo "0")

if [ "$RESULT_COUNT" -eq 0 ]; then
    echo "No results found for: $QUERY"
    exit 0
fi

for i in $(seq 0 $((RESULT_COUNT - 1))); do
    if [ "$i" -ge "$MAX_RESULTS" ]; then
        break
    fi

    TITLE=$(echo "$RESPONSE" | jq -r ".organic[$i].title // \"Untitled\"")
    URL=$(echo "$RESPONSE" | jq -r ".organic[$i].link // \"N/A\"")
    SNIPPET=$(echo "$RESPONSE" | jq -r ".organic[$i].snippet // \"\"")
    DATE=$(echo "$RESPONSE" | jq -r ".organic[$i].date // empty")

    echo "--- Result $((i + 1)) ---"
    echo "Title: $TITLE"
    echo "URL: $URL"
    if [ -n "$DATE" ] && [ "$DATE" != "null" ]; then
        echo "Date: $DATE"
    fi
    echo "Snippet: $SNIPPET"
    echo ""
done
