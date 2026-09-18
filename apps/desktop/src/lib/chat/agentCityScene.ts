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
  reducedMotion: boolean;
  quality: Exclude<AgentCityQuality, "fallback">;
  onPerformanceFallback: () => void;
  onContextLost: () => void;
  onViewChange?: (view: AgentCityViewState) => void;
}

export interface AgentCitySceneController {
  update(projection: AgentCityProjection): void;
  resize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  setTheme(theme: AgentCityTheme): void;
  setSky(sky: string): void;
  setReducedMotion(reducedMotion: boolean): void;
  setQuality(quality: Exclude<AgentCityQuality, "fallback">): void;
  hitTest(clientX: number, clientY: number): AgentCityHover | null;
  /** Plays the greeting animation on the clicked pug; returns the floor key. */
  greetAt(clientX: number, clientY: number): AgentCityHover | null;
  focusFloor(key: string): boolean;
  /** Auto-frames whichever agent is working; re-frames only when that changes. */
  setFollowWorking(enabled: boolean): void;
  clearFocus(): void;
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
  celebration: THREE.Group | null;
  proceduralShell: THREE.Group;
  proceduralDecor: THREE.Group;
  assetVisual: THREE.Group;
  assetWindowMaterials: THREE.MeshStandardMaterial[];
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
const COAT_COLOR = 0xcaa678;
const COAT_COLOR_DISABLED = 0x9b9388;
/** Pug ears fold forward at rest; upright cones read as a cat. */
const EAR_REST_PITCH = 1.05;
const CAMERA_TWEEN_MS = 620;
/** Full runtime data is retained; only the scene applies an animated-worker LOD. */
const SUBAGENT_RENDER_LIMIT = 12;

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

  const coat = material(COAT_COLOR);
  const coatMaterials = [coat];

  const body = mesh(new THREE.SphereGeometry(0.37, 18, 12), coat, 0, 0.42, 0);
  body.scale.set(1.08, 0.9, 1.18);
  pose.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.74, 0.05);
  pose.add(head);
  head.add(headAccessory);
  const skull = mesh(new THREE.SphereGeometry(0.34, 18, 12), material(0xd8b88e), 0, 0.1, 0.08);
  skull.scale.set(1.02, 0.94, 0.9);
  head.add(skull);
  const muzzle = mesh(new THREE.SphereGeometry(0.19, 16, 10), material(0x4c4037), 0, 0.02, 0.34);
  muzzle.scale.set(1.2, 0.78, 0.62);
  head.add(muzzle);
  const nose = mesh(new THREE.SphereGeometry(0.065, 12, 8), material(0x1f1d1b, 0.45), 0, 0.08, 0.49);
  nose.scale.set(1.1, 0.7, 0.65);
  head.add(nose);

  let earLeft: THREE.Mesh | null = null;
  let earRight: THREE.Mesh | null = null;
  const pawPivots: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.047, 10, 8), material(0x171717, 0.3), side * 0.12, 0.17, 0.34));
    const ear = mesh(new THREE.ConeGeometry(0.13, 0.25, 5), material(0x59483d), side * 0.26, 0.28, 0.02);
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
    rig.homePosition.x + pose.travelX,
    rig.homePosition.y,
    rig.homePosition.z + pose.travelZ
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
 * Desk built around its own origin with the seat side on +z, so the caller can
 * turn it against a side wall. Facing the back wall would put the working pug's
 * back to the camera and hide the whole typing animation.
 */
function createWorkstation(accent: number): { group: THREE.Group; screen: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  addBox(group, [1.25, 0.11, 0.58], 0x8d755f, [0, 0.48, 0], 0.055);
  addBox(group, [0.1, 0.48, 0.1], 0x5f554c, [-0.48, 0.23, 0]);
  addBox(group, [0.1, 0.48, 0.1], 0x5f554c, [0.46, 0.23, 0]);
  const screen = new THREE.MeshStandardMaterial({
    color: 0x52616b,
    emissive: accent,
    emissiveIntensity: 0,
    roughness: 0.42
  });
  group.add(mesh(new THREE.BoxGeometry(0.56, 0.4, 0.08), screen, 0, 0.83, 0));
  addBox(group, [0.07, 0.28, 0.07], 0x525252, [0, 0.61, 0]);
  // Keyboard, so the typing clip has something to hit.
  addBox(group, [0.42, 0.03, 0.16], 0x3f4750, [0, 0.55, 0.24], 0.02);
  return { group, screen };
}

