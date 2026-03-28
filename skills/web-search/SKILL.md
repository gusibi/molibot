---
name: web-search
description: "多引擎网页搜索。当用户提及：①查实时数据（股价、汇率、天气等） ②找技术文档/代码示例（GitHub/StackOverflow/掘金等） ③搜公司/产品/人物信息 ④找学术论文/研究报告 ⑤查最新新闻/热点事件（国内外）使用此技能。支持多引擎自动降级：从百度双版本（普通+高性能）到 Tavily/Brave/Exa 等。注意感知 Today's date，自动在查询中带上年份以搜索最新内容。"
---

# Web Search

搜索网页并返回结构化结果。提供多个搜索引擎脚本，按优先级依次尝试——第一个不行就用第二个，以此类推。

## 使用方式

每个搜索引擎是一个独立脚本，统一接收 JSON 参数：

```bash
{baseDir}/scripts/<engine>.sh '{"query": "搜索内容", "max_results": 5}'
```

## 搜索引擎优先级

按优先级从高到低，第一个失败就用下一个：

| 优先级 | 脚本 | API Key 环境变量 | 免费额度 | 适用场景 |
|--------|------|-----------------|---------|---------|
| 1 | `baidu_search.sh` | `BAIDU_SEARCH_API_KEY` | 每天 1000 次 | **中文搜索首选**，大模型能力强，适合深度总结和复杂查询 |
| 2 | `baidu_fast_search.sh` | `BAIDU_SEARCH_API_KEY` | 每天 100 次 | **百度高性能版**，响应速度极快，适合快速简单的信息检索 |
| 3 | `tavily_search.sh` | `TAVILY_API_KEY` | 每月 1000 次 | **AI搜索增强**，适合需要深度分析、研究性查询，质量高但较慢 |
| 4 | `brave_search.sh` | `BRAVE_API_KEY` | 每月 ~1000 次 | **英文搜索首选**，国外新闻、英文技术文档、海外产品信息 |
| 5 | `exa_search.sh` | `EXA_API_KEY` | 每月 1000 次 | **代码和技术内容**，适合搜代码片段、技术博客、开发者文档 |
| 6 | `serper_search.sh` | `SERPER_API_KEY` | 首次 2500 次 | **Google搜索替代**，需要Google结果但无法直接访问时 |
| 7 | `bocha_search.sh` | `BOCHA_API_KEY` | 首次 1000 次 | **国内搜索备选**，百度不可用时，同样适合中文内容 |
| 8 | `baidu_web_search.sh` | `BAIDU_SEARCH_API_KEY` | 每天 1000 次 | **百度全网搜索**，仅返回网页列表和摘要，无模型总结，作为兜底 |
| 9 | `duckduckgo.sh` | 无需 | 无限免费 | **备用/隐私搜索**，无需API key，适合快速简单的英文查询 |


## 统一输入格式

```json
{
  "query": "搜索关键词",
  "max_results": 5
}
```

各脚本还支持引擎特有参数（如 `time_range`, `include_domains` 等），详见各脚本帮助：

```bash
{baseDir}/scripts/<engine>.sh
```

## 输出格式

所有脚本统一输出：

```
--- Result 1 ---
Title: 页面标题
URL: https://example.com/page
Snippet: 搜索结果摘要...

--- Result 2 ---
...
```

## 使用建议

### 按内容类型选择

| 场景 | 推荐引擎 | 说明 |
|------|---------|------|
| **国内新闻/国内事件** | 百度 → 博查 | 中文新闻覆盖全，更新及时 |
| **快速简单查询** | 百度快 → DuckDuckGo | 极速响应，适合简单事实查询 |
| **深度总结/复杂问答** | 百度 → Tavily | 模型能力强，总结更专业 |
| **国外新闻/国际事件** | Brave → DuckDuckGo | 英文新闻源更全面 |
| **中文技术文档** | 百度 → Exa | CSDN、知乎、掘金等中文技术站 |
| **英文技术文档** | Brave → Exa → Tavily | GitHub、StackOverflow、官方文档 |
| **代码片段搜索** | Exa → Tavily | 专门优化过代码内容 |
| **学术论文/研究** | Tavily → Brave | Tavily的AI分析对研究性内容更优 |
| **产品/服务评价** | 百度(国内) / Brave(国外) | 用户评价和讨论 |
| **实时信息/股价/汇率** | 百度快 → 百度 | 包含最新数据的查询 |
| **通用兜底/结果列表** | 百度搜 → 博查 | 仅需要网页链接和摘要时 |

### 通用建议

- **日期感知 (Critical)**：始终关注环境上下文中的 `Today's date`。例如，若 `<env>` 显示 `Today's date: 2026-03-28`，而用户需要“最新文档”或“近期新闻”，搜索查询应使用 2026 而非过往年份。
- **域名过滤**：支持通过 `include_domains` 参数（部分引擎支持）或在查询中使用 `site:example.com` 语法来包含或排除特定网站。
- **搜索区域**：注意引擎的区域性。Brave/Exa/Tavily 偏向全球/英文结果，而百度/博查更适合中文/国内场景。
- **查询优化**：保持查询简洁（关键词形式），避免冗长的提问句。
- **自动降级**：无需手动切换引擎，脚本会自动按优先级尝试，直到获得结果。
- **API 详细信息**：参考 `{baseDir}/assets/api_list.md` 了解环境变量及免费额度。

---

## Usage Notes

- **Domain Filtering**: Domain filtering is supported to include or block specific websites via `include_domains` or `site:` syntax.
- **Search Region**: Web search availability or relevance may vary; Brave/Exa/Tavily are global/US-centric, while Baidu/Bocha are China-centric.
- **Date Awareness**: Account for "Today's date" in `<env>`. For example, if `<env>` says "Today's date: 2026-03-28", and the user wants the latest docs, do not use 2025 in the search query. Use 2026.


