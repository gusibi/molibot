# Momo Blender / GLB asset contract

Agent Community treats the character model as a replaceable asset boundary. The desktop runtime loads the shipped `/agent-community/momo.glb` first and keeps `momo.gltf` as a readable fallback. Both persistent Agents and temporary Sub-agent Workers use this same Momo asset; role identity stays in lightweight runtime accessories and props.

## Scene contract

- Root object: `MomoRoot`.
- Armature: `MomoRig`.
- Local origin should sit at the paws/floor contact point; +Y is up after glTF export.
- Keep the character around 1.25–1.4 local units tall. Runtime scaling handles Momo HQ vs normal Studio size.
- Momo should face +Z in its neutral pose.
- Materials should stay compact: one fawn coat, one light face/chest material, one dark mask/ears material, one ink/eye material, and one vest material are enough for the hero asset.
- Avoid environment geometry inside the character GLB. Room props, Worker Camp desks, task screens, state lights, and role accessories stay owned by Three.js.

## Required animation clips

The GLB must contain these exact clip names:

`Idle`, `Walk`, `Typing`, `Thinking`, `Scan`, `Reading`, `Reviewing`, `Phone`, `Sleep`, `Celebrate`, `Error`, `Wave`, `Coffee`.

The runtime maps Agent behavior to these names and cross-fades between them with `AnimationMixer`. The clip contract is intentionally semantic rather than tool-specific: future runtime roles reuse these clips instead of requiring a new animation per Sub-agent name.

## Animation guidance

- **Idle**: breathing, small head movement, tail motion; no large translation.
- **Walk**: readable paw cycle and body bob; runtime owns the actual room-space travel path.
- **Typing**: alternating front paws and forward lean.
- **Thinking**: stop typing, one paw near chin, head/ear movement.
- **Scan**: sweeping head/device gesture; Scan Worker accessory stays a Three.js layer.
- **Reading / Reviewing**: clearly different tempo; Reviewing should feel more deliberate/checking-oriented.
- **Phone / Coffee**: relaxed ambient behaviors.
- **Sleep**: low silhouette that still keeps paws above the floor plane.
- **Celebrate**: short energetic jump / both paws up.
- **Error**: short alert/panic motion, not a continuous violent shake.
- **Wave**: one-paw greeting aimed at the viewer.

Clips should loop cleanly except the semantic one-shots `Celebrate` and `Wave`; the runtime may still hold/restart them when status demands it.

## Performance budget

Target the hero Momo asset at roughly 8k–20k triangles and keep texture use optional. A community can render the persistent Agents plus up to 12 animated Workers per active parent, so geometry/material sharing matters more than cinematic detail. Runtime clones share immutable GLTF geometry/materials while keeping independent AnimationMixers and role accessories.

## Export

The repository has two Blender paths.

To rebuild both Phase 3 and Phase 4 art sources from scratch:

```bash
blender --background --python scripts/blender/build_agent_community_assets.py -- \
  --out-dir apps/desktop/public/agent-community \
  --source-dir .art/agent-community
```

This creates editable `Momo.blend` and `AgentCommunityKit.blend` source files and exports `momo.glb` plus `community-kit.glb`.

For an artist-edited `Momo.blend`, use the stricter validator/exporter:

```bash
blender Momo.blend --background --python scripts/blender/export_momo.py -- \
  --output apps/desktop/public/agent-community/momo.glb
```

The runtime GLBs are committed, so the desktop app does not require Blender to run. The text `.gltf` files remain deterministic fallbacks/debug assets.
