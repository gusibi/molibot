# 搜索 API 服务一览

**执行摘要：** 截至 2026 年，面向 AI 连接和检索场景的搜索 API 已十分丰富，包括国际和中国厂商的产品。例如 Tavily、Exa、Brave Search、SerpAPI、Serper、You.com、Perplexity、Google Gemini Grounding 等国际服务，以及博查、百度千帆、腾讯云联网搜索、阿里云 UnifiedSearch、Kimi 等国产服务。此外，还有 DuckDuckGo 等非官方方案。许多服务提供免费额度：如 Tavily 每月赠送 1000 次调用、SerpAPI 每月免费 250 次、You.com 提供 100 美元初始额度、百度千帆每日免费 1000 次，Brave 搜索每月赠送 5 美元试用额度等。这些 API 在检索能力和适用场景上各有侧重：例如 SerpAPI 侧重 Google 等搜索结构化结果，Exa 强调极高性能和完整网页内容抓取，You.com 兼具多模态搜索和大型场景支持，博查和千帆等国内服务则更侧重中文内容和合规要求。下文将按免费策略分组汇总各 API，并提供示例请求、定价与免费额度、适用场景和注意事项，最后给出快速选型建议表。

## A. 持续月度免费额度

### 1. [DuckDuckGo (非官方)](https://duckduckgo.com)
- **文档：** N/A（Unofficial）
- **示例请求：** `curl "https://api.duckduckgo.com/?q=北京天气&format=json"`
- **费用（起始价）：** 免费（无调用成本）
- **免费额度：** 无限免费（Instant Answer API）
- **适用场景与特点：** **即时答案**：利用 DuckDuckGo 的即时回答 (Instant Answer) API 获取摘要信息，适合快速查询基础定义或摘要，不提供网页列表。<br>**注意**：非正式爬虫方式集成，返回内容局限于摘要，对复杂查询效果有限。
- **备注：** 无需 API 密钥；请求参数见示例。

