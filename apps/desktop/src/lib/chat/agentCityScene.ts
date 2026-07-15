import * as THREE from "three";
import type { AgentCityFloor, AgentCityProjection, AgentCityStatus } from "./agentCityProjection";

export type AgentCityQuality = "full" | "low" | "fallback";
export type AgentCityTheme = "light" | "dark";

export interface AgentCityCapabilities {
  webgl2: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  devicePixelRatio: number;
}

export interface AgentCityAnchor {
  x: number;
  y: number;
  visible: boolean;
}

export interface AgentCitySceneOptions {
  canvas: HTMLCanvasElement;
  projection: AgentCityProjection;
  theme: AgentCityTheme;
  reducedMotion: boolean;
  quality: Exclude<AgentCityQuality, "fallback">;
  onPerformanceFallback: () => void;
  onContextLost: () => void;
}

export interface AgentCitySceneController {
  update(projection: AgentCityProjection): void;
  resize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  setTheme(theme: AgentCityTheme): void;
  setReducedMotion(reducedMotion: boolean): void;
  getAnchors(): Record<string, AgentCityAnchor>;
  dispose(): void;
}

interface AnimatedPug {
  root: THREE.Group;
  baseY: number;
  phase: number;
  state: AgentCityStatus;
}

interface AnimatedRoute {
  capsule: THREE.Mesh;
  curve: THREE.CatmullRomCurve3;
  phase: "outbound" | "returning" | "failed";
  offset: number;
}

const FLOOR_HEIGHT = 2.5;
const DAY_SKY = 0xeaf3f5;
const NIGHT_SKY = 0x101820;
const STATUS_COLORS: Record<AgentCityStatus, number> = {
  disabled: 0x8f8f8f,
  idle: 0x7d7d7d,
  working: 0x006bff,
  completed: 0x28a948,
  error: 0xea001d
};

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

function createPug(color: number, assistant = false): THREE.Group {
  const pug = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.37, 18, 12), material(color), 0, 0.42, 0);
  body.scale.set(1.08, 0.9, 1.18);
  pug.add(body);

  const head = mesh(new THREE.SphereGeometry(0.34, 18, 12), material(0xd8b88e), 0, 0.84, 0.13);
  head.scale.set(1.02, 0.94, 0.9);
  pug.add(head);
  const muzzle = mesh(new THREE.SphereGeometry(0.19, 16, 10), material(0x4c4037), 0, 0.76, 0.39);
  muzzle.scale.set(1.2, 0.78, 0.62);
  pug.add(muzzle);
  const nose = mesh(new THREE.SphereGeometry(0.065, 12, 8), material(0x1f1d1b, 0.45), 0, 0.82, 0.54);
  nose.scale.set(1.1, 0.7, 0.65);
  pug.add(nose);

  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.047, 10, 8), material(0x171717, 0.3), side * 0.12, 0.91, 0.39);
    pug.add(eye);
    const ear = mesh(new THREE.ConeGeometry(0.13, 0.25, 5), material(0x59483d), side * 0.24, 1.08, 0.1);
    ear.rotation.z = side * -0.42;
    pug.add(ear);
    const leg = mesh(new THREE.CapsuleGeometry(0.09, 0.2, 4, 8), material(color), side * 0.2, 0.14, 0.09);
    pug.add(leg);
  }

  const tail = new THREE.Mesh(
    new THREE.TorusGeometry(0.13, 0.045, 8, 16, Math.PI * 1.55),
    material(0xb98f61)
  );
  tail.position.set(-0.34, 0.52, -0.16);
  tail.rotation.set(Math.PI / 2, 0, -0.45);
  pug.add(tail);

  const vest = mesh(new THREE.CylinderGeometry(0.36, 0.34, 0.34, 16, 1, true), material(assistant ? 0x00ac96 : color), 0, 0.48, 0);
  vest.scale.set(1.02, 1, 1.12);
  pug.add(vest);
  if (assistant) {
    const badge = mesh(new THREE.BoxGeometry(0.13, 0.11, 0.025), material(0xfafafa), 0.18, 0.55, 0.38);
    pug.add(badge);
  }
  pug.scale.setScalar(0.82);
  return pug;
}

