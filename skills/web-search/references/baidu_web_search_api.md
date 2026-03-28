更新时间：2026-03-27

POST

https://qianfan.baidubce.com/v2/ai\_search/web\_search

**概述：** 可根据用户输入query，搜索全网实时信息，并返回摘要、网址等信息。  
**计费：** 每日免费额度为1000次，支持按量后付费（为不影响使用体验，可先去 [开通后付费](https://console.bce.baidu.com/qianfan/studio/resource) ），默认优先抵扣免费资源。如有其他需求请您 [联系我们](https://cloud.baidu.com/survey/baiduaisearch.html) ，费用详情请查看 [计费说明](https://cloud.baidu.com/doc/qianfan/s/1mh4sv6c4) 。  
**使用方式：** API、 [工具及MCP](https://console.bce.baidu.com/qianfan/tools/toolsCenter/57d4e765-8af5-4ec0-8f9b-47075ec349e0/detail)

## 权限说明

调用本API，需使用API Key鉴权方式。使用API Key鉴权调用API流程，具体调用流程，请查看 [认证鉴权](https://cloud.baidu.com/doc/qianfan/s/Kmh4sutww) 。

## 请求参数

```html
POST /v2/ai_search/web_search HTTP/1.1
HOST: qianfan.baidubce.com
Authorization: Bearer <API Key>
Content-Type: application/json
{
  "messages": [
    {
      "content": "北京有哪些旅游景区",
      "role": "user"
    }
  ],
  "search_source": "baidu_search_v2",
  "resource_type_filter": [{"type": "web","top_k": 20}],
  "search_filter": {
    "match": {
      "site": [
        "www.weather.com.cn"
      ]
    }
  },
  "search_recency_filter": "year"
}\`\`\`
```

## 示例代码

```html
curl --location 'https://qianfan.baidubce.com/v2/ai_search/web_search' \
--header 'X-Appbuilder-Authorization: Bearer <AppBuilder API Key>' \
--header 'Content-Type: application/json' \
--data '{
  "messages": [
    {
      "content": "百度千帆平台",
      "role": "user"
    }
  ],
  "search_source": "baidu_search_v2",
  "resource_type_filter": [{"type": "web","top_k": 10}]
}'
```

## 返回响应

```html
{
    "references": [
        {
            "content": "河北天气预报,及时准确发布中央气象台天气信息,便捷查询河北今日天气\u0004,河北周末天气,河北一周天气预报,河北蓝天预报,河北天气预报,河北40日天气预报,还\u0005提供河北的生活指数、健康指数、交通...",
            "date": "2025-04-27 18:02:00",
            "icon": null,
            "id": 1,
            "image": null,
            "title": "【河北天气】河北天气预报,蓝天,蓝天预报,雾霾,雾霾...",
            "type": "web",
            "url": "https://www.weather.com.cn/html/weather/101031600.shtml",
            "video": null,
            "web_anchor": "【河北天气】河北天气预报,蓝天,蓝天预报,雾霾,雾霾..."
        },
        {
            "content": "保定天气预报,及时准确发布中央气象台天气信息,便捷查询保定今日天气,保定周末天气,保定一周天气预报,保定蓝天预报,保定天气预报,保定40日天气预报,还提供保定的生活指数、健康指数、交通...",
            "date": "2025-05-20 11:58:00",
            "icon": null,
            "id": 2,
            "image": null,
            "title": "保定天气预报,保定7天天气预报,保定15天天气预报,保定...",
            "type": "web",
            "url": "https://www.weather.com.cn/weather/101090201.shtml",
            "video": null,
            "web_anchor": "保定天气预报,保定7天天气预报,保定15天天气预报,保定..."
        },
        {
            "content": "河北省气象台2025年05月23日11时发布天气预报: 今天下午到夜间,保定西部、石家庄西部、邢台西部阴有小雨或零星小雨转晴,其他地区阴转晴。最高气温,张家口、承德北部、保定西北部13～17...",
            "date": "2025-05-23 00:00:00",
            "icon": null,
            "id": 3,
            "image": null,
            "title": "今天西部部分地区仍有降水 其它地区阴转晴-河北首页...",
            "type": "web",
            "url": "http://hebei.weather.com.cn/tqxs/4190923_m.shtml",
            "video": null,
            "web_anchor": "今天西部部分地区仍有降水 其它地区阴转晴-河北首页..."
        },
        {
            "content": "河北省气象台2025年05月22日05时发布天气预报 今天白天,保定、廊坊及以北地区阴有小雨或阵雨,其中张家口、保定西北部有中到大雨;其他地区多云转阴有小雨或阵雨,其中邯郸大部有中雨。...",
            "date": "2025-05-22 09:07:22",
            "icon": null,
            "id": 4,
            "image": null,
            "title": "今天白天到夜间,我省大部分地区有降水-河北首页-中国...",
            "type": "web",
            "url": "http://hebei.weather.com.cn/tqxs/4189523_m.shtml",
            "video": null,
            "web_anchor": "今天白天到夜间,我省大部分地区有降水-河北首页-中国..."
        }
    ],
    "request_id": "ca749cb1-26db-4ff6-9735-f7b472d59003"
}
```

```html
{
    "requestId": "00000000-0000-0000-0000-000000000000",
    "code": 216003,
    "message": "Authentication error: ( [Code: InvalidHTTPAuthHeader; Message: Fail to parse apikey authorization; RequestId: ea6ffeca-a136-401b-ba30-61c910c02ead] )"
}
```

| 错误码 | 描述 |
| --- | --- |
| 400 | 客户端请求参数错误 |
| 500 | 服务端执行错误 |
| 501 | 调用模型服务超时 |
| 502 | 模型流式输出超时 |
| 其它 | 详见 [模型返回错误码](https://cloud.baidu.com/doc/qianfan/s/Pmh4sv5qa) 。 |