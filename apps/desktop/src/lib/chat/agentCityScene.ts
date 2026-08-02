import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
  propObjects: Record<Exclude<PugProp, "none">, THREE.Object3D>;
  bookPage: THREE.Group;
  screenMaterials: THREE.MeshStandardMaterial[];
  coatMaterials: THREE.MeshStandardMaterial[];
  seed: number;
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
const DAY_SKY = 0xeaf3f5;
const NIGHT_SKY = 0x101820;
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
    floor.subagents.visible.length,
    floor.subagents.overflowCount > 0 ? "overflow" : "solo",
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
  const geometry = radius > 0
    ? new THREE.BoxGeometry(size[0], size[1], size[2], 2, 2, 2)
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

/**
 * Low-poly pug with named pivots. The rig keeps front paws (the original model
 * had none), which is what makes typing / phone-scrolling / waving readable.
 */
function createPug(assistant = false): PugRig {
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);

  const coat = material(COAT_COLOR);
  const coatMaterials = [coat];

  const body = mesh(new THREE.SphereGeometry(0.37, 18, 12), coat, 0, 0.42, 0);
  body.scale.set(1.08, 0.9, 1.18);
  pose.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.74, 0.05);
  pose.add(head);
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
    material(assistant ? 0x00ac96 : COAT_COLOR),
    0,
    0.48,
    0
  );
  vest.scale.set(1.02, 1, 1.12);
  pose.add(vest);
  if (assistant) pose.add(mesh(new THREE.BoxGeometry(0.13, 0.11, 0.025), material(0xfafafa), 0.18, 0.55, 0.38));
  else coatMaterials.push(vest.material as THREE.MeshStandardMaterial);

  const propAnchor = new THREE.Group();
  propAnchor.position.set(0, 0.56, 0.44);
  pose.add(propAnchor);
  const phone = createPhoneProp();
  const book = createBookProp();
  const pen = createPenProp();
  for (const prop of [phone, book.object, pen]) {
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
    propObjects: { phone, book: book.object, pen },
    bookPage: book.page,
    screenMaterials: [phone.userData.screenMaterial as THREE.MeshStandardMaterial],
    coatMaterials,
    seed: 0,
    status: "idle",
    currentProp: "none",
    oneShot: null,
    faceCamera: 0
  };
}

function applyPugPose(rig: PugRig, pose: PugPose, baseYaw: number, detailed: boolean): void {
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

  const prop: PugProp = detailed ? pose.prop : "none";
  if (prop !== rig.currentProp) {
    for (const [name, object] of Object.entries(rig.propObjects)) object.visible = name === prop;
    rig.currentProp = prop;
  }
  if (prop === "book") rig.bookPage.rotation.z = -pose.propSpin;
  if (prop === "phone") rig.propAnchor.rotation.z = pose.propSpin;
  if (prop === "pen") rig.propAnchor.rotation.z = pose.propSpin * 0.4;
  for (const surface of rig.screenMaterials) surface.emissiveIntensity = 0.35 + pose.screenGlow * 0.9;
}

function setPugStatus(rig: PugRig, status: AgentCityStatus): void {
  rig.status = status;
  const color = status === "disabled" ? COAT_COLOR_DISABLED : COAT_COLOR;
  for (const surface of rig.coatMaterials) surface.color.setHex(color);
}

/**
 * Desk built around its own origin with the seat side on +z, so the caller can
 * turn it against a side wall. Facing the back wall would put the working pug's
 * back to the camera and hide the whole typing animation.
 */
