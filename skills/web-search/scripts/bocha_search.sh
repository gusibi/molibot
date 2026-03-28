#!/bin/bash
# 博查 AI 搜索 API — 首次 1000 次免费，中文优化
# Usage: ./bocha_search.sh '{"query": "阿里巴巴 ESG 报告"}'

set -e

JSON_INPUT="$1"

if [ -z "$JSON_INPUT" ]; then
    echo "Usage: ./bocha_search.sh '<json>'"
    echo ""
    echo "博查 AI 搜索 API — 首次 1000 次免费，中文搜索优化"
    echo "文档: https://bocha-ai.feishu.cn/wiki/HmtOw1z6vik14Fkdu5uc9VaInBb"
    echo ""
    echo "Required:"
    echo "  query: string - 搜索关键词"
    echo ""
    echo "Optional:"
    echo "  max_results: number - 最大结果数 (default: 5)"
    echo "  freshness: string - 时间过滤: \"day\" | \"week\" | \"month\" | \"year\""
    echo ""
    echo "Environment:"
    echo "  BOCHA_API_KEY - Required. 博查 API Key"
    echo ""
    echo "Example:"
    echo "  ./bocha_search.sh '{\"query\": \"大模型最新进展\", \"max_results\": 10}'"
    exit 1
fi

if [ -z "$BOCHA_API_KEY" ]; then
    echo "Error: BOCHA_API_KEY environment variable is required"
    echo "注册获取: https://open.bochaai.com"
    exit 1
fi

# Validate JSON
if ! echo "$JSON_INPUT" | jq empty 2>/dev/null; then
    echo "Error: Invalid JSON input"
    exit 1
fi

QUERY=$(echo "$JSON_INPUT" | jq -r '.query // empty')
MAX_RESULTS=$(echo "$JSON_INPUT" | jq -r '.max_results // 5')
FRESHNESS=$(echo "$JSON_INPUT" | jq -r '.freshness // empty')

if [ -z "$QUERY" ]; then
    echo "Error: 'query' field is required"
    exit 1
fi

# Build request body
REQUEST_BODY=$(jq -n \
    --arg query "$QUERY" \
    --argjson count "$MAX_RESULTS" \
    '{query: $query, count: $count, summary: true}')

if [ -n "$FRESHNESS" ] && [ "$FRESHNESS" != "null" ]; then
    REQUEST_BODY=$(echo "$REQUEST_BODY" | jq --arg f "$FRESHNESS" '. + {freshness: $f}')
fi

# Call Bocha API
RESPONSE=$(curl -s --request POST \
    --url "https://api.bochaai.com/v1/web-search" \
    --header "Authorization: Bearer $BOCHA_API_KEY" \
    --header "Content-Type: application/json" \
    --data "$REQUEST_BODY")

if [ -z "$RESPONSE" ]; then
    echo "Error: No response from Bocha API"
    exit 1
fi

# Check for errors
ERROR=$(echo "$RESPONSE" | jq -r '.error // .message // empty' 2>/dev/null)
if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo "Error: $ERROR"
    exit 1
fi

# Parse results — Bocha returns results in .data.webPages.value or .results
RESULTS_PATH=""
if echo "$RESPONSE" | jq -e '.data.webPages.value' >/dev/null 2>&1; then
    RESULTS_PATH=".data.webPages.value"
elif echo "$RESPONSE" | jq -e '.results' >/dev/null 2>&1; then
    RESULTS_PATH=".results"
elif echo "$RESPONSE" | jq -e '.webPages.value' >/dev/null 2>&1; then
    RESULTS_PATH=".webPages.value"
fi

if [ -z "$RESULTS_PATH" ]; then
    echo "No results found for: $QUERY"
    exit 0
fi

RESULT_COUNT=$(echo "$RESPONSE" | jq "${RESULTS_PATH} | length" 2>/dev/null || echo "0")

if [ "$RESULT_COUNT" -eq 0 ]; then
    echo "No results found for: $QUERY"
    exit 0
fi

for i in $(seq 0 $((RESULT_COUNT - 1))); do
    if [ "$i" -ge "$MAX_RESULTS" ]; then
        break
    fi

    TITLE=$(echo "$RESPONSE" | jq -r "${RESULTS_PATH}[$i].name // ${RESULTS_PATH}[$i].title // \"Untitled\"")
    URL=$(echo "$RESPONSE" | jq -r "${RESULTS_PATH}[$i].url // ${RESULTS_PATH}[$i].link // \"N/A\"")
    SNIPPET=$(echo "$RESPONSE" | jq -r "${RESULTS_PATH}[$i].summary // ${RESULTS_PATH}[$i].snippet // ${RESULTS_PATH}[$i].content // \"\"")

    echo "--- Result $((i + 1)) ---"
    echo "Title: $TITLE"
    echo "URL: $URL"
    echo "Snippet: $SNIPPET"
    echo ""
done
