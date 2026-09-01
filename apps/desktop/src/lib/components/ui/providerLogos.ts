/**
 * Full-color SVG brand logos for AI providers and LLM gateways.
 * Returns raw inline SVG strings with brand colors, or null if no matching logo is found.
 */

export const PROVIDER_LOGOS: Record<string, string> = {
  // OpenAI (Emerald Green)
  openai: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#10a37f"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.607 1.5-2.602-1.5z"/></svg>`,

  // Anthropic / Claude (Warm Terracotta / Coral)
  anthropic: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#D97706"><path fill="#CC6B49" d="M13.827 2.502h3.425L24 21.498h-3.483l-1.924-4.992H9.378l-1.924 4.992H3.972L10.72 2.502h3.107zm2.343 11.455l-2.483-6.446-2.484 6.446h4.967z"/><path fill="#D97706" d="M0 21.498L6.748 2.502h3.483L3.483 21.498H0z"/></svg>`,

  // DeepSeek (Vibrant Electric Blue)
  deepseek: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#4D6BFE"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 16.93c-3.96-.49-7-3.86-7-7.93 0-.62.08-1.22.21-1.8l3.65 3.65c.18.18.43.29.7.29h2.44v3.79c0 .55.45 1 1 1v1zm4.9-3.23c-.27-.68-.87-1.19-1.61-1.39l-1.29-.35v-2.96c0-.55-.45-1-1-1h-2v-2h2c.55 0 1-.45 1-1V5.5c2.95 1.15 5 4.02 5 7.38 0 1.25-.29 2.43-.8 3.48z"/></svg>`,

  // Google (Official 4-color)
  google: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>`,

  // Gemini (Gradient Blue / Purple)
  gemini: `<svg viewBox="0 0 24 24" width="100%" height="100%"><defs><linearGradient id="gemini-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1B72E8"/><stop offset="50%" stop-color="#7C3AED"/><stop offset="100%" stop-color="#DB2777"/></linearGradient></defs><path fill="url(#gemini-grad)" d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z"/></svg>`,

  // Groq (Bright Orange)
  groq: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#F55036"><path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8.01 8.01 0 0 1-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>`,

  // Mistral AI (Flame Red / Orange)
  mistral: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#FA520F" d="M3 3h4v4H3V3zm14 0h4v4h-4V3zM3 8.667h9.333v4H3v-4zm11.667 0H21v4h-6.333v-4zM3 14.333h18v4H3v-4zM3 20h6.667v4H3v-4zm11.333 0H21v4h-6.667v-4z"/></svg>`,

  // Moonshot / Kimi (Cosmic Blue / Teal Gradient)
  moonshot: `<svg viewBox="0 0 24 24" width="100%" height="100%"><defs><linearGradient id="moonshot-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0284C7"/><stop offset="100%" stop-color="#0D9488"/></linearGradient></defs><path fill="url(#moonshot-grad)" d="M12.3 2a10 10 0 0 0-1.9.18 9.9 9.9 0 0 0-7.85 7.86 10.15 10.15 0 0 0 2.21 8.44 10 10 0 0 0 7.84 3.52 10.07 10.07 0 0 0 9.77-7.79 9.93 9.93 0 0 0-1.46-7.83A9.9 9.9 0 0 0 12.3 2zm-1.07 4.25a6.05 6.05 0 0 1 6.05 6.05 6.05 6.05 0 0 1-6.05 6.05 6.05 6.05 0 0 1-6.05-6.05 6.05 6.05 0 0 1 6.05-6.05z"/></svg>`,

  // MiniMax (Indigo / Violet)
  minimax: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#6366F1"><path d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6zm3 1a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0v-4.586l3.293 3.293a1 1 0 0 0 1.414 0L15 11.414V16a1 1 0 0 0 2 0V8a1 1 0 0 0-1.707-.707L12 10.586 8.707 7.293A1 1 0 0 0 6 7z"/></svg>`,

  // Qwen / Alibaba Cloud (Alibaba Orange)
  qwen: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#FF6A00"><path d="M12 2L2 7.5v9L12 22l10-5.5v-9L12 2zm0 2.8l7.5 4.1v6.2L12 19.2 4.5 15.1V8.9L12 4.8zm0 3.2L6.5 11v3.8l5.5 3 5.5-3V11L12 8z"/></svg>`,

  // Z.AI / Zhipu GLM (Royal Blue)
  zai: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#2563EB"><path d="M4 4h16v3.5L9.5 16.5H20V20H4v-3.5L14.5 7.5H4V4z"/></svg>`,

  // xAI / Grok (Charcoal / Dark Theme Accent)
  xai: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#1E293B"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,

  // OpenRouter (Deep Sky Blue)
  openrouter: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#0284C7"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 3.5a6.5 6.5 0 0 1 5.8 3.55l-2.45 1.41a3.7 3.7 0 0 0-6.7 0L6.2 9.05A6.5 6.5 0 0 1 12 5.5zm0 13a6.5 6.5 0 0 1-5.8-3.55l2.45-1.41a3.7 3.7 0 0 0 6.7 0l2.45 1.41A6.5 6.5 0 0 1 12 18.5z"/></svg>`,

  // Together AI (Blue Gradient)
  together: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#0EA5E9"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-4H6v-2h3V8h2v3h3v2h-3v4zm6-2h-2V9h2v6z"/></svg>`,

  // Fireworks AI (Warm Flame Gradient)
  fireworks: `<svg viewBox="0 0 24 24" width="100%" height="100%"><defs><linearGradient id="fireworks-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#EF4444"/></linearGradient></defs><path fill="url(#fireworks-grad)" d="M12 2l2.4 6.6L21 11l-5.6 3.4L17 21l-5-4.2-5 4.2 1.6-6.6L3 11l6.6-2.4L12 2z"/></svg>`,

  // Cloudflare (Cloudflare Orange)
  cloudflare: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#F38020"><path d="M18.23 8.01a6.5 6.5 0 0 0-12.06 1.83A4.5 4.5 0 0 0 6.5 18.5h11.75a3.75 3.75 0 0 0 0-7.5c-.08 0-.16 0-.25.01a6.47 6.47 0 0 0 .23-3z"/></svg>`,

  // GitHub Copilot / GitHub (Purple / Blue Accent)
  github: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#6E40C9"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>`,

  // Hugging Face (Yellow / Gold Brand)
  huggingface: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#FFD21E"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm-3 8a1.5 1.5 0 1 1-1.5-1.5A1.5 1.5 0 0 1 9 10zm6 0a1.5 1.5 0 1 1-1.5-1.5A1.5 1.5 0 0 1 15 10zm-3 7c-2.33 0-4.31-1.46-5.11-3.5h10.22c-.8 2.04-2.78 3.5-5.11 3.5z"/></svg>`,

  // NVIDIA (Green)
  nvidia: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#76B900"><path d="M8.9 14.5c.3.5.7 1 1.2 1.4 1.2.9 2.7 1.2 4.1.8 1.4-.4 2.5-1.4 3-2.7.4-1.2.3-2.5-.3-3.6-.8-1.5-2.3-2.4-4-2.4H8.8v6.5zm-3.5 0V5.7h7.6c2.5 0 4.8 1.2 6.1 3.3 1 1.6 1.2 3.5.6 5.3-.8 2.1-2.5 3.7-4.6 4.3-1 .3-2 .3-3 .1-1.2-.2-2.3-.8-3.2-1.6L6.8 19l-1.4-1.4 3-3.1z"/></svg>`,

  // Ollama (Slate Blue / Dark Neutral)
  ollama: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#475569"><path d="M12 2C7.58 2 4 5.58 4 10c0 2.03.76 3.87 2 5.28V20a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4.72c1.24-1.41 2-3.25 2-5.28 0-4.42-3.58-8-8-8zm-3 9a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm6 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"/></svg>`,

  // AWS / Amazon Bedrock (AWS Squid Ink / Amber)
  bedrock: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#FF9900"><path d="M17.7 15.3c-.6.6-1.5 1-2.4 1-1.3 0-2.4-.8-2.8-2h-2c.5 2.3 2.5 4 4.8 4 1.6 0 3-.6 4-1.7l-1.6-1.3zM21 9V7H3v2h7v8H8v2h8v-2h-2V9h7z"/></svg>`,

  // Microsoft / Azure (Azure Blue)
  azure: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#0089D6"><path d="M13.05 4.24l-5.69 10.1 5.36 5.42H22L13.05 4.24zM2 18.25l3.8-6.75 3.32 3.33-4.14 3.42H2z"/></svg>`,

  // Cerebras (Cherry Red)
  cerebras: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#E11D48"><path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 3.3l5.5 3.4v6.6L12 18.7l-5.5-3.4V8.7L12 5.3z"/></svg>`,

  // Xiaomi / MiLM (Mi Orange)
  xiaomi: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#FF6700"><path d="M3 4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H3zm3.5 4h3v8h-3V8zm5 0h3v4.5l1.5-1.5h2.5L16 13.5l3 2.5h-2.5l-2-1.5v1.5h-3V8z"/></svg>`,

  // SiliconFlow / 硅基流动 (Cyan / Tech Blue)
  siliconflow: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#06B6D4"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V13h3.93A8.01 8.01 0 0 1 13 16.93zM11 7.07V11H7.07A8.01 8.01 0 0 1 11 7.07zM7.07 13H11v3.93A8.01 8.01 0 0 1 7.07 13zm9.86-2H13V7.07A8.01 8.01 0 0 1 16.93 11z"/></svg>`,

  // Vercel (Pure Dark / Triangle)
  vercel: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#000000"><path d="M12 1L24 22H0L12 1z"/></svg>`,

  // Perplexity (Teal)
  perplexity: `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#20B2AA"><path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 2.3l6 3.75v3.45L12 7.75l-6 3.75V8.05l6-3.75zM6 13.45l6-3.75 6 3.75v2.5L12 19.7 6 15.95v-2.5z"/></svg>`
};

