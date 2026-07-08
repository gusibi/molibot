import assert from "node:assert/strict";
import test from "node:test";
import {
  NEW_CONVERSATION_KEY,
  SessionDraftStore,
  emptyDraft,
  sessionDraftKey
} from "./sessionDraftStore.js";

test("sessionDraftKey and NEW_CONVERSATION_KEY", () => {
  assert.equal(sessionDraftKey("personal", "s-1"), "personal:s-1");
  assert.equal(NEW_CONVERSATION_KEY, "__new_conversation__");
});

test("emptyDraft defaults to medium thinking", () => {
  assert.deepEqual(emptyDraft(), { text: "", files: [], thinkingLevel: "medium" });
  assert.equal(emptyDraft("low").thinkingLevel, "low");
});

test("get creates an empty draft on first access and reuses it after", () => {
  const store = new SessionDraftStore();
  const draft = store.get(sessionDraftKey("personal", "s-1"));
  assert.equal(draft.text, "");
  assert.equal(draft.thinkingLevel, "medium");

  store.setText(sessionDraftKey("personal", "s-1"), "hello");
  const again = store.get(sessionDraftKey("personal", "s-1"));
  assert.equal(again.text, "hello");
});

test("setters update text, files, thinking and the new-conversation bot", () => {
  const store = new SessionDraftStore();
  const file = new File(["x"], "note.txt", { type: "text/plain" });
  store.setText(NEW_CONVERSATION_KEY, "draft");
  store.setFiles(NEW_CONVERSATION_KEY, [file]);
  store.setThinking(NEW_CONVERSATION_KEY, "high");
  store.setProfileId(NEW_CONVERSATION_KEY, "work");

  const draft = store.get(NEW_CONVERSATION_KEY);
  assert.equal(draft.text, "draft");
  assert.equal(draft.files.length, 1);
  assert.equal(draft.thinkingLevel, "high");
  assert.equal(draft.profileId, "work");
});

test("clear removes a draft so the next get starts empty (composer cleared after send)", () => {
  const store = new SessionDraftStore();
  const key = sessionDraftKey("personal", "s-1");
  store.setText(key, "unsent");
  store.clear(key);
  assert.equal(store.has(key), false);
  assert.equal(store.get(key).text, "");
});

test("drafts are isolated per session (switching away and back restores input)", () => {
  const store = new SessionDraftStore();
  store.setText(sessionDraftKey("personal", "s-1"), "A");
  store.setText(sessionDraftKey("work", "s-2"), "B");
  assert.equal(store.get(sessionDraftKey("personal", "s-1")).text, "A");
  assert.equal(store.get(sessionDraftKey("work", "s-2")).text, "B");
});
