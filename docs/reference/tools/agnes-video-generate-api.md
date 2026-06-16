Agnes-Video-V2.0
Agnes-Video-V2.0 是一款下一代电影级视频生成模型，支持 文生视频、图生视频、多图视频生成 和 关键帧动画工作流。
该模型能够生成高保真视频，并具备较强的运动一致性、场景连贯性和视觉真实感。用户可以通过文本提示词、参考图像或多个关键帧，创建可用于生产环境的视频内容。
Agnes-Video-V2.0 适用于故事创作、营销视频、产品演示、社交媒体内容、沉浸式视觉生产以及 AI 创意工作流。
模型概述
Agnes-Video-V2.0 针对高质量视频生成和灵活创意控制进行了优化。
该模型支持以下能力：
能力
说明
Text-to-Video
直接根据文本提示词生成视频
Image-to-Video
将静态图像动画化为动态视频
Multi-Image Video
使用多张参考图像指导视频生成
Keyframe Animation
在多个关键帧之间生成平滑过渡
Scene Motion Control
通过提示词控制主体运动、镜头运动和场景动态
Visual Consistency
在多帧之间保持较强的主体、风格和场景一致性
Cinematic Output
生成适用于创意和商业用途的高质量电影级视频
Asynchronous API
先提交任务，再通过任务 ID 获取结果
适用场景
Agnes-Video-V2.0 适用于以下场景：
场景
示例用例
故事创作
短片、叙事片段、角色场景
营销视频
产品广告、活动视频、推广内容
社交媒体内容
Reels、Shorts、TikTok 风格视频、创意帖子
图像动画化
动画化人像、产品、角色或场景
产品演示
根据文本或图像生成产品展示视频
关键帧过渡
在不同视觉状态之间生成平滑转场
游戏 / App 素材
为数字产品生成动态视觉素材
沉浸式内容
AI 生成的电影级场景和氛围视频
API 信息
Endpoint
项目
说明
API Endpoint - Create Task
https://apihub.agnes-ai.com/v1/videos
API Endpoint - Retrieve Result
https://apihub.agnes-ai.com/v1/videos/{task_id}
Request Method - Create Task
POST
Request Method - Retrieve Result
GET
Content-Type
application/json
Authentication Method
Bearer Token
Authentication Header
Authorization: Bearer YOUR_API_KEY
Task Type
异步视频生成任务
请求参数
创建视频任务
参数
类型
是否必填
说明
model
string
是
模型名称，固定为 agnes-video-v2.0
prompt
string
是
视频内容的文本描述
image
string / array
否
输入图片 URL 或图片 URL 数组
mode
string
否
生成模式，例如 ti2vid 或 keyframes
height
integer
否
视频高度，默认值为 768
width
integer
否
视频宽度，默认值为 1152
num_frames
integer
否
视频帧数，必须 ≤ 441，且满足 8n + 1
num_inference_steps
integer
否
推理步数
seed
integer
否
随机种子，用于保证结果可复现
frame_rate
number
否
视频 FPS，支持范围为 1–60
negative_prompt
string
否
负向提示词，用于描述需要避免的内容
extra_body.image
array
否
多图视频或关键帧模式中的输入图片 URL
extra_body.mode
string
否
额外模式设置，例如 keyframes
调用示例
1. 文生视频请求
用于直接根据文本提示词生成视频。
curl -X POST https://apihub.agnes-ai.com/v1/videos \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-video-v2.0",
    "prompt": "A cinematic shot of a cat walking on the beach at sunset, soft ocean waves, warm golden lighting, realistic motion",
    "height": 768,
    "width": 1152,
    "num_frames": 121,
    "frame_rate": 24
  }'
2. 图生视频请求
用于将单张图片动画化。
curl -X POST https://apihub.agnes-ai.com/v1/videos \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-video-v2.0",
    "prompt": "The woman slowly turns around and looks back at the camera, natural facial expression, cinematic camera movement",
    "image": "https://example.com/image.png",
    "num_frames": 121,
    "frame_rate": 24
  }'
3. 多图视频请求
用于通过多张输入图像指导视频生成。
curl -X POST https://apihub.agnes-ai.com/v1/videos \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-video-v2.0",
    "prompt": "Create a smooth transformation scene between the two reference images, cinematic lighting, consistent character identity, natural motion",
    "extra_body": {
      "image": [
        "https://example.com/image1.png",
        "https://example.com/image2.png"
      ]
    },
    "num_frames": 121,
    "frame_rate": 24
  }'
4. 关键帧动画请求
用于在关键帧之间生成平滑插值动画。
curl -X POST https://apihub.agnes-ai.com/v1/videos \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-video-v2.0",
    "prompt": "Generate a smooth cinematic transition between the keyframes, maintaining visual consistency and natural camera movement",
    "extra_body": {
      "image": [
        "https://example.com/keyframe1.png",
        "https://example.com/keyframe2.png"
      ],
      "mode": "keyframes"
    },
    "num_frames": 121,
    "frame_rate": 24
  }'
