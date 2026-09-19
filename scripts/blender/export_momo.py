"""Validate and export the Blender-authored Momo hero asset.

Usage:
  blender Momo.blend --background --python scripts/blender/export_momo.py -- \
    --output apps/desktop/public/agent-community/momo.glb

The desktop runtime prefers momo.glb and falls back to the bundled momo.gltf
prototype when this file is absent or cannot be loaded.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

import bpy

REQUIRED_ACTIONS = (
    "Idle",
    "Walk",
    "Typing",
    "Thinking",
    "Scan",
    "Reading",
    "Reviewing",
    "Phone",
    "Sleep",
    "Celebrate",
    "Error",
    "Wave",
    "Coffee",
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--root", default="MomoRoot")
    parser.add_argument("--rig", default="MomoRig")
    return parser.parse_args(argv)


def validate(root_name: str, rig_name: str) -> bpy.types.Object:
    root = bpy.data.objects.get(root_name)
    if root is None:
        raise RuntimeError(f"Missing required root object: {root_name}")

    rig = bpy.data.objects.get(rig_name)
    if rig is None or rig.type != "ARMATURE":
        raise RuntimeError(f"Missing required armature: {rig_name}")

    missing = [name for name in REQUIRED_ACTIONS if bpy.data.actions.get(name) is None]
    if missing:
        raise RuntimeError("Missing Momo animation actions: " + ", ".join(missing))

    # Keep clips alive even when no NLA strip currently references them.
    for name in REQUIRED_ACTIONS:
        bpy.data.actions[name].use_fake_user = True

    return root


def export_glb(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    common = dict(
        filepath=str(output),
        export_format="GLB",
        export_animations=True,
        export_force_sampling=True,
        export_yup=True,
        export_apply=False,
    )

    # Blender's glTF exporter has evolved over time. Newer versions can export
    # every armature Action directly; older versions still export the active/NLA
    # clips with the common options below.
    try:
        bpy.ops.export_scene.gltf(
            **common,
            export_animation_mode="ACTIONS",
            export_all_armature_actions=True,
        )
    except (TypeError, ValueError):
        bpy.ops.export_scene.gltf(**common)


def main() -> None:
    args = parse_args()
    validate(args.root, args.rig)
    output = Path(args.output).expanduser().resolve()
    export_glb(output)
    print(f"Exported Momo GLB: {output}")


if __name__ == "__main__":
    main()