/**
 * Normalizes provider id/name to pick an appropriate brand logo.
 */
export function getProviderLogoKey(id: string, name?: string): string | null {
  const combined = `${id || ""} ${name || ""}`.toLowerCase();

  if (/openai|chatgpt|gpt|codex/.test(combined)) return "openai";
  if (/anthropic|claude/.test(combined)) return "anthropic";
  if (/deepseek/.test(combined)) return "deepseek";
  if (/gemini/.test(combined)) return "gemini";
  if (/google|vertex/.test(combined)) return "google";
  if (/groq/.test(combined)) return "groq";
  if (/mistral|codestral|pixtral/.test(combined)) return "mistral";
  if (/moonshot|kimi/.test(combined)) return "moonshot";
  if (/minimax|abab/.test(combined)) return "minimax";
  if (/qwen|aliyun|alibaba|dashscope|tongyi/.test(combined)) return "qwen";
  if (/zai|zhipu|chatglm|glm/.test(combined)) return "zai";
  if (/xai|grok/.test(combined)) return "xai";
  if (/openrouter/.test(combined)) return "openrouter";
  if (/together/.test(combined)) return "together";
  if (/fireworks/.test(combined)) return "fireworks";
  if (/cloudflare/.test(combined)) return "cloudflare";
  if (/copilot|github/.test(combined)) return "github";
  if (/huggingface|hf/.test(combined)) return "huggingface";
  if (/nvidia/.test(combined)) return "nvidia";
  if (/ollama/.test(combined)) return "ollama";
  if (/bedrock|amazon|aws/.test(combined)) return "bedrock";
  if (/azure/.test(combined)) return "azure";
  if (/cerebras/.test(combined)) return "cerebras";
  if (/xiaomi|milm/.test(combined)) return "xiaomi";
  if (/silicon|siliconflow|guiji/.test(combined)) return "siliconflow";
  if (/vercel/.test(combined)) return "vercel";
  if (/perplexity|pplx/.test(combined)) return "perplexity";

  return null;
}

export function getProviderLogoSvg(id: string, name?: string): string | null {
  const key = getProviderLogoKey(id, name);
  return key && PROVIDER_LOGOS[key] ? PROVIDER_LOGOS[key] : null;
}
