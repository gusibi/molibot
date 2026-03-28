更新时间：2026-03-27

POST

https://qianfan.baidubce.com/v2/ai\_search/chat/completions

**概述：** 可根据用户输入query搜索全网实时信息后，并进行智能总结回答。  
**计费：** 每日免费额度为1000次，支持按量后付费（为不影响使用体验，可先去 [开通后付费](https://console.bce.baidu.com/qianfan/studio/resource) ），默认优先抵扣免费资源。如有其他需求请您 [联系我们](https://cloud.baidu.com/survey/baiduaisearch.html) ，费用详情请查看 [计费说明](https://cloud.baidu.com/doc/qianfan/s/Mmh4sv6ec) 。  
**使用方式：** API、 [工具及MCP](https://console.bce.baidu.com/qianfan/tools/toolsCenter/6dbfaa2c-4d84-44e0-9383-df15eff5bd6b/detail) 、 [SDK](https://github.com/baidubce/app-builder/blob/master/java/src/test/java/com/baidubce/appbuilder/AISearchTest.java)

## 权限说明

调用本文API，需使用API Key鉴权方式。使用API Key鉴权调用API流程，具体调用流程，请查看 [认证鉴权](https://cloud.baidu.com/doc/qianfan/s/Kmh4sutww) 。

## 请求参数

```html
POST /v2/ai_search/chat/completions HTTP/1.1
HOST: qianfan.baidubce.com
Authorization: Bearer <API Key>
Content-Type: application/json
{
    "messages": [
        {
            "content": "近日油价调整消息。",
            "role": "user"
        }
    ],
    "stream": false,
    "model": "ernie-4.5-turbo-32k",
    "instruction": "##",
    "enable_corner_markers": true,
    "enable_deep_search": true
}
```

## 示例代码

```html
curl --location 'https://qianfan.baidubce.com/v2/ai_search/chat/completions' \
--header 'X-Appbuilder-Authorization: Bearer <API Key>' \
--header 'Content-Type: application/json' \
--data '{
  "messages": [
    {
      "content": "北京有哪些景点",
      "role": "user"
    }
  ],
  "search_source": "baidu_search_v1",
  "resource_type_filter": [
      {"type": "image","top_k": 4},
      {"type": "video","top_k": 4},
      {"type": "web","top_k": 4}
  ],
  "search_recency_filter": "year",
  "stream": false,
  "model": "ernie-4.5-turbo-32k",
  "enable_deep_search": false,
  "enable_followup_query": false,
  "temperature": 0.11,
  "top_p": 0.55,
  "search_mode": "auto",
  "enable_reasoning": true
}'
```

## 返回响应

```html
{
    "choices": [
        {
            "finish_reason": "stop",
            "index": 0,
            "message": {
                "content": "北京的景点非常丰富，其中包括：\n1. 故宫博物院（紫禁城）：是世界上现存规模最大、保存最为完整的木质结构古建筑群之一，也是明清两代的皇家宫殿。\n2. 八达岭长城：是万里长城的重要组成部分，也是明长城的一个隘口，雄伟壮观，历史底蕴深厚。\n3. 颐和园：是清朝时期的皇家园林，以昆明湖、万寿山为基址，以杭州西湖为蓝本，汲取江南园林的设计手法而建成的一座大型山水园林，被誉为“皇家园林博物馆”。\n4. 北京天安门广场：是世界最大的城市广场，见证了许多重大历史时刻。\n5. 天坛公园：是明清皇帝祭天的地方，建筑独特，寓意“天圆地方”。\n6. 圆明园：是清代大型皇家园林，虽遭破坏，但仍能感受到昔日的辉煌与沧桑。\n7. 香山公园：是北京西郊的山林公园，景色秀丽，秋季红叶更是美不胜收。\n8. 恭王府：是规模宏大的王府建筑群，建筑精美。\n9. 什刹海：包括前海、后海等，有老北京的韵味，可乘船赏景。\n10. 奥林匹克公园：体现了“科技、绿色、人文”的理念，有鸟巢、水立方等标志性建筑。\n\n除了这些，北京还有许多其他值得一游的景点，如法海寺、龙庆峡、古北水镇、红螺寺等。",
                "role": "assistant"
            }
        }
    ],
    "is_safe": true,
    "references": [
        {
            "content": "1. 故宫（紫禁城）地址：东城区景山前街4号。门票：60元（旺季）/40元（淡季）开放时间：8:30-17:00（周一闭馆）。 为什么必去？故宫是世界现存最大、最完整的木质结构古建筑群，600年明清皇家历史的见证者，每一砖一瓦都藏着故事。必玩体验：中轴线游览（太和殿、乾清宫、御花园）感受皇家气派。打卡网红角落：延禧宫的西洋楼、红墙拍照（建议穿汉服）。珍宝馆+钟表馆（另收费），...",
            "date": "2025-4-24",
            "icon": "https://pic.rmb.bdstatic.com/bjh/user/f1c77bf4fc9f3651df29e52acde36e94.jpeg",
            "id": 1,
            "image": null,
            "title": "北京必玩景点TOP10|2025最新攻略,带你玩转帝都!",
            "type": "web",
            "url": "https://baijiahao.baidu.com/s?id=1830291819430711070&wfr=spider&for=pc",
            "video": null,
            "web_anchor": "老六爱玩"
        },
        {
            "content": "北京景点攻略 如果你是第一次去北京旅游可要千万要收藏好了",
            "date": "2024-06-01 03:18",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/default.png",
            "id": 2,
            "image": {
                "height": "674",
                "url": "http://img0.baidu.com/it/u=1145656209,2145532403&fm=253&fmt=auto&app=138&f=JPEG?w=500&h=674",
                "width": "500"
            },
            "title": "北京景点攻略 如果你是第一次去北京旅游可要千万要收藏好了",
            "type": "image",
            "url": "http://mbd.baidu.com/newspage/data/dtlandingsuper?nid=dt_5388334462984511033",
            "video": null,
            "web_anchor": "全网资源"
        },
        {
            "content": "哪些北京京郊的景点 外地同学值得自驾车去 跟着UP主出行看世界 /生活/出行/北京旅游避坑指南/北京去哪玩好/干货实用攻略/自驾游北京攻略/亲子游/周边游/周末去哪玩/北京旅游攻略/保姆级攻略 哪些北京京郊景点值得外地同学自驾车去 北京公义 大八山面 北京京郊大部分景点都在六环外 办理六环外的进京证就行 当然您要办理六环内的更好一些 下面就给您推荐一些京郊自驾游 外地同学值得去的景点(北京同学也值...",
            "date": "2025-5-23",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/bilibili.ico",
            "id": 3,
            "image": null,
            "title": "哪些北京京郊的景点 外地同学值得自驾车去",
            "type": "web",
            "url": "https://www.bilibili.com/video/BV1hE421K7K1",
            "video": null,
            "web_anchor": "哔哩哔哩"
        },
        {
            "content": "北京旅游必去的十大景点推荐",
            "date": "2024-06-19 13:00",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/default.png",
            "id": 4,
            "image": {
                "height": "1067",
                "url": "http://img2.baidu.com/it/u=80406124,3208002747&fm=253&fmt=auto&app=138&f=JPEG?w=800&h=1067",
                "width": "800"
            },
            "title": "北京旅游必去的十大景点推荐",
            "type": "image",
            "url": "http://www.douyin.com/note/7382074689126010131",
            "video": null,
            "web_anchor": "全网资源"
        },
        {
            "content": "北京景区排名必玩十大景点?有世界最大城市广场,有大型皇家园林 北京景区排名必玩十大景点?有世界最大城市广场,有大型皇家园林 北京景区 城市广场 旅游攻略 旅游资讯 皇家园林 北京有很多值得一去的景点推荐10个:1.故宫: 位于北京中心明清皇宫建筑辉煌藏品丰富 尽显皇家风范 2.颐和园 清朝皇家园林有山有水融合江南园林风格 风景如画 3.八达岭长城:在延庆万里长城重要部分 雄伟壮观历史底蕴深厚 4....",
            "date": "2025-5-22",
            "icon": "https://ss0.baidu.com/6ONWsjip0QIZ8tyhnq/it/u=76251347,1123177279&fm=195&app=88&f=PNG?w=200&h=200",
            "id": 5,
            "image": null,
            "title": "北京景区排名必玩十大景点?有世界最大城市广场,有大型...",
            "type": "web",
            "url": "https://haokan.baidu.com/v?pd=wisenatural&vid=14103857872992752240",
            "video": null,
            "web_anchor": "好看视频"
        },
        {
            "content": "北京必去十大景点 新手必看‼️附旅游攻略.熬夜整理出来的必打",
            "date": "2024-06-15 20:25",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/default.png",
            "id": 6,
            "image": {
                "height": "1342",
                "url": "http://img1.baidu.com/it/u=17130128,3218194790&fm=253&fmt=auto&app=138&f=JPEG?w=800&h=1342",
                "width": "800"
            },
            "title": "北京必去十大景点 新手必看‼附旅游攻略.熬夜整理出来的必打",
            "type": "image",
            "url": "http://www.douyin.com/note/7380319151006436646",
            "video": null,
            "web_anchor": "全网资源"
        },
        {
            "content": "揭秘！北京好玩的十大景点排行榜，你去过几个？北京，这座古老又现代的城市，藏着无数好玩的地方。想知道哪些景点能跻身北京好玩的地方排行榜前十名吗？接下来，我们就为你揭开谜底，带你领略京城最值得一去的精华景点，让你的北京之行不留遗憾。1. 故宫博物院 故宫，旧称紫禁城，是中国明清两代的皇家宫殿，也是世界上现存规模最大、保存最为完整的木质结构古建筑群之一。走进故宫，仿佛穿越回了古代，红墙黄瓦、飞檐斗拱，处...",
            "date": "2025-5-4",
            "icon": "https://pic.rmb.bdstatic.com/bjh/user/84f5641182eb2b574909828a3fa8f9b0.jpeg",
            "id": 7,
            "image": null,
            "title": "揭秘!北京好玩的十大景点排行榜,你去过几个?",
            "type": "web",
            "url": "https://baijiahao.baidu.com/s?id=1830726637146162329&wfr=spider&for=pc",
            "video": null,
            "web_anchor": "炫拍客旅途志"
        },
        {
            "content": "北京必去十大景点新手必看.亲亲记滴点赞收藏! 1 no.1",
            "date": "2024-08-17 11:00",
            "icon": "https://appbuilder.bj.bcebos.com/baidu-search-rag-pro/icon/default.png",
            "id": 8,
            "image": {
                "height": "1067",
                "url": "http://img0.baidu.com/it/u=3343386837,4291065808&fm=253&fmt=auto&app=138&f=JPEG?w=800&h=1067",
                "width": "800"
            },
            "title": "北京必去十大景点新手必看.亲亲记滴点赞收藏! 1 no.1",
            "type": "image",
            "url": "http://www.douyin.com/note/7403937889005882650",
            "video": null,
            "web_anchor": "全网资源"
        }
    ],
    "request_id": "ad524989-be46-48fd-b2ec-344683b28305",
    "usage": {
        "completion_tokens": 295,
        "prompt_tokens": 1919,
        "total_tokens": 2214
    }
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
| 其它 | 详见 [模型返回错误码](https://cloud.baidu.com/doc/qianfan/s/Pmh4sv5qa) |