# Agent City Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CSS Agent office with a production-quality Three.js isometric pug micro-city that faithfully projects the existing Desktop Agent Activity contract for 1–100 Agents and degrades accessibly when WebGL is unavailable or expensive.

**Architecture:** Keep Svelte responsible for polling, localization, DOM labels, tooltips, accessibility, and fallbacks. Add a pure `agentCityProjection` boundary that reconciles persistent Agent-to-slot assignments and produces deterministic buildings/floors/state intents; feed that projection into a lifecycle-owned Three.js renderer with no data fetching or ownership logic. Keep Global headquarters and the owner dispatch center outside the 100 regular-Agent slots, and retain the current Activity API unchanged.

**Tech Stack:** Svelte 5, TypeScript, Three.js 0.185.1, CSS semantic classes/Geist tokens, Node test runner, Vite.

## Global Constraints

- Fixed isometric orthographic camera; no rotate, zoom, building, or character controls.
- Exactly 10 regular-Agent buildings, one Global headquarters, and one owner dispatch center.
- Regular Agents fill floors round-robin through 100 slots; Global never consumes a regular slot; Agent 101+ only increments an explicit hidden count.
- Existing Agent Activity polling and contracts remain the only runtime source; never infer tool-specific actions from names or task text.
- Svelte owns data fetching, DOM semantics, localization, errors, and fallback UI; Three.js owns only scene objects, lighting, animation, and hit projection.
- Persist stable regular-Agent slot assignments locally; preserve existing assignments, remove deleted IDs, and assign new IDs to the lowest free slot.
- Render at most 3 Sub-agents independently and aggregate the rest on the parent floor.
- Full 3D, reduced-quality 3D, and polished 2D fallback are automatic; WebGL/context-loss/poor sustained frame rate must never produce a blank page.
- Reduced motion disables ambient/random loops while retaining clear working/completed/error state changes.
- Pause or reduce rendering while hidden/offscreen and release renderer, geometry, material, texture, observer, timer, and event resources on destroy.
- UI supports Chinese/English, light/dark themes, keyboard/focus semantics, Retina DOM labels, and narrow windows.
- Use semantic Svelte class names and existing Geist tokens; do not add raw visual Tailwind utilities or undefined tokens.
- Update `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md` for the delivered feature and verification evidence.

---

## File Map

- Create `apps/desktop/src/lib/chat/agentCityProjection.ts`: deterministic slot reconciliation and Agent/Activity-to-city projection.
- Create `apps/desktop/src/lib/chat/agentCityProjection.test.ts`: boundary tests for counts, stability, statuses, routes, Sub-agent aggregation, and no invented tool intent.
- Create `apps/desktop/src/lib/chat/agentCityScene.ts`: Three.js scene construction, procedural buildings/pugs, animation intents, resize, visibility, quality, context-loss, and disposal.
- Create `apps/desktop/src/lib/chat/AgentCityCanvas.svelte`: canvas lifecycle owner and renderer-to-DOM anchor callback.
- Create `apps/desktop/src/lib/chat/AgentCityFallback.svelte`: information-equivalent 2D city fallback.
- Rewrite `apps/desktop/src/lib/chat/AgentStudioPane.svelte`: preserve polling and compose projection, canvas/fallback, labels, tooltips, status summary, and persistence.
- Modify `apps/desktop/src/lib/i18n.ts`: city, headquarters, overflow, quality/fallback, dispatch, and Sub-agent aggregate copy in both locales.
- Replace the old Agent office block in `apps/desktop/src/styles.css`: semantic city shell, canvas, DOM overlays, fallback, responsive, theme, and reduced-motion styles.
- Modify `apps/desktop/src/chat-ui.test.mjs`: assert the new architecture and remove obsolete CSS-pug assertions.
- Modify `apps/desktop/package.json` and `pnpm-lock.yaml`: add Three.js and include projection tests in Desktop UI tests.
- Modify `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md`: record delivery, supersede the old office direction, and record verification.

---

### Task 1: Deterministic Agent City Projection