function addWorkstation(parent: THREE.Object3D, active: boolean, accent: number): void {
  addBox(parent, [1.25, 0.11, 0.58], 0x8d755f, [0.72, 0.48, -0.22]);
  addBox(parent, [0.1, 0.48, 0.1], 0x5f554c, [0.24, 0.23, -0.22]);
  addBox(parent, [0.1, 0.48, 0.1], 0x5f554c, [1.18, 0.23, -0.22]);
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: active ? accent : 0x52616b,
    emissive: active ? accent : 0x000000,
    emissiveIntensity: active ? 0.6 : 0,
    roughness: 0.42
  });
  const monitor = mesh(new THREE.BoxGeometry(0.56, 0.4, 0.08), screenMaterial, 0.72, 0.83, -0.22);
  parent.add(monitor);
  addBox(parent, [0.07, 0.28, 0.07], 0x525252, [0.72, 0.61, -0.22]);
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

function createDollhouseFloor(floor: AgentCityFloor, variant: number, dark: boolean, animatedPugs: AnimatedPug[]): THREE.Group {
  const group = new THREE.Group();
  const palette = floorPalette(variant, dark);
  const statusColor = STATUS_COLORS[floor.state];
  addBox(group, [3.8, 0.16, 2.35], palette.trim, [0, 0.02, 0]);
  addBox(group, [3.8, 1.9, 0.16], palette.wall, [0, 1.02, -1.1]);
  addBox(group, [0.16, 1.9, 2.35], palette.wall, [-1.82, 1.02, 0]);
  addBox(group, [0.16, 1.9, 2.35], palette.wall, [1.82, 1.02, 0]);
  addBox(group, [3.85, 0.12, 2.4], palette.trim, [0, 1.98, 0]);

  const statusStripMaterial = new THREE.MeshStandardMaterial({ color: statusColor, emissive: statusColor, emissiveIntensity: floor.state === "idle" || floor.state === "disabled" ? 0.05 : 0.48, roughness: 0.55 });
  group.add(mesh(new THREE.BoxGeometry(2.8, 0.055, 0.08), statusStripMaterial, 0, 0.1, 1.16));
  addWorkstation(group, floor.state === "working", palette.accent);

  const pug = createPug(floor.state === "disabled" ? 0x9b9388 : 0xcaa678);
  pug.position.set(floor.state === "working" ? 0.08 : -0.75, 0.1, floor.state === "working" ? 0.15 : 0.42);
  pug.rotation.y = floor.state === "working" ? -0.1 : 0.35;
  group.add(pug);
  animatedPugs.push({ root: pug, baseY: pug.position.y, phase: floor.agent.id.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % 17, state: floor.state });

  floor.subagents.visible.forEach((subagent, index) => {
    const assistant = createPug(0x9fe1cb, true);
    assistant.scale.setScalar(0.52);
    assistant.position.set(-1.12 + index * 0.68, 0.1, -0.52);
    assistant.rotation.y = 0.15;
    group.add(assistant);
    animatedPugs.push({ root: assistant, baseY: assistant.position.y, phase: index * 1.7, state: subagent.status });
    addBox(group, [0.56, 0.06, 0.42], 0x7c746c, [-1.12 + index * 0.68, 0.31, -0.72]);
  });

  if (floor.subagents.overflowCount > 0) {
    const studio = addBox(group, [0.62, 0.42, 0.38], palette.accent, [-1.37, 0.34, 0.48]);
    (studio.material as THREE.MeshStandardMaterial).emissive.setHex(palette.accent);
    (studio.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12;
  }

  if (floor.state === "error") {
    const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0xea001d, emissive: 0xea001d, emissiveIntensity: 0.8 });
    group.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.22, 12), beaconMaterial, -1.45, 1.72, -0.92));
  }
  return group;
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

