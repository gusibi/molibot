#!/bin/bash
# 百度千帆智能搜索 API 高性能版 — 每天 100次免费
# Usage: ./baidu_search.sh '{"query": "北京景点推荐", "max_results": 5}'

set -e

JSON_INPUT="$1"

if [ -z "$JSON_INPUT" ]; then
    echo "Usage: ./baidu_search.sh '<json>'"
    echo ""
    echo "百度千帆智能搜索 API (高性能版)"
    echo "文档: references/baidu_fast_api.md"
    echo ""
    echo "Required:"
    echo "  query: string - 搜索关键词"
    echo ""
    echo "Optional:"
    echo "  max_results: number - 最大结果数 (default: 5)"
    echo ""
    echo "Environment:"
    echo "  BAIDU_SEARCH_API_KEY - Required. 百度千帆 API Key"
    echo ""
    echo "Example:"
    echo "  ./baidu_search.sh '{\"query\": \"人工智能最新进展\"}'"
    exit 1
fi

if [ -z "$BAIDU_SEARCH_API_KEY" ]; then
    echo "Error: BAIDU_SEARCH_API_KEY environment variable is required"
    echo "获取方式: https://console.bce.baidu.com/ai_apaas/resource"
    exit 1
fi

# Validate JSON
if ! echo "$JSON_INPUT" | jq empty 2>/dev/null; then
    echo "Error: Invalid JSON input"
    exit 1
fi

QUERY=$(echo "$JSON_INPUT" | jq -r '.query // empty')
MAX_RESULTS=$(echo "$JSON_INPUT" | jq -r '.max_results // 5')

if [ -z "$QUERY" ]; then
    echo "Error: 'query' field is required"
    exit 1
fi

# Build request body for /v2/ai_search/web_summary
REQUEST_BODY=$(jq -n \
    --arg query "$QUERY" \
    '{
        "messages": [{"content": $query, "role": "user"}],
        "stream": false
    }')

# Call Baidu Qianfan AI Search API (Fast Version)
# Uses X-Appbuilder-Authorization header and correct endpoint
RESPONSE=$(curl -s --request POST \
    --url 'https://qianfan.baidubce.com/v2/ai_search/web_summary' \
    --header "X-Appbuilder-Authorization: Bearer ${BAIDU_SEARCH_API_KEY}" \
    --header 'Content-Type: application/json' \
    --data "$REQUEST_BODY")

if [ -z "$RESPONSE" ]; then
    echo "Error: No response from Baidu API"
    exit 1
fi

# Check for API-level errors
ERROR_CODE=$(echo "$RESPONSE" | jq -r '.code // empty' 2>/dev/null)
ERROR_MSG=$(echo "$RESPONSE" | jq -r '.message // empty' 2>/dev/null)

if [ -n "$ERROR_CODE" ] && [ "$ERROR_CODE" != "null" ]; then
    echo "Error ($ERROR_CODE): $ERROR_MSG"
    echo "Debug Info: $(echo "$RESPONSE" | jq -c .)"
    exit 1
fi

# Extract data based on fast_api.md structure
CONTENT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
REFERENCES=$(echo "$RESPONSE" | jq -r '.references // empty' 2>/dev/null)

# Output Summary first if available
if [ -n "$CONTENT" ] && [ "$CONTENT" != "null" ]; then
    echo "--- Summary ---"
    echo "$CONTENT"
    echo ""
fi

RESULT_COUNT=0

# Parse references array
if [ -n "$REFERENCES" ] && [ "$REFERENCES" != "null" ] && [ "$REFERENCES" != "empty" ]; then
    TOTAL=$(echo "$REFERENCES" | jq 'length' 2>/dev/null || echo "0")
    for i in $(seq 0 $((TOTAL - 1))); do
        if [ "$RESULT_COUNT" -ge "$MAX_RESULTS" ]; then
            break
        fi

        TITLE=$(echo "$REFERENCES" | jq -r ".[$i].title // \"Result\"")
        URL=$(echo "$REFERENCES" | jq -r ".[$i].url // \"N/A\"")
        SNIPPET=$(echo "$REFERENCES" | jq -r ".[$i].content // \"\"")
        SOURCE=$(echo "$REFERENCES" | jq -r ".[$i].website // empty")

        RESULT_COUNT=$((RESULT_COUNT + 1))
        echo "--- Result $RESULT_COUNT ---"
        echo "Title: $TITLE"
        if [ -n "$SOURCE" ]; then echo "Source: $SOURCE"; fi
        echo "URL: $URL"
        echo "Snippet: $SNIPPET"
        echo ""
    done
fi

if [ "$RESULT_COUNT" -eq 0 ] && [ -z "$CONTENT" ]; then
    echo "No results found for: $QUERY"
    exit 0
fi