5. 获取视频结果请求
用于获取任务状态和最终结果。
{
  "request": {
    "method": "GET",
    "url": "https://apihub.agnes-ai.com/v1/videos/task_YOUR_TASK_ID",
    "headers": {
      "Authorization": "Bearer ***REDACTED***"
    },
    "path_params": {
      "task_id": "task_YOUR_TASK_ID"
    },
    "body": null
  }
响应格式
创建任务响应
"response": {
    "status": 200,
    "body": {
      "id": "task_YOUR_TASK_ID",
      "task_id": "task_YOUR_TASK_ID",
      "object": "video",
      "model": "agnes-video-v2.0",
      "status": "queued",
      "progress": 0,
      "created_at": 1780457477,
      "seconds": "10.0",
      "size": "1280x768"
    }
获取视频结果响应
"final_response": {
    "status": 200,
    "body": {
      "id": "task_YOUR_TASK_ID",
      "model": "agnes-video-v2.0",
      "object": "video",
      "status": "completed",
      "progress": 100,
      "seconds": "10.0",
      "size": "1280x768",
      "error": null,
      "remixed_from_video_id": "https://storage.googleapis.com/agnes-aigc/aigc/videos/2026/06/03/video_xxxxxx.mp4"
    }
  }
视频时长设置
Agnes-Video-V2.0 支持通过 num_frames 和 frame_rate 控制生成视频的时长。
视频时长计算公式为：
seconds = num_frames / frame_rate
其中：
num_frames 表示生成的视频总帧数；
frame_rate 表示视频帧率，即每秒播放多少帧；
num_frames 必须小于或等于 441；
num_frames 必须满足 8n + 1，例如 81、121、161、241、441；
frame_rate 支持范围为 1–60。
例如：
目标时长
推荐参数
约 5 秒
num_frames: 121, frame_rate: 24
约 10 秒
num_frames: 241, frame_rate: 24
约 18 秒
num_frames: 441, frame_rate: 24
如果希望生成更长的视频，可以降低 frame_rate；如果希望画面更流畅，可以提高 frame_rate，但在相同 num_frames下，视频时长会相应变短。
 
响应字段说明
字段
类型
说明
id
string
唯一任务 ID
object
string
对象类型，固定为 video
model
string
使用的模型，固定为 agnes-video-v2.0
status
string
任务状态
progress
integer
任务进度百分比，范围为 0 到 100
created_at
integer
任务创建时间戳
completed_at
integer
任务完成时间戳；未完成时为 null
video_url
string
生成视频 URL，仅在 status 为 completed 时可用
size
string
视频分辨率，格式为 width x height
seconds
string
视频时长，单位为秒
usage
object
使用量信息
Usage 字段说明
字段
说明
duration_seconds
视频生成总耗时，单位为秒
任务状态说明
状态
说明
queued
任务正在队列中等待
in_progress
视频正在生成中
completed
视频生成已完成
failed
视频生成失败
错误码
错误码
说明
400
请求无效，请检查请求参数
401
未授权，请检查 API Key
404
任务不存在
500
服务器错误
503
服务繁忙，请稍后重试
价格
类型
价格
现价
Video Duration
$0.005 / second
$0 / second
功能与兼容性
Agnes-Video-V2.0 支持以下能力：
文生视频
图生视频
多图引导视频生成
关键帧动画与平滑插值
基于 Prompt 的运动和场景控制
电影级视觉输出
异步任务式视频生成
基于轮询的结果获取
基于 Seed 的结果复现
OpenAI 风格 API 设计，并扩展了任务式视频生成能力
最佳实践
文生视频 Prompt
对于文生视频任务，建议描述主体、动作、环境、光照、镜头运动和风格。
推荐结构：
[Subject] + [Action] + [Scene] + [Camera Movement] + [Lighting] + [Style]
示例
A young astronaut walking across a red desert planet, dust blowing in the wind, slow cinematic tracking shot, dramatic sunset lighting, realistic sci-fi style
图生视频 Prompt
对于图生视频任务，建议描述哪些内容需要运动，同时保持关键主体稳定。
示例
Animate the character with subtle breathing motion, hair moving gently in the wind, background lights flickering softly, while keeping the face and outfit consistent
多图视频 Prompt
对于多图生成任务，建议描述输入图片之间的关系。
示例
Use the first image as the starting scene and the second image as the target scene. Create a smooth transformation with consistent lighting, natural motion, and cinematic pacing
关键帧 Prompt
对于关键帧动画任务，建议清晰描述帧与帧之间的过渡关系。
示例
Create a smooth transition from the first keyframe to the second keyframe, maintaining character identity, consistent camera angle, and natural motion between scenes
参数推荐
使用场景
推荐设置
标准视频生成
width: 1152，height: 768，num_frames: 121，frame_rate: 24
短视频社交内容
num_frames: 81 或 121，frame_rate: 24
更平滑的运动
使用更高的 frame_rate，例如 24 或 30
可复现结果
设置固定 seed
关键帧过渡
使用 extra_body.mode: "keyframes"
避免不需要的内容
使用 negative_prompt
说明
使用 agnes-video-v2.0 作为模型名称
视频生成是异步任务，需要先创建任务，再通过任务 ID 获取结果
video_url 仅在任务状态为 completed 时可用
num_frames 必须小于或等于 441
num_frames 必须满足 8n + 1，例如 81、121、161、241 或 441
文生视频任务仅要求传入 model 和 prompt
图生视频任务需要通过 image 提供图片 URL
多图视频任务需要在 extra_body.image 中提供多个图片 URL
关键帧动画需要设置 extra_body.mode 为 keyframes


## doubao seed2.0

调用视频生成 API
参见视频生成教程、Doubao Seedance 2.0 系列教程完成视频生成任务，需注意必须使用 Agent Plan 专属 API Key、专属 Base URL 及支持的模型，否则可能会调用失败或产生额外费用。具体参见核心配置信息。
通过 Agent Plan 创建视频生成任务的示例如下：
 
curl https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -d '{
    "model": "doubao-seedance-2.0",
    "content": [
        {
            "type": "text",
            "text": "女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动，可以听到风声"
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_foxrgirl.png"
            }
        }
    ],
    "generate_audio": true,
    "ratio": "adaptive",
    "duration": 5,
    "watermark": false
}'

视频生成

视频生成教程