function createGlobalHeadquarters(floor: AgentCityFloor, dark: boolean, animatedPugs: AnimatedPug[]): THREE.Group {
  const group = new THREE.Group();
  const base = dark ? 0x27323d : 0xe9edf0;
  addBox(group, [6.2, 0.28, 3.9], dark ? 0x3d4d58 : 0xcad3d8, [0, 0.1, 0]);
  addBox(group, [5.5, 2.8, 0.2], base, [0, 1.58, -1.75]);
  addBox(group, [0.22, 2.8, 3.7], base, [-2.65, 1.58, 0]);
  addBox(group, [0.22, 2.8, 3.7], base, [2.65, 1.58, 0]);
  addBox(group, [5.7, 0.18, 3.9], dark ? 0x3d4d58 : 0xcad3d8, [0, 3, 0]);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: STATUS_COLORS[floor.state], emissive: STATUS_COLORS[floor.state], emissiveIntensity: floor.state === "working" ? 0.7 : 0.18, roughness: 0.4 });
  group.add(mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.45, 20), coreMaterial, 0, 0.88, -0.52));
  addWorkstation(group, floor.state === "working", 0x006bff);
  const pug = createPug(floor.state === "disabled" ? 0x9b9388 : 0xcaa678);
  pug.scale.setScalar(1.08);
  pug.position.set(-1.18, 0.14, 0.35);
  group.add(pug);
  animatedPugs.push({ root: pug, baseY: pug.position.y, phase: 2.4, state: floor.state });
  return group;
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.quality === "full" ? 2 : 1.25));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 120);
  const cityRoot = new THREE.Group();
  scene.add(cityRoot);

  let projection = options.projection;
  let theme = options.theme;
  let reducedMotion = options.reducedMotion;
  let visible = true;
  let disposed = false;
  let width = 1;
  let height = 1;
  let animationFrame = 0;
  let lastFrame = performance.now();
  let frameSamples: number[] = [];
  let animatedPugs: AnimatedPug[] = [];
  let animatedRoutes: AnimatedRoute[] = [];
  const anchorObjects = new Map<string, THREE.Object3D>();

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

  function applyTheme(): void {
    scene.background = new THREE.Color(theme === "dark" ? NIGHT_SKY : DAY_SKY);
    scene.fog = new THREE.Fog(theme === "dark" ? NIGHT_SKY : DAY_SKY, 28, 62);
    ambient.intensity = theme === "dark" ? 1.45 : 1.8;
    sun.color.setHex(theme === "dark" ? 0x9fc6ff : 0xfff4df);
    sun.intensity = theme === "dark" ? 2.2 : 3.4;
  }

  function addRoute(floor: AgentCityFloor): void {
    if (!floor.route) return;
    const points = floor.route.points.map((point) => new THREE.Vector3(point.x, point.y + 0.11, point.z));
    const curve = new THREE.CatmullRomCurve3(points);
    const color = floor.route.phase === "failed" ? 0xea001d : floor.route.phase === "returning" ? 0x28a948 : 0x006bff;
    const lineMaterial = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.65, transparent: true, opacity: 0.78 });
    const route = mesh(new THREE.TubeGeometry(curve, 42, 0.045, 8, false), lineMaterial);
    route.castShadow = false;
    cityRoot.add(route);
    const capsule = mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.2 }));
    cityRoot.add(capsule);
    animatedRoutes.push({ capsule, curve, phase: floor.route.phase, offset: floor.floorIndex * 0.13 + (typeof floor.buildingIndex === "number" ? floor.buildingIndex * 0.07 : 0) });
  }

  function rebuild(): void {
    disposeObject(cityRoot);
    cityRoot.clear();
    anchorObjects.clear();
    animatedPugs = [];
    animatedRoutes = [];

    const groundColor = theme === "dark" ? 0x1d282f : 0xdfe7e5;
    const ground = mesh(new THREE.BoxGeometry(34, 0.28, 22), material(groundColor), 0, -0.2, 0);
    ground.receiveShadow = true;
    cityRoot.add(ground);
    for (let index = -2; index <= 2; index += 1) addBox(cityRoot, [0.36, 0.035, 20], theme === "dark" ? 0x33434c : 0xcbd8d5, [index * 5.6, -0.02, 0]);
    addBox(cityRoot, [33, 0.035, 0.42], theme === "dark" ? 0x33434c : 0xcbd8d5, [0, -0.01, 0]);

    const owner = createOwnerCenter(theme === "dark");
    owner.position.set(projection.owner.position.x, projection.owner.position.y, projection.owner.position.z);
    cityRoot.add(owner);
    const ownerAnchor = new THREE.Object3D();
    ownerAnchor.position.set(0, 1.9, 0.8);
    owner.add(ownerAnchor);
    anchorObjects.set("owner", ownerAnchor);

    const headquarters = createGlobalHeadquarters(projection.globalFloor, theme === "dark", animatedPugs);
    headquarters.position.set(projection.globalFloor.position.x, 0, projection.globalFloor.position.z);
    cityRoot.add(headquarters);
    const globalAnchor = new THREE.Object3D();
    globalAnchor.position.set(0, 3.65, 0.8);
    headquarters.add(globalAnchor);
    anchorObjects.set("global", globalAnchor);
    addRoute(projection.globalFloor);

    for (const building of projection.buildings) {
      for (const floor of building.floors) {
        const room = createDollhouseFloor(floor, building.variant, theme === "dark", animatedPugs);
        room.position.set(building.position.x, floor.floorIndex * FLOOR_HEIGHT, building.position.z);
        cityRoot.add(room);
        const anchor = new THREE.Object3D();
        anchor.position.set(0, 2.32, 0.92);
        room.add(anchor);
        anchorObjects.set(floor.key, anchor);
        addRoute(floor);
      }
    }

    const maxHeight = Math.max(3.5, projection.sceneFloors * FLOOR_HEIGHT);
    camera.position.set(24, 19 + maxHeight * 0.65, 28);
    camera.lookAt(0, maxHeight * 0.42, 0);
    applyTheme();
  }

  function updateCamera(): void {
    const aspect = Math.max(0.5, width / Math.max(1, height));
    const vertical = 12 + Math.max(0, projection.sceneFloors - 4) * 1.15;
    camera.left = -vertical * aspect;
    camera.right = vertical * aspect;
    camera.top = vertical;
    camera.bottom = -vertical;
    camera.updateProjectionMatrix();
  }

  function animate(time: number): void {
    if (disposed || !visible) return;
    const delta = Math.min(100, time - lastFrame);
    lastFrame = time;

    if (!reducedMotion) {
      for (const pug of animatedPugs) {
        const speed = pug.state === "working" ? 0.006 : 0.0014;
        const amplitude = pug.state === "disabled" ? 0 : pug.state === "working" ? 0.035 : 0.018;
        pug.root.position.y = pug.baseY + Math.sin(time * speed + pug.phase) * amplitude;
        if (pug.state === "completed") pug.root.rotation.y = Math.sin(time * 0.004 + pug.phase) * 0.16;
      }
      for (const route of animatedRoutes) {
        const direction = route.phase === "returning" ? -1 : 1;
        const progress = ((time * 0.00018 * direction + route.offset) % 1 + 1) % 1;
        route.capsule.position.copy(route.curve.getPoint(progress));
      }
    }

    renderer.render(scene, camera);
    if (options.quality === "full" && frameSamples.length < 180) {
      if (delta > 0 && delta < 100) frameSamples.push(delta);
      if (frameSamples.length === 180) {
        const average = frameSamples.reduce((sum, value) => sum + value, 0) / frameSamples.length;
        if (average > 42) options.onPerformanceFallback();
        frameSamples = [];
      }
    }
    animationFrame = requestAnimationFrame(animate);
  }

  function handleContextLost(event: Event): void {
    event.preventDefault();
    options.onContextLost();
  }

  options.canvas.addEventListener("webglcontextlost", handleContextLost, false);
  rebuild();
  animationFrame = requestAnimationFrame(animate);

  return {
    update(nextProjection) {
      projection = nextProjection;
      rebuild();
      updateCamera();
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
      if (visible) {
        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(animate);
      }
    },
    setTheme(nextTheme) {
      if (theme === nextTheme) return;
      theme = nextTheme;
      rebuild();
    },
    setReducedMotion(nextReducedMotion) {
      reducedMotion = nextReducedMotion;
    },
    getAnchors() {
      const anchors: Record<string, AgentCityAnchor> = {};
      const point = new THREE.Vector3();
      for (const [key, object] of anchorObjects) {
        object.getWorldPosition(point);
        point.project(camera);
        anchors[key] = {
          x: (point.x * 0.5 + 0.5) * width,
          y: (-point.y * 0.5 + 0.5) * height,
          visible: point.z >= -1 && point.z <= 1
        };
      }
      return anchors;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(animationFrame);
      options.canvas.removeEventListener("webglcontextlost", handleContextLost, false);
      disposeObject(cityRoot);
      cityRoot.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
}
