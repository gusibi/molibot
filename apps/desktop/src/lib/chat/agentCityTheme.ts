export type AgentCityThemeRecipe =
  | "native"
  | "material"
  | "messenger"
  | "retro"
  | "editorial"
  | "technical"
  | "product"
  | "expressive"
  | "imported";

export interface AgentCityVisualTheme {
  family: string;
  recipe: AgentCityThemeRecipe;
  accent: string;
  surface: string;
  panel: string;
  card: string;
  separator: string;
  online: string;
  danger: string;
  warning: string;
  skillAccent: string;
  miniappAccent: string;
}

export interface AgentCityRecipeProfile {
  roomAccentMix: number;
  sceneryAccentMix: number;
  emissiveScale: number;
  roughness: number;
  metalness: number;
  edgeStrength: number;
}

const DEFAULT_PROFILE: AgentCityRecipeProfile = {
  roomAccentMix: 0.14,
  sceneryAccentMix: 0.1,
  emissiveScale: 0.85,
  roughness: 0.78,
  metalness: 0.04,
  edgeStrength: 0.7
};

export function agentCityRecipeProfile(recipe: AgentCityThemeRecipe): AgentCityRecipeProfile {
  if (recipe === "material") return { roomAccentMix: 0.2, sceneryAccentMix: 0.14, emissiveScale: 0.85, roughness: 0.72, metalness: 0.05, edgeStrength: 0.72 };
  if (recipe === "messenger") return { roomAccentMix: 0.18, sceneryAccentMix: 0.12, emissiveScale: 0.9, roughness: 0.76, metalness: 0.04, edgeStrength: 0.76 };
  if (recipe === "retro") return { roomAccentMix: 0.08, sceneryAccentMix: 0.05, emissiveScale: 0.42, roughness: 0.96, metalness: 0, edgeStrength: 1 };
  if (recipe === "editorial") return { roomAccentMix: 0.07, sceneryAccentMix: 0.05, emissiveScale: 0.5, roughness: 0.92, metalness: 0, edgeStrength: 0.9 };
  if (recipe === "technical") return { roomAccentMix: 0.26, sceneryAccentMix: 0.18, emissiveScale: 1.18, roughness: 0.56, metalness: 0.11, edgeStrength: 0.95 };
  if (recipe === "product") return { roomAccentMix: 0.13, sceneryAccentMix: 0.08, emissiveScale: 0.7, roughness: 0.8, metalness: 0.05, edgeStrength: 0.68 };
  if (recipe === "expressive") return { roomAccentMix: 0.3, sceneryAccentMix: 0.2, emissiveScale: 0.96, roughness: 0.7, metalness: 0.03, edgeStrength: 0.82 };
  if (recipe === "imported") return { roomAccentMix: 0.16, sceneryAccentMix: 0.11, emissiveScale: 0.82, roughness: 0.78, metalness: 0.04, edgeStrength: 0.7 };
  return DEFAULT_PROFILE;
}

export function agentCityVisualThemeSignature(theme: AgentCityVisualTheme): string {
  return [
    theme.family,
    theme.recipe,
    theme.accent,
    theme.surface,
    theme.panel,
    theme.card,
    theme.separator,
    theme.online,
    theme.danger,
    theme.warning,
    theme.skillAccent,
    theme.miniappAccent
  ].join("|");
}
