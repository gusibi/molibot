Agnes-Image-2.0-Flash
Agnes-Image-2.0-Flash 是由 Sapiens AI 开发的一款高性能图像编辑与图像生成模型。
该模型支持 图生图 和 多图合成 工作流，适用于快速创意生产、图像优化、营销视觉设计以及专业内容生成等场景。
Agnes-Image-2.0-Flash 已登上 Artificial Analysis Image Editing Leaderboard，取得 ELO 1,184 【动态调整】的成绩，并进入 Top 20 区间，展现出在主流图像模型中较强的图像编辑能力。
模型概述
Agnes-Image-2.0-Flash 针对快速、高质量的图像生成与图像编辑任务进行了优化。
该模型支持以下能力：
能力
说明
Image-to-Image
编辑、转换或增强现有图像
Multi-Image Input
将多张参考图合成为一张新图像
Image Editing
修改构图、风格、对象、场景和视觉细节
Style Control
调整艺术风格、光照、布局和视觉方向
Fast Generation
针对快速、低成本的生产工作流进行优化
OpenAI-Compatible API
使用兼容 OpenAI Images API 的结构
适用场景
Agnes-Image-2.0-Flash 适用于以下场景：
场景
示例用例
创意设计
海报、概念艺术、社交媒体视觉图
营销内容
产品广告、活动创意、Banner
图像编辑
对象替换、背景更换、风格转换
角色合成
将多个角色或参考图组合到同一场景中
视觉生产
为 App、网站、游戏和视频生成素材
电商
产品图优化和场景化生成
社交内容
Meme、头像、缩略图、生活方式视觉图
API 信息
Endpoint
项目
说明
API Endpoint
https://apihub.agnes-ai.com/v1/images/generations
Request Method
POST
Content-Type
application/json
Authentication
Bearer Token
Authentication Header
Authorization: Bearer YOUR_API_KEY
请求参数
参数
类型
是否必填
说明
model
string
是
模型名称，固定为 agnes-image-2.0-flash
prompt
string
是
描述目标图像或编辑需求的文本提示词
size
string
否
输出图像尺寸，例如 1024x768、1024x1024、768x1024
seed
number
否
随机种子，用于保证结果可复现
tags
array
否
任务类型，例如 ["img2img"]
extra_body.image
array
否
图生图或多图工作流中的输入图像 URL
extra_body.response_format
string
否
输出格式，目前支持 url
调用示例
1. 图生图请求
用于编辑或转换现有图像。
curl https://apihub.agnes-ai.com/v1/images/generations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-image-2.0-flash",
    "tags": ["img2img"],
    "prompt": "Transform this image into a cinematic cyberpunk style while preserving the main subject and composition",
    "size": "1024x768",
    "extra_body": {
      "image": [
        "https://example.com/input-image.png"
      ],
      "response_format": "url"
    }
  }'
2. 多图合成请求
用于将多张输入图像组合成一个新场景。
curl https://apihub.agnes-ai.com/v1/images/generations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-image-2.0-flash",
    "tags": ["img2img"],
    "prompt": "Combine the two characters into an intense fantasy battle scene, dynamic lighting, detailed background, cinematic composition",
    "size": "1024x768",
    "extra_body": {
      "image": [
        "https://example.com/character-1.png",
        "https://example.com/character-2.png"
      ],
      "response_format": "url"
    }
  }'
响应格式
{
  "created": 1774432125,
  "data": [
    {
      "url": "https://..."
    }
  ],
  "usage": {
    "generated_images": 1
  }
}
响应字段说明
字段
类型
说明
created
integer
请求时间戳
data
array
生成的图像结果列表
data[].url
string
生成图像的 URL
usage
object
使用量信息
usage.generated_images
integer
生成图像数量
价格
类型
价格
现价
Generated Images
$0.003 / image
$0 / image
功能与兼容性
Agnes-Image-2.0-Flash 支持以下能力：
图生图编辑
多图输入与合成
基于 Prompt 的图像转换
稳定的风格与构图控制
基于 Seed 的结果复现
面向生产工作流的快速生成
兼容 OpenAI Images API 的请求结构
最佳实践
Prompt 编写建议
为了获得更好的生成效果，建议在 Prompt 中提供清晰的视觉指令。
示例：产品图生成
A professional product photo of a wireless headphone on a clean white background, soft studio lighting, sharp details, commercial photography style
示例：图像编辑
对于编辑任务，建议明确描述需要改变的内容，以及需要保持不变的内容。
Change the background to a futuristic city at night while keeping the person’s face, outfit, and pose unchanged
示例：多图合成
对于多图合成任务，建议描述不同输入图像之间的关系。
Place the person from the first image beside the robot from the second image in a cinematic sci-fi battle scene
推荐 Prompt 结构
建议使用以下结构组织 Prompt：
[Main subject] + [Scene / background] + [Style] + [Lighting] + [Composition] + [Quality requirements]
示例
A young explorer standing in an ancient temple, cinematic fantasy style, warm dramatic lighting, wide-angle composition, ultra detailed, high quality
说明
使用 agnes-image-2.0-flash 作为模型名称
对于图生图任务，需要添加 tags: ["img2img"]
对于图生图任务，需要在 extra_body.image 中提供输入图像 URL
对于多图编辑任务，可在 extra_body.image 中提供多个图像 URL