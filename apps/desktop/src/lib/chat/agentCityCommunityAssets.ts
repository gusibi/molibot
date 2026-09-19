import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { agentCityRecipeProfile, type AgentCityVisualTheme } from "./agentCityTheme";

export const COMMUNITY_KIT_URL = "/agent-community/community-kit.glb";
export const COMMUNITY_KIT_FALLBACK_URL = "/agent-community/community-kit.gltf";

export type CommunityKitComponent =
  | "StudioArchitecture"
  | "HQArchitecture"
  | "StudioDecor"
  | "HQDecor"
  | "CommunityHub";

export interface CommunityKitTemplate {
  scene: THREE.Object3D;
}

let templatePromise: Promise<CommunityKitTemplate> | null = null;

export function loadCommunityKit(): Promise<CommunityKitTemplate> {
  if (templatePromise) return templatePromise;
  const loader = new GLTFLoader();
  templatePromise = loader.loadAsync(COMMUNITY_KIT_URL)
    .catch(() => loader.loadAsync(COMMUNITY_KIT_FALLBACK_URL))
    .then((gltf) => ({ scene: gltf.scene }));
  return templatePromise;
}

function cloneMaterial(material: THREE.Material): THREE.Material {
  return material.clone();
}

function cssColorHex(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const color = new THREE.Color();
  try {
    color.setStyle(value.trim());
    return color.getHex();
  } catch {
    return fallback;
  }
}

function mixHex(left: number, right: number, amount: number): number {
  return new THREE.Color(left).lerp(new THREE.Color(right), Math.min(1, Math.max(0, amount))).getHex();
}

export function cloneCommunityComponent(
  template: CommunityKitTemplate,
  name: CommunityKitComponent,
  dark: boolean,
  accent: number,
  visualTheme?: AgentCityVisualTheme
): THREE.Object3D | null {
  const source = template.scene.getObjectByName(name);
  if (!source) return null;
  const profile = visualTheme ? agentCityRecipeProfile(visualTheme.recipe) : null;
  const wall = visualTheme
    ? mixHex(
        cssColorHex(visualTheme.card, dark ? 0x2d3940 : 0xe9edf0),
        accent,
        (profile?.roomAccentMix ?? 0.14) * (dark ? 0.55 : 0.42)
      )
    : dark ? 0x2d3940 : 0xe9edf0;
  const trim = visualTheme
    ? mixHex(
        cssColorHex(visualTheme.panel, dark ? 0x44545d : 0xc8d1d5),
        accent,
        (profile?.roomAccentMix ?? 0.14) * 0.72
      )
    : dark ? 0x44545d : 0xc8d1d5;
  const glass = visualTheme
    ? mixHex(cssColorHex(visualTheme.miniappAccent, dark ? 0x527a92 : 0x9ec7da), accent, 0.28)
    : dark ? 0x527a92 : 0x9ec7da;
  const root = cloneSkeleton(source);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneMaterial)
      : cloneMaterial(object.material);
    object.castShadow = true;
    object.receiveShadow = true;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const materialName = material.name.toLowerCase();
      if (materialName.includes("wallneutral")) {
        material.color.setHex(wall);
        if (profile) {
          material.roughness = profile.roughness;
          material.metalness = profile.metalness;
        }
      } else if (materialName.includes("trimneutral")) {
        material.color.setHex(trim);
        if (profile) {
          material.roughness = Math.max(0.42, profile.roughness - 0.08);
          material.metalness = profile.metalness;
        }
      } else if (materialName.includes("glass")) {
        material.color.setHex(glass);
        material.emissive.setHex(accent);
        material.emissiveIntensity = (dark ? 0.1 : 0.025) * (profile?.emissiveScale ?? 1);
      } else if (materialName.includes("accent")) {
        material.color.setHex(accent);
        material.emissive.setHex(accent);
        material.emissiveIntensity = 0.16 * (profile?.emissiveScale ?? 1);
      }
    }
  });
  return root;
}

export function disposeCommunityComponent(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}
