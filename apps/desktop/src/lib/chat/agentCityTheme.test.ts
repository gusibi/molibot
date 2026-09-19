import assert from "node:assert/strict";
import test from "node:test";
import { agentCityRecipeProfile, agentCityVisualThemeSignature, type AgentCityVisualTheme } from "./agentCityTheme";

test("Agent City recipes make technical/expressive themes visibly stronger than retro/editorial themes", () => {
  assert.ok(agentCityRecipeProfile("technical").emissiveScale > agentCityRecipeProfile("retro").emissiveScale);
  assert.ok(agentCityRecipeProfile("expressive").roomAccentMix > agentCityRecipeProfile("editorial").roomAccentMix);
  assert.ok(agentCityRecipeProfile("retro").roughness > agentCityRecipeProfile("native").roughness);
  assert.equal(agentCityRecipeProfile("retro").metalness, 0);
});

test("Agent City visual signature changes when family tokens change", () => {
  const base: AgentCityVisualTheme = {
    family: "macos",
    recipe: "native",
    accent: "#006bff",
    surface: "#f5f5f7",
    panel: "#ffffff",
    card: "#ffffff",
    separator: "#d1d1d6",
    online: "#28a948",
    danger: "#ea001d",
    warning: "#c26a00",
    skillAccent: "#8b5cf6",
    miniappAccent: "#0d9488"
  };
  assert.notEqual(
    agentCityVisualThemeSignature(base),
    agentCityVisualThemeSignature({ ...base, family: "cyberpunk", recipe: "technical", accent: "#00f0ff" })
  );
});
