import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  agentCityFloors,
  selectFollowFloorKey,
  type AgentCityFloor,
  type AgentCityProjection,
  type AgentCityStatus
} from "./agentCityProjection";
import {
  AGENT_CITY_DETAIL_DISTANCE,
  AGENT_CITY_FLOOR_HEIGHT,
  AGENT_CITY_MAX_DISTANCE,
  AGENT_CITY_MIN_DISTANCE,
  agentCityBounds,
  cameraTweenEase,
  clampCameraTarget,
  floorFocusFraming,
  overviewFraming,
  zoomedDistance
} from "./agentCityCamera";
import {
  ONE_SHOT_CLIP_DURATION_MS,
  clipDurationForStatus,
  clipsForStatus,
  pugPose,
  pugSeed,
  scheduledClip,
  transitionClip,
  type PugClip,
  type PugPose,
  type PugProp
} from "./agentCityPugAnimation";
import {
  createMomoAssetInstance,
  loadMomoAssetTemplate,
  momoAnimationName,
  playMomoAnimation,
  stopMomoAssetInstance,
  type MomoAssetInstance,
  type MomoAssetTemplate
} from "./agentCityMomoAsset";
import {
  cloneCommunityComponent,
  disposeCommunityComponent,
  loadCommunityKit,
  type CommunityKitTemplate
} from "./agentCityCommunityAssets";
import {
  agentCityRecipeProfile,
  agentCityVisualThemeSignature,
  type AgentCityVisualTheme
} from "./agentCityTheme";

export type AgentCityQuality = "full" | "low" | "fallback";
export type AgentCityTheme = "light" | "dark";

export interface AgentCityCapabilities {
  webgl2: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  devicePixelRatio: number;
}

export interface AgentCityHover {
  key: string;
  x: number;
  y: number;
}

export interface AgentCityViewState {
  distance: number;
  focusedKey: string | null;
  adjusted: boolean;
  following: boolean;
  followKey: string | null;
}

export interface AgentCitySatelliteHudCoord {
  id: string;
  role: string;
  status: "working" | "completed" | "error";
  x: number;
  y: number;
  visible: boolean;
}

export interface AgentCityHudCoords {
  anchors: Record<string, { x: number; y: number; visible: boolean; depth?: number }>;
  satellites: Record<string, AgentCitySatelliteHudCoord[]>;
  owner: { x: number; y: number; visible: boolean };
}

export interface AgentCitySceneOptions {
  canvas: HTMLCanvasElement;
  projection: AgentCityProjection;
  theme: AgentCityTheme;
  /**
   * Sky/fog colour, read from the family's `--agent-city-sky` token. The shell
   * around the canvas paints the same token, so the two cannot drift and leave
   * a seam at the panel edge.
   */
  sky: string;
  visualTheme: AgentCityVisualTheme;
  reducedMotion: boolean;
  quality: Exclude<AgentCityQuality, "fallback">;
  onPerformanceFallback: () => void;
  onContextLost: () => void;
  onViewChange?: (view: AgentCityViewState) => void;
  onHudUpdate?: (coords: AgentCityHudCoords) => void;
}

export interface AgentCitySceneController {
  update(projection: AgentCityProjection): void;
  resize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  setTheme(theme: AgentCityTheme): void;
  setSky(sky: string): void;
  setVisualTheme(theme: AgentCityVisualTheme): void;
  setReducedMotion(reducedMotion: boolean): void;
  setQuality(quality: Exclude<AgentCityQuality, "fallback">): void;
  hitTest(clientX: number, clientY: number): AgentCityHover | null;
  /** Plays the greeting animation on the clicked pug; returns the floor key. */
  greetAt(clientX: number, clientY: number): AgentCityHover | null;
  focusFloor(key: string): boolean;
  /** Auto-frames whichever agent is working; re-frames only when that changes. */
  setFollowWorking(enabled: boolean): void;
  clearFocus(): void;
  setSelectedFloor(key: string | null): void;
  zoom(direction: "in" | "out"): void;
  resetView(): void;
  dispose(): void;
}

interface PugRig {
  root: THREE.Group;
  pose: THREE.Group;
  head: THREE.Group;
  pawLeft: THREE.Group;
  pawRight: THREE.Group;
  earLeft: THREE.Mesh;
  earRight: THREE.Mesh;
  tailPivot: THREE.Group;
  propAnchor: THREE.Group;
  roleAccessory: THREE.Group;
  headAccessory: THREE.Group;
  propObjects: Record<Exclude<PugProp, "none">, THREE.Object3D>;
  bookPage: THREE.Group;
  screenMaterials: THREE.MeshStandardMaterial[];
  coatMaterials: THREE.MeshStandardMaterial[];
  seed: number;
  role: string | null;
  baseScale: number;
  homePosition: THREE.Vector3;
  homeYaw: number;
  spawnEpochMs: number | null;
  portalPosition: THREE.Vector3 | null;
  workerExitStartedAt: number | null;
  travelOffset: THREE.Vector3;
  ambientTarget: THREE.Vector3 | null;
  isWorker: boolean;
  assetEligible: boolean;
  asset: MomoAssetInstance | null;
  status: AgentCityStatus;
  currentProp: PugProp;
  oneShot: { clip: PugClip; startedAt: number } | null;
  faceCamera: number;
}

interface AnimatedRoute {
  group: THREE.Group;
  capsule: THREE.Mesh;
  tubeMaterial: THREE.MeshStandardMaterial;
  capsuleMaterial: THREE.MeshStandardMaterial;
  curve: THREE.CatmullRomCurve3;
  phase: "outbound" | "returning" | "failed";
  offset: number;
}

interface AnimatedFloorPerimeter {
  group: THREE.Group;
  material: THREE.LineBasicMaterial;
  marquee: THREE.LineDashedMaterial;
  distances: THREE.BufferAttribute;
  baseDistances: Float32Array;
  emissive: THREE.MeshStandardMaterial;
  phase: number;
  length: number;
}

interface WorkerPacket {
  mesh: THREE.Mesh;
  angle: number;
  innerRadius: number;
  outerRadius: number;
  seed: number;
}

interface FloorNode {
  key: string;
  group: THREE.Group;
  signature: string;
  status: AgentCityStatus | null;
  pugs: PugRig[];
  mainPug: PugRig;
  statusMaterial: THREE.MeshStandardMaterial;
  deskScreen: THREE.MeshStandardMaterial;
  deskAccent: number;
  perimeter: AnimatedFloorPerimeter | null;
  beacon: THREE.Object3D | null;
  overflowStudio: THREE.Object3D | null;
  route: AnimatedRoute | null;
  anchor: THREE.Object3D;
  target: THREE.Mesh;
  seatPosition: THREE.Vector3;
  loungePosition: THREE.Vector3;
  windowMaterial: THREE.MeshStandardMaterial;
  roomMaterials: THREE.MeshStandardMaterial[];
  activityMaterials: THREE.MeshStandardMaterial[];
  workerScreens: THREE.MeshStandardMaterial[];
  workerPackets: WorkerPacket[];
  workerAnchors: { id: string; role: string; anchor: THREE.Object3D }[];
  holoBeam: THREE.Mesh;
  holoBeamMaterial: THREE.MeshStandardMaterial;
  holoCore: THREE.Mesh;
  holoRings: THREE.Mesh[];
  celebration: THREE.Group | null;
  proceduralShell: THREE.Group;
  proceduralDecor: THREE.Group;
  assetVisual: THREE.Group;
  assetWindowMaterials: THREE.MeshStandardMaterial[];
  selection: THREE.LineSegments;
  selectionMaterial: THREE.LineBasicMaterial;
  windowBase: number;
  windowFlicker: number;
  glowPhase: number;
}

function moveMarquee(perimeter: AnimatedFloorPerimeter, offset: number): void {
  const distances = perimeter.distances.array as Float32Array;
  for (let index = 0; index < distances.length; index += 1) {
    distances[index] = perimeter.baseDistances[index] + offset;
  }
  perimeter.distances.needsUpdate = true;
}

const FLOOR_HEIGHT = AGENT_CITY_FLOOR_HEIGHT;
const STATUS_COLORS: Record<AgentCityStatus, number> = {
  disabled: 0x8f8f8f,
  idle: 0x7d7d7d,
  working: 0x006bff,
  completed: 0x28a948,
  error: 0xea001d
};

function cssColorHex(value: string, fallback: number): number {
  if (!value.trim()) return fallback;
  const parsed = new THREE.Color();
  try {
    parsed.setStyle(value.trim());
    return parsed.getHex();
  } catch {
    return fallback;
  }
}

function mixHex(left: number, right: number, amount: number): number {
  const color = new THREE.Color(left);
  color.lerp(new THREE.Color(right), Math.min(1, Math.max(0, amount)));
  return color.getHex();
}

function themedStatusColor(status: AgentCityStatus, visual: AgentCityVisualTheme): number {
  if (status === "working") return cssColorHex(visual.accent, STATUS_COLORS.working);
  if (status === "completed") return cssColorHex(visual.online, STATUS_COLORS.completed);
  if (status === "error") return cssColorHex(visual.danger, STATUS_COLORS.error);
  return STATUS_COLORS[status];
}
const COAT_COLOR = 0xe3be92;
const COAT_COLOR_DISABLED = 0xa39a8f;
/** Pug ears fold forward at rest; upright cones read as a cat. */
const EAR_REST_PITCH = 1.05;
const CAMERA_TWEEN_MS = 620;
/** Full runtime data is retained; only the scene applies an animated-worker LOD. */
const SUBAGENT_RENDER_LIMIT = 12;

let cachedFurBumpMap: THREE.CanvasTexture | null = null;

/**
 * Generates a subtle procedural short-fur micro-grain bump texture so the pug
 * coat reads like soft velvet/fur instead of flat plastic spheres.
 */
function sharedFurBumpMap(): THREE.CanvasTexture | null {
  if (cachedFurBumpMap) return cachedFurBumpMap;
  if (typeof document === "undefined") return null;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(size, size);
  let seed = 1337;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const grain = 112 + ((seed >>> 24) % 44);
    image.data[i] = grain;
    image.data[i + 1] = grain;
    image.data[i + 2] = grain;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  cachedFurBumpMap = texture;
  return texture;
}

export function selectAgentCityQuality(capabilities: AgentCityCapabilities): AgentCityQuality {
  if (!capabilities.webgl2) return "fallback";
  if ((capabilities.deviceMemory ?? 8) <= 4 || (capabilities.hardwareConcurrency ?? 8) <= 4) return "low";
  return "full";
}

export function agentCityViewportHeight(floors: number, width: number): number {
  const count = Math.max(1, Math.min(10, Math.ceil(floors)));
  if (width < 640) return Math.max(560, 520 + count * 36);
  if (count <= 4) return Math.round(560 + ((count - 1) * 160) / 3);
  return 720 + (count - 4) * 80;
}

export function supportsAgentCityWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }));
}

/**
 * Identity of a floor's *geometry*. Status is deliberately excluded: status
 * changes must repaint and re-pose an existing room rather than rebuild it, or
 * the 2.5s activity poll would restart every animation and camera tween.
 */
export function agentCityFloorSignature(floor: AgentCityFloor, variant: number, theme: AgentCityTheme): string {
  return [
    floor.kind,
    String(floor.buildingIndex),
    floor.floorIndex,
    variant,
    theme,
    Math.min(floor.subagents.instances.length, SUBAGENT_RENDER_LIMIT),
    floor.subagents.instances.length > SUBAGENT_RENDER_LIMIT ? "pool" : "solo",
    floor.route ? "route" : "noroute"
  ].join("|");
}

function material(color: number, roughness = 0.78, metalness = 0.02): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry: THREE.BufferGeometry, surface: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const value = new THREE.Mesh(geometry, surface);
  value.position.set(x, y, z);
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  color: number,
  position: [number, number, number],
  radius = 0
): THREE.Mesh {
  const maxRadius = Math.max(0.001, Math.min(size[0], size[1], size[2]) * 0.45);
  const geometry = radius > 0
    ? new RoundedBoxGeometry(size[0], size[1], size[2], 4, Math.min(radius, maxRadius))
    : new THREE.BoxGeometry(...size);
  const value = mesh(geometry, material(color), ...position);
  parent.add(value);
  return value;
}

function createPhoneProp(): THREE.Object3D {
  const group = new THREE.Group();
  const shell = mesh(new THREE.BoxGeometry(0.18, 0.3, 0.028), material(0x22262b, 0.4));
  group.add(shell);
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6ecff,
    emissive: 0x8ad0ff,
    emissiveIntensity: 0.9,
    roughness: 0.3
  });
  group.add(mesh(new THREE.BoxGeometry(0.15, 0.25, 0.006), screenMaterial, 0, 0, 0.019));
  group.userData.screenMaterial = screenMaterial;
  return group;
}

function createBookProp(): { object: THREE.Object3D; page: THREE.Group } {
  const group = new THREE.Group();
  const coverMaterial = material(0x8a3f2f, 0.7);
  const left = mesh(new THREE.BoxGeometry(0.3, 0.02, 0.36), coverMaterial, -0.155, 0, 0);
  left.rotation.z = 0.22;
  const right = mesh(new THREE.BoxGeometry(0.3, 0.02, 0.36), coverMaterial, 0.155, 0, 0);
  right.rotation.z = -0.22;
  group.add(left, right);
  const page = new THREE.Group();
  const sheet = mesh(new THREE.BoxGeometry(0.28, 0.008, 0.33), material(0xf7f2e6, 0.9), 0.145, 0.02, 0);
  page.add(sheet);
  group.add(page);
  group.rotation.x = -0.55;
  return { object: group, page };
}