function floorPalette(index: number, dark: boolean): { wall: number; trim: number; accent: number } {
  const palettes = dark
    ? [
        { wall: 0x26333b, trim: 0x3b4b54, accent: 0x48aeff },
        { wall: 0x2e3038, trim: 0x484a54, accent: 0x82eb8d },
        { wall: 0x332f3b, trim: 0x4c4658, accent: 0xc979ff },
        { wall: 0x38332c, trim: 0x514a40, accent: 0xffc543 }
      ]
    : [
        { wall: 0xf5eee4, trim: 0xd9c7ae, accent: 0x006bff },
        { wall: 0xe8f1e9, trim: 0xb9d0bc, accent: 0x28a948 },
        { wall: 0xeee9f4, trim: 0xcfc2df, accent: 0x8500d1 },
        { wall: 0xf4eee0, trim: 0xd8c59c, accent: 0xaa4d00 }
      ];
  return palettes[index % palettes.length];
}

/**
 * Panes on the inner face of the back wall. The dollhouse is open at the front,
 * so lighting these from inside is what reads as "someone is still in there" at
 * night — the outer faces never point at the camera.
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
    color: 0xbfd9e8,
    emissive: 0xffd79a,
    emissiveIntensity: 0,
    roughness: 0.28,
    metalness: 0.05
  });
  const offset = ((count - 1) * spacing) / 2;
  for (let index = 0; index < count; index += 1) {
    group.add(mesh(new THREE.BoxGeometry(size[0], size[1], 0.03), material, index * spacing - offset, y, z));
  }
  return { group, material };
}


function createWorkerStation(accent: number, role: string): { group: THREE.Group; screen: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const roleAccent = roleColor(role);
  addBox(group, [0.5, 0.055, 0.34], 0x756b62, [0, 0.27, 0], 0.035);
  addBox(group, [0.045, 0.26, 0.045], 0x57514b, [-0.19, 0.13, 0]);
  addBox(group, [0.045, 0.26, 0.045], 0x57514b, [0.19, 0.13, 0]);
  const screen = new THREE.MeshStandardMaterial({
    color: 0x33424c,
    emissive: roleAccent || accent,
    emissiveIntensity: 0.55,
    roughness: 0.32
  });
  group.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.035), screen, 0, 0.48, -0.04));
  addBox(group, [0.22, 0.018, 0.09], 0x3e474e, [0, 0.32, 0.11], 0.012);
  return { group, screen };
}

function createRoomDecor(
  group: THREE.Group,
  dynamicGroup: THREE.Group,
  isGlobal: boolean,
  dark: boolean,
  accent: number,
  variant: number,
  hasWorkers: boolean
): { activityMaterials: THREE.MeshStandardMaterial[]; celebration: THREE.Group } {
  const activityMaterials: THREE.MeshStandardMaterial[] = [];
  const wood = dark ? 0x6f5d4f : 0x9a8068;
  const soft = dark ? 0x48545d : 0xc7d1d6;
  const fabric = dark ? 0x384957 : 0xaec1ce;
  const rug = dark ? 0x293942 : 0xd7e0dc;

  // A soft floor plane makes the rooms feel inhabited instead of like empty boxes.
  addBox(
    group,
    isGlobal ? [4.9, 0.035, 3.25] : [2.45, 0.03, 1.48],
    rug,
    isGlobal ? [-0.2, 0.275, 0.28] : [-0.2, 0.115, 0.28]
  );

  // Bookshelf + books.
  const shelfX = isGlobal ? -2.85 : -1.48;
  const shelfZ = isGlobal ? -1.88 : -0.92;
  const shelfHeight = isGlobal ? 1.72 : 1.16;
  addBox(group, [0.64, shelfHeight, 0.16], wood, [shelfX, shelfHeight / 2 + 0.15, shelfZ]);
  for (let level = 0; level < (isGlobal ? 4 : 3); level += 1) {
    addBox(group, [0.7, 0.045, 0.24], dark ? 0x806b58 : 0x9b8069, [shelfX, 0.34 + level * 0.39, shelfZ + 0.02]);
    for (let book = 0; book < 4; book += 1) {
      const colors = [0xd06c8d, 0x4f8bd8, 0xe7a34b, 0x72a85f];
      addBox(group, [0.08, 0.22 + ((book + variant) % 2) * 0.05, 0.08], colors[(book + variant) % colors.length], [
        shelfX - 0.22 + book * 0.14,
        0.48 + level * 0.39,
        shelfZ + 0.13
      ]);
    }
  }

  // Lounge corner. It retracts while a temporary worker camp is deployed so
  // the team gets a visually distinct collaboration zone instead of clipping furniture.
  if (!hasWorkers) {
    const loungeX = isGlobal ? -2.05 : -0.78;
    const loungeZ = isGlobal ? 0.9 : 0.46;
    const cushion = mesh(new THREE.CylinderGeometry(isGlobal ? 0.64 : 0.46, isGlobal ? 0.68 : 0.49, 0.16, 22), material(fabric, 0.92), loungeX, isGlobal ? 0.34 : 0.2, loungeZ);
    group.add(cushion);
    addBox(group, isGlobal ? [1.42, 0.12, 0.72] : [0.96, 0.1, 0.54], soft, [
      loungeX,
      isGlobal ? 0.3 : 0.18,
      loungeZ + (isGlobal ? 0.18 : 0.14)
    ]);
  }

  // Plant in the far corner.
  const plantX = isGlobal ? 2.95 : -1.48;
  const plantZ = isGlobal ? 1.78 : 0.82;
  group.add(mesh(new THREE.CylinderGeometry(0.18, 0.23, 0.34, 12), material(dark ? 0x735945 : 0xb88563), plantX, 0.33, plantZ));
  for (const [dx, dz, scale] of [[-0.1, 0, 1], [0.1, 0.03, 0.9], [0, -0.09, 1.08]] as const) {
    const leaf = mesh(new THREE.SphereGeometry(0.18, 10, 7), material(dark ? 0x4d7a5b : 0x70a87d), plantX + dx, 0.68, plantZ + dz);
    leaf.scale.set(0.7, scale, 0.5);
    group.add(leaf);
  }

  // Task board: this is the room's strongest state surface and changes with the Agent.
  const boardMaterial = new THREE.MeshStandardMaterial({
    color: dark ? 0x24323d : 0xe6eef2,
    emissive: accent,
    emissiveIntensity: 0.08,
    roughness: 0.36,
    metalness: 0.04
  });
  const board = mesh(
    new THREE.BoxGeometry(isGlobal ? 2.15 : 1.05, isGlobal ? 0.72 : 0.48, 0.055),
    boardMaterial,
    isGlobal ? 0.25 : -0.25,
    isGlobal ? 0.9 : 0.64,
    isGlobal ? -2.14 : -1.0
  );
  dynamicGroup.add(board);
  activityMaterials.push(boardMaterial);
  const cellCount = isGlobal ? 5 : 3;
  for (let index = 0; index < cellCount; index += 1) {
    const cellMaterial = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.08,
      roughness: 0.4
    });
    const spacing = isGlobal ? 0.37 : 0.26;
    dynamicGroup.add(mesh(
      new THREE.BoxGeometry(isGlobal ? 0.24 : 0.16, 0.08, 0.025),
      cellMaterial,
      (isGlobal ? 0.25 : -0.25) + (index - (cellCount - 1) / 2) * spacing,
      isGlobal ? 0.9 : 0.64,
      isGlobal ? -2.105 : -0.968
    ));
    activityMaterials.push(cellMaterial);
  }

  // Standing lamp; the glow remains subtle so it reads as interior light, not a beacon.
  const lampX = isGlobal ? 2.65 : -1.35;
  const lampZ = isGlobal ? 1.58 : 0.66;
  addBox(group, [0.055, isGlobal ? 1.08 : 0.72, 0.055], dark ? 0x58656d : 0x71808a, [lampX, isGlobal ? 0.72 : 0.5, lampZ]);
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe7b0,
    emissive: 0xffc96b,
    emissiveIntensity: dark ? 0.42 : 0.12,
    roughness: 0.55
  });
  group.add(mesh(new THREE.ConeGeometry(isGlobal ? 0.28 : 0.2, isGlobal ? 0.34 : 0.25, 16, 1, true), lampMaterial, lampX, isGlobal ? 1.32 : 0.9, lampZ));
  activityMaterials.push(lampMaterial);

  // Celebration satellites: hidden unless a task just completed / remains completed.
  const celebration = new THREE.Group();
  const confettiColors = [0xffc543, 0x48aeff, 0x82eb8d, 0xc979ff, 0xff7d9d, 0xffffff];
  for (let index = 0; index < confettiColors.length; index += 1) {
    const bit = mesh(new THREE.SphereGeometry(isGlobal ? 0.075 : 0.05, 8, 6), material(confettiColors[index], 0.45));
    const angle = (index / confettiColors.length) * Math.PI * 2;
    bit.position.set(Math.cos(angle) * (isGlobal ? 1.2 : 0.72), 0.9 + (index % 2) * 0.3, Math.sin(angle) * (isGlobal ? 0.78 : 0.46));
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
  phase: number
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
    color: STATUS_COLORS.working,
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
    color: 0xd8f0ff,
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
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(theme === "dark" ? 0x79b8ff : 0xffe1b8, theme === "dark" ? 0.75 : 0.55);
  rim.position.set(14, 10, -16);
  rim.castShadow = false;
  scene.add(rim);

  function attachMomoAsset(rig: PugRig): void {
    if (!rig.assetEligible || rig.asset || !momoTemplate) return;
    if (quality === "low" && rig.isWorker) return;
    const instance = createMomoAssetInstance(momoTemplate);
    instance.root.scale.setScalar(0.96);
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
    const architecture = cloneCommunityComponent(communityKit, isGlobal ? "HQArchitecture" : "StudioArchitecture", dark, accent);
    const decor = cloneCommunityComponent(communityKit, isGlobal ? "HQDecor" : "StudioDecor", dark, accent);
    if (architecture) node.assetVisual.add(architecture);
    if (decor) {
      const lounge = decor.getObjectByName("Lounge");
      if (lounge) lounge.visible = !hasWorkers;
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
    node.proceduralShell.visible = false;
    node.proceduralDecor.visible = false;
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
        const accent = floor.kind === "global" ? 0x006bff : floorPalette(variant, dark).accent;
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
    scene.background = skyColor;
    scene.fog = new THREE.Fog(skyColor, 42, 130);
    ambient.intensity = theme === "dark" ? 1.45 : 1.8;
    sun.color.setHex(theme === "dark" ? 0x9fc6ff : 0xfff4df);
    sun.intensity = theme === "dark" ? 2.2 : 3.4;
    rim.color.setHex(theme === "dark" ? 0x79b8ff : 0xffe1b8);
    rim.intensity = theme === "dark" ? 0.75 : 0.55;
    renderer.toneMappingExposure = theme === "dark" ? 1.08 : 1.0;
  }

  function buildStaticScenery(): void {
    disposeObject(staticRoot);
    staticRoot.clear();
    const groundColor = theme === "dark" ? 0x1d282f : 0xdfe7e5;
    const ground = mesh(new THREE.BoxGeometry(34, 0.28, 22), material(groundColor), 0, -0.2, 0);
    ground.receiveShadow = true;
    staticRoot.add(ground);
    const roadColor = theme === "dark" ? 0x33434c : 0xcbd8d5;
    const addRoad = (fromX: number, fromZ: number, toX: number, toZ: number, width = 0.3): void => {
      const dx = toX - fromX;
      const dz = toZ - fromZ;
      const length = Math.hypot(dx, dz);
      if (length < 0.01) return;
      const road = addBox(staticRoot, [width, 0.035, length], roadColor, [(fromX + toX) / 2, -0.02, (fromZ + toZ) / 2]);
      road.rotation.y = Math.atan2(dx, dz);
    };
    const primary = projection.globalFloor.position;
    addRoad(projection.owner.position.x, projection.owner.position.z, primary.x, primary.z, 0.46);
    for (const building of projection.buildings) {
      addRoad(primary.x, primary.z, building.position.x, building.position.z);
    }

    // A small shared plaza and restrained landscaping make the scene read as a
    // community rather than isolated dollhouses. These remain runtime-owned so
    // they can follow light/dark themes without baking another asset variant.
    const plazaMaterial = material(theme === "dark" ? 0x2a373e : 0xd5dfdc, 0.86);
    const plaza = mesh(new RoundedBoxGeometry(9.2, 0.06, 7.0, 5, 0.12), plazaMaterial, primary.x, -0.01, primary.z + 0.25);
    plaza.receiveShadow = true;
    staticRoot.add(plaza);

    const leafMaterial = material(theme === "dark" ? 0x416b52 : 0x6f9f78, 0.92);
    const trunkMaterial = material(theme === "dark" ? 0x645244 : 0x8b6a52, 0.9);
    const lampMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe7b0,
      emissive: 0xffc96b,
      emissiveIntensity: theme === "dark" ? 0.7 : 0.12,
      roughness: 0.55
    });
    for (const [x, z] of [[-3.8, -0.5], [3.8, -0.5], [-3.6, 4.7], [3.6, 4.7]] as const) {
      staticRoot.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.75, 12), trunkMaterial, x, 0.34, z + primary.z));
      const crown = mesh(new THREE.SphereGeometry(0.48, 14, 10), leafMaterial, x, 1.02, z + primary.z);
      crown.scale.set(0.82, 1.12, 0.82);
      staticRoot.add(crown);
    }
    for (const x of [-2.2, 2.2]) {
      addBox(staticRoot, [0.9, 0.11, 0.34], theme === "dark" ? 0x665748 : 0x927761, [x, 0.25, primary.z + 3.0], 0.05);
      addBox(staticRoot, [0.055, 0.34, 0.055], theme === "dark" ? 0x59666d : 0x75838b, [x - 0.31, 0.12, primary.z + 3.0], 0.02);
      addBox(staticRoot, [0.055, 0.34, 0.055], theme === "dark" ? 0x59666d : 0x75838b, [x + 0.31, 0.12, primary.z + 3.0], 0.02);
    }
    for (const x of [-1.7, 1.7]) {
      addBox(staticRoot, [0.055, 1.05, 0.055], theme === "dark" ? 0x59666d : 0x75838b, [x, 0.5, primary.z + 5.1], 0.018);
      staticRoot.add(mesh(new THREE.SphereGeometry(0.12, 12, 8), lampMaterial, x, 1.05, primary.z + 5.1));
    }

    const owner = communityKit
      ? cloneCommunityComponent(communityKit, "CommunityHub", theme === "dark", 0x006bff) ?? createOwnerCenter(theme === "dark")
      : createOwnerCenter(theme === "dark");
    owner.position.set(projection.owner.position.x, projection.owner.position.y, projection.owner.position.z);
    staticRoot.add(owner);
  }

  function createOwnerCenter(dark: boolean): THREE.Group {
    const group = new THREE.Group();
    const base = material(dark ? 0x33434c : 0xd8e2df, 0.72);
    const platform = mesh(new THREE.CylinderGeometry(2.15, 2.35, 0.24, 40), base, 0, 0.08, 0);
    group.add(platform);

    const coreMaterial = new THREE.MeshStandardMaterial({
      color: dark ? 0x17324c : 0xd9edff,
      emissive: 0x006bff,
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.08
    });
    group.add(mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.35, 24), coreMaterial, 0, 0.78, 0));
    group.add(mesh(new THREE.SphereGeometry(0.28, 20, 14), coreMaterial, 0, 1.52, 0));

    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x8bc7ff,
      emissive: 0x006bff,
      emissiveIntensity: 0.4,
      roughness: 0.35
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.055, 10, 48), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    group.add(ring);

    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const x = Math.cos(angle) * 1.5;
      const z = Math.sin(angle) * 1.5;
      const terminal = addBox(group, [0.46, 0.12, 0.34], dark ? 0x657680 : 0x9caab0, [x, 0.28, z]);
      terminal.rotation.y = -angle;
    }
    return group;
  }

  function createRoute(floor: AgentCityFloor): AnimatedRoute | null {
    if (!floor.route) return null;
    const group = new THREE.Group();
    const points = floor.route.points.map((point) => new THREE.Vector3(point.x, point.y + 0.11, point.z));
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeMaterial = new THREE.MeshStandardMaterial({
      color: 0x006bff,
      emissive: 0x006bff,
      emissiveIntensity: 0.65,
      transparent: true,
      opacity: 0.78
    });
    const tube = mesh(new THREE.TubeGeometry(curve, 42, 0.045, 8, false), tubeMaterial);
    tube.castShadow = false;
    group.add(tube);
    const capsuleMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x006bff, emissiveIntensity: 1.2 });
    const capsule = mesh(new THREE.SphereGeometry(0.13, 10, 8), capsuleMaterial);
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
    anchor.position.set(0, anchorY, 0.92);
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
    const palette = floorPalette(variant, dark);
    const accent = isGlobal ? 0x006bff : palette.accent;

    let statusMaterial: THREE.MeshStandardMaterial;
    let perimeterSize: [number, number, number];
    let perimeterHeight: number;
    let targetSize: [number, number, number];
    let anchorY: number;
    let windows: { group: THREE.Group; material: THREE.MeshStandardMaterial };
    // Interior surfaces that pick up the room's own light. Glowing panes alone
    // read wrong at city distance — a lit window over a pitch-black room.
    const roomMaterials: THREE.MeshStandardMaterial[] = [];
    const shell = (value: THREE.Mesh): THREE.Mesh => {
      roomMaterials.push(value.material as THREE.MeshStandardMaterial);
      return value;
    };

    if (isGlobal) {
      // The default Agent is the community's hero building rather than a remote
      // "global" room. Extra width/depth leaves room for a temporary worker camp.
      const base = dark ? 0x27323d : 0xe9edf0;
      shell(addBox(proceduralShell, [7.6, 0.3, 5], dark ? 0x3d4d58 : 0xcad3d8, [0, 0.1, 0]));
      shell(addBox(proceduralShell, [6.9, 3.05, 0.2], base, [0, 1.7, -2.28]));
      shell(addBox(proceduralShell, [0.22, 3.05, 4.8], base, [-3.35, 1.7, 0]));
      shell(addBox(proceduralShell, [0.22, 3.05, 4.8], base, [3.35, 1.7, 0]));
      addBox(proceduralShell, [7.05, 0.18, 5], dark ? 0x3d4d58 : 0xcad3d8, [0, 3.25, 0]);
      statusMaterial = new THREE.MeshStandardMaterial({ color: 0x7d7d7d, emissive: 0x7d7d7d, emissiveIntensity: 0.18, roughness: 0.4 });
      group.add(mesh(new THREE.CylinderGeometry(0.5, 0.72, 1.6, 24), statusMaterial, 0, 0.95, -0.72));
      perimeterSize = [7.05, 0.18, 5];
      perimeterHeight = 3.34;
      targetSize = [7.05, 3.34, 5];
      anchorY = 3.62;
      windows = createWindowPanes(4, 1.45, [1, 0.95], 1.82, -2.16);
    } else {
      shell(addBox(proceduralShell, [3.8, 0.16, 2.35], palette.trim, [0, 0.02, 0]));
      shell(addBox(proceduralShell, [3.8, 1.9, 0.16], palette.wall, [0, 1.02, -1.1]));
      shell(addBox(proceduralShell, [0.16, 1.9, 2.35], palette.wall, [-1.82, 1.02, 0]));
      shell(addBox(proceduralShell, [0.16, 1.9, 2.35], palette.wall, [1.82, 1.02, 0]));
      addBox(proceduralShell, [3.85, 0.12, 2.4], palette.trim, [0, 1.98, 0]);
      statusMaterial = new THREE.MeshStandardMaterial({ color: 0x7d7d7d, emissive: 0x7d7d7d, emissiveIntensity: 0.05, roughness: 0.55 });
      group.add(mesh(new THREE.BoxGeometry(2.8, 0.055, 0.08), statusMaterial, 0, 0.1, 1.16));
      perimeterSize = [3.85, 0.12, 2.4];
      perimeterHeight = 2.04;
      targetSize = [3.85, 2.04, 2.4];
      anchorY = 2.32;
      windows = createWindowPanes(2, 1.1, [0.8, 0.62], 1.18, -1.0);
    }
    proceduralShell.add(windows.group);

    const renderedWorkers = floor.subagents.instances.slice(0, SUBAGENT_RENDER_LIMIT);
    const decor = createRoomDecor(proceduralDecor, group, isGlobal, dark, accent, variant, renderedWorkers.length > 0);
    const activityMaterials = decor.activityMaterials;
    const celebration = decor.celebration;
    const workerScreens: THREE.MeshStandardMaterial[] = [];

    if (renderedWorkers.length > 0) {
      const campSurface = new THREE.MeshStandardMaterial({
        color: dark ? 0x26343d : 0xdbe5e8,
        emissive: accent,
        emissiveIntensity: 0.08,
        roughness: 0.68
      });
      const camp = mesh(
        new RoundedBoxGeometry(isGlobal ? 4.35 : 2.05, 0.055, isGlobal ? 2.55 : 1.62, 4, 0.025),
        campSurface,
        isGlobal ? -0.85 : -0.82,
        isGlobal ? 0.285 : 0.13,
        isGlobal ? 0.35 : 0.06
      );
      group.add(camp);
      activityMaterials.push(campSurface);
    }

    // Desk against the right wall, seat side facing -x: the working pug ends up
    // in profile to the camera, so the paws on the keyboard stay visible.
    const workstation = createWorkstation(accent);
    workstation.group.position.set(isGlobal ? 2.62 : 1.35, 0, isGlobal ? 0.22 : 0.05);
    workstation.group.rotation.y = -Math.PI / 2;
    group.add(workstation.group);
    const deskScreen = workstation.screen;
    const perimeter = createWorkingFloorPerimeter(
      perimeterSize,
      perimeterHeight,
      statusMaterial,
      floor.floorIndex * 0.71 + variant
    );
    perimeter.group.visible = false;
    group.add(perimeter.group);

    const mainPug = createPug(false, null);
    mainPug.seed = pugSeed(floor.agent.id);
    if (isGlobal) setRigScale(mainPug, 1.08);
    group.add(mainPug.root);
    attachMomoAsset(mainPug);
    const pugs = [mainPug];

    const seatPosition = isGlobal
      ? new THREE.Vector3(1.82, 0.14, 0.22)
      : new THREE.Vector3(0.74, 0.1, 0.05);
    const loungePosition = isGlobal ? new THREE.Vector3(-2.05, 0.14, 0.9) : new THREE.Vector3(-0.78, 0.1, 0.46);

    const workerColumns = isGlobal ? 5 : 3;
    const workerSpacingX = isGlobal ? 0.7 : 0.5;
    const workerSpacingZ = isGlobal ? 0.62 : 0.43;
    const workerCenterX = isGlobal ? -0.9 : -0.82;
    const workerCenterZ = isGlobal ? -0.28 : -0.58;
    renderedWorkers.forEach((subagent, index) => {
      const row = Math.floor(index / workerColumns);
      const column = index % workerColumns;
      const rowCount = Math.min(workerColumns, renderedWorkers.length - row * workerColumns);
      const x = workerCenterX + (column - (rowCount - 1) / 2) * workerSpacingX;
      const z = workerCenterZ + row * workerSpacingZ;
      const assistant = createPug(true, subagent.name);
      assistant.seed = pugSeed(`${floor.agent.id}:${subagent.id}`);
      setRigScale(assistant, isGlobal ? 0.47 : 0.39);
      const startedAt = Date.parse(subagent.startedAt);
      assistant.spawnEpochMs = Number.isNaN(startedAt) ? null : startedAt;
      setRigHome(assistant, new THREE.Vector3(x, isGlobal ? 0.22 : 0.1, z + 0.08), 0.08);
      group.add(assistant.root);
      attachMomoAsset(assistant);
      pugs.push(assistant);

      const station = createWorkerStation(accent, subagent.name);
      station.group.position.set(x, isGlobal ? 0.14 : 0.03, z - (isGlobal ? 0.27 : 0.21));
      group.add(station.group);
      workerScreens.push(station.screen);
    });

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

    const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0xea001d, emissive: 0xea001d, emissiveIntensity: 0.8 });
    const beacon = mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.22, 12), beaconMaterial, isGlobal ? -2.3 : -1.45, isGlobal ? 2.6 : 1.72, -0.92);
    beacon.visible = false;
    group.add(beacon);

    const { target, anchor } = attachFloorTarget(group, targetSize, anchorY, floor.key);
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
      celebration,
      proceduralShell,
      proceduralDecor,
      assetVisual,
      assetWindowMaterials: [],
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
      node.windowBase = night ? 0.95 : 0.16;
      node.windowFlicker = night ? 0.22 : 0.04;
    } else if (status === "error") {
      node.windowBase = night ? 0.5 : 0.1;
      node.windowFlicker = night ? 0.35 : 0;
    } else {
      node.windowBase = night ? 0.3 : 0.05;
      node.windowFlicker = night ? 0.05 : 0;
    }
    const tint = status === "error" ? 0xff9a86 : 0xffd79a;
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
    const statusColor = STATUS_COLORS[floor.state];
    node.statusMaterial.color.setHex(statusColor);
    node.statusMaterial.emissive.setHex(statusColor);
    node.statusMaterial.emissiveIntensity =
      floor.state === "idle" || floor.state === "disabled" ? 0.05 : floor.kind === "global" && floor.state !== "working" ? 0.18 : 0.48;

    const working = floor.state === "working";
    node.deskScreen.color.setHex(working ? node.deskAccent : 0x52616b);
    node.deskScreen.emissiveIntensity = working ? 0.75 : 0;
    if (node.perimeter) node.perimeter.group.visible = floor.animation === "working";
    if (node.beacon) node.beacon.visible = floor.state === "error";
    if (node.celebration) node.celebration.visible = floor.state === "completed";
    const roomAccent =
      floor.state === "working" ? node.deskAccent :
      floor.state === "completed" ? STATUS_COLORS.completed :
      floor.state === "error" ? STATUS_COLORS.error :
      0xffc96b;
    for (const surface of node.activityMaterials) {
      surface.emissive.setHex(roomAccent);
      surface.emissiveIntensity =
        floor.state === "working" ? 0.48 :
        floor.state === "completed" ? 0.36 :
        floor.state === "error" ? 0.62 :
        floor.state === "disabled" ? 0.02 : 0.12;
    }
    applyWindowGlow(node, floor.state);

    const seat = working ? node.seatPosition : node.loungePosition;
    setRigHome(node.mainPug, seat, working ? Math.PI / 2 : 0.35);
    setPugStatus(node.mainPug, floor.state);
    floor.subagents.instances.slice(0, SUBAGENT_RENDER_LIMIT).forEach((subagent, index) => {
      const rig = node.pugs[index + 1];
      if (rig) {
        const workerReaction = transitionClip(rig.status, subagent.status);
        if (workerReaction) rig.oneShot = { clip: workerReaction, startedAt: performance.now() };
        setPugStatus(rig, subagent.status);
      }
      const screen = node.workerScreens[index];
      if (screen) {
        const color =
          subagent.status === "working" ? roleColor(subagent.name) :
          subagent.status === "completed" ? STATUS_COLORS.completed :
          STATUS_COLORS.error;
        screen.color.setHex(color);
        screen.emissive.setHex(color);
        screen.emissiveIntensity = subagent.status === "working" ? 0.9 : 0.48;
      }
    });

    if (node.route && floor.route) {
      const color = floor.route.phase === "failed" ? 0xea001d : floor.route.phase === "returning" ? 0x28a948 : 0x006bff;
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
          const accent = floor.kind === "global" ? 0x006bff : floorPalette(variant, dark).accent;
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
          applyRigTravel(rig, motion.pose, yaw);
          applyPugProp(rig, motion.pose, showProps);
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
        if (node.windowFlicker > 0) {
          const windowGlow = node.windowBase + Math.sin(time * 0.0026 + node.glowPhase) * node.windowFlicker;
          node.windowMaterial.emissiveIntensity = windowGlow;
          for (const surface of node.assetWindowMaterials) surface.emissiveIntensity = windowGlow;
        }
        if (node.status === "working") {
          const roomPulse = 0.42 + (Math.sin(time * 0.004 + node.glowPhase) + 1) * 0.11;
          for (const surface of node.activityMaterials) surface.emissiveIntensity = roomPulse;
          node.deskScreen.emissiveIntensity = 0.7 + (Math.sin(time * 0.007 + node.glowPhase) + 1) * 0.12;
        } else if (node.status === "error") {
          const alertPulse = 0.34 + Math.abs(Math.sin(time * 0.009 + node.glowPhase)) * 0.5;
          for (const surface of node.activityMaterials) surface.emissiveIntensity = alertPulse;
        }
        node.workerScreens.forEach((surface, index) => {
          const rig = node.pugs[index + 1];
          if (!rig) return;
          if (rig.status === "working") surface.emissiveIntensity = 0.72 + (Math.sin(time * 0.01 + rig.seed) + 1) * 0.14;
          else if (rig.status === "error") surface.emissiveIntensity = 0.45 + Math.abs(Math.sin(time * 0.012 + rig.seed)) * 0.42;
        });
        const route = node.route;
        if (route && route.group.visible) {
          const direction = route.phase === "returning" ? -1 : 1;
          const progress = ((time * 0.00018 * direction + route.offset) % 1 + 1) % 1;
          route.curve.getPoint(progress, route.capsule.position);
        }
        const perimeter = node.perimeter;
        if (perimeter && perimeter.group.visible) {
          const pulse = 0.7 + Math.sin(time * 0.006 + perimeter.phase) * 0.16;
          perimeter.material.opacity = 0.38 + pulse * 0.16;
          moveMarquee(perimeter, -((time * 0.006 + perimeter.phase) % perimeter.length));
          perimeter.emissive.emissiveIntensity = 0.72 + pulse * 0.28;
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
      // Background and fog both read the same colour so the horizon dissolves
      // into the shell instead of drawing a seam.
      scene.background = skyColor;
      scene.fog = new THREE.Fog(skyColor, 42, 130);
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