function createWorkstation(accent: number): { group: THREE.Group; screen: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  addBox(group, [1.25, 0.11, 0.58], 0x8d755f, [0, 0.48, 0]);
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
  addBox(group, [0.42, 0.03, 0.16], 0x3f4750, [0, 0.55, 0.24]);
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
  renderer.shadowMap.enabled = options.quality === "full";
  renderer.shadowMap.type = THREE.PCFShadowMap;
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
    scene.background = new THREE.Color(theme === "dark" ? NIGHT_SKY : DAY_SKY);
    scene.fog = new THREE.Fog(theme === "dark" ? NIGHT_SKY : DAY_SKY, 42, 130);
    ambient.intensity = theme === "dark" ? 1.45 : 1.8;
    sun.color.setHex(theme === "dark" ? 0x9fc6ff : 0xfff4df);
    sun.intensity = theme === "dark" ? 2.2 : 3.4;
  }

  function buildStaticScenery(): void {
    disposeObject(staticRoot);
    staticRoot.clear();
    const groundColor = theme === "dark" ? 0x1d282f : 0xdfe7e5;
    const ground = mesh(new THREE.BoxGeometry(34, 0.28, 22), material(groundColor), 0, -0.2, 0);
    ground.receiveShadow = true;
    staticRoot.add(ground);
    for (let index = -2; index <= 2; index += 1) {
      addBox(staticRoot, [0.36, 0.035, 20], theme === "dark" ? 0x33434c : 0xcbd8d5, [index * 5.6, -0.02, 0]);
    }
    addBox(staticRoot, [33, 0.035, 0.42], theme === "dark" ? 0x33434c : 0xcbd8d5, [0, -0.01, 0]);

    const owner = createOwnerCenter(theme === "dark");
    owner.position.set(projection.owner.position.x, projection.owner.position.y, projection.owner.position.z);
    staticRoot.add(owner);
  }

  function createOwnerCenter(dark: boolean): THREE.Group {
    const group = new THREE.Group();
    const surface = dark ? 0x26333b : 0xf0eadf;
    addBox(group, [4.5, 0.22, 3.3], dark ? 0x33434c : 0xd8cdbb, [0, 0.08, 0]);
    addBox(group, [2.4, 0.18, 0.84], 0x806b58, [0, 0.78, 0]);
    addBox(group, [0.14, 0.72, 0.14], 0x5f554c, [-0.92, 0.39, 0]);
    addBox(group, [0.14, 0.72, 0.14], 0x5f554c, [0.92, 0.39, 0]);
    addBox(group, [0.85, 0.62, 0.11], 0x171717, [0, 1.18, -0.1]);
    const consoleSurface = addBox(group, [0.68, 0.46, 0.04], 0x006bff, [0, 1.18, -0.035]);
    (consoleSurface.material as THREE.MeshStandardMaterial).emissive.setHex(0x006bff);
    (consoleSurface.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
    addBox(group, [0.95, 0.14, 0.95], surface, [0, 0.16, 1.02]);
    const chair = addBox(group, [0.72, 0.78, 0.2], dark ? 0x657680 : 0x9caab0, [0, 0.65, 0.92]);
    chair.rotation.x = -0.08;
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
      const base = dark ? 0x27323d : 0xe9edf0;
      shell(addBox(group, [6.2, 0.28, 3.9], dark ? 0x3d4d58 : 0xcad3d8, [0, 0.1, 0]));
      shell(addBox(group, [5.5, 2.8, 0.2], base, [0, 1.58, -1.75]));
      shell(addBox(group, [0.22, 2.8, 3.7], base, [-2.65, 1.58, 0]));
      shell(addBox(group, [0.22, 2.8, 3.7], base, [2.65, 1.58, 0]));
      addBox(group, [5.7, 0.18, 3.9], dark ? 0x3d4d58 : 0xcad3d8, [0, 3, 0]);
      statusMaterial = new THREE.MeshStandardMaterial({ color: 0x7d7d7d, emissive: 0x7d7d7d, emissiveIntensity: 0.18, roughness: 0.4 });
      group.add(mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.45, 20), statusMaterial, 0, 0.88, -0.52));
      perimeterSize = [5.7, 0.18, 3.9];
      perimeterHeight = 3.08;
      targetSize = [5.7, 3.08, 3.9];
      anchorY = 3.34;
      windows = createWindowPanes(3, 1.5, [1, 0.9], 1.72, -1.63);
    } else {
      shell(addBox(group, [3.8, 0.16, 2.35], palette.trim, [0, 0.02, 0]));
      shell(addBox(group, [3.8, 1.9, 0.16], palette.wall, [0, 1.02, -1.1]));
      shell(addBox(group, [0.16, 1.9, 2.35], palette.wall, [-1.82, 1.02, 0]));
      shell(addBox(group, [0.16, 1.9, 2.35], palette.wall, [1.82, 1.02, 0]));
      addBox(group, [3.85, 0.12, 2.4], palette.trim, [0, 1.98, 0]);
      statusMaterial = new THREE.MeshStandardMaterial({ color: 0x7d7d7d, emissive: 0x7d7d7d, emissiveIntensity: 0.05, roughness: 0.55 });
      group.add(mesh(new THREE.BoxGeometry(2.8, 0.055, 0.08), statusMaterial, 0, 0.1, 1.16));
      perimeterSize = [3.85, 0.12, 2.4];
      perimeterHeight = 2.04;
      targetSize = [3.85, 2.04, 2.4];
      anchorY = 2.32;
      windows = createWindowPanes(2, 1.1, [0.8, 0.62], 1.18, -1.0);
    }
    group.add(windows.group);

    // Desk against the right wall, seat side facing -x: the working pug ends up
    // in profile to the camera, so the paws on the keyboard stay visible.
    const workstation = createWorkstation(accent);
    workstation.group.position.set(isGlobal ? 2.05 : 1.35, 0, isGlobal ? 0.1 : 0.05);
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

    const mainPug = createPug();
    mainPug.seed = pugSeed(floor.agent.id);
    if (isGlobal) mainPug.root.scale.setScalar(0.9);
    group.add(mainPug.root);
    const pugs = [mainPug];

    const seatPosition = isGlobal
      ? new THREE.Vector3(1.32, 0.14, 0.1)
      : new THREE.Vector3(0.74, 0.1, 0.05);
    const loungePosition = isGlobal ? new THREE.Vector3(-1.18, 0.14, 0.5) : new THREE.Vector3(-0.78, 0.1, 0.46);

    floor.subagents.visible.forEach((subagent, index) => {
      const assistant = createPug(true);
      assistant.seed = pugSeed(`${floor.agent.id}:${subagent.name}:${index}`);
      assistant.root.scale.setScalar(0.5);
      assistant.root.position.set(-1.12 + index * 0.68, 0.1, -0.52);
      assistant.root.rotation.y = 0.15;
      group.add(assistant.root);
      pugs.push(assistant);
      addBox(group, [0.56, 0.06, 0.42], 0x7c746c, [-1.12 + index * 0.68, 0.31, -0.72]);
    });

    let overflowStudio: THREE.Object3D | null = null;
    if (floor.subagents.overflowCount > 0) {
      overflowStudio = addBox(group, [0.62, 0.42, 0.38], accent, [-1.37, 0.34, 0.48]);
      const surface = (overflowStudio as THREE.Mesh).material as THREE.MeshStandardMaterial;
      surface.emissive.setHex(accent);
      surface.emissiveIntensity = 0.12;
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
    node.deskScreen.emissiveIntensity = working ? 0.6 : 0;
    if (node.perimeter) node.perimeter.group.visible = floor.animation === "working";
    if (node.beacon) node.beacon.visible = floor.state === "error";
    applyWindowGlow(node, floor.state);

    const seat = working ? node.seatPosition : node.loungePosition;
    node.mainPug.root.position.copy(seat);
    node.mainPug.root.rotation.y = working ? Math.PI / 2 : 0.35;
    setPugStatus(node.mainPug, floor.state);
    floor.subagents.visible.forEach((subagent, index) => {
      const rig = node.pugs[index + 1];
      if (rig) setPugStatus(rig, subagent.status);
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

  function poseFor(rig: PugRig, timeMs: number): { pose: PugPose; oneShot: boolean } {
    if (rig.oneShot) {
      const duration = ONE_SHOT_CLIP_DURATION_MS[rig.oneShot.clip as "cheer" | "panic" | "greet"] ?? 1600;
      const elapsed = timeMs - rig.oneShot.startedAt;
      if (elapsed < duration) return { pose: pugPose(rig.oneShot.clip, elapsed / 1000, rig.seed), oneShot: true };
      rig.oneShot = null;
    }
    const clips = clipsForStatus(rig.status);
    const scheduled = scheduledClip(clips, rig.seed, timeMs, clipDurationForStatus(rig.status));
    return { pose: pugPose(scheduled.clip, scheduled.localTime, rig.seed), oneShot: false };
  }

  function animatePugs(timeMs: number, detailed: boolean): void {
    camera.getWorldPosition(cameraWorldPosition);
    for (const node of floorNodes.values()) {
      for (const rig of node.pugs) {
        if (reducedMotion && !rig.oneShot) {
          applyPugPose(rig, staticPoseFor(rig), 0, detailed);
          continue;
        }
        const { pose, oneShot } = poseFor(rig, timeMs);
        // While greeting, the pug turns to look straight at the viewer.
        const greeting = oneShot && rig.oneShot?.clip === "greet";
        rig.faceCamera += ((greeting ? 1 : 0) - rig.faceCamera) * 0.18;
        let yaw = 0;
        if (rig.faceCamera > 0.01) {
          rig.root.getWorldPosition(floorWorldPosition);
          const desired =
            Math.atan2(cameraWorldPosition.x - floorWorldPosition.x, cameraWorldPosition.z - floorWorldPosition.z) -
            rig.root.rotation.y;
          yaw = desired * rig.faceCamera;
        }
        applyPugPose(rig, pose, yaw, detailed);
      }
    }
  }

  function staticPoseFor(rig: PugRig): PugPose {
    const clips = clipsForStatus(rig.status);
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

    animatePugs(time, detailed);

    if (!reducedMotion) {
      for (const node of floorNodes.values()) {
        if (node.windowFlicker > 0) {
          node.windowMaterial.emissiveIntensity =
            node.windowBase + Math.sin(time * 0.0026 + node.glowPhase) * node.windowFlicker;
        }
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
      }
    } else {
      for (const node of floorNodes.values()) {
        node.windowMaterial.emissiveIntensity = node.windowBase;
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
  applyOverview(true);
  lastSceneFloors = projection.sceneFloors;
  publishView();
  animationFrame = requestAnimationFrame(animate);

  return {
    update(nextProjection) {
      projection = nextProjection;
      syncProjection();
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
