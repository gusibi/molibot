# Momo Blender / GLB asset contract

Agent Community now treats the character model as a replaceable asset boundary. The desktop runtime first loads `/agent-community/momo.glb` and falls back to the bundled `momo.gltf` prototype, so a Blender-authored asset can replace the prototype without changing Agent/Activity code.

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

Target the hero Momo asset at roughly 8k–20k triangles and keep texture use optional. There can be up to 11 persistent Agent Momo instances on screen, so geometry/material sharing matters more than cinematic detail. Temporary Sub-agent workers remain on the procedural lightweight rig for now.

## Export

Run:

```bash
blender Momo.blend --background --python scripts/blender/export_momo.py -- \
  --output apps/desktop/public/agent-community/momo.glb
```

The exporter validates the required root, armature, and clip names before writing the GLB. The committed `momo.gltf` is a lightweight animated prototype/fallback and should not be treated as the final Blender art asset.
