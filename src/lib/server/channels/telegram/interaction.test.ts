import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTelegramInputKeyboard,
  buildTelegramInteractionKeyboard,
  formatTelegramInteractionView
} from "$lib/server/channels/telegram/interaction.js";
import type { InteractionInputPrompt, InteractionView } from "$lib/server/agent/interactions/types.js";

test("telegram interaction renderer emits only short interaction callback tokens", () => {
  const view: InteractionView = {
    surface: "models",
    title: "Models",
    sections: [{
      rows: [{
        label: "Model B",
        detail: "provider/model-b",
        actions: [{ label: "Select", token: "abc123", style: "primary" }]
      }]
    }],
    actions: [{ label: "Menu", token: "menu123" }]
  };
  const keyboard = buildTelegramInteractionKeyboard(view);
  const callbacks = keyboard.inline_keyboard.flatMap((row) =>
    row.map((button) => "callback_data" in button ? button.callback_data : "")
  );
  assert.deepEqual(callbacks, ["ix:abc123", "ix:menu123"]);
  assert.ok(callbacks.every((value) => value.length < 64));
  assert.match(formatTelegramInteractionView(view), /Model B/);
  assert.doesNotMatch(JSON.stringify(keyboard.inline_keyboard), /provider\/model-b/);
});

test("telegram input prompt exposes cancel token without serializing task state", () => {
  const input: InteractionInputPrompt = {
    requestId: "request-secret-server-side",
    kind: "run.steer",
    title: "Adjust current task",
    body: "Reply to this prompt.",
    cancelToken: "cancel123",
    expiresAt: Date.now() + 1000
  };
  const keyboard = buildTelegramInputKeyboard(input);
  assert.equal(keyboard.inline_keyboard[0]?.[0] && "callback_data" in keyboard.inline_keyboard[0][0]
    ? keyboard.inline_keyboard[0][0].callback_data
    : "", "ix:cancel123");
  assert.doesNotMatch(JSON.stringify(keyboard.inline_keyboard), /request-secret-server-side/);
});
