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