**Files:**
- Create: `apps/desktop/src/lib/chat/agentCityProjection.ts`
- Create: `apps/desktop/src/lib/chat/agentCityProjection.test.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: `DesktopAgentItem[]`, `DesktopAgentActivityItem[]`, and a stored `Record<string, number>` slot map.
- Produces: `reconcileAgentCitySlots(agentIds, previous): AgentCitySlotState` and `projectAgentCity(input): AgentCityProjection`.
- `AgentCityProjection` exposes `buildings`, `globalFloor`, `owner`, `hiddenAgentCount`, `sceneFloors`, `workingCount`, and per-floor `route`/`state`/`subagents` intents.

- [ ] Write tests for 0/1/10/11/40/41/100/101 regular Agents, independent Global/owner structures, round-robin floor positions, and hidden overflow.
- [ ] Run `corepack pnpm exec tsx --test apps/desktop/src/lib/chat/agentCityProjection.test.ts` and verify it fails because the module is missing.
- [ ] Implement typed projection models, `statusForAgent`, stable slot reconciliation, building/floor coordinates, owner-to-floor route points, and Sub-agent `visible`/`overflowCount` projection.
- [ ] Add tests proving existing slots do not move, deleted IDs free slots, new IDs fill the lowest free slot, disabled/idle/working/completed/error are exclusive, routes target the exact building/floor, and task text never creates tool-specific intent.
- [ ] Run the projection test and `corepack pnpm --dir apps/desktop run check`; expect all tests to pass and Svelte diagnostics to report 0 errors/0 warnings.

### Task 2: Three.js Scene Kernel

**Files:**
- Create: `apps/desktop/src/lib/chat/agentCityScene.ts`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `AgentCityProjection`, `{ theme, reducedMotion, quality }`, canvas size, and visibility state.
- Produces: `createAgentCityScene(options): AgentCitySceneController` with `update`, `resize`, `setVisible`, `setTheme`, `setReducedMotion`, `getAnchors`, and `dispose`.

- [ ] Add `three@0.185.1` to the Desktop package with pnpm.
- [ ] Implement a fixed orthographic isometric camera, neutral ground/roads, owner dispatch center, separate Global headquarters, 10 stable building plots, and floor stacks whose height comes from `sceneFloors`.
- [ ] Implement reusable procedural geometry/material factories for dollhouse floors, workstations, proxy pugs, assistant apparel, data shafts, ground routes, dispatch capsules, completed returns, and restrained failure beacons.
- [ ] Implement state transitions for disabled/idle/working/completed/error without inferring tools; keep ambient idle motion deterministic, sparse, and disabled under reduced motion.
- [ ] Implement full/low quality presets using capped pixel ratio, shadow enablement, antialias choice, and animation cadence; collect rolling frame timings and request fallback after sustained poor performance.
- [ ] Implement resize, hidden/offscreen throttling, `webglcontextlost` fallback signaling, world-to-screen anchor projection, and complete traversal-based GPU disposal plus `renderer.dispose()`/`forceContextLoss()`.
- [ ] Run `corepack pnpm --dir apps/desktop run check` and `corepack pnpm --dir apps/desktop run build`; expect clean diagnostics and a successful production bundle.

### Task 3: Svelte Canvas Lifecycle and Agent Studio Composition

**Files:**
- Create: `apps/desktop/src/lib/chat/AgentCityCanvas.svelte`
- Rewrite: `apps/desktop/src/lib/chat/AgentStudioPane.svelte`
- Modify: `apps/desktop/src/lib/i18n.ts`

**Interfaces:**
- `AgentCityCanvas` accepts `projection`, `theme`, `reducedMotion`, and callbacks for anchors, quality, and fallback.
- `AgentStudioPane` keeps the existing `copy`, `serviceEndpoint`, `serviceReady`, and `onOpenAgentSettings` props.

- [ ] In `AgentCityCanvas`, feature-detect WebGL2 before creating the renderer, own `ResizeObserver`/`IntersectionObserver`/visibility/media listeners, update the scene when projection/theme/motion changes, and dispose every resource on destroy.
- [ ] In `AgentStudioPane`, retain generation-safe 2.5-second polling, synthesize Global, reconcile/persist slot state under a versioned localStorage key, and derive one projection from explicit dependencies.
- [ ] Render the city canvas as presentation only and render all Agent names/statuses as real DOM buttons/labels positioned from scene anchors; provide hover and focus tooltips with Bot, channel, start time, task preview, model routing, and Sub-agent details.
- [ ] Keep Global and owner labels semantically distinct, show the hidden count above 100, and expose a localized status summary to assistive technology.
- [ ] Add Chinese and English copy for city terminology, dispatch states, headquarters, overflow, team studio aggregation, reduced quality, and 2D fallback.
- [ ] Ensure stale async responses cannot replace newer endpoint/service state by validating a refresh generation before assigning Agents or Activities.
- [ ] Run `corepack pnpm --dir apps/desktop run check`; expect 0 errors and 0 warnings.

### Task 4: Polished 2D Fallback, Responsive Styling, and Theme Fidelity

**Files:**
- Create: `apps/desktop/src/lib/chat/AgentCityFallback.svelte`
- Modify: `apps/desktop/src/styles.css`

**Interfaces:**
- Consumes the same `AgentCityProjection` and localized copy as the 3D view.
- Produces an information-equivalent keyboard-readable city grid with Global, owner, 10 buildings, floors, states, Sub-agent aggregation, and overflow count.

- [ ] Implement the 2D fallback as semantic building/floor cards rather than a blank-canvas error; keep names/statuses always visible and details available by hover/focus.
- [ ] Replace old `.agent-office`, `.agent-desk`, `.pug`, and `.subagent-*` CSS with semantic `.agent-city-*` classes for the scene shell, anchor labels, tooltips, fallback buildings, floor rows, summary, and state surfaces.
- [ ] Use only existing Geist spacing, radii, type, color, and elevation tokens; create a bright natural day treatment and a restrained dark night treatment without simple inversion.
- [ ] Let the city viewport height increase at 2/4/10 floors and permit page vertical scrolling rather than shrinking ten floors into one screen.
- [ ] Add narrow-window layouts that preserve readable labels/tooltips and keep settings access reachable.
- [ ] Add `prefers-reduced-motion` rules that remove decorative transitions/ambient effects while preserving visible state and focus rings.
- [ ] Run Desktop check and build; expect clean diagnostics and successful output.

### Task 5: Behavioral and Lifecycle Tests

**Files:**
- Modify: `apps/desktop/src/chat-ui.test.mjs`
- Modify: `apps/desktop/package.json`
- Test: `apps/desktop/src/lib/chat/agentCityProjection.test.ts`

**Interfaces:**
- Verifies public source architecture and pure projection outputs, not Three.js mesh names or frame interpolation.

- [ ] Replace obsolete assertions for CSS pugs/desks with assertions that `AgentStudioPane` composes `AgentCityCanvas`/`AgentCityFallback`, persists slot state, keeps DOM labels/tooltips, caps direct Sub-agents at 3, displays overflow, and retains visibility-aware polling.
- [ ] Add lifecycle assertions for WebGL2 detection, context-loss handling, `ResizeObserver`, `IntersectionObserver`, visibility throttling, reduced-motion handling, resource disposal, and no controls import.
- [ ] Add style assertions for semantic city classes, responsive rules, dark theme, focus-visible treatment, and reduced-motion coverage; assert obsolete CSS-office selectors are absent.
- [ ] Update the Desktop test script to run the projection test before existing UI and Rust tests.
- [ ] Run `corepack pnpm --dir apps/desktop run test`; expect projection/UI/Rust suites to pass.
- [ ] Run `corepack pnpm run test:desktop-chat`; expect the existing server Activity aggregation and Desktop API suites to pass unchanged.

### Task 6: Documentation, Visual Exercise, and Final Verification

**Files:**
- Modify: `features.md`
- Modify: `prd.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

