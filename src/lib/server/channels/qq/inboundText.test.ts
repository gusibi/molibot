import test from "node:test";
import assert from "node:assert/strict";
import { buildInboundText } from "./inboundText.js";

test("buildInboundText prefers the user's own text over everything else", () => {
  assert.equal(
    buildInboundText("  你好  ", [{ content_type: "voice", url: "https://x", asr_refer_text: "转写文本" }]),
    "你好"
  );
});

test("buildInboundText falls back to platform ASR transcription for voice messages", () => {
  assert.equal(
    buildInboundText("", [
      { content_type: "voice", url: "https://x", voice_wav_url: "https://x/wav", asr_refer_text: " 明天提醒我开会 " },
    ]),
    "明天提醒我开会"
  );
  assert.equal(
    buildInboundText(undefined, [
      { content_type: "voice", url: "https://x", asr_refer_text: "第一段" },
      { content_type: "voice", url: "https://y", asr_refer_text: "第二段" },
    ]),
    "第一段\n第二段"
  );
});

test("buildInboundText keeps placeholder fallbacks when no text and no transcription", () => {
  assert.equal(
    buildInboundText("", [{ content_type: "audio/ogg", url: "https://x" }]),
    "(voice message)"
  );
  assert.equal(
    buildInboundText("", [{ content_type: "image/png", url: "https://x" }]),
    "(image attachment)"
  );
  assert.equal(buildInboundText("", []), "");
});
