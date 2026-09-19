# Agent Community modular asset contract

Phase 4 splits the visual scene into two layers:

1. **Static art assets** — Momo HQ, regular Studio shells/decor, and Community Hub come from the bundled GLB kit.
2. **Runtime state surfaces** — task boards, main/Worker monitors, Worker Camp expansion surfaces, status beacons, routes, celebration effects, and role accessories stay in Three.js because they change with live Agent state.

This is intentional: replacing the static art must never require changes to activity/state logic.

## Bundled assets

The desktop app loads:

- `/agent-community/community-kit.glb`
- fallback: `/agent-community/community-kit.gltf`

The kit exposes these named components:

- `StudioArchitecture`
- `HQArchitecture`
- `StudioDecor`
- `HQDecor`
- `CommunityHub`

`agentCityCommunityAssets.ts` clones components, applies light/dark palette adaptation, preserves cast/receive shadows, and extracts `GlassTint` materials so room windows continue to reflect live working/error/idle state.

## Runtime-owned visual pieces

These deliberately remain code-owned rather than baked into the GLB:

- main Agent workstation monitor and keyboard
- temporary Worker desk monitors
- Worker Camp expandable platform
- live task/status board cells
- working perimeter/marquee
- route pulse
- completed celebration satellites
- error beacon
- Momo hand props and Worker role accessories

They are not unfinished art. They are dynamic UI surfaces whose materials, visibility, counts, or colors depend on live activity data.

## Blender source regeneration

Use:

```bash
blender --background --python scripts/blender/build_agent_community_assets.py -- \
  --out-dir apps/desktop/public/agent-community \
  --source-dir .art/agent-community
```

The script creates editable source files:

- `.art/agent-community/Momo.blend`
- `.art/agent-community/AgentCommunityKit.blend`

and exports the runtime GLBs.

The repository commits the GLBs so a normal desktop build has no Blender dependency.
