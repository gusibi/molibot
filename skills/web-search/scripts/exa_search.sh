#!/bin/bash
# Exa Search API — 每月 1000 次免费
# Usage: ./exa_search.sh '{"query": "LLM research", "max_results": 5}'

set -e

JSON_INPUT="$1"

if [ -z "$JSON_INPUT" ]; then
    echo "Usage: ./exa_search.sh '<json>'"
    echo ""
    echo "Exa Search API — 每月 1000 次免费，超低延迟"
    echo "文档: https://exa.ai/docs/reference/search"
    echo ""
    echo "Required:"
    echo "  query: string - 搜索关键词"
    echo ""
    echo "Optional:"
    echo "  max_results: number - 最大结果数 (default: 5)"
    echo "  include_domains: array - 限定搜索域名"
    echo "  start_date: string - 开始日期 (YYYY-MM-DD)"
    echo "  end_date: string - 结束日期 (YYYY-MM-DD)"
    echo ""
    echo "Environment:"
    echo "  EXA_API_KEY - Required. Exa API Key"
    echo ""
    echo "Example:"
    echo "  ./exa_search.sh '{\"query\": \"transformer architecture\", \"max_results\": 10}'"
    exit 1
fi

if [ -z "$EXA_API_KEY" ]; then
    echo "Error: EXA_API_KEY environment variable is required"
    echo "Get your API key at: https://exa.ai"
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

# Build request body
REQUEST_BODY=$(echo "$JSON_INPUT" | jq '{
    query: .query,
    numResults: (.max_results // 5),
    contents: {
        text: { maxCharacters: 500 },
        highlights: { maxCharacters: 200 }
    }
} + (if .include_domains then {includeDomains: .include_domains} else {} end)
  + (if .start_date then {startPublishedDate: .start_date} else {} end)
  + (if .end_date then {endPublishedDate: .end_date} else {} end)')

# Call Exa API
RESPONSE=$(curl -s --request POST \
    --url "https://api.exa.ai/search" \
    --header "x-api-key: $EXA_API_KEY" \
    --header "Content-Type: application/json" \
    --data "$REQUEST_BODY")

if [ -z "$RESPONSE" ]; then
    echo "Error: No response from Exa API"
    exit 1
fi

# Check for errors
ERROR=$(echo "$RESPONSE" | jq -r '.error // .message // empty' 2>/dev/null)
if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo "Error: $ERROR"
    exit 1
fi

# Parse results
RESULT_COUNT=$(echo "$RESPONSE" | jq '.results | length' 2>/dev/null || echo "0")

if [ "$RESULT_COUNT" -eq 0 ]; then
    echo "No results found for: $QUERY"
    exit 0
fi

for i in $(seq 0 $((RESULT_COUNT - 1))); do
    if [ "$i" -ge "$MAX_RESULTS" ]; then
        break
    fi

    TITLE=$(echo "$RESPONSE" | jq -r ".results[$i].title // \"Untitled\"")
    URL=$(echo "$RESPONSE" | jq -r ".results[$i].url // \"N/A\"")
    TEXT=$(echo "$RESPONSE" | jq -r ".results[$i].text // \"\"")
    HIGHLIGHT=$(echo "$RESPONSE" | jq -r ".results[$i].highlights[0] // empty")
    SCORE=$(echo "$RESPONSE" | jq -r ".results[$i].score // empty")

    # Use highlight as snippet if text is empty, otherwise use text
    SNIPPET="$TEXT"
    if [ -z "$SNIPPET" ] || [ "$SNIPPET" = "null" ]; then
        SNIPPET="$HIGHLIGHT"
    fi

    echo "--- Result $((i + 1)) ---"
    echo "Title: $TITLE"
    echo "URL: $URL"
    if [ -n "$SCORE" ] && [ "$SCORE" != "null" ]; then
        echo "Score: $SCORE"
    fi
    echo "Snippet: $SNIPPET"
    echo ""
done
