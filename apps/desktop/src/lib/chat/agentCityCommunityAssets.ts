import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

export const COMMUNITY_KIT_URL = "/agent-community/community-kit.gltf";

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
  templatePromise = loader.loadAsync(COMMUNITY_KIT_URL).then((gltf) => ({ scene: gltf.scene }));
  return templatePromise;
}

function cloneMaterial(material: THREE.Material): THREE.Material {
  return material.clone();
}

export function cloneCommunityComponent(
  template: CommunityKitTemplate,
  name: CommunityKitComponent,
  dark: boolean,
  accent: number
): THREE.Object3D | null {
  const source = template.scene.getObjectByName(name);
  if (!source) return null;
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
        material.color.setHex(dark ? 0x2d3940 : 0xe9edf0);
      } else if (materialName.includes("trimneutral")) {
        material.color.setHex(dark ? 0x44545d : 0xc8d1d5);
      } else if (materialName.includes("glass")) {
        material.color.setHex(dark ? 0x527a92 : 0x9ec7da);
        material.emissive.setHex(accent);
        material.emissiveIntensity = dark ? 0.12 : 0.03;
      } else if (materialName.includes("accent")) {
        material.color.setHex(accent);
        material.emissive.setHex(accent);
        material.emissiveIntensity = 0.18;
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