**Interfaces:**
- Records the delivered procedural-asset release and explicitly leaves formal Blender GLB production as a later asset replacement milestone.

- [ ] Mark the old single-floor CSS office direction as superseded and record the Three.js city, stable 100-slot projection, Global/owner separation, Sub-agent collaboration bays, automatic quality/fallback, accessibility, and lifecycle behavior.
- [ ] Record exact verification results in `CHANGELOG.md` and `features.md` after commands complete.
- [ ] Start the Desktop Vite UI and exercise the Agent page at representative 1/10/40/100 data scales where the local environment permits; inspect light, dark, narrow, reduced-motion, and fallback states. If the harness cannot drive the Tauri/WebView UI, state that limitation explicitly and do not claim visual validation.
- [ ] Run `corepack pnpm --dir apps/desktop run check`; require 0 errors and 0 warnings.
- [ ] Run `corepack pnpm --dir apps/desktop run build`; require success.
- [ ] Run `corepack pnpm --dir apps/desktop run test`; require all Desktop UI and Rust tests to pass.
- [ ] Run `corepack pnpm run test:desktop-chat`; require all touched server/API tests to pass.
- [ ] Run `git diff --check` and inspect `git diff --stat`/`git status --short` for accidental files, secrets, generated artifacts, absolute paths, and out-of-scope changes.
- [ ] Perform adversarial review of the five likeliest failures: unstable slot migration, stale Activity mutation, blank WebGL failure, leaked GPU/listener resources, and unreadable ten-floor/narrow layouts; fix every confirmed issue before reporting completion.