### 2. [Brave Search](https://search.brave.com/)
- **文档：** [文档](https://brave.com/zh/search/api/)
- **示例请求：** `curl -H "X-Subscription-Token: <API_KEY>" "https://api.search.brave.com/res/v1/news/search?q=AI&count=5"`
- **费用（起始价）：** $5/1000 请求
- **免费额度：** 每月赠送 **$5** 额度（约 1000 请求）（需信用卡）
- **适用场景与特点：** **隐私搜索**：Brave 基于自有索引，强调用户隐私。适用于一般网络搜索和新闻检索，支持多类别（新闻、图像、常规网页）。<br>**特征**：全球查询，免费额稳定；调用时需带 `X-Subscription-Token`。
- **备注：** 免费额度为账户赠送额度；请求速率及结果条数可在文档中配置。

### 3. [Tavily Search](https://tavily.com)
- **文档：** [搜索 API 文档](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- **示例请求：** `curl -X POST https://api.tavily.com/search -H "Authorization: Bearer tvly-<KEY>" -d '{"query": "AI 发展"}'`
- **费用（起始价）：** $0.008/信用分
- **免费额度：** 每月 **1000** 信用分（无需信用卡）
- **适用场景与特点：** **实时网页搜索**：面向 AI 应用的实时网络搜索接口，支持文本和图片搜索，返回搜索结果及内容提取。适合智能代理、问答和检索任务，保证最新内容。<br>**特征**：上手快，支持多结果&网页内容提取；免费额度友好。
- **备注：** 免费额度按月重置；1 请求=1 信用分，多结果时按额外计费。

### 4. [Exa Search](https://exa.ai)
- **文档：** [文档](https://exa.ai/docs/reference/search)
- **示例请求：** `curl -X POST 'https://api.exa.ai/search' -H 'x-api-key: <KEY>' -d '{"query": "LLM 研究", "contents":{"highlights":{"maxCharacters":4000}}}'`
- **费用（起始价）：** $7/1000 请求（基础）
- **免费额度：** 每月 **1000** 请求
- **适用场景与特点：** **超高速检索**：Exa 提供极低延迟（≈200ms 内）全网搜索，适合需要大吞吐的场景（智能代理、企业搜索）。支持批量结果和多种输出（摘要、全文、高亮）。<br>**特征**：免费额度每月1k，还支持升级深度搜索、Answer等服务。
- **备注：** 默认为 1k 请求免费；超出计费较灵活，可调节返回结果数。

### 5. [百度千帆 (智能搜索)](https://cloud.baidu.com/product/qianfan)
- **文档：** [文档-智能搜索生成](https://cloud.baidu.com/doc/qianfan-api/s/Hmbu8m06u)
- **示例请求：** 
  ```bash
  curl --location 'https://qianfan.baidubce.com/v2/ai_search/chat/completions' \
  -H 'X-Appbuilder-Authorization: Bearer <API_KEY>' \
  -H 'Content-Type: application/json' \
  --data '{"messages":[{"content":"北京有哪些景点","role":"user"}],"search_source":"baidu_search_v1",...}'
  ```
  
- **费用（起始价）：** 按量计费（视模型/套餐而定）
- **免费额度：** 每日免费 **1000** 次调用
- **适用场景与特点：** **中文搜索+生成**：百度千帆智能搜索基于 ERNIE 模型，将网络检索与生成结合。适合中文问答和信息检索，默认调用智能对话接口自动检索并总结答案。<br>**特征**：免费每天1k；调用方式与对话接口相似，可多模态过滤。
- **备注：** 免费额度每日刷新；需使用百度开放平台的 SDK/HTTP 接入。

## B. 一次性试用额度

### 1. [Serper 搜索 API](https://serper.dev)
- **文档：** (暂无公开文档，见示例调用)
- **示例请求：** `curl "https://google.serper.dev/search?q=AI&api_key=<KEY>"`
- **费用（起始价）：** ~$0.30/1000 查询
- **免费额度：** 首次赠送 **2500** 次查询（需注册）
- **适用场景与特点：** **Google 搜索结果**：面向 AI 的 Google Web Search API，提供标准网页结果和知识图谱等。适合快速获取结构化搜索结果。<br>**特征**：支持国家/语言参数；极低成本，每千次约 $0.30。
- **备注：** 试用额度一次性；免费额度或价格请登录控制台确认。

### 2. [You.com 搜索 API](https://you.com)
- **文档：** [文档](https://docs.you.com/quickstart)
- **示例请求：** *示例略：通过 OAuth 验证后调用 REST 接口搜索*
- **费用（起始价）：** $5/1000 调用
- **免费额度：** 首次赠送 **$100** 额度
- **适用场景与特点：** **多模态 Web 搜索**：You.com 提供网页、新闻、图片、代码等多类型结果，支持上下文搜索、自然语言查询。适合多功能问答和代理场景。<br>**特征**：初始 $100 免额度；全面支持长查询和多结果页面。
- **备注：** 无需信用卡；具体调用方式见开发者文档。

### 3. [博查 AI 搜索](https://open.bochaai.com)
- **文档：** [文档](https://bocha-ai.feishu.cn/wiki/HmtOw1z6vik14Fkdu5uc9VaInBb) （示例：Web 搜索）
- **示例请求：** `curl --location 'https://api.bochaai.com/v1/web-search' -H 'Authorization: Bearer <KEY>' -H 'Content-Type: application/json' -d '{"query":"阿里巴巴 ESG 报告",...}'`
- **费用（起始价）：** ~3.6元/1000 调用
- **免费额度：** 首次赠送 **1000** 次调用
- **适用场景与特点：** **中文多模态搜索**：基于多模态和语义排序技术的搜索引擎。支持网页、图片、视频等结果检索，自动摘要输出适合下游 LLM 处理。<br>**特征**：国内部署、符合合规，响应快（约300ms）；着重过滤低质内容。
- **备注：** 免费包需输入口令领取；价格低廉。

### 4. [阿里云 UnifiedSearch](https://www.aliyun.com/product/iqs)
- **文档：** [文档](https://help.aliyun.com/zh/document_detail/2883041.html)
- **示例请求：** `POST https://ysou.cn-shanghai.aliyuncs.com/?Action=Search&Version=2023-12-01` (包含 `query` 等参数)
- **费用（起始价）：** 具体计费模式需咨询
- **免费额度：** **测试账号**：免费 5000 次 (个人1000次)*
- **适用场景与特点：** **通用搜索引擎**：面向 Agent 的开放域搜索引擎。提供标准（Generic）和增强（GenericAdvanced、LiteAdvanced）等多种模式，可返回摘要和长正文。适用于嵌入式搜索、知识查询等场景。<br>**特征**：测试账号免费额度 5000 次（个人1000次）；付费版按日用量计费，可自定义过滤与高阶参数。
- **备注：** 测试额度有时间和次数限制；正式版需先购买服务包并开通。

## C. 无免费额度（付费专用）

### 1. [SerpAPI](https://serpapi.com)
- **文档：** [文档](https://serpapi.com/search-api)
- **示例请求：** `GET https://serpapi.com/search?engine=google&q=AI&api_key=<KEY>`
- **费用（起始价）：** $0（开发者版）起（250免费/月）
- **免费额度：** 250 次/月
- **适用场景与特点：** **多搜索引擎数据**：支持 Google、Bing、Yahoo、DuckDuckGo、亚马逊、维基、Yelp 等丰富搜索源，返回结构化 JSON 结果。适用于需要多渠道搜索和开发者快速集成的场景。<br>**特征**：API 覆盖面广，提供结果条目、图片、新闻等多种类别；基础免费250/月。
- **备注：** 免费额度固定月额；超额按使用量计费。

### 2. [Perplexity Search](https://perplexity.ai)
- **文档：** [文档](https://docs.perplexity.ai/docs/search/quickstart)
- **示例请求：** *使用 SDK：`client.search.create(query: "LLM 发展")`*（或 HTTP POST）
- **费用（起始价）：** $5/1000 调用
- **免费额度：** 无免费
- **适用场景与特点：** **英文网络搜索**：由 Perplexity AI 提供的搜索 API，返回答案和引用。适合需要英文维基类回答和资料检索的场景。<br>**特征**：侧重严谨回答；按请求计费，无免费套餐。
- **备注：** 需登录控制台查看定价。

### 3. [Google Gemini Grounding](https://ai.google.dev/tutorials)
- **文档：** [文档](https://developers.generativeai.google/tutorials)
- **示例请求：** `curl -X POST https://generativelanguage.googleapis.com/v1beta/generateContent ... {"prompt": {"context": ...,"messages": [{"content": "法国人口多少？","author":"user"}]}}`
- **费用（起始价）：** 按 Google AIGC 定价
- **免费额度：** 无免费
- **适用场景与特点：** **工具调用搜索**：Google Gemini 的联网搜索功能（grounding），在 GenAI 对话中自动调用 Google Search，提供带引用的答案。适合高质量对话场景。<br>**特征**：作为 Gemini API 的工具使用；结果质量高；计费复杂，多按 token 计费。
- **备注：** 需使用 Google Cloud Generative AI API，计费视模型和 token 而定。

### 4. [Kimi ($web_search)](https://moonshot.cn)
- **文档：** [定价](https://platform.moonshot.cn/docs/pricing/tools)
- **示例请求：** *示例：通过 Kimi LLM 调用内置 `$web_search` 工具，无额外 HTTP 请求示例。*
- **费用（起始价）：** 0.03 元/次
- **免费额度：** 无免费
- **适用场景与特点：** **LLM 内置搜索**：Kimi（原摩杜卡）提供的内置 `$web_search` 工具，通过 Kimi 模型自动执行网络检索。适用于搭配 Kimi 模型的问答和 RAG 流程。<br>**特征**：调用完成后仅收取工具调用费 0.03 元；检索结果占用的 tokens 也计费。
- **备注：** 需在 Kimi API 对话中启用 `$web_search` 工具。

### 5. [腾讯云联网搜索](https://console.cloud.tencent.com/api)
- **文档：** [文档](https://cloud.tencent.com/document/product/1806/121811)
- **示例请求：** **示例**：使用腾讯云 API Explorer 调用 `SearchPro` 接口，见腾讯文档。
- **费用（起始价）：** 按量计费（需申请）
- **免费额度：** 无免费
- **适用场景与特点：** **中文综合搜索**：基于搜狗搜索，全网公开资源智能排序。适合国内企业级搜索集成。<br>**特征**：与云 API 3.0 结合，支持筛选参数；无公开免费额度，需实名认证后开通。
- **备注：** 需腾讯云账号实名认证并开通服务。

> **快速选型建议（场景→推荐 API）：**  
> - **新手开发/快速集成**：可先试用赠送额度较多的服务，如 Serper（2500 次）、Bocha（1000 次）和 You.com（$100）等。或者使用免费项目如 Brave、Tavily 和 Exa 等，快速获得搜索结果。  
> - **多引擎/结构化需求**：使用 SerpAPI（支持 Google/Bing/DuckDuckGo 等多源），适合需要结构化 SERP 数据（标题、链接、摘要等）的场景。  
> - **高性能/全内容检索**：Exa 和 Tavily 提供低延迟的全网搜索，可返回完整网页内容或摘要，适合 RAG 和代理调用。  
> - **中文内容/合规需求**：优先选择国内服务如 博查、百度千帆、腾讯联网搜索，保证数据本地化和兼容中文查询。  
> - **无需注册/隐私搜**：DuckDuckGo 提供非官方免费接口，适合轻量使用；Brave 搜索免费额度和隐私特性也适合对隐私友好的项目。  
> - **高级代理/工具调用**：需要在 LLM 中自动调用搜索，可考虑 Kimi 的 `$web_search` 工具或 Google Gemini Grounding 等平台特定方案。  

上述所有信息基于官方文档和公开资料整理，如有更新请参考对应官网和文档。文中示例 curl/HTTP 请求仅供参考，请根据实际文档填写完整参数和路径。  

**参考资料：** 各产品官网及文档等。