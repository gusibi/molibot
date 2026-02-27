#!/usr/bin/env python3
"""
图片生成脚本 - 使用 ModelScope API 生成图片

用法：
    python generate.py "提示词" --output output.png --api-key "your-api-key"
    
    # 也可以通过环境变量设置 API Key
    export MODELSCOPE_API_KEY="your-api-key"
    python generate.py "提示词" --output output.png
"""

import argparse
import json
import os
import sys
import time

import requests
from PIL import Image
from io import BytesIO


def generate_image(prompt: str, output_path: str, api_key: str, model: str = "Tongyi-MAI/Z-Image-Turbo") -> str:
    """
    生成图片并保存到指定路径
    
    Args:
        prompt: 图片生成提示词
        output_path: 输出图片路径
        api_key: ModelScope API Key
        model: 使用的模型 ID
        
    Returns:
        生成的图片路径
    """
    base_url = "https://api-inference.modelscope.cn/"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    
    # 提交异步生成任务
    print(f"正在提交图片生成任务...")
    print(f"提示词: {prompt[:100]}{'...' if len(prompt) > 100 else ''}")
    
    response = requests.post(
        f"{base_url}v1/images/generations",
        headers={**headers, "X-ModelScope-Async-Mode": "true"},
        data=json.dumps({
            "model": model,
            "prompt": prompt
        }, ensure_ascii=False).encode("utf-8"),
        timeout=30
    )
    response.raise_for_status()
    task_id = response.json()["task_id"]
    print(f"任务已提交，ID: {task_id}")
    
    # 轮询等待结果
    max_attempts = 60  # 最多等待 5 分钟
    attempt = 0
    
    while attempt < max_attempts:
        result = requests.get(
            f"{base_url}v1/tasks/{task_id}",
            headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
            timeout=30
        )
        result.raise_for_status()
        data = result.json()
        
        status = data["task_status"]
        
        if status == "SUCCEED":
            print("图片生成成功，正在下载...")
            image_url = data["output_images"][0]
            image_response = requests.get(image_url, timeout=60)
            image_response.raise_for_status()
            
            image = Image.open(BytesIO(image_response.content))
            
            # 确保输出目录存在
            output_dir = os.path.dirname(output_path)
            if output_dir and not os.path.exists(output_dir):
                os.makedirs(output_dir)
            
            image.save(output_path)
            print(f"图片已保存至: {output_path}")
            return output_path
            
        elif status == "FAILED":
            error_msg = data.get("error", "未知错误")
            print(f"图片生成失败: {error_msg}", file=sys.stderr)
            sys.exit(1)
        
        else:
            attempt += 1
            if attempt % 6 == 0:  # 每 30 秒打印一次进度
                print(f"等待中... 状态: {status}")
            time.sleep(5)
    
    print("图片生成超时", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="使用 ModelScope API 生成图片",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    python generate.py "一只金色的猫" --output cat.png --api-key "ms-xxx"
    python generate.py "科技风格的封面" -o cover.png  # 使用环境变量中的 API Key
        """
    )
    
    parser.add_argument(
        "prompt",
        help="图片生成提示词"
    )
    
    parser.add_argument(
        "-o", "--output",
        required=True,
        help="输出图片路径"
    )
    
    parser.add_argument(
        "-k", "--api-key",
        default=os.environ.get("MODELSCOPE_API_KEY"),
        help="ModelScope API Key（也可通过 MODELSCOPE_API_KEY 环境变量设置）"
    )
    
    parser.add_argument(
        "-m", "--model",
        default="Tongyi-MAI/Z-Image-Turbo",
        help="模型 ID（默认: Tongyi-MAI/Z-Image-Turbo）"
    )
    
    args = parser.parse_args()
    
    if not args.api_key:
        print("错误: 请通过 --api-key 参数或 MODELSCOPE_API_KEY 环境变量提供 API Key", file=sys.stderr)
        sys.exit(1)
    
    generate_image(args.prompt, args.output, args.api_key, args.model)


if __name__ == "__main__":
    main()
