import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { PugClip } from "./agentCityPugAnimation";

export const MOMO_ASSET_URL = "/agent-community/momo.gltf";

export interface MomoAssetTemplate {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export interface MomoAssetInstance {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  currentAction: THREE.AnimationAction | null;
  currentName: string | null;
}

let templatePromise: Promise<MomoAssetTemplate> | null = null;

export function momoAnimationName(clip: PugClip): string {
  if (clip === "pace") return "Walk";
  if (clip === "typing" || clip === "writing") return "Typing";
  if (clip === "thinking") return "Thinking";
  if (clip === "scan") return "Scan";
  if (clip === "reading") return "Reading";
  if (clip === "reviewing") return "Reviewing";
  if (clip === "phone") return "Phone";
  if (clip === "sleep" || clip === "off") return "Sleep";
  if (clip === "cheer") return "Celebrate";
  if (clip === "panic") return "Error";
  if (clip === "greet") return "Wave";
  if (clip === "coffee") return "Coffee";
  return "Idle";
}

export function loadMomoAssetTemplate(): Promise<MomoAssetTemplate> {
  if (templatePromise) return templatePromise;
  const loader = new GLTFLoader();
  templatePromise = loader.loadAsync(MOMO_ASSET_URL).then((gltf) => ({
    scene: gltf.scene,
    clips: gltf.animations
  }));
  return templatePromise;
}

function cloneMaterial(material: THREE.Material): THREE.Material {
  return material.clone();
}

export function createMomoAssetInstance(template: MomoAssetTemplate): MomoAssetInstance {
  const root = cloneSkeleton(template.scene);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneMaterial)
      : cloneMaterial(object.material);
    object.castShadow = true;
    object.receiveShadow = true;
  });

  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of template.clips) {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    actions.set(clip.name, action);
  }
  return { root, mixer, actions, currentAction: null, currentName: null };
}

export function playMomoAnimation(instance: MomoAssetInstance, name: string, fadeSeconds = 0.18): void {
  const next = instance.actions.get(name) ?? instance.actions.get("Idle");
  if (!next || instance.currentAction === next) return;
  next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  const previous = instance.currentAction;
  if (previous) previous.crossFadeTo(next, fadeSeconds, false);
  else next.fadeIn(fadeSeconds);
  instance.currentAction = next;
  instance.currentName = name;
}

export function stopMomoAssetInstance(instance: MomoAssetInstance): void {
  instance.mixer.stopAllAction();
  instance.mixer.uncacheRoot(instance.root);
}