function createPenProp(): THREE.Object3D {
  const group = new THREE.Group();
  const pen = mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.3, 8), material(0x2f6bd8, 0.5));
  pen.rotation.set(0.5, 0, 0.9);
  group.add(pen);
  group.add(mesh(new THREE.BoxGeometry(0.3, 0.01, 0.22), material(0xf7f2e6, 0.9), 0.02, -0.14, 0.02));
  return group;
}

function createMugProp(): THREE.Object3D {
  const group = new THREE.Group();
  group.add(mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.16, 14), material(0xf0c66b, 0.6), 0, 0, 0));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.018, 6, 12, Math.PI * 1.55), material(0xf0c66b, 0.6));
  handle.rotation.y = Math.PI / 2;
  handle.position.set(0.09, 0, 0);
  group.add(handle);
  return group;
}

function createScannerProp(): THREE.Object3D {
  const group = new THREE.Group();
  const shell = mesh(new THREE.BoxGeometry(0.24, 0.16, 0.08), material(0x203646, 0.42));
  group.add(shell);
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0xbdefff,
    emissive: 0x46d7ff,
    emissiveIntensity: 1.1,
    roughness: 0.24
  });
  group.add(mesh(new THREE.BoxGeometry(0.19, 0.11, 0.014), screenMaterial, 0, 0, 0.048));
  group.userData.screenMaterial = screenMaterial;
  return group;
}

function createClipboardProp(): THREE.Object3D {
  const group = new THREE.Group();
  group.add(mesh(new THREE.BoxGeometry(0.25, 0.035, 0.34), material(0xd5c6aa, 0.8), 0, 0, 0));
  group.add(mesh(new THREE.BoxGeometry(0.09, 0.025, 0.045), material(0x657680, 0.45), 0, 0.035, -0.13));
  for (let index = 0; index < 3; index += 1) {
    group.add(mesh(new THREE.BoxGeometry(0.16, 0.012, 0.014), material(0x6f7c85, 0.9), 0, 0.03, -0.045 + index * 0.065));
  }
  return group;
}

function roleColor(role: string | null): number {
  const normalized = role?.trim().toLowerCase() ?? "";
  if (/scan|search|research|crawl|discover|inspect/.test(normalized)) return 0x36bfe8;
  if (/plan|architect|design|strategy/.test(normalized)) return 0x9b7be8;
  if (/review|test|audit|check|verify|qa/.test(normalized)) return 0xe7a34b;
  if (!normalized) return COAT_COLOR;
  const palette = [0x00ac96, 0x4f8bd8, 0xd06c8d, 0x72a85f];
  return palette[pugSeed(normalized) % palette.length];
}

/**
 * Low-poly pug with named pivots. The rig keeps front paws (the original model
 * had none), which is what makes typing / phone-scrolling / waving readable.
 */
function createPug(assistant = false, role: string | null = null): PugRig {
  const root = new THREE.Group();
  const pose = new THREE.Group();
  const roleAccessory = new THREE.Group();
  const headAccessory = new THREE.Group();
  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.13, depthWrite: false })
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.scale.set(1.15, 0.78, 1);
  contactShadow.position.y = 0.012;
  contactShadow.renderOrder = 1;
  root.add(contactShadow, pose, roleAccessory);

  const furBump = sharedFurBumpMap();
  const coat = new THREE.MeshStandardMaterial({
    color: COAT_COLOR,
    roughness: 0.9,
    metalness: 0.0,
    bumpMap: furBump ?? undefined,
    bumpScale: furBump ? 0.014 : 0
  });
  const coatMaterials = [coat];

  const body = mesh(new THREE.SphereGeometry(0.37, 22, 16), coat, 0, 0.42, 0);
  body.scale.set(1.08, 0.9, 1.18);
  pose.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.74, 0.05);
  pose.add(head);
  head.add(headAccessory);
  const skullMat = new THREE.MeshStandardMaterial({
    color: 0xeacaa1,
    roughness: 0.9,
    metalness: 0.0,
    bumpMap: furBump ?? undefined,
    bumpScale: furBump ? 0.012 : 0
  });
  const skull = mesh(new THREE.SphereGeometry(0.34, 22, 16), skullMat, 0, 0.1, 0.08);
  skull.scale.set(1.02, 0.94, 0.9);
  head.add(skull);
  const muzzleMat = new THREE.MeshStandardMaterial({
    color: 0x3d3028,
    roughness: 0.88,
    metalness: 0.0,
    bumpMap: furBump ?? undefined,
    bumpScale: furBump ? 0.01 : 0
  });
  const muzzle = mesh(new THREE.SphereGeometry(0.19, 18, 12), muzzleMat, 0, 0.02, 0.34);
  muzzle.scale.set(1.2, 0.78, 0.62);
  head.add(muzzle);
  const nose = mesh(new THREE.SphereGeometry(0.065, 14, 10), material(0x221b17, 0.24, 0.06), 0, 0.08, 0.49);
  nose.scale.set(1.1, 0.7, 0.65);
  head.add(nose);

  let earLeft: THREE.Mesh | null = null;
  let earRight: THREE.Mesh | null = null;
  const pawPivots: THREE.Group[] = [];
  const eyeSurface = material(0x18120e, 0.08, 0.08);
  const eyeShineSurface = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.35,
    roughness: 0.1
  });
  for (const side of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.05, 14, 10), eyeSurface, side * 0.12, 0.17, 0.34));
    head.add(mesh(new THREE.SphereGeometry(0.015, 8, 6), eyeShineSurface, side * 0.108, 0.188, 0.382));
    const ear = mesh(new THREE.ConeGeometry(0.13, 0.25, 8), material(0x3a2c24, 0.88), side * 0.26, 0.28, 0.02);
    ear.rotation.set(EAR_REST_PITCH, 0, side * -0.42);
    head.add(ear);
    if (side < 0) earLeft = ear; else earRight = ear;

    const backLeg = mesh(new THREE.CapsuleGeometry(0.09, 0.2, 4, 8), coat, side * 0.2, 0.14, -0.09);
    pose.add(backLeg);

    const pivot = new THREE.Group();
    pivot.position.set(side * 0.19, 0.47, 0.19);
    const paw = mesh(new THREE.CapsuleGeometry(0.085, 0.19, 4, 8), coat, 0, -0.16, 0);
    pivot.add(paw);
    pose.add(pivot);
    pawPivots.push(pivot);
  }

  const tailPivot = new THREE.Group();
  tailPivot.position.set(-0.3, 0.52, -0.16);
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 8, 16, Math.PI * 1.55), material(0xb98f61));
  tail.rotation.set(Math.PI / 2, 0, -0.45);
  tailPivot.add(tail);
  pose.add(tailPivot);

  const vest = mesh(
    new THREE.CylinderGeometry(0.36, 0.34, 0.34, 16, 1, true),
    material(assistant ? roleColor(role) : COAT_COLOR),
    0,
    0.48,
    0
  );
  vest.scale.set(1.02, 1, 1.12);
  pose.add(vest);
  if (assistant) {
    const roleAccent = roleColor(role);
    const collar = mesh(new THREE.TorusGeometry(0.28, 0.025, 8, 20), material(roleAccent, 0.5));
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 0.66, 0.02);
    roleAccessory.add(collar);
    roleAccessory.add(mesh(new THREE.BoxGeometry(0.13, 0.11, 0.025), material(0xfafafa), 0.18, 0.55, 0.38));
    const normalized = role?.toLowerCase() ?? "";
    if (/scan|search|research|crawl|discover|inspect/.test(normalized)) {
      const visor = addBox(headAccessory, [0.34, 0.08, 0.05], 0x46d7ff, [0, 0.17, 0.36]);
      const visorSurface = visor.material as THREE.MeshStandardMaterial;
      visorSurface.emissive.setHex(0x46d7ff);
      visorSurface.emissiveIntensity = 0.5;
    } else if (/plan|architect|design|strategy/.test(normalized)) {
      const badge = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.026, 12), material(0xd9c9ff), -0.19, 0.57, 0.37);
      badge.rotation.x = Math.PI / 2;
      roleAccessory.add(badge);
    } else if (/review|test|audit|check|verify|qa/.test(normalized)) {
      roleAccessory.add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.025), material(0xffe0ad), -0.18, 0.55, 0.38));
    }
  } else coatMaterials.push(vest.material as THREE.MeshStandardMaterial);

  const propAnchor = new THREE.Group();
  propAnchor.position.set(0, 0.56, 0.44);
  pose.add(propAnchor);
  const phone = createPhoneProp();
  const book = createBookProp();
  const pen = createPenProp();
  const mug = createMugProp();
  const scanner = createScannerProp();
  const clipboard = createClipboardProp();
  for (const prop of [phone, book.object, pen, mug, scanner, clipboard]) {
    prop.visible = false;
    propAnchor.add(prop);
  }

  root.scale.setScalar(0.82);
  return {
    root,
    pose,
    head,
    pawLeft: pawPivots[0],
    pawRight: pawPivots[1],
    earLeft: earLeft as THREE.Mesh,
    earRight: earRight as THREE.Mesh,
    tailPivot,
    propAnchor,
    roleAccessory,
    headAccessory,
    propObjects: { phone, book: book.object, pen, mug, scanner, clipboard },
    bookPage: book.page,
    screenMaterials: [
      phone.userData.screenMaterial as THREE.MeshStandardMaterial,
      scanner.userData.screenMaterial as THREE.MeshStandardMaterial
    ],
    coatMaterials,
    seed: 0,
    role,
    baseScale: 0.82,
    homePosition: new THREE.Vector3(),
    homeYaw: 0,
    spawnEpochMs: null,
    portalPosition: null,
    workerExitStartedAt: null,
    travelOffset: new THREE.Vector3(),
    ambientTarget: null,
    isWorker: assistant,
    assetEligible: true,
    asset: null,
    status: "idle",
    currentProp: "none",
    oneShot: null,
    faceCamera: 0
  };
}

function applyRigTravel(rig: PugRig, pose: PugPose, extraYaw = 0): void {
  rig.root.position.set(
    rig.homePosition.x + rig.travelOffset.x + pose.travelX,
    rig.homePosition.y + rig.travelOffset.y,
    rig.homePosition.z + rig.travelOffset.z + pose.travelZ
  );
  rig.root.rotation.y = rig.homeYaw + pose.travelYaw + extraYaw;
}

function applyPugProp(rig: PugRig, pose: PugPose, detailed: boolean): void {
  const prop: PugProp = detailed ? pose.prop : "none";
  if (prop !== rig.currentProp) {
    for (const [name, object] of Object.entries(rig.propObjects)) object.visible = name === prop;
    rig.currentProp = prop;
  }
  if (prop === "book") rig.bookPage.rotation.z = -pose.propSpin;
  if (prop === "phone" || prop === "mug" || prop === "scanner" || prop === "clipboard") rig.propAnchor.rotation.z = pose.propSpin;
  if (prop === "pen") rig.propAnchor.rotation.z = pose.propSpin * 0.4;
  for (const surface of rig.screenMaterials) surface.emissiveIntensity = 0.35 + pose.screenGlow * 0.9;
}

function applyPugPose(rig: PugRig, pose: PugPose, baseYaw: number, detailed: boolean): void {
  applyRigTravel(rig, pose);
  rig.pose.position.y = pose.bodyOffsetY;
  rig.pose.rotation.set(pose.bodyTiltX, baseYaw + pose.bodyTurnY, pose.bodyRollZ);
  const lateral = 1 / Math.sqrt(Math.max(0.2, pose.squash));
  rig.pose.scale.set(lateral, pose.squash, lateral);

  rig.head.rotation.set(pose.headPitch, pose.headYaw, pose.headRoll);
  rig.pawLeft.rotation.set(pose.frontPawLeft, 0, pose.pawSpreadLeft);
  rig.pawRight.rotation.set(pose.frontPawRight, 0, pose.pawSpreadRight);
  rig.tailPivot.rotation.y = pose.tailWag;
  rig.earLeft.rotation.x = EAR_REST_PITCH + pose.earFlop;
  rig.earRight.rotation.x = EAR_REST_PITCH + pose.earFlop;
  applyPugProp(rig, pose, detailed);
}

function setPugStatus(rig: PugRig, status: AgentCityStatus): void {
  rig.status = status;
  const color = status === "disabled" ? COAT_COLOR_DISABLED : COAT_COLOR;
  for (const surface of rig.coatMaterials) surface.color.setHex(color);
}

function setRigScale(rig: PugRig, scalar: number): void {
  rig.baseScale = scalar;
  rig.root.scale.setScalar(scalar);
}

function setRigHome(rig: PugRig, position: THREE.Vector3, yaw: number): void {
  rig.homePosition.copy(position);
  rig.homeYaw = yaw;
  rig.root.position.copy(position);
  rig.root.rotation.y = yaw;
}

/**
 * Holographic tactical terminal built around its own origin with the seat side
 * on +z, so the caller can position it inside the tactical pod.
 */
function createWorkstation(accent: number, visual: AgentCityVisualTheme): { group: THREE.Group; screen: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const profile = agentCityRecipeProfile(visual.recipe);
  const desk = mixHex(cssColorHex(visual.panel, 0x1b2836), accent, Math.max(0.28, profile.roomAccentMix * 0.65));
  const frame = mixHex(cssColorHex(visual.separator, 0x2d4052), accent, 0.42);
  addBox(group, [1.1, 0.06, 0.46], desk, [0, 0.48, 0], visual.recipe === "retro" || visual.recipe === "editorial" ? 0.01 : 0.03);
  addBox(group, [0.06, 0.46, 0.06], frame, [-0.42, 0.23, 0]);
  addBox(group, [0.06, 0.46, 0.06], frame, [0.42, 0.23, 0]);
  const screen = new THREE.MeshStandardMaterial({
    color: mixHex(accent, 0xffffff, 0.35),
    emissive: accent,
    emissiveIntensity: 0.55,
    roughness: 0.18,
    metalness: 0.2,
    transparent: true,
    opacity: 0.86
  });
  group.add(mesh(new THREE.BoxGeometry(0.76, 0.44, 0.024), screen, 0, 0.84, -0.04));
  // Keyboard / holographic projection pad.
  addBox(group, [0.46, 0.02, 0.16], mixHex(frame, accent, 0.38), [0, 0.53, 0.16], visual.recipe === "retro" ? 0.005 : 0.015);
  return { group, screen };
}

