#!/bin/bash
# 百度千帆全网搜索 API — 每天 1000 次免费
# Usage: ./baidu_web_search.sh '{"query": "北京景点推荐", "max_results": 5}'

set -e

JSON_INPUT="$1"

if [ -z "$JSON_INPUT" ]; then
    echo "Usage: ./baidu_web_search.sh '<json>'"
    echo ""
    echo "百度千帆全网搜索 API (仅搜索，无总结)"
    echo "文档: references/baidu_web_search_api.md"
    echo ""
    echo "Required:"
    echo "  query: string - 搜索关键词"
    echo ""
    echo "Optional:"
    echo "  max_results: number - 最大结果数 (default: 5, max: 20)"
    echo "  recency: string - 时间筛选 (week, month, semiyear, year)"
    echo "  include_domains: array<string> - 指定站点搜索"
    echo ""
    echo "Environment:"
    echo "  BAIDU_SEARCH_API_KEY - Required. 百度千帆 API Key"
    echo ""
    echo "Example:"
    echo "  ./baidu_web_search.sh '{"query": "百度千帆平台"}'"
    exit 1
fi

if [ -z "$BAIDU_SEARCH_API_KEY" ]; then
    echo "Error: BAIDU_SEARCH_API_KEY environment variable is required"
    exit 1
fi

# Validate JSON
if ! echo "$JSON_INPUT" | jq empty 2>/dev/null; then
    echo "Error: Invalid JSON input"
    exit 1
fi

QUERY=$(echo "$JSON_INPUT" | jq -r '.query // empty')
MAX_RESULTS=$(echo "$JSON_INPUT" | jq -r '.max_results // 5')
RECENCY=$(echo "$JSON_INPUT" | jq -r '.recency // empty')
INCLUDE_DOMAINS=$(echo "$JSON_INPUT" | jq -c '.include_domains // empty')

if [ -z "$QUERY" ]; then
    echo "Error: 'query' field is required"
    exit 1
fi

# Build request body for /v2/ai_search/web_search
REQUEST_BODY=$(jq -n 
    --arg query "$QUERY" 
    --argjson max_results "$MAX_RESULTS" 
    '{
        "messages": [{"content": $query, "role": "user"}],
        "search_source": "baidu_search_v2",
        "resource_type_filter": [
            {"type": "web", "top_k": $max_results}
        ]
    }')

# Add recency filter
if [ -n "$RECENCY" ]; then
    REQUEST_BODY=$(echo "$REQUEST_BODY" | jq --arg r "$RECENCY" '. + {search_recency_filter: $r}')
fi

# Add site filter
if [ -n "$INCLUDE_DOMAINS" ] && [ "$INCLUDE_DOMAINS" != "null" ]; then
    REQUEST_BODY=$(echo "$REQUEST_BODY" | jq --argjson sites "$INCLUDE_DOMAINS" '. + {search_filter: {match: {site: $sites}}}')
fi

# Call Baidu Qianfan Web Search API
RESPONSE=$(curl -s --request POST 
    --url 'https://qianfan.baidubce.com/v2/ai_search/web_search' 
    --header "X-Appbuilder-Authorization: Bearer ${BAIDU_SEARCH_API_KEY}" 
    --header 'Content-Type: application/json' 
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
    exit 1
fi

# Extract references
REFERENCES=$(echo "$RESPONSE" | jq -r '.references // empty' 2>/dev/null)

RESULT_COUNT=0

# Parse references array
if [ -n "$REFERENCES" ] && [ "$REFERENCES" != "null" ] && [ "$REFERENCES" != "empty" ]; then
    TOTAL=$(echo "$REFERENCES" | jq 'length' 2>/dev/null || echo "0")
    for i in $(seq 0 $((TOTAL - 1))); do
        if [ "$RESULT_COUNT" -ge "$MAX_RESULTS" ]; then
            break
        fi

        TITLE=$(echo "$REFERENCES" | jq -r ".[$i].title // "Result"")
        URL=$(echo "$REFERENCES" | jq -r ".[$i].url // "N/A"")
        SNIPPET=$(echo "$REFERENCES" | jq -r ".[$i].content // """)
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

if [ "$RESULT_COUNT" -eq 0 ]; then
    echo "No results found for: $QUERY"
    exit 0
fi
