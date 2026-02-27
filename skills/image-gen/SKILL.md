---
name: image-gen
description: 使用 ModelScope API 生成图片。支持自定义提示词、输出路径和模型选择。触发词："生成图片"、"画一张图"、"创建图片"。
---

# 图片生成器

使用 ModelScope API 根据文本提示生成图片。

## 使用方式

```bash
# 基本用法
/image-gen "一只在星空下睡觉的猫" --output cat.png

# 使用环境变量中的 API Key
export MODELSCOPE_API_KEY="your-api-key"
/image-gen "科技风格的抽象背景" -o background.png

# 指定模型
/image-gen "水彩风格的风景画" -o landscape.png --model "Tongyi-MAI/Z-Image-Turbo"
```

## 选项

| 选项 | 简写 | 说明 |
|------|------|------|
| `--output` | `-o` | 输出图片路径（必需） |
| `--api-key` | `-k` | ModelScope API Key |
| `--model` | `-m` | 模型 ID（默认: Tongyi-MAI/Z-Image-Turbo） |

## API Key 配置

二选一：
1. 环境变量：`export MODELSCOPE_API_KEY="your-api-key"`
2. 命令行参数：`--api-key "your-api-key"`

## 示例

```bash
# 生成封面图
/image-gen "极简科技风格封面，深蓝色背景，几何线条，无文字" -o cover.png

# 生成插图
/image-gen "手绘风格，一杯咖啡和一本书，温暖色调" -o illustration.png

# 生成头像
/image-gen "卡通风格，一只戴眼镜的猫头鹰，简约设计" -o avatar.png
```

## 脚本位置

生成脚本位于：`{baseDir}/generate.py`

## 注意事项

- 图片生成通常需要 10-30 秒
- 支持常见图片格式：png、jpg、webp
- 提示词越详细，生成效果越好