function floorPalette(index: number, dark: boolean, visual: AgentCityVisualTheme): { wall: number; trim: number; accent: number } {
  const profile = agentCityRecipeProfile(visual.recipe);
  const surface = cssColorHex(visual.card, dark ? 0x14202c : 0xe4eef7);
  const panel = cssColorHex(visual.panel, dark ? 0x1f3142 : 0xd2e1ee);
  const accents = [
    cssColorHex(visual.accent, dark ? 0x38bdf8 : 0x006bff),
    cssColorHex(visual.online, dark ? 0x34d399 : 0x28a948),
    cssColorHex(visual.skillAccent, dark ? 0xa855f7 : 0x8500d1),
    cssColorHex(visual.warning, dark ? 0xfbbf24 : 0xaa4d00)
  ];
  const accent = accents[index % accents.length];
  return {
    wall: mixHex(surface, accent, Math.max(0.24, profile.roomAccentMix * (dark ? 0.72 : 0.52))),
    trim: mixHex(panel, accent, Math.max(0.32, profile.roomAccentMix * (dark ? 0.95 : 0.75))),
    accent
  };
}

/**
 * Holographic telemetry panes inside the tactical pod.
 */
function createWindowPanes(
  count: number,
  spacing: number,
  size: [number, number],
  y: number,
  z: number
): { group: THREE.Group; material: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.25,
    roughness: 0.15,
    metalness: 0.15,
    transparent: true,
    opacity: 0.42
  });
  const offset = ((count - 1) * spacing) / 2;
  for (let index = 0; index < count; index += 1) {
    group.add(mesh(new THREE.BoxGeometry(size[0], size[1], 0.02), material, index * spacing - offset, y, z));
  }
  return { group, material };
}


function createWorkerStation(accent: number, role: string, visual: AgentCityVisualTheme): { group: THREE.Group; screen: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const roleAccent = roleColor(role);
  const profile = agentCityRecipeProfile(visual.recipe);
  const podBase = mixHex(cssColorHex(visual.panel, 0x1b2a38), roleAccent || accent, Math.max(0.35, profile.roomAccentMix * 0.6));
  const satellitePad = mesh(new THREE.CylinderGeometry(0.46, 0.52, 0.08, 6), material(podBase, 0.35, 0.35), 0, 0.04, 0);
  group.add(satellitePad);
  const screen = new THREE.MeshStandardMaterial({
    color: mixHex(roleAccent || accent, 0xffffff, 0.35),
    emissive: roleAccent || accent,
    emissiveIntensity: 0.85,
    roughness: 0.2,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9
  });
  const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.022, 8, 24), screen);
  orbitRing.rotation.x = Math.PI / 2;
  orbitRing.position.y = 0.12;
  group.add(orbitRing);
  group.add(mesh(new THREE.OctahedronGeometry(0.14, 0), screen, 0, 0.52, -0.05));
  return { group, screen };
}

function createRoomDecor(
  group: THREE.Group,
  dynamicGroup: THREE.Group,
  isGlobal: boolean,
  dark: boolean,
  accent: number,
  _variant: number,
  _hasWorkers: boolean,
  visual: AgentCityVisualTheme
): { activityMaterials: THREE.MeshStandardMaterial[]; celebration: THREE.Group } {
  const activityMaterials: THREE.MeshStandardMaterial[] = [];
  const card = cssColorHex(visual.card, dark ? 0x13202c : 0xdce8f2);
  const panel = cssColorHex(visual.panel, dark ? 0x1e3040 : 0xc8dae8);

  // Holographic Hex Reactor Core base plate
  const padRadius = isGlobal ? 3.2 : 1.72;
  const basePlate = mesh(
    new THREE.CylinderGeometry(padRadius, padRadius * 1.06, 0.08, isGlobal ? 32 : 6),
    material(mixHex(card, accent, dark ? 0.22 : 0.16), 0.38, 0.42),
    0,
    0.09,
    0
  );
  group.add(basePlate);

  // Glowing inner telemetry ring
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: mixHex(accent, 0xffffff, 0.35),
    emissive: accent,
    emissiveIntensity: dark ? 0.55 : 0.28,
    roughness: 0.2,
    metalness: 0.3
  });
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(padRadius * 0.76, isGlobal ? 0.045 : 0.03, 10, isGlobal ? 48 : 6),
    ringMaterial
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.15;
  dynamicGroup.add(innerRing);
  activityMaterials.push(ringMaterial);

  // Outer precision reticle ring
  const outerRingMaterial = new THREE.MeshStandardMaterial({
    color: mixHex(panel, accent, 0.5),
    emissive: accent,
    emissiveIntensity: dark ? 0.32 : 0.15,
    roughness: 0.3
  });
  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(padRadius * 0.96, 0.02, 8, isGlobal ? 64 : 32),
    outerRingMaterial
  );
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = 0.14;
  dynamicGroup.add(outerRing);
  activityMaterials.push(outerRingMaterial);

  // Vertical Holographic Data Pillars at corners
  const pillarCount = isGlobal ? 6 : 4;
  for (let index = 0; index < pillarCount; index += 1) {
    const angle = (index / pillarCount) * Math.PI * 2 + Math.PI / 4;
    const px = Math.cos(angle) * (padRadius * 0.88);
    const pz = Math.sin(angle) * (padRadius * 0.88);
    const cellMaterial = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: dark ? 0.38 : 0.18,
      roughness: 0.25,
      transparent: true,
      opacity: 0.82
    });
    dynamicGroup.add(mesh(
      new THREE.CylinderGeometry(0.028, 0.028, isGlobal ? 1.45 : 0.92, 8),
      cellMaterial,
      px,
      isGlobal ? 0.82 : 0.54,
      pz
    ));
    activityMaterials.push(cellMaterial);
  }

  // Celebration orbital energy satellites: active when a run completes
  const celebration = new THREE.Group();
  const confettiColors = [0x38bdf8, 0x34d399, 0xa855f7, 0xfbbf24, 0x60a5fa, 0xffffff];
  for (let index = 0; index < confettiColors.length; index += 1) {
    const satMat = new THREE.MeshStandardMaterial({
      color: confettiColors[index],
      emissive: confettiColors[index],
      emissiveIntensity: 0.9,
      roughness: 0.2
    });
    const bit = mesh(new THREE.OctahedronGeometry(isGlobal ? 0.11 : 0.075, 0), satMat);
    const angle = (index / confettiColors.length) * Math.PI * 2;
    bit.position.set(Math.cos(angle) * (isGlobal ? 1.65 : 1.05), 1.05 + (index % 2) * 0.25, Math.sin(angle) * (isGlobal ? 1.65 : 1.05));
    celebration.add(bit);
  }
  celebration.visible = false;
  dynamicGroup.add(celebration);

  return { activityMaterials, celebration };
}