seedance 模型具备出色的语义理解能力，可根据用户输入的文本、图片、视频、音频等多模态内容，快速生成优质的视频片段。本文为您介绍视频生成模型的通用基础能力，指导您调用 [Video Generation API](https://www.volcengine.com/docs/82379/1520758) 生成视频。如需了解 seedance 2.0 系列模型的最新能力，请参见 [Doubao Seedance 2.0 系列教程](https://www.volcengine.com/docs/82379/2291680) 。

效果预览

访问 [模型卡片](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0) 查看更多示例。

<iframe src="//about:blank" frameborder="0"></iframe>

| 场景 | 输入：提示词 | 输入：图片、视频、音频 | 输出 |
| --- | --- | --- | --- |
| 多模态参考  可参考图、  视频和音频 | 以图片1为首帧，画面放大至飞机舷窗外，一团团云朵缓缓飘至画面中，其中一朵为彩色糖豆点缀的云朵，始终在画面中居中，然后缓缓变形为图片2中的冰淇淋，镜头推远回到机舱内，坐在窗边的图片3中的角色伸手从窗外拿进冰淇淋，吃了一口，嘴巴上沾满奶油，脸上洋溢出甜蜜的笑容，此时视频配音为音频1 | ![](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/52bdd8074d41430b97afb773ac6acb91~tplv-goo7wpa0wc-image.image)  冰淇淋.mp3 | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/8eaeafa52ae04afe8d8894be0145c8c8" controls=""></video>  重播  播放  00:00 / 00:08 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频 |
| 编辑视频  替换视频主体、视频中对象增删改、局部画面重绘/修复等 | 将视频1中的房子外立面墙壁刷成蓝色，天气和光线参考图片1的雪天 | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/0751d1ba97664456893058e914a1b44a" controls=""></video>  重播  播放  00:00 / 00:00 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频  ![](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/666b1aa0e24143b285cf2325ad90de77~tplv-goo7wpa0wc-image.image) | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/5c17f8570a3943ceaa0c806aeffcbac9" controls=""></video>  重播  播放  00:00 / 00:08 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频 |
| 延长视频  向前或者向后延长视频，或多个视频片段串联成一个连贯视频 | 将视频1向后延长，11秒视频，汽车丝滑行驶到一片沙漠绿洲，背景音乐使用音频1 | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/7d84f0e0149348f598c8df548195b1c1" controls=""></video>  重播  播放  00:00 / 00:05 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频  汽车背景音.mp3 | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/37e14c2c6b994ef6821b1bebb8c1bd47" controls=""></video>  重播  播放  00:00 / 00:11 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频 |
| 首帧图生视频 | 镜头围绕人物推镜头拉近，特写人物面部，她正在用京剧唱腔唱“月移花影，疑是玉人来”，唱词充满情感，唱腔充满传统京剧特有的韵味与技巧，完美体现了花旦角色的内心世界 | ![](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bf9e55ee68e34671abbb12942aceb91a~tplv-goo7wpa0wc-image.image) | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/2fe3d82baa1642b1926007968a44e022" controls=""></video>  重播  播放  00:00 / 00:05 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频 |
| 首尾帧生视频 | 360度环绕运镜 | ![](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f8fc1008f23a4908b7c897e8b7eb87df~tplv-goo7wpa0wc-image.image) | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/9cb7768701564b73ac45616097452338" controls=""></video>  重播  播放  00:00 / 00:05 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频 |

新手入门

说明

下文详细介绍使用不同编程语言调用视频生成 API 的示例代码。

- 若您是编程零基础用户，推荐使用控制台 [体验中心](https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-260128&tab=GenVideo) ，包含丰富的模板库，可一键生成同款视频，无需编写代码即可快速上手创作。

- 若您想快速体验 API 调用，推荐使用 [API Explorer](https://api.volcengine.com/api-explorer/?action=CreateContentsGenerationsTasks&groupName=%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90API&serviceCode=ark&version=2024-01-01) ，内置预设参数模板，可一键发起 API 调用；同时也支持灵活调整参数（例如设置视频水印等），满足多样化的测试和使用场景。

- 若您想真正开始编程开发，但苦于搭建开发环境、依赖安装等问题，推荐阅读 [seedance 2.0 新手入门](https://www.volcengine.com/docs/82379/2291680) 。

视频生成是一个异步过程：

1. 成功调用 POST /contents/generations/tasks 接口后，API 将返回一个任务 ID 。

2. 您可以轮询 GET /contents/generations/tasks/{id} 接口，直到任务状态变为 succeeded；或者使用 Webhook 自动接收视频生成任务的状态变化。

3. 任务完成后，您可在 content.video\_url 字段处，下载最终生成的 MP4 文件。

说明

方舟平台的新用户？获取 API Key 及 开通模型等准备工作，请参见 [快速入门](https://www.volcengine.com/docs/82379/1399008) 。

Step1: 创建视频生成任务

通过 POST /\`\`contents/generations/tasks 创建视频生成任务。

请求成功后，系统将返回一个任务 ID。

{

"id": "cgt-2025\*\*\*\*\*\*-\*\*\*\*"

}

Step2: 查询视频生成任务

利用创建视频生成任务时返回的 ID ，您可以查询视频生成任务的详细状态与结果。此接口会返回任务的当前状态（如 queued 、running 、 succeeded 等）以及生成的视频相关信息（如视频下载链接、分辨率、时长等）。

说明

因模型、API负载和视频输出规格的不同，视频生成的过程可能耗时较长。为高效管理这一过程，您可以通过轮询 API 接口（详见 [基础使用](https://www.volcengine.com/docs/82379/1366799#754e68e3) 和 [进阶使用](https://www.volcengine.com/docs/82379/1366799#e190e738) 部分的 SDK 示例）来请求状态更新，或通过 [使用 Webhook 通知](https://www.volcengine.com/docs/82379/1366799#724d67c3) 接收通知。

当任务状态变为 succeeded 后，您可在 content.video\_url 字段处，下载最终生成的视频文件。

{

"id": "cgt-2025\*\*\*\*",

"model": "doubao-seedance-2-0-260128",

"status": "succeeded",

"content": {

"video\_url": "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/\*\*\*\*"

},

"usage": {

"completion\_tokens": 246840,

"total\_tokens": 246840

},

"created\_at": 1765510475,

"updated\_at": 1765510559,

"seed": 58944,

"resolution": "1080p",

"ratio": "16:9",

"duration": 5,

"framespersecond": 24,

"service\_tier": "default",

"execution\_expires\_after": 172800

}

模型能力

本表格展示所有 seedance 模型支持的能力，方便您对比和选型。如需了解 seedance 2.0 系列模型的最新用法，请参见 [Doubao Seedance 2.0 系列教程](https://www.volcengine.com/docs/82379/2291680) 。

<iframe src="//about:blank" frameborder="0"></iframe>

<table><colgroup><col width="216"> <col width="216"> <col width="108"> <col width="108"> <col width="108"> <col width="108"> <col width="108"></colgroup><tbody><tr><td><p>模型名称</p></td><td><p></p></td><td><p><a href="https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0&projectName=default">seedance 2.0</a></p></td><td><p><a href="https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-2-0-fast&projectName=default">seedance 2.0 fast</a></p></td><td><p><a href="https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-5-pro&projectName=default">seedance 1.5 pro</a></p></td><td><p><a href="https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedance-1-0-pro&projectName=default">seedance 1.0 pro</a></p></td><td></td></tr><tr><td><p>Model ID</p></td><td><p></p></td><td><p>doubao-seedance-2-0-260128</p></td><td><p>doubao-seedance-2-0-fast-260128</p></td><td><p>doubao-seedance-1-5-pro-251215</p></td><td><p>doubao-seedance-1-0-pro-250528</p></td><td><p>doubao-seedance-1-0-pro-fast-251015</p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2298881?lang=zh#4e74bcee">文生视频</a></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2298881?lang=zh#979b2d28">图生视频-首帧</a></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2298881?lang=zh#0d55ca07">图生视频-首尾帧</a></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td rowspan="3"><p><a href="https://www.volcengine.com/docs/82379/2291680?lang=zh#50e1b4ea">多模态参考</a> 【New】</p></td><td><p>图片参考</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td rowspan="0"><p></p></td><td><p>视频参考</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td rowspan="0"><p></p></td><td><p>组合参考</p><div><ul><li>图片 + 音频</li></ul></div><div><ul><li>图片 + 视频</li></ul></div><div><ul><li>视频 + 音频</li></ul></div><div><ul><li>图片 + 视频 + 音频</li></ul></div></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2291680?lang=zh#75a28782">编辑视频</a> 【New】</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2291680?lang=zh#46d77653">延长视频</a> 【New】</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2298881?lang=zh#979b2d28">生成有声视频</a></p><p>"generate_audio": "true"</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2291680?lang=zh#c40ed3ef">联网搜索工具</a> 【New】</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2298881?lang=zh#5acd28c8">样片模式</a></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2298881?lang=zh#141cf7fa">返回视频产物对应的尾帧图</a></p><p>"return_last_frame":</p><p>"true"</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2298881?lang=zh#9fe4cce0">输出视频规格</a></p></td><td><p>输出分辨率</p><p>"resolution": "720p"</p></td><td><p>480p</p><p>720p</p><p>1080p</p></td><td><p>480p</p><p>720p</p></td><td><p>480p</p><p>720p</p><p>1080p</p></td><td><p>480p</p><p>720p</p><p>1080p</p></td><td><p>480p</p><p>720p</p><p>1080p</p></td></tr><tr><td><p></p></td><td><p>输出宽高比</p><p>"ratio":"16:9"</p></td><td><p>21:9</p><p>16:9</p><p>4:3</p><p>1:1</p><p>3:4</p><p>9:16</p></td><td><p>21:9</p><p>16:9</p><p>4:3</p><p>1:1</p><p>3:4</p><p>9:16</p></td><td><p>21:9</p><p>16:9</p><p>4:3</p><p>1:1</p><p>3:4</p><p>9:16</p></td><td><p>21:9</p><p>16:9</p><p>4:3</p><p>1:1</p><p>3:4</p><p>9:16</p></td><td><p>21:9</p><p>16:9</p><p>4:3</p><p>1:1</p><p>3:4</p><p>9:16</p></td></tr><tr><td><p></p></td><td><p>输出帧率</p></td><td><p>24 fps</p></td><td><p>24 fps</p></td><td><p>24 fps</p></td><td><p>24 fps</p></td><td><p>24 fps</p></td></tr><tr><td><p></p></td><td><p>输出时长</p><p>"duration": 5</p></td><td><p>4~15 秒</p></td><td><p>4~15 秒</p></td><td><p>4~12 秒</p></td><td><p>2~12 秒</p></td><td><p>2~12 秒</p></td></tr><tr><td><p></p></td><td><p>输出视频格式</p></td><td><p>mp4</p></td><td><p>mp4</p></td><td><p>mp4</p></td><td><p>mp4</p></td><td><p>mp4</p></td></tr><tr><td><p><a href="https://www.volcengine.com/docs/82379/2298881?lang=zh#c3588bd1">离线推理</a></p><p>"service_tier": "flex"</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>在线推理限流</p></td><td><p>最大 RPM</p></td><td><p>企业用户：600</p><p>个人用户：180</p></td><td><p>企业用户：600</p><p>个人用户：180</p></td><td><p>600</p></td><td><p>600</p></td><td><p>600</p></td></tr><tr><td><p></p></td><td><p>最大并发数</p></td><td><p>企业用户：10</p><p>个人用户：3</p></td><td><p>企业用户：10</p><p>个人用户：3</p></td><td><p>10</p></td><td><p>10</p></td><td><p>10</p></td></tr><tr><td><p>离线推理限流</p></td><td><p>TPD</p></td><td><p>-</p></td><td><p>-</p></td><td><p>5000亿</p></td><td><p>5000亿</p></td><td><p>5000亿</p></td></tr></tbody></table>

基础使用

文生视频

根据用户输入的提示词生成视频，结果具有较大的随机性，可以用于激发创作灵感。

<iframe src="//about:blank" frameborder="0"></iframe>

| 提示词 | 输出 |
| --- | --- |
| 写实风格，晴朗的蓝天之下，一大片白色的雏菊花田，镜头逐渐拉近，最终定格在一朵雏菊花的特写上，花瓣上有几颗晶莹的露珠 | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/b847f3e831c244b39f7b4d53d904988f" controls=""></video>  重播  播放  00:00 / 00:05 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频 |

图生视频-基于首帧（含音频）

通过指定视频的首帧图片，模型能够基于该图片生成与之相关且画面连贯的视频内容。

seedance 2.0 / seedance 1.5 pro 可通过设置参数 generate\_audio 为 true，生成有声视频。

<iframe src="//about:blank" frameborder="0"></iframe>

| 提示词 | 首帧 | 输出 |
| --- | --- | --- |
| 女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动，可以听到风声 | ![](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a28ec84ff9fc4287a0d98191020a3218~tplv-goo7wpa0wc-image.image) | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/f1f7b95a38ee4ee094c724233e4da4f8" controls=""></video>  重播  播放  00:00 / 00:05 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频 |

图生视频-基于首尾帧（含音频）

通过指定视频的起始和结束图片，模型即可生成流畅衔接首、尾帧的视频，实现画面间自然、连贯的过渡效果。

seedance 2.0 / seedance 1.5 pro 可通过设置参数 generate\_audio 为 true，生成有声视频。

<iframe src="//about:blank" frameborder="0"></iframe>

| 提示词 | 首帧 | 尾帧 | 输出 |
| --- | --- | --- | --- |
| 图中女孩对着镜头说“茄子”，360度环绕运镜 | ![](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/649cb2057eae48d6a6eec872d912c75c~tplv-goo7wpa0wc-image.image) | ![](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e39fd8e500a34bbdad50d06659c4ea6b~tplv-goo7wpa0wc-image.image) | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/3aa8c84b8a29408ab29e95992d61c559" controls=""></video>  重播  播放  00:00 / 00:05 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频 |

管理视频任务

查询视频生成任务列表

该接口支持传入条件筛选参数，以查询符合条件的视频生成任务列表。

删除或取消视频生成任务

取消排队中的视频生成任务，或者删除视频生成任务记录。

自定义视频输出规格

通过 API 参数控制输出视频的规格，包括分辨率、宽高比、时长、是否包含水印等。

新方式（推荐）：在 request body 中直接传入参数

此方式为强校验，若参数填写错误，模型会返回错误提示。

...

"content": \[

{

"type": "text",

"text": "<Your prompt>"

}

\],

"resolution": "720p",

"ratio":"16:9",

"duration": 5,

"seed": 11,

"camera\_fixed": false,

"watermark": true

...

旧方式：在文本提示词后追加 --\[parameters\]

此方式为弱校验，若参数填写错误，该参数将被忽略或触发报错。

...

"content": \[

{

"type": "text",

"text": "<Your prompt> --rs 720p --rt 16:9 --dur 5 --seed 11 --cf false --wm true"

}

\]

...

分辨率和宽高比

Seedance 2.0 fast 不支持 1080p

通过以下参数控制输出视频的分辨率和宽高比，分辨率和宽高比将共同决定输出视频的像素尺寸。

- resolution：指定输出视频的分辨率，支持 480p，720p，1080p。

- ratio：指定输出视频的宽高比，支持 16:9，4:3，1:1，3:4，9:16，21:9，adaptive。

{

"resolution": "720p",

"ratio":"16:9"

}

各模型输出视频的像素尺寸如下：

<iframe src="//about:blank" frameborder="0"></iframe>

<table><colgroup><col width="164"> <col width="164"> <col width="328"> <col width="328"></colgroup><tbody><tr><td><p>分辨率</p></td><td><p>宽高比</p></td><td><p>Seedance 1.0 系列</p></td><td><p>Seedance 2.0 系列</p><p>Seedance 1.5 pro</p></td></tr><tr><td rowspan="6"><p>480p</p></td><td><p>16:9</p></td><td><p>864×480</p></td><td><p>864×496</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>4:3</p></td><td><p>736×544</p></td><td><p>752×560</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>1:1</p></td><td><p>640×640</p></td><td><p>640×640</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>3:4</p></td><td><p>544×736</p></td><td><p>560×752</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>9:16</p></td><td><p>480×864</p></td><td><p>496×864</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>21:9</p></td><td><p>960×416</p></td><td><p>992×432</p></td></tr><tr><td rowspan="6"><p>720p</p></td><td><p>16:9</p></td><td><p>1248×704</p></td><td><p>1280×720</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>4:3</p></td><td><p>1120×832</p></td><td><p>1112×834</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>1:1</p></td><td><p>960×960</p></td><td><p>960×960</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>3:4</p></td><td><p>832×1120</p></td><td><p>834×1112</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>9:16</p></td><td><p>704×1248</p></td><td><p>720×1280</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>21:9</p></td><td><p>1504×640</p></td><td><p>1470×630</p></td></tr><tr><td rowspan="6"><p>1080p</p><p>Seedance 2.0 fast 不支持</p></td><td><p>16:9</p></td><td><p>1920×1088</p></td><td><p>1920×1080</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>4:3</p></td><td><p>1664×1248</p></td><td><p>1664×1248</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>1:1</p></td><td><p>1440×1440</p></td><td><p>1440×1440</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>3:4</p></td><td><p>1248×1664</p></td><td><p>1248×1664</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>9:16</p></td><td><p>1088×1920</p></td><td><p>1080×1920</p></td></tr><tr><td rowspan="0"><p></p></td><td><p>21:9</p></td><td><p>2176×928</p></td><td><p>2206×946</p></td></tr></tbody></table>

视频时长

通过 duration 参数控制生成视频的时长（整数秒）：

- Seedance 1.0 系列: \[2, 12\]

- Seedance 1.5 pro: \[4,12\] 或设置为-1

- Seedance 2.0 系列: \[4,15\] 或设置为-1

\-1 表示智能指定时长，由模型在有效范围内自主选择合适的视频长度（整数秒）

{

"duration": 5

}

Seedance 1.0 系列模型还支持通过 frames 参数指定生成视频的帧数，从而生成小数秒的视频。

- 计算公式：帧数 = 时长 × 帧率（24）。

- 取值范围：frames 支持 \[29, 289\] 区间内所有满足 25 + 4n 格式的整数值，其中 n 为正整数。

- 注意事项：duration 和 frames 二选一即可，frames 的优先级高于 duration。

{

"frames": 29

}

视频中添加水印

通过 watermark 参数，来控制是否在生成的视频中添加水印。

- true：在视频右下角添加AI生成水印标识。

- false：不添加水印。

{

"watermark": true

}

提示词建议

- 提示词 = 主体 + 运动， 背景 + 运动，镜头 + 运动...

- 用简洁准确的自然语言写出你想要的效果。

- 如果有较为明确的效果预期，建议先用生图模型生成符合预期的图片，再用图生视频进行视频片段的生成。

- 文生视频会有较大的结果随机性，可以用于激发创作灵感

- 图生视频时请尽量上传高清高质量的图片，上传图片的质量对图生视频影响较大。

- 当生成的视频不符合预期时，建议修改提示词，将抽象描述换成具象描述，并注意删除不重要的部分，将重要内容前置。

- 更多提示词的使用技巧请参见 [Seedance-1.5-pro 提示词指南](https://www.volcengine.com/docs/82379/2168087) 、 [Seedance-1.0-pro&pro-fast 提示词指南](https://www.volcengine.com/docs/82379/1631633) 。

进阶使用

离线推理

不支持 seedance 2.0 及 seedance 2.0 fast

针对推理时延敏感度低（例如小时级响应）的场景，建议将 service\_tier 设为 flex，一键切换至离线推理模式——价格仅为在线推理的 50%，显著降低业务成本。

注意根据业务场景设置合适的超时时间，超过该时间后任务将自动终止。

样片模式

仅支持 seedance 1.5 pro

获得一个符合预期的生产级别视频，通常需要多次抽卡，耗时耗力。样片模式是平台推出的中间产物可视化功能，开启该功能后，将生成一段预览视频，帮助用户 低成本验证 生成视频的场景结构、镜头调度、主体动作与 Prompt 意图等关键要素是否符合预期，快速调整方向。确认符合预期后，再基于 Draft 视频生成最终的高质量视频。

<iframe src="//about:blank" frameborder="0"></iframe>

| 输入 | Draft 视频 | 正式视频 |
| --- | --- | --- |
| ![](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ebb5217645b04cfc94209a6f7d36a523~tplv-goo7wpa0wc-image.image)  提示词：女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动，可以听到风声 | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/7c190b3a0ed34b29bc1192acbce2f4d2" controls=""></video>  重播  播放  00:00 / 00:05 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频  生成一段预览视频，低成本验证结果。 | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/a82cd582a5d54f34a8adec10f2815081" controls=""></video>  重播  播放  00:00 / 00:05 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频  复用 Draft 视频使用 模型、提示词、输入图片、种子值、音频设置、视频宽高比、视频时长等 生成正式视频，保证视频关键要素一致。 |

本功能使用分为两步：

Step1: 生成 Draft 视频

1. 设置 "draft": true，调用POST /contents/generations/tasks接口创建 Draft 视频生成任务。

2. 调用GET /contents/generations/tasks/{id}接口查询生成状态和结果，下载 Draft 视频，确认是否符合预期。

说明

- 仅 seedance 1.5 pro 支持该功能。

- 仅支持 480p 分辨率（使用其他分辨率会报错），不支持返回尾帧功能，不支持离线推理功能。

- Draft 视频的 token 单价不变，消耗的 token 更少。Draft视频token用量 = 正常视频token用量 × 折算系数，以 seedance 1.5 pro 为例，有声视频的折算系数为 0.6，故生成一个 Draft 有声视频的价格是正常视频的 0.6 倍，显著降低了成本。

Step2: 基于 Draft 视频生成正式视频

如果确认 Draft 视频符合预期，可基于 Step1 返回的 Draft 视频任务 ID，再次调用POST /contents/generations/tasks接口，生成最终视频。

说明

- 平台将自动复用 Draft 视频使用的用户输入（ \*\*model、\*\*content.\*\*text、\*\*content.\*\*image\_url、generate\_audio、seed、ratio、duration、\*\*camera\_fixed ），生成正式视频。

- 其余参数支持指定，不指定将使用本模型的默认值。例如：指定正式视频的分辨率、是否包含水印、是否使用离线推理、是否返回尾帧等。

- 基于 Draft 视频生成最终视频属于正常推理过程，按照正常视频消耗 token 量计费。

- Draft 视频任务 ID 的有效期为 7 天（从 created at 时间戳开始计算），超时后将无法使用该 Draft 视频生成正式视频。

生成多个连续视频

使用前一个生成视频的尾帧，作为后一个视频任务的首帧，循环生成多个连续的视频。

后续您可以自行使用 FFmpeg 等工具，将生成的多个短视频拼接成一个完整长视频。

<iframe src="//about:blank" frameborder="0"></iframe>

| 输出1 | 输出2 | 输出3 |
| --- | --- | --- |
| <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/c984894e448f43ca8a593babe411a078" controls=""></video>  重播  播放  00:00 / 00:00 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频  女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动  A girl holding a fox, the girl opens her eyes, looks gently at the camera, the fox hugs affectionately, the camera slowly pulls out, the girl's hair is blown by the wind | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/ccb8cebc70bd42738ba8d4bb894b69e6" controls=""></video>  重播  播放  00:00 / 00:00 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频  女孩和狐狸在草地上奔跑，阳光明媚，女孩的笑容灿烂，狐狸欢快地跳跃  A girl and a fox running on the grass, sunny weather, the girl's smile is brilliant, the fox jumps happily | <video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/b78ed8dd418a4c97ac94253cb0c00728" controls=""></video>  重播  播放  00:00 / 00:00 直播  00:00  进入全屏  进入样式全屏  - 2x - 1.5x - 1x - 0.75x - 0.5x  点击按住可拖动视频  女孩和狐狸坐在树下休息，女孩轻轻抚摸狐狸的毛发，狐狸温顺地趴在女孩腿上  A girl and a fox resting under a tree, the girl gently strokes the fox's fur, the fox lies meekly on the girl's lap |

import os

import time

from volcenginesdkarkruntime import Ark

client = Ark(

base\_url="https://ark.cn-beijing.volces.com/api/v3",

api\_key=os.environ.get("ARK\_API\_KEY"),

)

def generate\_video\_with\_last\_frame(prompt, initial\_image\_url=None):

"""

Generate video and return video URL and last frame URL

Parameters:

prompt: Text prompt for video generation

initial\_image\_url: Initial image URL (optional)

Returns:

video\_url: Generated video URL

last\_frame\_url: URL of the last frame of the video

"""

print(f"----- Generating video: {prompt} -----")

content = \[{

"text": prompt,

"type": "text"

}\]

if initial\_image\_url:

content.append({

"image\_url": {

"url": initial\_image\_url

},

"type": "image\_url"

})

create\_result = client.content\_generation.tasks.create(

model="doubao-seedance-2-0-260128",

content=content,

return\_last\_frame=True,

ratio="adaptive",

duration=5,

watermark=False,

)

task\_id = create\_result.id

while True:

get\_result = client.content\_generation.tasks.get(task\_id=task\_id)

status = get\_result.status

if get\_result.status == "succeeded":

print("Video generation succeeded")

try:

if hasattr(get\_result, 'content') and hasattr(get\_result.content, 'video\_url') and hasattr(get\_result.content, 'last\_frame\_url'):

return get\_result.content.video\_url, get\_result.content.last\_frame\_url

print("Failed to obtain video URL or last frame URL")

return None, None

except Exception as e:

print(f"Error occurred while obtaining video URL and last frame URL: {e}")

return None, None

elif status == "failed":

print(f"----- Video generation failed -----")

print(f"Error: {get\_result.error}")

return None, None

else:

print(f"Current status: {status}, retrying in 10 seconds...")

time.sleep(10)

if \_\_name\_\_ == "\_\_main\_\_":

prompts = \[

"女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动",

"女孩和狐狸在草地上奔跑，阳光明媚，女孩的笑容灿烂，狐狸欢快地跳跃",

"女孩和狐狸坐在树下休息，女孩轻轻抚摸狐狸的毛发，狐狸温顺地趴在女孩腿上"

\]

video\_urls = \[\]

initial\_image\_url = "https://ark-project.tos-cn-beijing.volces.com/doc\_image/i2v\_foxrgirl.png"

for i, prompt in enumerate(prompts):

print(f"Generating video {i+1}")

video\_url, last\_frame\_url = generate\_video\_with\_last\_frame(prompt, initial\_image\_url)

if video\_url and last\_frame\_url:

video\_urls.append(video\_url)

print(f"Video {i+1} URL: {video\_url}")

initial\_image\_url = last\_frame\_url

else:

print(f"Video {i+1} generation failed, exiting program")

exit(1)

print("All videos generated successfully!")

print("Generated video URL list:")

for i, url in enumerate(video\_urls):

print(f"Video {i+1}: {url}")

使用 Webhook 通知

通过 callback\_url 参数可以指定一个回调通知地址，当视频生成任务的状态发生变化时，方舟会向该地址发送一条 POST 请求，方便您及时获取任务最新情况。 请求内容结构与 [查询任务API](https://www.volcengine.com/docs/82379/1521309) 的返回体一致。

{

"id": "cgt-2025\*\*\*\*",

"model": "doubao-seedance-2-0-260128",

"status": "running",

"created\_at": 1765434920,

"updated\_at": 1765434920,

"service\_tier": "default",

"execution\_expires\_after": 172800

}

您需要自行搭建一个公网可访问的 Web Server 来接收 Webhook 通知。以下是一个简单的 Web Server 代码示例，供您参考。

from flask import Flask, request, jsonify

import sqlite3

import logging

from datetime import datetime

import os

app = Flask(\_\_name\_\_)

logging.basicConfig(

level=logging.INFO,

format='%(asctime)s - %(levelname)s - %(message)s',

handlers=\[logging.FileHandler('webhook.log'), logging.StreamHandler()\]

)

DB\_PATH = 'video\_tasks.db'

def init\_db():

"""Automatically create task table on first run, aligning fields with callback parameters"""

conn = sqlite3.connect(DB\_PATH)

cursor = conn.cursor()

cursor.execute('''

CREATE TABLE IF NOT EXISTS video\_generation\_tasks (

task\_id TEXT PRIMARY KEY,

model TEXT NOT NULL,

status TEXT NOT NULL,

created\_at INTEGER NOT NULL,

updated\_at INTEGER NOT NULL,

service\_tier TEXT NOT NULL,

execution\_expires\_after INTEGER NOT NULL,

last\_callback\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP

)

''')

conn.commit()

conn.close()

logging.info("Database initialized, table created/exists")

@app.route('/webhook/callback', methods=\['POST'\])

def video\_task\_callback():

"""Core interface for receiving Ark callback"""

try:

callback\_data = request.get\_json()

if not callback\_data:

logging.error("Callback request body empty or non-JSON format")

return jsonify({"code": 400, "msg": "Invalid JSON data"}), 400

required\_fields = \['id', 'model', 'status', 'created\_at', 'updated\_at', 'service\_tier', 'execution\_expires\_after'\]

for field in required\_fields:

if field not in callback\_data:

logging.error(f"Callback data missing required field: {field}, data: {callback\_data}")

return jsonify({"code": 400, "msg": f"Missing field: {field}"}), 400

task\_id = callback\_data\['id'\]

status = callback\_data\['status'\]

model = callback\_data\['model'\]

logging.info(f"Received task callback | Task ID: {task\_id} | Status: {status} | Model: {model}")

print(f"\[{datetime.now()}\] Task {task\_id} status updated to: {status}")

conn = sqlite3.connect(DB\_PATH)

cursor = conn.cursor()

cursor.execute('''

INSERT OR REPLACE INTO video\_generation\_tasks (

task\_id, model, status, created\_at, updated\_at, service\_tier, execution\_expires\_after

) VALUES (?,?,?,?,?,?,?)

''', (

task\_id,

model,

status,

callback\_data\['created\_at'\],

callback\_data\['updated\_at'\],

callback\_data\['service\_tier'\],

callback\_data\['execution\_expires\_after'\]

))

conn.commit()

conn.close()

logging.info(f"Task {task\_id} database update successful")

return jsonify({"code": 200, "msg": "Callback received successfully", "task\_id": task\_id}), 200

except Exception as e:

logging.error(f"Callback processing failed: {str(e)}", exc\_info=True)

return jsonify({"code": 200, "msg": "Callback received successfully (internal processing exception)"}), 200

@app.route('/tasks/<task\_id>', methods=\['GET'\])

def get\_task\_status(task\_id):

"""Query latest status of specified task"""

conn = sqlite3.connect(DB\_PATH)

cursor = conn.cursor()

cursor.execute('SELECT \* FROM video\_generation\_tasks WHERE task\_id =?', (task\_id,))

task = cursor.fetchone()

conn.close()

if not task:

return jsonify({"code": 404, "msg": "Task not found"}), 404

fields = \['task\_id', 'model', 'status', 'created\_at', 'updated\_at', 'service\_tier', 'execution\_expires\_after', 'last\_callback\_at'\]

task\_dict = dict(zip(fields, task))

return jsonify({"code": 200, "data": task\_dict}), 200

if \_\_name\_\_ == '\_\_main\_\_':

init\_db()

app.run(host='0.0.0.0', port=8080, debug=False)

使用限制

多模态输入

注意

seedance 2.0 系列模型不支持直接上传含有真人人脸的参考图/视频。为了便利创作者对肖像的使用，平台推出了一系列解决方案，详情参见seedance 2.0 系列教程的 [便利创作](https://www.volcengine.com/docs/82379/2291680#5c67c9a1) 章节。

图片要求

- 传入方式：图片 URL、图片 Base64 编码、素材 ID。

- 图片格式：jpeg、png、webp、bmp、tiff、gif。其中，Seedance 1.5 pro 和 Seedance 2.0 系列模型新增支持 heic 和 heif。

- 单个图片尺寸：

- 宽高比（宽/高）： (0.4, 2.5)

- 宽高长度（px）：(300, 6000)

- 大小：单张图片小于 30 MB。请求体大小不超过 64 MB。大文件请勿使用Base64编码。

- 图片数量：

- 图生视频-首帧：1 张

- 图生视频-首尾帧：2 张

- seedance 2.0 多模态参考生视频：1~9 张

视频要求

- 传入方式：视频URL、素材 ID。

- 视频格式：mp4、mov，支持编码格式见下表。

- 分辨率：480p，720p，1080p

- 时长：单个视频时长 \[2, 15\] s，最多传入 3 个参考视频，所有视频总时长不超过 15s。

- 单个视频尺寸：

- 宽高比（宽/高）：\[0.4, 2.5\]

- 宽高长度（px）：\[300, 6000\]

- 总像素数：\[640×640=409600, 2206×946=2086876\]，即宽和高的乘积符合 \[409600, 2086876\] 的区间要求。

- 大小：单个视频不超过 50 MB。

- 帧率 (FPS)：\[24, 60\]

<iframe src="//about:blank" frameborder="0"></iframe>

| 容器格式 | 常用文件扩展名 | MIME | 支持编码 |
| --- | --- | --- | --- |
| MP4 | .mp4 | video/mp4 | 视频：H.264/AVC、H.265/HEVC  音频：AAC、MP3 |
| QuickTime | .mov | video/quicktime | 视频：H.264/AVC、H.265/HEVC  音频：AAC、MP3 |

音频要求

- 传入方式：音频 URL 、音频 Base64 编码、素材 ID。

- 音频格式：wav、mp3

- 时长：单个音频时长 \[2, 15\] s，最多传入 3 段参考音频，所有音频总时长不超过 15 s。

- 大小：单个音频不超过 15 MB，请求体大小不超过 64 MB。大文件请勿使用Base64编码。

保存时间

- 任务记录：保存 7 天，查询区间 \[T-7天, T)，T 为请求发起时刻的 UTC 秒级时间戳。

- 视频 URL：保存 24 小时，超时后无法访问，请及时下载或转存。

限流说明

模型限流

default（在线推理）

- RPM 限流：账号下同模型（区分模型版本）每分钟允许创建的任务数量上限。若超过该限制，创建视频生成任务时会报错。

- 并发数限制：账号下同模型（区分模型版本）同一时刻在处理中的任务数量上限。超过此限制的任务将进入队列等待处理。

- 不同模型的限制值不同，详见 [视频生成能力](https://www.volcengine.com/docs/82379/1330310#2705b333) 。

flex（离线推理）

- TPD 限流：账号在一天内对同一模型（区分模型版本）的总调用 token 上限。超过此限制的调用请求将被拒绝。不同模型的 TPD 限流值不同，详见 [视频生成能力](https://www.volcengine.com/docs/82379/1330310#2705b333) 。

图片裁剪规则

seedance 系列模型的图生视频场景，支持设置生成视频的宽高比。当选择的视频宽高与您上传的图片宽高比不一致时，方舟会对您的图片进行裁剪，裁剪时会居中裁剪。详细规则如下：

说明

若要呈现出较好的视频效果，建议所指定的视频宽高比（ratio）与实际上传图片的宽高比尽可能接近。

1. 输入参数：

- 原始图片宽度记为W（单位：像素），高度记为H（单位：像素）。

- 目标比例记为A:B（例如，21:9），这表示裁剪后的宽度与高度之比应为 A/B（如 21/9≈2.333）。

2. 比较宽高比：

- 计算原始图片的宽高比Ratio\_原始=W/H。

- 计算目标比例的比值Ratio\_目标=A/B（例如，21:9 的 Ratio目标=21/9≈2.333)。

- 根据比较结果，决定裁剪基准：

- 如果Ratio\_原始<Ratio\_目标（即原始图片“太高”或“竖高”），则以宽度为基准裁剪。

- 如果Ratio\_原始>Ratio\_目标（即原始图片“太宽”或“横宽”），则以高度为基准裁剪。

- 如果相等，则无需裁剪，直接使用全图。

3. 裁剪尺寸计算（量化公式）：

- 以宽度为基准（适用于竖高图片）：

- 裁剪宽度Crop\_W=W（使用整个原始宽度）。

- 裁剪高度Crop\_H=(B/A)×W（根据目标比例等比例计算高度）。

- 裁剪区域的起始坐标（居中定位）：

- X 坐标（水平）：总是 0（因为宽度全用，从左侧开始）。

- Y 坐标（垂直）：(H−Crop\_H)/2（确保垂直居中，从顶部开始）。

- 以高度为基准（适用于横宽图片）：

- 裁剪高度Crop\_H=H（使用整个原始高度）。

- 裁剪宽度Crop\_W=(A/B)×H（根据目标比例等比例计算宽度）。

- 裁剪区域的起始坐标（居中定位）：

- X 坐标（水平）：(W−Crop\_W)/2（确保水平居中，从左侧开始）。

- Y 坐标（垂直）：总是 0（因为高度全用，从顶部开始）。

4. 裁剪结果：

- 最终裁剪出的图片尺寸为Crop\_W×Crop\_H，比例严格为A:B，且完全位于原始图片内部，无黑边。

- 裁剪区域总是以原始图片中心为基准，因此内容居中。

5. 裁剪示例：

以 seedance 1.0 Pro 首帧图生视频功能为例

<iframe src="//about:blank" frameborder="0"></iframe>

<table><colgroup><col width="394"> <col width="197"> <col width="394"></colgroup><tbody><tr><td><p>输入的首帧图片</p></td><td><p>指定的宽高比ratio</p></td><td><p>生成的视频结果</p></td></tr><tr><td rowspan="6"><p>16:9</p><div><img src="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c66d7faff6104320a981b36149dc713f~tplv-goo7wpa0wc-image.image"></div></td><td><p>21:9</p></td><td><p><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/6e8590c07be9406d805209355b799a37"></video><svg width="78" height="78"><path></path></svg></p><p>重播</p><p>播放</p><p>00:00 / 00:00 直播</p><p>00:00</p><p>进入全屏</p><p>进入样式全屏</p><div><ul><li>2x</li><li>1.5x</li><li>1x</li><li>0.75x</li><li>0.5x</li></ul></div><p>点击按住可拖动视频</p><p></p></td></tr><tr><td rowspan="0"><p></p></td><td><p>16:9</p></td><td><p><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/e0bef5f3806f439da5f0c9f5acc44c9b"></video><svg width="78" height="78"><path></path></svg></p><p>重播</p><p>播放</p><p>00:00 / 00:00 直播</p><p>00:00</p><p>进入全屏</p><p>进入样式全屏</p><div><ul><li>2x</li><li>1.5x</li><li>1x</li><li>0.75x</li><li>0.5x</li></ul></div><p>点击按住可拖动视频</p><p></p></td></tr><tr><td rowspan="0"><p></p></td><td><p>4:3</p></td><td><p><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/a8e3202b77744bec83e0c7baa247b84c"></video><svg width="78" height="78"><path></path></svg></p><p>重播</p><p>播放</p><p>00:00 / 00:00 直播</p><p>00:00</p><p>进入全屏</p><p>进入样式全屏</p><div><ul><li>2x</li><li>1.5x</li><li>1x</li><li>0.75x</li><li>0.5x</li></ul></div><p>点击按住可拖动视频</p><p></p></td></tr><tr><td rowspan="0"><p></p></td><td><p>1:1</p></td><td><p><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/436df8f6dae74d6c86d08bf1e18bc9d0"></video><svg width="78" height="78"><path></path></svg></p><p>重播</p><p>播放</p><p>00:00 / 00:00 直播</p><p>00:00</p><p>进入全屏</p><p>进入样式全屏</p><div><ul><li>2x</li><li>1.5x</li><li>1x</li><li>0.75x</li><li>0.5x</li></ul></div><p>点击按住可拖动视频</p><p></p></td></tr><tr><td rowspan="0"><p></p></td><td><p>3:4</p></td><td><p><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/a3a94a577d754501889535a651d03a55"></video><svg width="78" height="78"><path></path></svg></p><p>重播</p><p>播放</p><p>00:00 / 00:00 直播</p><p>00:00</p><p>进入全屏</p><p>进入样式全屏</p><div><ul><li>2x</li><li>1.5x</li><li>1x</li><li>0.75x</li><li>0.5x</li></ul></div><p>点击按住可拖动视频</p><p></p></td></tr><tr><td rowspan="0"><p></p></td><td><p>9:16</p></td><td><p><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/1423ee0fc9cf451398788dc57e9f55c4"></video><svg width="78" height="78"><path></path></svg></p><p>重播</p><p>播放</p><p>00:00 / 00:00 直播</p><p>00:00</p><p>进入全屏</p><p>进入样式全屏</p><div><ul><li>2x</li><li>1.5x</li><li>1x</li><li>0.75x</li><li>0.5x</li></ul></div><p>点击按住可拖动视频</p><p></p></td></tr></tbody></table>

最近更新时间：2026.06.03 19:24:07

这个页面对您有帮助吗？

rangeDom

<iframe src="about:blank"></iframe>