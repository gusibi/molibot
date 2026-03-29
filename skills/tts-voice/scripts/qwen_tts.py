import sys
import os

try:
    from qwen_tts import QwenTTS
except ImportError:
    print("qwen_tts not found", file=sys.stderr)
    sys.exit(1)

def main():
    if len(sys.argv) < 3:
        print("Usage: python qwen_tts.py <text> <output_wav>")
        sys.exit(1)
        
    text = sys.argv[1]
    output_path = sys.argv[2]
    
    device = "mps" # Apple Silicon 优化
    
    try:
        # 初始化 Qwen3-TTS
        tts = QwenTTS(model_name="Qwen/Qwen3-TTS-12Hz-0.6B-VoiceDesign", device=device)
        
        # 语音合成
        tts.synthesize(
            text=text,
            language="zh",
            speaker="female",
            speed=1.0,
            output_path=output_path
        )
    except Exception as e:
        print(f"Error synthesizing: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