function createWorkingFloorPerimeter(
  size: [number, number, number],
  height: number,
  emissive: THREE.MeshStandardMaterial,
  phase: number,
  workingColor: number,
  highlightColor: number
): AnimatedFloorPerimeter {
  const group = new THREE.Group();
  const [width, , depth] = size;
  const halfWidth = width / 2 + 0.045;
  const halfDepth = depth / 2 + 0.045;
  const baseY = 0.13;
  const topY = height + 0.05;
  const points = new Float32Array([
    -halfWidth, baseY, -halfDepth, halfWidth, baseY, -halfDepth,
    halfWidth, baseY, -halfDepth, halfWidth, baseY, halfDepth,
    halfWidth, baseY, halfDepth, -halfWidth, baseY, halfDepth,
    -halfWidth, baseY, halfDepth, -halfWidth, baseY, -halfDepth,
    -halfWidth, topY, -halfDepth, halfWidth, topY, -halfDepth,
    halfWidth, topY, -halfDepth, halfWidth, topY, halfDepth,
    halfWidth, topY, halfDepth, -halfWidth, topY, halfDepth,
    -halfWidth, topY, halfDepth, -halfWidth, topY, -halfDepth,
    -halfWidth, baseY, -halfDepth, -halfWidth, topY, -halfDepth,
    halfWidth, baseY, -halfDepth, halfWidth, topY, -halfDepth,
    halfWidth, baseY, halfDepth, halfWidth, topY, halfDepth,
    -halfWidth, baseY, halfDepth, -halfWidth, topY, halfDepth
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const perimeterMaterial = new THREE.LineBasicMaterial({
    color: workingColor,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  group.add(new THREE.LineSegments(geometry, perimeterMaterial));

  const marqueePoints = new Float32Array([
    -halfWidth, baseY, -halfDepth,
    halfWidth, baseY, -halfDepth,
    halfWidth, topY, -halfDepth,
    halfWidth, topY, halfDepth,
    -halfWidth, topY, halfDepth,
    -halfWidth, baseY, halfDepth,
    -halfWidth, baseY, -halfDepth
  ]);
  const marqueeGeometry = new THREE.BufferGeometry();
  marqueeGeometry.setAttribute("position", new THREE.BufferAttribute(marqueePoints, 3));
  const marqueeLength = width * 2 + depth * 2 + (topY - baseY) * 2;
  const marquee = new THREE.LineDashedMaterial({
    color: highlightColor,
    dashSize: marqueeLength * 0.24,
    gapSize: marqueeLength * 0.76,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const marqueeLine = new THREE.Line(marqueeGeometry, marquee);
  marqueeLine.computeLineDistances();
  const distances = marqueeGeometry.getAttribute("lineDistance") as THREE.BufferAttribute;
  const baseDistances = new Float32Array(distances.array as Float32Array);
  group.add(marqueeLine);
  return { group, material: perimeterMaterial, marquee, distances, baseDistances, emissive, phase, length: marqueeLength };
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const surface of materials) {
      for (const value of Object.values(surface)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      surface.dispose();
    }
  });
}

export function createAgentCityScene(options: AgentCitySceneOptions): AgentCitySceneController {
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    antialias: options.quality === "full",
    alpha: false,
    powerPreference: options.quality === "full" ? "high-performance" : "low-power"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = options.theme === "dark" ? 1.08 : 1.0;
  renderer.shadowMap.enabled = options.quality === "full";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.quality === "full" ? 2 : 1.25));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 240);
  const cityRoot = new THREE.Group();
  scene.add(cityRoot);

  const controls = new OrbitControls(camera, options.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.rotateSpeed = 0.62;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = true;
  controls.minDistance = AGENT_CITY_MIN_DISTANCE;
  controls.maxDistance = AGENT_CITY_MAX_DISTANCE;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = Math.PI * 0.487;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  let projection = options.projection;
  let theme = options.theme;
  let visualTheme = options.visualTheme;
  let visualThemeSignature = agentCityVisualThemeSignature(visualTheme);
  let skyColor = new THREE.Color(options.sky);
  let quality = options.quality;
  let reducedMotion = options.reducedMotion;
  let visible = true;
  let disposed = false;
  let width = 1;
  let height = 1;
  let animationFrame = 0;
  let lastFrame = performance.now();
  let lastRenderedAt = lastFrame;
  let frameSamples: number[] = [];
  let userAdjusted = false;
  let focusedKey: string | null = null;
  let selectedKey: string | null = null;
  let followWorking = false;
  let followKey: string | null = null;
  let lastSceneFloors = -1;
  let momoTemplate: MomoAssetTemplate | null = null;
  let momoAssetLoadFailed = false;
  let communityKit: CommunityKitTemplate | null = null;
  let communityKitLoadFailed = false;

  const floorNodes = new Map<string, FloorNode>();
  const staticRoot = new THREE.Group();
  cityRoot.add(staticRoot);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const anchorWorldPosition = new THREE.Vector3();
  const cameraWorldPosition = new THREE.Vector3();
  const floorWorldPosition = new THREE.Vector3();
  let bounds = agentCityBounds(projection.sceneFloors);

  let tween:
    | {
        fromPosition: THREE.Vector3;
        toPosition: THREE.Vector3;
        fromTarget: THREE.Vector3;
        toTarget: THREE.Vector3;
        startedAt: number;
      }
    | null = null;

  const ambient = new THREE.HemisphereLight(0xffffff, 0x56616a, theme === "dark" ? 1.45 : 1.8);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(theme === "dark" ? 0x9fc6ff : 0xfff4df, theme === "dark" ? 2.2 : 3.4);
  sun.position.set(-12, 24, 18);
  sun.castShadow = options.quality === "full";
  sun.shadow.mapSize.set(options.quality === "full" ? 2048 : 512, options.quality === "full" ? 2048 : 512);
  // Without bias the GLTF rooms self-shadow wholesale (black walls/roofs) and
  // the per-frame shadow re-render makes the acne crawl — read as flicker.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.35;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(theme === "dark" ? 0x79b8ff : 0xffe1b8, theme === "dark" ? 0.75 : 0.55);
  rim.position.set(14, 10, -16);
  rim.castShadow = false;
  scene.add(rim);

  function applyMomoTheme(root: THREE.Object3D): void {
    const profile = agentCityRecipeProfile(visualTheme.recipe);
    const accent = cssColorHex(visualTheme.accent, 0x4a9a94);
    const panel = cssColorHex(visualTheme.panel, theme === "dark" ? 0x2d3940 : 0xe9edf0);
    const separator = cssColorHex(visualTheme.separator, theme === "dark" ? 0x56616a : 0x9aa3aa);
    const furBump = sharedFurBumpMap();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const meshName = object.name.toLowerCase();
      const surfaces = Array.isArray(object.material) ? object.material : [object.material];
      for (const surface of surfaces) {
        if (!(surface instanceof THREE.MeshStandardMaterial)) continue;
        const name = surface.name.toLowerCase();
        if (name.includes("vesttrim")) {
          surface.color.setHex(mixHex(separator, accent, 0.28));
          surface.roughness = Math.max(0.7, profile.roughness);
        } else if (name.includes("momovest") || name.includes("momoteal") || name === "vest") {
          surface.color.setHex(mixHex(accent, panel, 0.22));
          surface.roughness = Math.max(0.74, profile.roughness);
          surface.metalness = Math.min(0.08, profile.metalness);
        } else if (name.includes("warmfawn")) {
          surface.color.setHex(0xe5c298);
          surface.roughness = 0.92;
          surface.metalness = 0.0;
          if (furBump) {
            surface.bumpMap = furBump;
            surface.bumpScale = 0.014;
          }
        } else if (name.includes("creamfawn")) {
          surface.color.setHex(0xf5e5ce);
          surface.roughness = 0.93;
          surface.metalness = 0.0;
          if (furBump) {
            surface.bumpMap = furBump;
            surface.bumpScale = 0.011;
          }
        } else if (name.includes("maskbrown")) {
          surface.color.setHex(0x3e3129);
          surface.roughness = 0.88;
          surface.metalness = 0.0;
          if (furBump) {
            surface.bumpMap = furBump;
            surface.bumpScale = 0.01;
          }
        } else if (name === "ear" || meshName.startsWith("ear")) {
          surface.color.setHex(0x362922);
          surface.roughness = 0.9;
          surface.metalness = 0.0;
        } else if (name.includes("eyehighlight")) {
          surface.color.setHex(0xffffff);
          surface.emissive.setHex(0xffffff);
          surface.emissiveIntensity = 0.35;
          surface.roughness = 0.12;
        } else if (name === "ink") {
          if (meshName.startsWith("nose")) {
            surface.color.setHex(0x231c18);
            surface.roughness = 0.24;
            surface.metalness = 0.06;
          } else {
            surface.color.setHex(0x16110d);
            surface.roughness = 0.08;
            surface.metalness = 0.08;
          }
        } else if (name.includes("tongue")) {
          surface.color.setHex(0xe68a86);
          surface.roughness = 0.42;
          surface.metalness = 0.0;
        }
        surface.needsUpdate = true;
      }
    });
  }

  function attachMomoAsset(rig: PugRig): void {
    if (!rig.assetEligible || rig.asset || !momoTemplate) return;
    if (quality === "low" && rig.isWorker) return;
    const instance = createMomoAssetInstance(momoTemplate);
    instance.root.scale.setScalar(0.96);
    applyMomoTheme(instance.root);
    rig.root.add(instance.root);
    const assetHead = instance.root.getObjectByName("HeadPivot");
    if (assetHead) {
      rig.head.remove(rig.headAccessory);
      assetHead.add(rig.headAccessory);
      rig.headAccessory.position.set(0, 0, 0);
    }
    // Keep the lightweight Three.js prop layer so Phone/Reading/Coffee remain
    // readable even though the procedural body is replaced by the GLTF hero.
    rig.pose.remove(rig.propAnchor);
    rig.root.add(rig.propAnchor);
    rig.propAnchor.position.set(0, 0.63, 0.45);
    rig.pose.visible = false;
    rig.asset = instance;
    playMomoAnimation(instance, "Idle", 0);
  }

  function detachMomoAsset(rig: PugRig): void {
    if (!rig.asset) return;
    stopMomoAssetInstance(rig.asset);
    rig.headAccessory.parent?.remove(rig.headAccessory);
    rig.head.add(rig.headAccessory);
    rig.root.remove(rig.asset.root);
    rig.asset = null;
    rig.pose.visible = true;
    if (rig.propAnchor.parent !== rig.pose) {
      rig.root.remove(rig.propAnchor);
      rig.pose.add(rig.propAnchor);
      rig.propAnchor.position.set(0, 0.56, 0.44);
    }
  }

  async function hydrateMomoAssets(): Promise<void> {
    if (momoTemplate || momoAssetLoadFailed) return;
    try {
      const template = await loadMomoAssetTemplate();
      if (disposed) return;
      momoTemplate = template;
      for (const node of floorNodes.values()) {
        for (const rig of node.pugs) attachMomoAsset(rig);
      }
    } catch {
      // Asset loading must never blank Agent Community: procedural Momo remains
      // the permanent fallback for offline/dev/broken-package scenarios.
      momoAssetLoadFailed = true;
    }
  }

  function attachCommunityKit(node: FloorNode, isGlobal: boolean, dark: boolean, accent: number, hasWorkers: boolean): void {
    if (!communityKit || node.assetVisual.children.length > 0) return;
    const architecture = cloneCommunityComponent(communityKit, isGlobal ? "HQArchitecture" : "StudioArchitecture", dark, accent, visualTheme);
    const decor = cloneCommunityComponent(communityKit, isGlobal ? "HQDecor" : "StudioDecor", dark, accent, visualTheme);
    if (architecture) {
      architecture.visible = false;
      node.assetVisual.add(architecture);
    }
    if (decor) {
      const lounge = decor.getObjectByName("Lounge");
      if (lounge) lounge.visible = !hasWorkers;
      decor.visible = false;
      node.assetVisual.add(decor);
    }
    if (!architecture && !decor) return;
    node.assetWindowMaterials = [];
    node.assetVisual.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const surfaces = Array.isArray(object.material) ? object.material : [object.material];
      for (const surface of surfaces) {
        if (!(surface instanceof THREE.MeshStandardMaterial)) continue;
        if (surface.name.toLowerCase().includes("glasstint")) node.assetWindowMaterials.push(surface);
      }
    });
    node.proceduralShell.visible = true;
    node.proceduralDecor.visible = true;
    if (node.status) applyWindowGlow(node, node.status);
  }

  async function hydrateCommunityAssets(): Promise<void> {
    if (communityKit || communityKitLoadFailed) return;
    try {
      const template = await loadCommunityKit();
      if (disposed) return;
      communityKit = template;
      buildStaticScenery();
      for (const floor of agentCityFloors(projection)) {
        const node = floorNodes.get(floor.key);
        if (!node) continue;
        const dark = theme === "dark";
        const variant = typeof floor.buildingIndex === "number" ? floor.buildingIndex : 0;
        const accent = floor.kind === "global"
          ? cssColorHex(visualTheme.accent, 0x006bff)
          : floorPalette(variant, dark, visualTheme).accent;
        attachCommunityKit(node, floor.kind === "global", dark, accent, floor.subagents.instances.length > 0);
      }
    } catch {
      communityKitLoadFailed = true;
    }
  }

  function publishView(): void {
    options.onViewChange?.({
      distance: camera.position.distanceTo(controls.target),
      focusedKey,
      adjusted: userAdjusted,
      following: followWorking,
      followKey
    });
  }

  function applyQuality(): void {
    const full = quality === "full";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, full ? 2 : 1.25));
    renderer.shadowMap.enabled = full;
    sun.castShadow = full;
    sun.shadow.mapSize.set(full ? 2048 : 512, full ? 2048 : 512);
    if (width > 1 || height > 1) renderer.setSize(width, height, false);
  }

  function applyTheme(): void {
    const profile = agentCityRecipeProfile(visualTheme.recipe);
    const accent = cssColorHex(visualTheme.accent, theme === "dark" ? 0x79b8ff : 0x006bff);
    const warning = cssColorHex(visualTheme.warning, 0xffc96b);
    scene.background = skyColor;
    scene.fog = new THREE.Fog(skyColor, visualTheme.recipe === "technical" ? 34 : 42, visualTheme.recipe === "retro" ? 105 : 130);
    ambient.intensity = (theme === "dark" ? 1.45 : 1.8) * (visualTheme.recipe === "retro" ? 0.92 : 1);
    sun.color.setHex(theme === "dark" ? mixHex(accent, 0xffffff, 0.48) : mixHex(warning, 0xffffff, 0.78));
    sun.intensity = theme === "dark" ? 2.15 : 3.3;
    rim.color.setHex(accent);
    rim.intensity = (theme === "dark" ? 0.72 : 0.5) * profile.emissiveScale;
    renderer.toneMappingExposure =
      visualTheme.recipe === "technical" ? (theme === "dark" ? 1.14 : 1.02) :
      visualTheme.recipe === "retro" ? (theme === "dark" ? 0.98 : 0.94) :
      theme === "dark" ? 1.06 : 1.0;
  }

  function buildStaticScenery(): void {
    disposeObject(staticRoot);
    staticRoot.clear();
    const profile = agentCityRecipeProfile(visualTheme.recipe);
    const accent = cssColorHex(visualTheme.accent, theme === "dark" ? 0x38bdf8 : 0x006bff);
    const surface = cssColorHex(visualTheme.surface, theme === "dark" ? 0x111a24 : 0xdfe7e5);
    const panel = cssColorHex(visualTheme.panel, theme === "dark" ? 0x1b2836 : 0xd5dfdc);
    const card = cssColorHex(visualTheme.card, theme === "dark" ? 0x16222f : 0xf5eee4);
    const separator = cssColorHex(visualTheme.separator, theme === "dark" ? 0x36495c : 0xb9c4c8);
    const online = cssColorHex(visualTheme.online, theme === "dark" ? 0x34d399 : 0x28a948);
    const warning = cssColorHex(visualTheme.warning, theme === "dark" ? 0xfbbf24 : 0xa97842);

    // Tactical Holographic Astrolabe Deck Base
    const groundColor = mixHex(surface, panel, theme === "dark" ? 0.22 : 0.28);
    const ground = mesh(
      new THREE.CylinderGeometry(20.5, 21.2, 0.24, 64),
      material(groundColor, Math.max(0.28, profile.roughness - 0.18), Math.min(0.45, profile.metalness + 0.16)),
      0,
      -0.2,
      0
    );
    ground.receiveShadow = true;
    staticRoot.add(ground);

    // Concentric Polar Orbit Rings on the Tactical Deck
    const ringMat = new THREE.MeshStandardMaterial({
      color: mixHex(accent, separator, 0.45),
      emissive: accent,
      emissiveIntensity: (theme === "dark" ? 0.42 : 0.18) * profile.emissiveScale,
      roughness: 0.28,
      metalness: 0.3,
      transparent: true,
      opacity: theme === "dark" ? 0.62 : 0.42
    });
    for (const radius of [4.2, 8.6, 12.8, 16.8, 20.2]) {
      const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(radius, radius === 12.8 ? 0.045 : 0.024, 8, 96), ringMat);
      orbitRing.rotation.x = Math.PI / 2;
      orbitRing.position.y = -0.05;
      staticRoot.add(orbitRing);
    }

    // glowing neural conduit traces from Primary Core to every orbital node
    const conduitColor = mixHex(panel, accent, visualTheme.recipe === "retro" ? 0.35 : 0.55);
    const conduitMat = new THREE.MeshStandardMaterial({
      color: conduitColor,
      emissive: accent,
      emissiveIntensity: (theme === "dark" ? 0.28 : 0.12) * profile.emissiveScale,
      roughness: 0.3,
      metalness: 0.25,
      transparent: true,
      opacity: theme === "dark" ? 0.72 : 0.52
    });
    const addConduit = (fromX: number, fromZ: number, toX: number, toZ: number, traceWidth = 0.14): void => {
      const dx = toX - fromX;
      const dz = toZ - fromZ;
      const length = Math.hypot(dx, dz);
      if (length < 0.01) return;
      const trace = mesh(
        new THREE.BoxGeometry(traceWidth, 0.025, length),
        conduitMat,
        (fromX + toX) / 2,
        -0.04,
        (fromZ + toZ) / 2
      );
      trace.rotation.y = Math.atan2(dx, dz);
      staticRoot.add(trace);
    };
    const primary = projection.globalFloor.position;
    addConduit(projection.owner.position.x, projection.owner.position.z, primary.x, primary.z, 0.28);
    for (const building of projection.buildings) {
      addConduit(primary.x, primary.z, building.position.x, building.position.z, 0.12);
    }

    // Central Nexus Reactor Pedestal
    const plazaMaterial = new THREE.MeshStandardMaterial({
      color: mixHex(card, accent, Math.max(0.18, profile.sceneryAccentMix * 1.4)),
      emissive: accent,
      emissiveIntensity: (theme === "dark" ? 0.18 : 0.06) * profile.emissiveScale,
      roughness: 0.32,
      metalness: 0.28
    });
    const plaza = mesh(new THREE.CylinderGeometry(4.6, 5.1, 0.1, 32), plazaMaterial, primary.x, -0.02, primary.z);
    plaza.receiveShadow = true;
    staticRoot.add(plaza);

    // Theme family tactical grid & markers
    if (visualTheme.recipe === "technical") {
      const gridColor = mixHex(accent, separator, 0.36);
      const grid = new THREE.GridHelper(36, 36, gridColor, mixHex(gridColor, surface, 0.48));
      grid.position.y = -0.06;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = theme === "dark" ? 0.34 : 0.2;
      staticRoot.add(grid);
    } else if (visualTheme.recipe === "retro" || visualTheme.recipe === "editorial") {
      const rule = mixHex(separator, accent, visualTheme.recipe === "editorial" ? 0.34 : 0.12);
      for (const z of [-6.0, 0, 6.0]) {
        addBox(staticRoot, [32, 0.016, visualTheme.recipe === "retro" ? 0.05 : 0.03], rule, [0, -0.05, z], 0.001);
      }
      for (const x of [-10, 0, 10]) {
        addBox(staticRoot, [visualTheme.recipe === "retro" ? 0.05 : 0.03, 0.016, 20], rule, [x, -0.05, 0], 0.001);
      }
    } else if (visualTheme.recipe === "expressive") {
      for (const [x, z, scale] of [[-6.2, 2.5, 1.0], [6.2, 2.5, 0.85], [0, -5.0, 0.75]] as const) {
        const island = mesh(
          new THREE.CylinderGeometry(1.1 * scale, 1.1 * scale, 0.02, 24),
          material(mixHex(card, accent, 0.28), 0.5),
          x, -0.04, z
        );
        staticRoot.add(island);
      }
    } else {
      const subtleGrid = new THREE.GridHelper(34, 34, mixHex(accent, separator, 0.5), mixHex(separator, surface, 0.55));
      subtleGrid.position.y = -0.065;
      (subtleGrid.material as THREE.Material).transparent = true;
      (subtleGrid.material as THREE.Material).opacity = theme === "dark" ? 0.22 : 0.14;
      staticRoot.add(subtleGrid);
    }

    // Perimeter Holographic Telemetry Beacons (replacing cartoon trees & park benches)
    const beaconGlassMat = new THREE.MeshStandardMaterial({
      color: mixHex(online, accent, 0.5),
      emissive: accent,
      emissiveIntensity: (theme === "dark" ? 0.72 : 0.28) * profile.emissiveScale,
      roughness: 0.2,
      metalness: 0.3
    });
    const beaconWarnMat = new THREE.MeshStandardMaterial({
      color: mixHex(warning, 0xffffff, 0.45),
      emissive: warning,
      emissiveIntensity: (theme === "dark" ? 0.65 : 0.22) * profile.emissiveScale,
      roughness: 0.25
    });
    for (const angleDeg of [30, 90, 150, 210, 270, 330]) {
      const rad = (angleDeg * Math.PI) / 180;
      const bx = Math.cos(rad) * 16.8;
      const bz = Math.sin(rad) * 16.8;
      staticRoot.add(mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.18, 6), material(mixHex(panel, accent, 0.35), 0.3, 0.4), bx, 0.02, bz));
      staticRoot.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.35, 8), beaconGlassMat, bx, 0.7, bz));
      staticRoot.add(mesh(new THREE.OctahedronGeometry(0.11, 0), angleDeg % 180 === 90 ? beaconWarnMat : beaconGlassMat, bx, 1.45, bz));
    }

    const owner = createOwnerCenter(theme === "dark", accent);
    if (communityKit) {
      const hubClone = cloneCommunityComponent(communityKit, "CommunityHub", theme === "dark", accent, visualTheme);
      if (hubClone) {
        hubClone.visible = false;
        owner.add(hubClone);
      }
    }
    owner.position.set(projection.owner.position.x, projection.owner.position.y, projection.owner.position.z);
    staticRoot.add(owner);
  }

  function createOwnerCenter(dark: boolean, accent: number): THREE.Group {
    const group = new THREE.Group();
    const profile = agentCityRecipeProfile(visualTheme.recipe);
    const baseColor = mixHex(cssColorHex(visualTheme.panel, dark ? 0x172634 : 0xd8e2df), accent, Math.max(0.25, profile.sceneryAccentMix * 0.8));
    const base = material(baseColor, 0.32, 0.38);
    const platform = mesh(new THREE.CylinderGeometry(1.85, 2.15, 0.16, 6), base, 0, 0.04, 0);
    group.add(platform);

    const coreMaterial = new THREE.MeshStandardMaterial({
      color: mixHex(accent, 0xffffff, 0.55),
      emissive: accent,
      emissiveIntensity: 0.88 * profile.emissiveScale,
      roughness: 0.18,
      metalness: 0.3
    });
    group.add(mesh(new THREE.OctahedronGeometry(0.42, 0), coreMaterial, 0, 0.95, 0));

    const ringMaterial = new THREE.MeshStandardMaterial({
      color: mixHex(accent, 0xffffff, 0.42),
      emissive: accent,
      emissiveIntensity: 0.62 * profile.emissiveScale,
      roughness: 0.25
    });
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.032, 10, 48), ringMaterial);
    ring1.rotation.x = Math.PI / 2;
    ring1.position.y = 0.22;
    group.add(ring1);

    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.024, 10, 36), ringMaterial);
    ring2.rotation.set(Math.PI / 3, Math.PI / 6, 0);
    ring2.position.y = 0.95;
    group.add(ring2);

    return group;
  }

  function createRoute(floor: AgentCityFloor): AnimatedRoute | null {
    if (!floor.route) return null;
    const group = new THREE.Group();
    const points = floor.route.points.map((point) => new THREE.Vector3(point.x, point.y + 0.11, point.z));
    const curve = new THREE.CatmullRomCurve3(points);
    const routeAccent = cssColorHex(visualTheme.accent, 0x38bdf8);
    const tubeMaterial = new THREE.MeshStandardMaterial({
      color: routeAccent,
      emissive: routeAccent,
      emissiveIntensity: 0.92 * agentCityRecipeProfile(visualTheme.recipe).emissiveScale,
      transparent: true,
      opacity: visualTheme.recipe === "retro" ? 0.68 : 0.88
    });
    const tube = mesh(new THREE.TubeGeometry(curve, 48, 0.042, 8, false), tubeMaterial);
    tube.castShadow = false;
    group.add(tube);
    const capsuleMaterial = new THREE.MeshStandardMaterial({
      color: mixHex(routeAccent, 0xffffff, 0.88),
      emissive: routeAccent,
      emissiveIntensity: 1.45 * agentCityRecipeProfile(visualTheme.recipe).emissiveScale
    });
    const capsule = mesh(new THREE.SphereGeometry(0.15, 12, 10), capsuleMaterial);
    group.add(capsule);
    cityRoot.add(group);
    return {
      group,
      capsule,
      tubeMaterial,
      capsuleMaterial,
      curve,
      phase: floor.route.phase,
      offset: floor.floorIndex * 0.13 + (typeof floor.buildingIndex === "number" ? floor.buildingIndex * 0.07 : 0)
    };
  }

  function attachFloorTarget(
    parent: THREE.Object3D,
    size: [number, number, number],
    anchorY: number,
    key: string
  ): { target: THREE.Mesh; anchor: THREE.Object3D } {
    const target = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
    );
    target.position.set(0, size[1] / 2, 0);
    target.userData.floorKey = key;
    parent.add(target);
    const anchor = new THREE.Object3D();
    anchor.position.set(0, anchorY, 0);
    parent.add(anchor);
    return { target, anchor };
  }

  function buildFloorNode(floor: AgentCityFloor, variant: number, signature: string): FloorNode {
    const group = new THREE.Group();
    const proceduralShell = new THREE.Group();
    const proceduralDecor = new THREE.Group();
    const assetVisual = new THREE.Group();
    group.add(proceduralShell, proceduralDecor, assetVisual);
    const dark = theme === "dark";
    const isGlobal = floor.kind === "global";
    const palette = floorPalette(variant, dark, visualTheme);
    const accent = isGlobal ? cssColorHex(visualTheme.accent, 0x38bdf8) : palette.accent;

    let statusMaterial: THREE.MeshStandardMaterial;
    let perimeterSize: [number, number, number];
    let perimeterHeight: number;
    let targetSize: [number, number, number];
    let anchorY: number;
    let windows: { group: THREE.Group; material: THREE.MeshStandardMaterial };
    const roomMaterials: THREE.MeshStandardMaterial[] = [];
    const shell = (value: THREE.Mesh): THREE.Mesh => {
      roomMaterials.push(value.material as THREE.MeshStandardMaterial);
      return value;
    };

    if (isGlobal) {
      // Central Holographic Command Core for Primary Agent (Momo HQ)
      const hqProfile = agentCityRecipeProfile(visualTheme.recipe);
      const hqTrim = mixHex(
        cssColorHex(visualTheme.panel, dark ? 0x1b2c3b : 0xcad3d8),
        accent,
        Math.max(0.35, hqProfile.roomAccentMix * 0.85)
      );
      shell(mesh(new THREE.CylinderGeometry(3.5, 3.8, 0.16, 32), material(hqTrim, 0.32, 0.4), 0, 0.04, 0));
      proceduralShell.add(roomMaterials.length ? mesh(new THREE.CylinderGeometry(3.5, 3.8, 0.16, 32), roomMaterials[0], 0, 0.04, 0) : new THREE.Group());
      statusMaterial = new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 0.45,
        roughness: 0.25,
        metalness: 0.3
      });
      const coreGyro = new THREE.Mesh(new THREE.TorusGeometry(2.85, 0.055, 12, 64), statusMaterial);
      coreGyro.rotation.x = Math.PI / 2;
      coreGyro.position.y = 0.18;
      group.add(coreGyro);
      perimeterSize = [5.4, 0.16, 5.4];
      perimeterHeight = 2.4;
      targetSize = [5.8, 2.8, 5.8];
      anchorY = 2.35;
      windows = createWindowPanes(3, 1.35, [0.95, 0.55], 1.15, -2.1);
    } else {
      // Open Hexagonal Tactical Pod (No ugly opaque black roof or closed walls!)
      const podBaseMat = material(palette.trim, 0.34, 0.38);
      const podHex = mesh(new THREE.CylinderGeometry(1.92, 2.1, 0.14, 6), podBaseMat, 0, 0.03, 0);
      roomMaterials.push(podBaseMat);
      proceduralShell.add(podHex);

      // Rear low-profile holographic shield arc
      const shieldMat = new THREE.MeshStandardMaterial({
        color: palette.wall,
        emissive: accent,
        emissiveIntensity: dark ? 0.18 : 0.06,
        roughness: 0.22,
        metalness: 0.2,
        transparent: true,
        opacity: dark ? 0.55 : 0.42
      });
      roomMaterials.push(shieldMat);
      const rearShield = mesh(new THREE.BoxGeometry(2.4, 0.95, 0.06), shieldMat, 0, 0.58, -1.18);
      proceduralShell.add(rearShield);

      statusMaterial = new THREE.MeshStandardMaterial({
        color: 0x7d7d7d,
        emissive: 0x7d7d7d,
        emissiveIntensity: 0.22,
        roughness: 0.3,
        metalness: 0.3
      });
      const statusRing = new THREE.Mesh(new THREE.TorusGeometry(1.86, 0.042, 10, 6), statusMaterial);
      statusRing.rotation.x = Math.PI / 2;
      statusRing.position.y = 0.12;
      group.add(statusRing);
      perimeterSize = [3.3, 0.12, 3.3];
      perimeterHeight = 1.85;
      targetSize = [3.6, 2.15, 3.6];
      anchorY = 1.95;
      windows = createWindowPanes(2, 1.05, [0.75, 0.45], 0.85, -1.12);
    }
    proceduralShell.add(windows.group);

    const renderedWorkers = floor.subagents.instances.slice(0, SUBAGENT_RENDER_LIMIT);
    const decor = createRoomDecor(proceduralDecor, group, isGlobal, dark, accent, variant, renderedWorkers.length > 0, visualTheme);
    const activityMaterials = decor.activityMaterials;
    const celebration = decor.celebration;
    const workerScreens: THREE.MeshStandardMaterial[] = [];

    if (renderedWorkers.length > 0) {
      // Sub-agent Orbital Ring around the parent Agent node!
      const orbitRadius = isGlobal ? 4.25 : 2.65;
      const campSurface = new THREE.MeshStandardMaterial({
        color: mixHex(accent, 0xffffff, 0.35),
        emissive: accent,
        emissiveIntensity: 0.72,
        roughness: 0.25,
        transparent: true,
        opacity: 0.85
      });
      const subOrbitRing = new THREE.Mesh(
        new THREE.TorusGeometry(orbitRadius, 0.032, 10, 48),
        campSurface
      );
      subOrbitRing.rotation.x = Math.PI / 2;
      subOrbitRing.position.y = 0.16;
      group.add(subOrbitRing);
      activityMaterials.push(campSurface);
    }

    // Holographic Tactical Console in front of the Agent
    const workstation = createWorkstation(accent, visualTheme);
    workstation.group.position.set(isGlobal ? 1.15 : 0.68, 0, isGlobal ? 0.15 : 0.05);
    workstation.group.rotation.y = -Math.PI / 2;
    group.add(workstation.group);
    const deskScreen = workstation.screen;
    const perimeter = createWorkingFloorPerimeter(
      perimeterSize,
      perimeterHeight,
      statusMaterial,
      floor.floorIndex * 0.71 + variant,
      cssColorHex(visualTheme.accent, STATUS_COLORS.working),
      mixHex(cssColorHex(visualTheme.accent, STATUS_COLORS.working), 0xffffff, 0.7)
    );
    perimeter.group.visible = false;
    group.add(perimeter.group);

    const mainPug = createPug(false, null);
    mainPug.seed = pugSeed(floor.agent.id);
    if (isGlobal) setRigScale(mainPug, 1.12);
    group.add(mainPug.root);
    attachMomoAsset(mainPug);
    const pugs = [mainPug];
    // Keep idle residents grounded inside their own workstation pod (small step
    // between desk and side lounge) instead of floating across the plaza.
    if (isGlobal) {
      mainPug.ambientTarget = new THREE.Vector3(-0.32, 0.14, 0.36);
    } else if (floor.floorIndex === 0) {
      mainPug.ambientTarget = new THREE.Vector3(-0.18, 0.1, 0.24);
    }

    const seatPosition = isGlobal
      ? new THREE.Vector3(0.25, 0.14, 0.15)
      : new THREE.Vector3(0.05, 0.1, 0.05);
    const loungePosition = isGlobal ? new THREE.Vector3(-0.35, 0.14, 0.35) : new THREE.Vector3(-0.15, 0.1, 0.18);

    // Sub-agents deploy on an outer orbital ring around the parent Agent node
    // with direct radiant neural link beams connecting parent -> sub-agent!
    const orbitRadius = isGlobal ? 4.25 : 2.65;
    const innerRadius = isGlobal ? 1.4 : 0.9;
    const workerPackets: WorkerPacket[] = [];
    const workerAnchors: { id: string; role: string; anchor: THREE.Object3D }[] = [];
    renderedWorkers.forEach((subagent, index) => {
      const count = Math.max(1, renderedWorkers.length);
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * orbitRadius;
      const z = Math.sin(angle) * orbitRadius;
      const assistant = createPug(true, subagent.name);
      assistant.seed = pugSeed(`${floor.agent.id}:${subagent.id}`);
      setRigScale(assistant, isGlobal ? 0.52 : 0.44);
      assistant.spawnEpochMs = performance.timeOrigin + performance.now();
      // Temporary Workers enter through the room portal at the parent core and deploy outward into orbit
      assistant.portalPosition = new THREE.Vector3(0, isGlobal ? 0.22 : 0.12, 0);
      setRigHome(assistant, new THREE.Vector3(x, isGlobal ? 0.22 : 0.12, z), -angle + Math.PI / 2);
      group.add(assistant.root);
      attachMomoAsset(assistant);
      pugs.push(assistant);

      const station = createWorkerStation(accent, subagent.name, visualTheme);
      station.group.position.set(x, isGlobal ? 0.12 : 0.04, z);
      station.group.rotation.y = -angle;
      group.add(station.group);
      workerScreens.push(station.screen);

      // Anchor above each satellite for crisp 3D-projected DOM satellite tags
      const satAnchor = new THREE.Object3D();
      satAnchor.position.set(x, isGlobal ? 1.25 : 1.05, z);
      group.add(satAnchor);
      workerAnchors.push({ id: subagent.id, role: subagent.name, anchor: satAnchor });

      // Radiant Neural Link Tether connecting Parent Pod -> Sub-agent Satellite
      const tetherLength = orbitRadius - innerRadius;
      const tetherMidRadius = (orbitRadius + innerRadius) * 0.5;
      const tetherBeam = mesh(
        new THREE.BoxGeometry(0.045, 0.028, Math.max(0.4, tetherLength)),
        station.screen,
        Math.cos(angle) * tetherMidRadius,
        0.18,
        Math.sin(angle) * tetherMidRadius
      );
      tetherBeam.rotation.y = Math.atan2(Math.cos(angle), Math.sin(angle));
      group.add(tetherBeam);

      // Flowing Energy Packet Capsule along the Parent <-> Sub-agent Tether
      const packetMesh = mesh(
        new THREE.SphereGeometry(0.095, 10, 8),
        station.screen,
        Math.cos(angle) * tetherMidRadius,
        0.22,
        Math.sin(angle) * tetherMidRadius
      );
      packetMesh.castShadow = false;
      group.add(packetMesh);
      workerPackets.push({
        mesh: packetMesh,
        angle,
        innerRadius,
        outerRadius: orbitRadius,
        seed: index * 0.27
      });
    });

    // Vertical Holographic Projection Cone & Floating Tactical Gyroscope above the Pod
    const holoBeamMaterial = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.95,
      roughness: 0.2,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    const holoBeam = mesh(
      new THREE.ConeGeometry(isGlobal ? 1.55 : 1.05, isGlobal ? 1.95 : 1.45, 24, 1, true),
      holoBeamMaterial,
      0,
      isGlobal ? 1.15 : 0.88,
      0
    );
    holoBeam.rotation.x = Math.PI;
    holoBeam.castShadow = false;
    holoBeam.receiveShadow = false;
    holoBeam.visible = false;
    group.add(holoBeam);

    const holoCore = mesh(
      new THREE.OctahedronGeometry(isGlobal ? 0.22 : 0.15, 0),
      statusMaterial,
      0,
      isGlobal ? 1.68 : 1.32,
      0
    );
    holoCore.castShadow = false;
    group.add(holoCore);

    const holoRing1 = new THREE.Mesh(
      new THREE.TorusGeometry(isGlobal ? 1.35 : 0.92, 0.018, 8, 48),
      statusMaterial
    );
    holoRing1.rotation.x = Math.PI / 2;
    holoRing1.position.y = isGlobal ? 0.42 : 0.34;
    group.add(holoRing1);

    const holoRing2 = new THREE.Mesh(
      new THREE.TorusGeometry(isGlobal ? 0.65 : 0.46, 0.016, 8, 36),
      statusMaterial
    );
    holoRing2.rotation.x = Math.PI / 3;
    holoRing2.position.y = isGlobal ? 1.68 : 1.32;
    group.add(holoRing2);
    const holoRings = [holoRing1, holoRing2];

    let overflowStudio: THREE.Object3D | null = null;
    if (floor.subagents.instances.length > SUBAGENT_RENDER_LIMIT) {
      overflowStudio = addBox(
        group,
        isGlobal ? [1.15, 0.34, 0.58] : [0.72, 0.36, 0.44],
        accent,
        isGlobal ? [-2.55, 0.3, 1.35] : [-1.35, 0.32, 0.52]
      );
      const surface = (overflowStudio as THREE.Mesh).material as THREE.MeshStandardMaterial;
      surface.emissive.setHex(accent);
      surface.emissiveIntensity = 0.18;
    }

    const beaconColor = themedStatusColor("error", visualTheme);
    const beaconMaterial = new THREE.MeshStandardMaterial({ color: beaconColor, emissive: beaconColor, emissiveIntensity: 0.72 });
    const beacon = mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.22, 12), beaconMaterial, isGlobal ? -2.3 : -1.45, isGlobal ? 2.6 : 1.72, -0.92);
    beacon.visible = false;
    group.add(beacon);

    const { target, anchor } = attachFloorTarget(group, targetSize, anchorY, floor.key);
    const selectionMaterial = new THREE.LineBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.82,
      depthTest: false
    });
    const selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(targetSize[0] + 0.18, 0.08, targetSize[2] + 0.18)),
      selectionMaterial
    );
    selection.position.y = 0.12;
    selection.visible = selectedKey === floor.key;
    selection.renderOrder = 5;
    group.add(selection);
    group.position.set(floor.position.x, isGlobal ? 0 : floor.floorIndex * FLOOR_HEIGHT, floor.position.z);
    cityRoot.add(group);

    return {
      key: floor.key,
      group,
      signature,
      status: null,
      pugs,
      mainPug,
      statusMaterial,
      deskScreen,
      deskAccent: accent,
      perimeter,
      beacon,
      overflowStudio,
      route: createRoute(floor),
      anchor,
      target,
      seatPosition,
      loungePosition,
      windowMaterial: windows.material,
      roomMaterials,
      activityMaterials,
      workerScreens,
      workerPackets,
      workerAnchors,
      holoBeam,
      holoBeamMaterial,
      holoCore,
      holoRings,
      celebration,
      proceduralShell,
      proceduralDecor,
      assetVisual,
      assetWindowMaterials: [],
      selection,
      selectionMaterial,
      windowBase: 0,
      windowFlicker: 0,
      glowPhase: (pugSeed(floor.key) % 628) / 100
    };
  }

  /**
   * Window brightness. Daylight leaves the panes as plain glass; at night a
   * working room burns bright, an idle one keeps a low lamp on, and a disabled
   * agent's room goes dark.
   */
  function applyWindowGlow(node: FloorNode, status: AgentCityStatus): void {
    const night = theme === "dark";
    if (status === "disabled") {
      node.windowBase = night ? 0 : 0.02;
      node.windowFlicker = 0;
    } else if (status === "working") {
      node.windowBase = night ? 0.88 : 0.14;
      node.windowFlicker = night ? 0.045 : 0.012;
    } else if (status === "error") {
      node.windowBase = night ? 0.48 : 0.1;
      node.windowFlicker = night ? 0.1 : 0.018;
    } else {
      node.windowBase = night ? 0.28 : 0.05;
      node.windowFlicker = night ? 0.012 : 0;
    }
    const tint = status === "error"
      ? mixHex(cssColorHex(visualTheme.danger, 0xff9a86), 0xffffff, 0.32)
      : mixHex(cssColorHex(visualTheme.warning, 0xffc96b), 0xffffff, 0.46);
    node.windowMaterial.emissive.setHex(tint);
    node.windowMaterial.emissiveIntensity = node.windowBase;
    for (const surface of node.assetWindowMaterials) {
      surface.emissive.setHex(tint);
      surface.emissiveIntensity = node.windowBase;
    }
    for (const surface of node.roomMaterials) {
      surface.emissive.setHex(tint);
      surface.emissiveIntensity = node.windowBase * (night ? 0.22 : 0.05);
    }
  }

  function applyFloorState(node: FloorNode, floor: AgentCityFloor): void {
    const previous = node.status;
    const stateChanged = previous !== floor.state;
    const statusColor = themedStatusColor(floor.state, visualTheme);
    node.statusMaterial.color.setHex(statusColor);
    node.statusMaterial.emissive.setHex(statusColor);
    node.statusMaterial.emissiveIntensity =
      floor.state === "idle" || floor.state === "disabled" ? 0.05 : floor.kind === "global" && floor.state !== "working" ? 0.18 : 0.48;

    const working = floor.state === "working";
    node.deskScreen.color.setHex(working ? node.deskAccent : 0x52616b);
    if (stateChanged) node.deskScreen.emissiveIntensity = working ? 0.75 : 0;
    if (node.perimeter) node.perimeter.group.visible = floor.animation === "working";
    if (node.beacon) node.beacon.visible = floor.state === "error";
    if (node.celebration) node.celebration.visible = floor.state === "completed";
    node.holoBeam.visible = floor.state === "working" || floor.state === "error" || floor.state === "completed";
    node.holoBeamMaterial.color.setHex(statusColor);
    node.holoBeamMaterial.emissive.setHex(statusColor);
    node.holoCore.visible = floor.state !== "disabled";
    const roomAccent =
      floor.state === "working" ? node.deskAccent :
      floor.state === "completed" ? themedStatusColor("completed", visualTheme) :
      floor.state === "error" ? themedStatusColor("error", visualTheme) :
      cssColorHex(visualTheme.warning, 0xffc96b);
    for (const surface of node.activityMaterials) {
      surface.emissive.setHex(roomAccent);
      if (stateChanged) {
        surface.emissiveIntensity =
          floor.state === "working" ? 0.48 :
          floor.state === "completed" ? 0.36 :
          floor.state === "error" ? 0.62 :
          floor.state === "disabled" ? 0.02 : 0.12;
      }
    }
    if (stateChanged) applyWindowGlow(node, floor.state);

    const seat = working ? node.seatPosition : node.loungePosition;
    setRigHome(node.mainPug, seat, working ? Math.PI / 2 : 0.35);
    setPugStatus(node.mainPug, floor.state);
    floor.subagents.instances.slice(0, SUBAGENT_RENDER_LIMIT).forEach((subagent, index) => {
      const rig = node.pugs[index + 1];
      const previousWorkerStatus = rig?.status ?? null;
      const workerStatusChanged = previousWorkerStatus !== subagent.status;
      if (rig) {
        const workerReaction = transitionClip(previousWorkerStatus, subagent.status);
        if (workerReaction) rig.oneShot = { clip: workerReaction, startedAt: performance.now() };
        if (previousWorkerStatus === "working" && subagent.status !== "working" && rig.workerExitStartedAt === null) {
          rig.workerExitStartedAt = performance.now() + 900;
        } else if (subagent.status === "working") {
          rig.workerExitStartedAt = null;
          rig.root.visible = true;
        }
        setPugStatus(rig, subagent.status);
      }
      const screen = node.workerScreens[index];
      if (screen) {
        const color =
          subagent.status === "working" ? roleColor(subagent.name) :
          subagent.status === "completed" ? themedStatusColor("completed", visualTheme) :
          themedStatusColor("error", visualTheme);
        screen.color.setHex(color);
        screen.emissive.setHex(color);
        if (workerStatusChanged || stateChanged) {
          screen.emissiveIntensity = subagent.status === "working" ? 0.9 : 0.48;
        }
      }
    });

    if (node.route && floor.route) {
      const color = floor.route.phase === "failed"
        ? themedStatusColor("error", visualTheme)
        : floor.route.phase === "returning"
          ? themedStatusColor("completed", visualTheme)
          : themedStatusColor("working", visualTheme);
      node.route.phase = floor.route.phase;
      node.route.tubeMaterial.color.setHex(color);
      node.route.tubeMaterial.emissive.setHex(color);
      node.route.capsuleMaterial.emissive.setHex(color);
    }

    const reaction = transitionClip(previous, floor.state);
    if (reaction) node.mainPug.oneShot = { clip: reaction, startedAt: performance.now() };
    node.status = floor.state;
  }

  function disposeFloorNode(node: FloorNode): void {
    for (const rig of node.pugs) detachMomoAsset(rig);
    for (const child of [...node.assetVisual.children]) {
      node.assetVisual.remove(child);
      disposeCommunityComponent(child);
    }
    cityRoot.remove(node.group);
    disposeObject(node.group);
    if (node.route) {
      cityRoot.remove(node.route.group);
      disposeObject(node.route.group);
    }
  }

  /**
   * Incremental sync: rooms are rebuilt only when their geometry signature
   * changes. Status-only updates repaint in place so animations, the camera and
   * any active focus survive the activity poll.
   */
  function syncProjection(): void {
    const floors: { floor: AgentCityFloor; variant: number }[] = [
      { floor: projection.globalFloor, variant: 0 }
    ];
    for (const building of projection.buildings) {
      for (const floor of building.floors) floors.push({ floor, variant: building.variant });
    }

    const seen = new Set<string>();
    for (const { floor, variant } of floors) {
      seen.add(floor.key);
      const signature = agentCityFloorSignature(floor, variant, theme);
      let node = floorNodes.get(floor.key);
      if (node && node.signature !== signature) {
        disposeFloorNode(node);
        floorNodes.delete(floor.key);
        node = undefined;
      }
      if (!node) {
        node = buildFloorNode(floor, variant, signature);
        floorNodes.set(floor.key, node);
        if (communityKit) {
          const dark = theme === "dark";
          const accent = floor.kind === "global"
            ? cssColorHex(visualTheme.accent, 0x006bff)
            : floorPalette(variant, dark, visualTheme).accent;
          attachCommunityKit(node, floor.kind === "global", dark, accent, floor.subagents.instances.length > 0);
        }
      }
      applyFloorState(node, floor);
    }

    for (const [key, node] of [...floorNodes]) {
      if (seen.has(key)) continue;
      disposeFloorNode(node);
      floorNodes.delete(key);
      if (focusedKey === key) focusedKey = null;
      if (selectedKey === key) selectedKey = null;
    }

    bounds = agentCityBounds(projection.sceneFloors);
    controls.target.copy(clampCameraTargetVector(controls.target));
    if (!userAdjusted && projection.sceneFloors !== lastSceneFloors) applyOverview(true);
    lastSceneFloors = projection.sceneFloors;
    syncFollowTarget();
  }

  function clampCameraTargetVector(value: THREE.Vector3): THREE.Vector3 {
    const clamped = clampCameraTarget({ x: value.x, y: value.y, z: value.z }, bounds);
    return new THREE.Vector3(clamped.x, clamped.y, clamped.z);
  }

  function applyOverview(immediate: boolean): void {
    const framing = overviewFraming(projection.sceneFloors);
    const position = new THREE.Vector3(framing.position.x, framing.position.y, framing.position.z);
    const target = new THREE.Vector3(framing.target.x, framing.target.y, framing.target.z);
    if (immediate || reducedMotion) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      tween = null;
    } else {
      startTween(position, target);
    }
  }

  function startTween(position: THREE.Vector3, target: THREE.Vector3): void {
    if (reducedMotion) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      tween = null;
      publishView();
      return;
    }
    tween = {
      fromPosition: camera.position.clone(),
      toPosition: position,
      fromTarget: controls.target.clone(),
      toTarget: target,
      startedAt: performance.now()
    };
  }

  function flyToFloor(key: string): boolean {
    if (!floorNodes.has(key)) return false;
    const floor = agentCityFloors(projection).find((item) => item.key === key);
    if (!floor) return false;
    const framing = floorFocusFraming(floor.position, floor.kind === "global" ? 0 : floor.floorIndex, floor.kind);
    focusedKey = key;
    userAdjusted = true;
    startTween(
      new THREE.Vector3(framing.position.x, framing.position.y, framing.position.z),
      new THREE.Vector3(framing.target.x, framing.target.y, framing.target.z)
    );
    publishView();
    return true;
  }

  /**
   * Follow mode re-frames only when the agent worth watching *changes*. Flying
   * on every poll would fight a user who is panning around while it is on.
   */
  function syncFollowTarget(): void {
    if (!followWorking) return;
    const next = selectFollowFloorKey(projection, followKey);
    if (!next || next === followKey) return;
    followKey = next;
    flyToFloor(next);
  }

  function hoverAt(clientX: number, clientY: number): AgentCityHover | null {
    if (disposed || width <= 1 || height <= 1) return null;
    const boundsRect = options.canvas.getBoundingClientRect();
    if (!boundsRect.width || !boundsRect.height) return null;
    pointer.set(
      ((clientX - boundsRect.left) / boundsRect.width) * 2 - 1,
      -((clientY - boundsRect.top) / boundsRect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const targets = [...floorNodes.values()].map((node) => node.target);
    const hit = raycaster.intersectObjects(targets, false)[0]?.object;
    const key = typeof hit?.userData.floorKey === "string" ? hit.userData.floorKey : null;
    if (!key) return null;
    const anchor = anchorFor(key);
    return anchor ? { key, x: anchor.x, y: anchor.y } : null;
  }

  function anchorFor(key: string): { x: number; y: number } | null {
    const node = floorNodes.get(key);
    if (!node) return null;
    const projected = node.anchor.getWorldPosition(anchorWorldPosition).project(camera);
    if (projected.z < -1 || projected.z > 1) return null;
    return { x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height };
  }

  let lastHudSnapshot = "";

  function publishHudCoords(force = false): void {
    if (!options.onHudUpdate || width <= 1 || height <= 1) return;
    camera.updateMatrixWorld();
    const anchors: Record<string, { x: number; y: number; visible: boolean; depth: number }> = {};
    const satellites: Record<string, AgentCitySatelliteHudCoord[]> = {};
    let snapshot = "";
    for (const [key, node] of floorNodes) {
      const projected = node.anchor.getWorldPosition(anchorWorldPosition).project(camera);
      const visible =
        projected.z >= -1 &&
        projected.z <= 1 &&
        projected.x >= -1.08 &&
        projected.x <= 1.08 &&
        projected.y >= -1.08 &&
        projected.y <= 1.08;
      const x = Math.round((projected.x * 0.5 + 0.5) * width * 2) / 2;
      const y = Math.round((-projected.y * 0.5 + 0.5) * height * 2) / 2;
      const depth = Math.round(projected.z * 1000) / 1000;
      anchors[key] = { x, y, visible, depth };
      snapshot += `${key}:${x},${y},${visible ? 1 : 0};`;
      if (node.workerAnchors.length > 0) {
        const list: AgentCitySatelliteHudCoord[] = [];
        node.workerAnchors.forEach((sat, index) => {
          const rig = node.pugs[index + 1];
          const satProj = sat.anchor.getWorldPosition(anchorWorldPosition).project(camera);
          const satVisible =
            satProj.z >= -1 &&
            satProj.z <= 1 &&
            satProj.x >= -1.08 &&
            satProj.x <= 1.08 &&
            satProj.y >= -1.08 &&
            satProj.y <= 1.08 &&
            (rig ? rig.root.visible : true);
          const rawStatus = rig?.status;
          const satStatus: "working" | "completed" | "error" =
            rawStatus === "completed" ? "completed" : rawStatus === "error" ? "error" : "working";
          const sx = Math.round((satProj.x * 0.5 + 0.5) * width * 2) / 2;
          const sy = Math.round((-satProj.y * 0.5 + 0.5) * height * 2) / 2;
          list.push({
            id: sat.id,
            role: sat.role,
            status: satStatus,
            x: sx,
            y: sy,
            visible: satVisible
          });
          snapshot += `s:${sat.id}:${sx},${sy},${satVisible ? 1 : 0},${satStatus};`;
        });
        satellites[key] = list;
      }
    }
    const ownerPos = anchorWorldPosition.set(
      projection.owner.position.x,
      projection.owner.position.y + 1.65,
      projection.owner.position.z
    ).project(camera);
    const ownerVisible = ownerPos.z >= -1 && ownerPos.z <= 1;
    const ox = Math.round((ownerPos.x * 0.5 + 0.5) * width * 2) / 2;
    const oy = Math.round((-ownerPos.y * 0.5 + 0.5) * height * 2) / 2;
    snapshot += `o:${ox},${oy},${ownerVisible ? 1 : 0}`;
    if (!force && snapshot === lastHudSnapshot) return;
    lastHudSnapshot = snapshot;
    options.onHudUpdate({
      anchors,
      satellites,
      owner: {
        x: ox,
        y: oy,
        visible: ownerVisible
      }
    });
  }

  function updateCamera(): void {
    camera.aspect = Math.max(0.4, width / Math.max(1, height));
    camera.updateProjectionMatrix();
  }

  function motionFor(rig: PugRig, timeMs: number): { clip: PugClip; pose: PugPose; oneShot: boolean } {
    if (rig.oneShot) {
      const duration = ONE_SHOT_CLIP_DURATION_MS[rig.oneShot.clip as "cheer" | "panic" | "greet"] ?? 1600;
      const elapsed = timeMs - rig.oneShot.startedAt;
      if (elapsed < duration) {
        return {
          clip: rig.oneShot.clip,
          pose: pugPose(rig.oneShot.clip, elapsed / 1000, rig.seed),
          oneShot: true
        };
      }
      rig.oneShot = null;
    }
    const clips = clipsForStatus(rig.status, rig.role);
    const scheduled = scheduledClip(clips, rig.seed, timeMs, clipDurationForStatus(rig.status));
    return {
      clip: scheduled.clip,
      pose: pugPose(scheduled.clip, scheduled.localTime, rig.seed),
      oneShot: false
    };
  }

  function animatePugs(timeMs: number, detailed: boolean, deltaSeconds: number): void {
    camera.getWorldPosition(cameraWorldPosition);
    for (const node of floorNodes.values()) {
      const showProps = detailed || node.key === "global" || focusedKey === node.key;
      for (const rig of node.pugs) {
        rig.travelOffset.set(0, 0, 0);
        rig.root.visible = true;

        // Temporary Workers enter through the room portal, walk to their pod,
        // react to completion/error, then visibly leave instead of teleporting.
        let lifecycleClip: PugClip | null = null;
        if (rig.isWorker && rig.portalPosition) {
          const portalDelta = rig.portalPosition.clone().sub(rig.homePosition);
          if (rig.spawnEpochMs !== null) {
            const elapsed = performance.timeOrigin + timeMs - rig.spawnEpochMs;
            const progress = Math.min(1, Math.max(0, elapsed / 1100));
            if (progress < 1 && !reducedMotion) {
              const eased = 1 - (1 - progress) ** 3;
              rig.travelOffset.copy(portalDelta).multiplyScalar(1 - eased);
              lifecycleClip = "pace";
            }
          }
          if (rig.workerExitStartedAt !== null && timeMs >= rig.workerExitStartedAt) {
            const progress = Math.min(1, (timeMs - rig.workerExitStartedAt) / 1350);
            if (reducedMotion) {
              rig.root.visible = false;
            } else {
              const eased = progress * progress * (3 - 2 * progress);
              rig.travelOffset.copy(portalDelta).multiplyScalar(eased);
              lifecycleClip = "pace";
              if (progress >= 1) rig.root.visible = false;
            }
          }
        }

        // Idle ground-floor residents stay grounded at their own pod instead of
        // floating off-platform: occasionally turn slightly toward their coffee
        // spot for a brief break, then return to their workstation (no shared plaza meetup drift).
        let ambientClip: PugClip | null = null;
        if (!rig.isWorker && rig.status === "idle" && rig.ambientTarget && !reducedMotion) {
          const cycle = 44_000;
          const phase = (timeMs + (rig.seed % 12) * 3100) % cycle;
          const targetDelta = rig.ambientTarget.clone().sub(rig.homePosition);
          if (phase < 3000) {
            const p = phase / 3000;
            rig.travelOffset.copy(targetDelta).multiplyScalar(p * p * (3 - 2 * p));
            ambientClip = "coffee";
          } else if (phase < 11_000) {
            rig.travelOffset.copy(targetDelta);
            ambientClip = phase < 7000 ? "reading" : "coffee";
          } else if (phase < 14_000) {
            const p = (phase - 11_000) / 3000;
            rig.travelOffset.copy(targetDelta).multiplyScalar(1 - p * p * (3 - 2 * p));
            ambientClip = "lookAround";
          }
        }
        if (rig.spawnEpochMs !== null) {
          const elapsed = performance.timeOrigin + timeMs - rig.spawnEpochMs;
          const progress = Math.min(1, Math.max(0, elapsed / 720));
          const eased = reducedMotion ? 1 : 1 - (1 - progress) ** 3;
          rig.root.scale.setScalar(rig.baseScale * Math.max(0.08, eased));
        } else {
          rig.root.scale.setScalar(rig.baseScale);
        }
        const motion = reducedMotion && !rig.oneShot
          ? { clip: clipsForStatus(rig.status, rig.role)[0] ?? "off" as PugClip, pose: staticPoseFor(rig), oneShot: false }
          : motionFor(rig, timeMs);
        if (lifecycleClip || ambientClip) {
          motion.clip = lifecycleClip ?? ambientClip ?? motion.clip;
          motion.pose = pugPose(motion.clip, timeMs / 1000, rig.seed);
        }
        // Keep GLTF residents seated cleanly at their workstation: replace
        // chaotic rolling or lateral pacing with purposeful reading/coffee clips.
        if (rig.asset && !rig.oneShot && (motion.clip === "roll" || motion.clip === "pace")) {
          motion.clip = rig.seed % 2 === 0 ? "reading" : "coffee";
          motion.pose = pugPose(motion.clip, timeMs / 1000, rig.seed);
        }
        // While greeting, the pug turns to look straight at the viewer.
        const greeting = motion.oneShot && rig.oneShot?.clip === "greet";
        rig.faceCamera += ((greeting ? 1 : 0) - rig.faceCamera) * 0.18;
        let yaw = 0;
        if (rig.faceCamera > 0.01) {
          rig.root.getWorldPosition(floorWorldPosition);
          const desired =
            Math.atan2(cameraWorldPosition.x - floorWorldPosition.x, cameraWorldPosition.z - floorWorldPosition.z) -
            rig.root.rotation.y;
          yaw = desired * rig.faceCamera;
        }

        if (rig.asset) {
          // GLTF clips animate in-place; zero out procedural lateral travel so
          // the character never slides across the floor like it is floating.
          const groundedPose = { ...motion.pose, travelX: 0, travelZ: 0, travelYaw: 0 };
          applyRigTravel(rig, groundedPose, yaw);
          applyPugProp(rig, groundedPose, showProps);
          playMomoAnimation(rig.asset, momoAnimationName(motion.clip), reducedMotion ? 0 : 0.16);
          if (rig.asset.currentAction) rig.asset.currentAction.paused = reducedMotion;
          if (reducedMotion && rig.asset.currentAction) rig.asset.currentAction.time = 0.28;
          else rig.asset.mixer.update(deltaSeconds);
          continue;
        }
        applyPugPose(rig, motion.pose, yaw, showProps);
      }
    }
  }

  function staticPoseFor(rig: PugRig): PugPose {
    const clips = clipsForStatus(rig.status, rig.role);
    const scheduled = scheduledClip(clips, rig.seed, 0, clipDurationForStatus(rig.status));
    const pose = pugPose(scheduled.clip, 0.35, rig.seed);
    pose.tailWag = 0;
    return pose;
  }

  function animate(time: number): void {
    if (disposed || !visible) return;
    if (quality === "low" && time - lastRenderedAt < 1000 / 30) {
      animationFrame = requestAnimationFrame(animate);
      return;
    }
    const delta = Math.min(100, time - lastFrame);
    lastFrame = time;
    lastRenderedAt = time;

    if (tween) {
      // The tween owns the camera outright; OrbitControls' damping would fight
      // it and leave the fly-to short of the framing it was given.
      const progress = Math.min(1, (time - tween.startedAt) / CAMERA_TWEEN_MS);
      const eased = cameraTweenEase(progress);
      camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
      camera.lookAt(controls.target);
      if (progress >= 1) {
        tween = null;
        controls.update();
        publishView();
      }
    } else {
      controls.update();
    }

    const distance = camera.position.distanceTo(controls.target);
    const detailed = distance <= AGENT_CITY_DETAIL_DISTANCE;

    animatePugs(time, detailed, delta / 1000);

    if (!reducedMotion) {
      for (const node of floorNodes.values()) {
        // At overview distance a very small pulse makes activity legible. In a
        // close-up it reads as the whole room flashing, especially on large
        // emissive GLTF windows, so detailed/focused views become steady.
        const steadyCloseUp = detailed || focusedKey === node.key;
        if (node.windowFlicker > 0) {
          const windowGlow = steadyCloseUp
            ? node.windowBase
            : node.windowBase + Math.sin(time * 0.0018 + node.glowPhase) * node.windowFlicker;
          node.windowMaterial.emissiveIntensity = windowGlow;
          for (const surface of node.assetWindowMaterials) surface.emissiveIntensity = windowGlow;
        }
        if (node.status === "working") {
          const roomPulse = steadyCloseUp ? 0.48 : 0.46 + Math.sin(time * 0.0022 + node.glowPhase) * 0.035;
          for (const surface of node.activityMaterials) surface.emissiveIntensity = roomPulse;
          node.deskScreen.emissiveIntensity = steadyCloseUp ? 0.76 : 0.76 + Math.sin(time * 0.003 + node.glowPhase) * 0.045;
        } else if (node.status === "error") {
          const alertPulse = steadyCloseUp ? 0.58 : 0.54 + Math.sin(time * 0.0035 + node.glowPhase) * 0.08;
          for (const surface of node.activityMaterials) surface.emissiveIntensity = alertPulse;
        }
        node.workerScreens.forEach((surface, index) => {
          const rig = node.pugs[index + 1];
          if (!rig) return;
          if (rig.status === "working") {
            surface.emissiveIntensity = steadyCloseUp ? 0.82 : 0.82 + Math.sin(time * 0.0032 + rig.seed) * 0.06;
          } else if (rig.status === "error") {
            surface.emissiveIntensity = steadyCloseUp ? 0.62 : 0.62 + Math.sin(time * 0.004 + rig.seed) * 0.09;
          }
        });
        node.workerPackets.forEach((packet, index) => {
          const rig = node.pugs[index + 1];
          if (!rig || !rig.root.visible) {
            packet.mesh.visible = false;
            return;
          }
          packet.mesh.visible = true;
          const returning = rig.status === "completed";
          const speed = rig.status === "error" ? 0.00045 : 0.00075;
          const rawProgress = ((time * speed + packet.seed) % 1 + 1) % 1;
          const t = returning ? 1 - rawProgress : rawProgress;
          const radius = packet.innerRadius + (packet.outerRadius - packet.innerRadius) * t;
          packet.mesh.position.set(
            Math.cos(packet.angle) * radius,
            0.2 + Math.sin(t * Math.PI) * 0.14,
            Math.sin(packet.angle) * radius
          );
        });
        const spinSpeed = node.status === "working" ? 0.0024 : node.status === "error" ? 0.0036 : 0.00055;
        node.holoCore.rotation.y = time * spinSpeed + node.glowPhase;
        node.holoCore.rotation.x = Math.sin(time * 0.0015 + node.glowPhase) * 0.35;
        if (node.holoRings[0]) {
          node.holoRings[0].rotation.z = time * spinSpeed * 0.8 + node.glowPhase;
        }
        if (node.holoRings[1]) {
          node.holoRings[1].rotation.y = -time * spinSpeed * 1.3 + node.glowPhase;
          node.holoRings[1].rotation.z = Math.sin(time * 0.002 + node.glowPhase) * 0.4;
        }
        if (node.holoBeam.visible) {
          node.holoBeamMaterial.opacity = steadyCloseUp
            ? 0.12
            : 0.13 + Math.sin(time * 0.003 + node.glowPhase) * 0.04;
        }
        const route = node.route;
        if (route && route.group.visible) {
          const direction = route.phase === "returning" ? -1 : 1;
          const progress = ((time * 0.00018 * direction + route.offset) % 1 + 1) % 1;
          route.curve.getPoint(progress, route.capsule.position);
        }
        const perimeter = node.perimeter;
        if (perimeter && perimeter.group.visible) {
          if (steadyCloseUp) {
            perimeter.material.opacity = 0.54;
            moveMarquee(perimeter, 0);
            perimeter.emissive.emissiveIntensity = 0.86;
          } else {
            const pulse = 0.7 + Math.sin(time * 0.003 + perimeter.phase) * 0.1;
            perimeter.material.opacity = 0.4 + pulse * 0.1;
            moveMarquee(perimeter, -((time * 0.0028 + perimeter.phase) % perimeter.length));
            perimeter.emissive.emissiveIntensity = 0.72 + pulse * 0.2;
          }
        }
        if (node.selection.visible) {
          node.selectionMaterial.opacity = steadyCloseUp
            ? 0.78
            : 0.72 + Math.sin(time * 0.0025 + node.glowPhase) * 0.05;
        }
        if (node.celebration?.visible) {
          node.celebration.rotation.y = time * 0.0014 + node.glowPhase;
          node.celebration.position.y = 0.08 + Math.sin(time * 0.004 + node.glowPhase) * 0.08;
          for (let index = 0; index < node.celebration.children.length; index += 1) {
            node.celebration.children[index].position.y =
              0.9 + (index % 2) * 0.3 + Math.sin(time * 0.006 + index) * 0.14;
          }
        }
      }
    } else {
      for (const node of floorNodes.values()) {
        node.windowMaterial.emissiveIntensity = node.windowBase;
        for (const surface of node.assetWindowMaterials) surface.emissiveIntensity = node.windowBase;
        const perimeter = node.perimeter;
        if (!perimeter || !perimeter.group.visible) continue;
        perimeter.material.opacity = 0.62;
        moveMarquee(perimeter, 0);
        perimeter.emissive.emissiveIntensity = 0.96;
      }
    }

    renderer.render(scene, camera);
    publishHudCoords();
    const sampleTarget = quality === "full" ? 180 : 90;
    if (frameSamples.length < sampleTarget) {
      if (delta > 0) frameSamples.push(delta);
      if (frameSamples.length === sampleTarget) {
        const average = frameSamples.reduce((sum, value) => sum + value, 0) / frameSamples.length;
        if (average > (quality === "full" ? 42 : 70)) options.onPerformanceFallback();
        frameSamples = [];
      }
    }
    animationFrame = requestAnimationFrame(animate);
  }

  function handleContextLost(event: Event): void {
    event.preventDefault();
    options.onContextLost();
  }

  function handleControlStart(): void {
    userAdjusted = true;
    tween = null;
    if (focusedKey) {
      focusedKey = null;
      publishView();
    }
  }

  function handleControlChange(): void {
    const clamped = clampCameraTarget(
      { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      bounds
    );
    controls.target.set(clamped.x, clamped.y, clamped.z);
  }

  options.canvas.addEventListener("webglcontextlost", handleContextLost, false);
  controls.addEventListener("start", handleControlStart);
  controls.addEventListener("change", handleControlChange);
  applyTheme();
  buildStaticScenery();
  syncProjection();
  void hydrateMomoAssets();
  void hydrateCommunityAssets();
  applyOverview(true);
  lastSceneFloors = projection.sceneFloors;
  publishView();
  animationFrame = requestAnimationFrame(animate);

  return {
    update(nextProjection) {
      projection = nextProjection;
      syncProjection();
      void hydrateCommunityAssets();
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      renderer.setSize(width, height, false);
      updateCamera();
      renderer.render(scene, camera);
      publishHudCoords(true);
    },
    setVisible(nextVisible) {
      if (visible === nextVisible) return;
      visible = nextVisible;
      lastFrame = performance.now();
      lastRenderedAt = lastFrame;
      if (visible) {
        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(animate);
      }
    },
    setTheme(nextTheme) {
      if (theme === nextTheme) return;
      theme = nextTheme;
      applyTheme();
      buildStaticScenery();
      // Palettes are baked into the room meshes, so a theme flip is structural.
      for (const [key, node] of [...floorNodes]) {
        disposeFloorNode(node);
        floorNodes.delete(key);
      }
      syncProjection();
    },
    setSky(nextSky) {
      const next = new THREE.Color(nextSky);
      if (next.equals(skyColor)) return;
      skyColor = next;
      // applyTheme also keeps recipe-specific fog/exposure in sync.
      applyTheme();
      renderer.render(scene, camera);
    },
    setVisualTheme(nextVisualTheme) {
      const nextSignature = agentCityVisualThemeSignature(nextVisualTheme);
      if (nextSignature === visualThemeSignature) return;
      visualTheme = nextVisualTheme;
      visualThemeSignature = nextSignature;
      if (momoTemplate) applyMomoTheme(momoTemplate.scene);
      applyTheme();
      buildStaticScenery();
      // Family colours are baked into room/GLTF material clones. Rebuild only
      // on a theme-token change; ordinary activity polling remains incremental.
      for (const [key, node] of [...floorNodes]) {
        disposeFloorNode(node);
        floorNodes.delete(key);
      }
      syncProjection();
      renderer.render(scene, camera);
    },
    setReducedMotion(nextReducedMotion) {
      reducedMotion = nextReducedMotion;
      if (!reducedMotion) return;
      tween = null;
      for (const node of floorNodes.values()) {
        const perimeter = node.perimeter;
        if (!perimeter || !perimeter.group.visible) continue;
        perimeter.material.opacity = 0.62;
        moveMarquee(perimeter, 0);
        perimeter.emissive.emissiveIntensity = 0.96;
      }
    },
    setQuality(nextQuality) {
      if (quality === nextQuality) return;
      quality = nextQuality;
      frameSamples = [];
      if (quality === "low") {
        for (const node of floorNodes.values()) {
          for (const rig of node.pugs) if (rig.isWorker) detachMomoAsset(rig);
        }
      } else if (momoTemplate) {
        for (const node of floorNodes.values()) {
          for (const rig of node.pugs) attachMomoAsset(rig);
        }
      }
      applyQuality();
      renderer.render(scene, camera);
    },
    hitTest(clientX, clientY) {
      return hoverAt(clientX, clientY);
    },
    greetAt(clientX, clientY) {
      const hover = hoverAt(clientX, clientY);
      if (!hover) return null;
      const node = floorNodes.get(hover.key);
      if (node && node.status !== "disabled") {
        node.mainPug.oneShot = { clip: "greet", startedAt: performance.now() };
      }
      return hover;
    },
    focusFloor(key) {
      return flyToFloor(key);
    },
    setFollowWorking(enabled) {
      if (followWorking === enabled) return;
      followWorking = enabled;
      followKey = null;
      if (enabled) syncFollowTarget();
      publishView();
    },
    clearFocus() {
      if (!focusedKey) return;
      focusedKey = null;
      publishView();
    },
    setSelectedFloor(key) {
      if (selectedKey === key) return;
      selectedKey = key;
      for (const node of floorNodes.values()) {
        node.selection.visible = node.key === selectedKey;
        if (reducedMotion && node.selection.visible) node.selectionMaterial.opacity = 0.82;
      }
      renderer.render(scene, camera);
    },
    zoom(direction) {
      const current = camera.position.distanceTo(controls.target);
      const next = zoomedDistance(current, direction);
      const offsetVector = camera.position.clone().sub(controls.target).setLength(next);
      userAdjusted = true;
      startTween(controls.target.clone().add(offsetVector), controls.target.clone());
      publishView();
    },
    resetView() {
      focusedKey = null;
      userAdjusted = false;
      applyOverview(false);
      publishView();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(animationFrame);
      options.canvas.removeEventListener("webglcontextlost", handleContextLost, false);
      controls.removeEventListener("start", handleControlStart);
      controls.removeEventListener("change", handleControlChange);
      controls.dispose();
      for (const node of floorNodes.values()) disposeFloorNode(node);
      floorNodes.clear();
      disposeObject(cityRoot);
      cityRoot.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
}
