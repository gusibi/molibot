#!/bin/bash
# DuckDuckGo Instant Answer API — 无需 API Key，无限免费
# Usage: ./duckduckgo.sh '{"query": "python programming"}'

set -e

JSON_INPUT="$1"

if [ -z "$JSON_INPUT" ]; then
    echo "Usage: ./duckduckgo.sh '<json>'"
    echo ""
    echo "DuckDuckGo Instant Answer API — 无需 API Key"
    echo ""
    echo "Required:"
    echo "  query: string - 搜索关键词"
    echo ""
    echo "Optional:"
    echo "  max_results: number - 最大结果数 (default: 5)"
    echo ""
    echo "Example:"
    echo "  ./duckduckgo.sh '{\"query\": \"python async await\"}'"
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

# URL encode the query
ENCODED_QUERY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")

# Call DuckDuckGo Instant Answer API
RESPONSE=$(curl -s "https://api.duckduckgo.com/?q=${ENCODED_QUERY}&format=json&no_html=1&skip_disambig=1")

if [ -z "$RESPONSE" ]; then
    echo "Error: No response from DuckDuckGo API"
    exit 1
fi

# Extract results
ABSTRACT=$(echo "$RESPONSE" | jq -r '.AbstractText // empty')
ABSTRACT_URL=$(echo "$RESPONSE" | jq -r '.AbstractURL // empty')
ABSTRACT_SOURCE=$(echo "$RESPONSE" | jq -r '.AbstractSource // empty')
ANSWER=$(echo "$RESPONSE" | jq -r '.Answer // empty')
DEFINITION=$(echo "$RESPONSE" | jq -r '.Definition // empty')

RESULT_COUNT=0

# Output abstract if available
if [ -n "$ABSTRACT" ] && [ "$ABSTRACT" != "null" ]; then
    RESULT_COUNT=$((RESULT_COUNT + 1))
    echo "--- Result $RESULT_COUNT ---"
    echo "Title: $ABSTRACT_SOURCE"
    echo "URL: $ABSTRACT_URL"
    echo "Snippet: $ABSTRACT"
    echo ""
fi

# Output direct answer if available
if [ -n "$ANSWER" ] && [ "$ANSWER" != "null" ]; then
    RESULT_COUNT=$((RESULT_COUNT + 1))
    echo "--- Result $RESULT_COUNT ---"
    echo "Title: Direct Answer"
    echo "URL: https://duckduckgo.com/?q=${ENCODED_QUERY}"
    echo "Snippet: $ANSWER"
    echo ""
fi

# Output definition if available
if [ -n "$DEFINITION" ] && [ "$DEFINITION" != "null" ]; then
    RESULT_COUNT=$((RESULT_COUNT + 1))
    echo "--- Result $RESULT_COUNT ---"
    echo "Title: Definition"
    echo "URL: $(echo "$RESPONSE" | jq -r '.DefinitionURL // "N/A"')"
    echo "Snippet: $DEFINITION"
    echo ""
fi

# Output related topics
RELATED_COUNT=$(echo "$RESPONSE" | jq '.RelatedTopics | length')
if [ "$RELATED_COUNT" -gt 0 ] 2>/dev/null; then
    for i in $(seq 0 $((RELATED_COUNT - 1))); do
        if [ "$RESULT_COUNT" -ge "$MAX_RESULTS" ]; then
            break
        fi

        TEXT=$(echo "$RESPONSE" | jq -r ".RelatedTopics[$i].Text // empty")
        URL=$(echo "$RESPONSE" | jq -r ".RelatedTopics[$i].FirstURL // empty")

        # Skip nested topics (they have a "Topics" key instead of "Text")
        if [ -z "$TEXT" ] || [ "$TEXT" = "null" ]; then
            continue
        fi

        RESULT_COUNT=$((RESULT_COUNT + 1))
        echo "--- Result $RESULT_COUNT ---"
        echo "Title: Related"
        echo "URL: $URL"
        echo "Snippet: $TEXT"
        echo ""
    done
fi

if [ "$RESULT_COUNT" -eq 0 ]; then
    echo "No results found for: $QUERY"
    exit 0
fi
