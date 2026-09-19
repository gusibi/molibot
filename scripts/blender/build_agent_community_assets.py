"""Build the Agent Community art source in Blender and export the runtime GLBs.

This is the reproducible source for the rounded Momo mascot and the modular
Momo HQ / Agent Studio / Community Hub kit.  It intentionally uses only bpy,
so an artist can open the generated .blend files and continue sculpting without
changing the runtime contract.

Example:
  blender --background --python scripts/blender/build_agent_community_assets.py -- \
    --out-dir apps/desktop/public/agent-community \
    --source-dir .art/agent-community
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

CLIPS = (
    "Idle", "Walk", "Typing", "Thinking", "Scan", "Reading", "Reviewing",
    "Phone", "Sleep", "Celebrate", "Error", "Wave", "Coffee",
)


def args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out-dir", required=True)
    p.add_argument("--source-dir", required=True)
    return p.parse_args(argv)


def clear() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures):
        for item in list(datablocks):
            if item.users == 0:
                datablocks.remove(item)


def material(name: str, rgb: tuple[float, float, float], rough=.75, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    return m


def smooth(obj) -> None:
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True


def sphere(name, loc, scale, mat, segments=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def cylinder(name, loc, radius, depth, mat, rotation=(0, 0, 0), vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def cube(name, loc, scale, mat, bevel=.04):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0] / 2, scale[1] / 2, scale[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("SoftEdges", "BEVEL")
        mod.width = min(bevel, min(scale) * .3)
        mod.segments = 3
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    smooth(obj)
    return obj


def parent_bone(obj, rig, bone):
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone


def create_rig():
    arm = bpy.data.armatures.new("MomoRig")
    rig = bpy.data.objects.new("MomoRig", arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = {
        "Root": ((0, 0, 0), (0, 0, .28), None),
        "Body": ((0, 0, .25), (0, 0, .78), "Root"),
        "Head": ((0, .03, .72), (0, .06, 1.18), "Body"),
        "Paw.L": ((-.20, .16, .52), (-.20, .18, .18), "Body"),
        "Paw.R": ((.20, .16, .52), (.20, .18, .18), "Body"),
        "Tail": ((-.28, -.14, .52), (-.44, -.18, .68), "Body"),
    }
    for name, (head, tail, parent) in bones.items():
        b = arm.edit_bones.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def create_momo():
    coat = material("WarmFawn", (.79, .61, .42), .86)
    light = material("CreamFawn", (.88, .76, .61), .84)
    mask = material("MaskBrown", (.29, .24, .21), .80)
    ink = material("Ink", (.035, .03, .028), .35)
    ear = material("Ear", (.36, .28, .23), .82)
    vest = material("MomoTeal", (.29, .60, .58), .62)
    white = material("EyeHighlight", (1, 1, 1), .3)
    pink = material("Tongue", (.85, .56, .54), .7)

    root = bpy.data.objects.new("MomoRoot", None)
    bpy.context.collection.objects.link(root)
    rig = create_rig()
    rig.parent = root

    body = sphere("Body", (0, 0, .48), (.43, .48, .39), coat)
    chest = sphere("Chest", (0, .22, .49), (.28, .18, .31), light)
    parent_bone(body, rig, "Body")
    parent_bone(chest, rig, "Body")

    head = sphere("Head", (0, .10, .93), (.40, .34, .35), light)
    parent_bone(head, rig, "Head")
    for side in (-1, 1):
        cheek = sphere(f"Cheek.{side}", (side*.14, .34, .86), (.16, .12, .12), mask)
        eye_white = sphere(f"EyeWhite.{side}", (side*.135, .35, 1.02), (.064, .044, .064), white)
        eye = sphere(f"Eye.{side}", (side*.135, .382, 1.02), (.05, .036, .05), ink)
        shine = sphere(f"EyeHighlight.{side}", (side*.118, .413, 1.043), (.013, .009, .013), white, 16, 10)
        ear_obj = sphere(f"Ear.{side}", (side*.29, .04, 1.13), (.14, .08, .18), ear)
        ear_obj.rotation_euler = (0, side*.18, side*-.35)
        for obj in (cheek, eye_white, eye, shine, ear_obj):
            parent_bone(obj, rig, "Head")
    muzzle = sphere("Muzzle", (0, .39, .84), (.25, .14, .15), mask)
    nose = sphere("Nose", (0, .50, .91), (.085, .045, .05), ink, 20, 12)
    tongue = sphere("Tongue", (0, .47, .75), (.047, .035, .03), pink, 16, 10)
    for obj in (muzzle, nose, tongue):
        parent_bone(obj, rig, "Head")

    for label, x, bone in (("L", -.20, "Paw.L"), ("R", .20, "Paw.R")):
        leg = cylinder(f"FrontPaw.{label}", (x, .20, .35), .085, .30, coat, rotation=(math.pi/2, 0, 0))
        foot = sphere(f"FrontFoot.{label}", (x, .32, .16), (.105, .12, .066), light)
        parent_bone(leg, rig, bone)
        parent_bone(foot, rig, bone)
    for label, x in (("L", -.22), ("R", .22)):
        leg = cylinder(f"BackLeg.{label}", (x, -.08, .19), .09, .27, coat, rotation=(math.pi/2, 0, 0))
        foot = sphere(f"BackFoot.{label}", (x, .08, .07), (.11, .14, .065), light)
        parent_bone(leg, rig, "Body")
        parent_bone(foot, rig, "Body")

    vest_obj = cylinder("Vest", (0, 0, .52), .38, .34, vest, rotation=(math.pi/2, 0, 0), vertices=32)
    parent_bone(vest_obj, rig, "Body")
    bpy.ops.mesh.primitive_torus_add(major_radius=.13, minor_radius=.04, major_segments=24, minor_segments=8, location=(-.34, -.16, .58))
    tail = bpy.context.object
    tail.name = "TailCurl"
    tail.data.materials.append(coat)
    tail.rotation_euler = (math.pi/2, 0, -.35)
    parent_bone(tail, rig, "Tail")

    return root, rig


def set_pose(rig, frame: int, values: dict[str, tuple[float, float, float] | tuple[float, float, float, float]]):
    for bone, value in values.items():
        p = rig.pose.bones[bone]
        if len(value) == 3:
            p.rotation_mode = "XYZ"
            p.rotation_euler = value
            p.keyframe_insert("rotation_euler", frame=frame, group=bone)
        else:
            p.rotation_mode = "QUATERNION"
            p.rotation_quaternion = value
            p.keyframe_insert("rotation_quaternion", frame=frame, group=bone)


def create_actions(rig):
    definitions = {
        "Idle": [(1, {"Head": (0, -.18, .03), "Tail": (0, -.35, 0)}), (35, {"Head": (.02, .22, -.03), "Tail": (0, .35, 0)}), (70, {"Head": (0, -.18, .03), "Tail": (0, -.35, 0)})],
        "Walk": [(1, {"Paw.L": (-.62, 0, 0), "Paw.R": (.30, 0, 0), "Tail": (0, -.5, 0)}), (18, {"Paw.L": (.30, 0, 0), "Paw.R": (-.62, 0, 0), "Tail": (0, .5, 0)}), (36, {"Paw.L": (-.62, 0, 0), "Paw.R": (.30, 0, 0), "Tail": (0, -.5, 0)})],
        "Typing": [(1, {"Body": (-.12, 0, 0), "Paw.L": (-1.25, 0, 0), "Paw.R": (-1.62, 0, 0)}), (8, {"Paw.L": (-1.62, 0, 0), "Paw.R": (-1.25, 0, 0)}), (16, {"Paw.L": (-1.25, 0, 0), "Paw.R": (-1.62, 0, 0)})],
        "Thinking": [(1, {"Head": (-.10, -.32, .13), "Paw.R": (-2.0, 0, -.42)}), (28, {"Head": (-.17, .30, .09), "Paw.R": (-2.22, 0, -.50)}), (55, {"Head": (-.10, -.32, .13), "Paw.R": (-2.0, 0, -.42)})],
        "Scan": [(1, {"Head": (.08, .68, 0), "Paw.R": (-1.8, 0, -.38)}), (24, {"Head": (.08, -.68, 0), "Paw.R": (-1.8, 0, -.38)}), (48, {"Head": (.08, .68, 0), "Paw.R": (-1.8, 0, -.38)})],
        "Reading": [(1, {"Head": (.32, -.10, 0), "Paw.L": (-1.2, 0, .2), "Paw.R": (-1.2, 0, -.2)}), (32, {"Head": (.38, .12, 0)}), (64, {"Head": (.32, -.10, 0)})],
        "Reviewing": [(1, {"Head": (.34, -.12, 0), "Paw.R": (-.98, 0, -.18)}), (20, {"Head": (.40, .10, 0), "Paw.R": (-1.45, 0, -.24)}), (40, {"Head": (.34, -.12, 0), "Paw.R": (-.98, 0, -.18)})],
        "Phone": [(1, {"Body": (-.44, 0, 0), "Paw.L": (-1.55, 0, .13), "Paw.R": (-1.5, 0, -.13)}), (36, {"Head": (.48, .04, 0)}), (72, {"Head": (.42, -.04, 0)})],
        "Sleep": [(1, {"Body": (.11, 0, .20), "Head": (.46, 0, .16)}), (48, {"Body": (.09, 0, .22), "Head": (.50, 0, .18)}), (96, {"Body": (.11, 0, .20), "Head": (.46, 0, .16)})],
        "Celebrate": [(1, {"Paw.L": (-2.38, 0, .46), "Paw.R": (-2.38, 0, -.46)}), (12, {"Head": (-.24, 0, 0)}), (28, {"Head": (-.10, 0, 0)})],
        "Error": [(1, {"Head": (-.08, -.24, .16)}), (5, {"Head": (-.08, .24, -.16)}), (10, {"Head": (-.08, -.24, .16)})],
        "Wave": [(1, {"Paw.R": (-2.0, 0, -.42)}), (8, {"Paw.R": (-2.42, 0, -.12)}), (16, {"Paw.R": (-2.0, 0, -.42)})],
        "Coffee": [(1, {"Head": (.05, 0, 0), "Paw.L": (-1.20, 0, .16), "Paw.R": (-1.14, 0, -.16)}), (28, {"Head": (.30, 0, 0), "Paw.L": (-1.48, 0, .16), "Paw.R": (-1.42, 0, -.16)}), (56, {"Head": (.05, 0, 0)})],
    }
    rig.animation_data_create()
    for name in CLIPS:
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        rig.animation_data.action = action
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="SELECT")
        bpy.ops.pose.transforms_clear()
        bpy.ops.object.mode_set(mode="OBJECT")
        for frame, pose in definitions[name]:
            set_pose(rig, frame, pose)
    rig.animation_data.action = bpy.data.actions["Idle"]


def export_gltf(path: Path, selected=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if selected:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in selected:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = selected[0]
    kwargs = dict(
        filepath=str(path),
        export_format="GLB",
        export_animations=True,
        export_force_sampling=True,
        export_yup=True,
        export_apply=False,
    )
    if selected:
        kwargs["use_selection"] = True
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_animation_mode="ACTIONS", export_all_armature_actions=True)
    except (TypeError, ValueError):
        bpy.ops.export_scene.gltf(**kwargs)


def create_architecture():
    wall = material("WallNeutral", (.84, .83, .80), .84)
    trim = material("TrimNeutral", (.56, .51, .47), .70)
    wood = material("WarmWood", (.50, .41, .34), .72)
    soft = material("SoftFabric", (.56, .65, .68), .92)
    leaf = material("Leaf", (.44, .62, .47), .90)
    pot = material("Pot", (.71, .49, .36), .82)
    glass = material("GlassTint", (.61, .75, .82), .34)
    accent = material("Accent", (.29, .60, .58), .5)

    root = bpy.data.objects.new("CommunityKit", None)
    bpy.context.collection.objects.link(root)

    def component(name, hq=False):
        base = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(base)
        base.parent = root
        w, d, h = (7.0, 5.0, 3.2) if hq else (3.85, 2.4, 2.0)
        for obj in (
            cube("Floor", (0, 0, .10), (w, d, .18), trim, .06),
            cube("BackWall", (0, -d/2+.08, h/2), (w-.25, .16, h), wall, .05),
            cube("LeftWall", (-w/2+.08, 0, h/2), (.16, d, h), wall, .05),
            cube("RightWall", (w/2-.08, 0, h/2), (.16, d, h), wall, .05),
            cube("RoofTrim", (0, 0, h+.04), (w, d, .12), trim, .05),
        ):
            obj.parent = base
        for i in range(5 if hq else 3):
            x = (i - ((5 if hq else 3)-1)/2) * (1.15 if hq else .88)
            window = cube(f"Window{i}", (x, -d/2+.17, h*.62), ((.82 if hq else .62), .04, (.82 if hq else .56)), glass, .035)
            window.parent = base
        return base

    def decor(name, hq=False):
        base = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(base)
        base.parent = root
        sx, sz = (-2.8, -1.9) if hq else (-1.38, -.88)
        shelf = cube("ShelfBody", (sx, sz, .9 if hq else .64), (.72 if hq else .58, .18, 1.6 if hq else 1.08), wood, .045)
        shelf.parent = base
        lx, lz = (-2.0, .9) if hq else (-.78, .45)
        lounge = sphere("Lounge", (lx, lz, .32 if hq else .20), (.72 if hq else .50, .58 if hq else .42, .22 if hq else .16), soft)
        lounge.parent = base
        px, pz = (2.85, 1.75) if hq else (-1.38, .78)
        p = cylinder("Pot", (px, pz, .27), .22, .36, pot)
        p.parent = base
        for dx, dy in ((-.12, 0), (.12, .03), (0, -.08)):
            leaf_obj = sphere("Leaf", (px+dx, pz+dy, .66), (.14, .10, .34), leaf)
            leaf_obj.parent = base
        return base

    component("StudioArchitecture", False)
    component("HQArchitecture", True)
    decor("StudioDecor", False)
    decor("HQDecor", True)

    hub = bpy.data.objects.new("CommunityHub", None)
    bpy.context.collection.objects.link(hub)
    hub.parent = root
    for obj in (
        cylinder("HubBase", (0, 0, .12), 2.2, .24, trim),
        cylinder("HubCore", (0, 0, .78), .55, 1.4, accent),
        sphere("HubOrb", (0, 0, 1.55), (.30, .30, .30), glass),
    ):
        obj.parent = hub
    return root


def main():
    cfg = args()
    out_dir = Path(cfg.out_dir).resolve()
    source_dir = Path(cfg.source_dir).resolve()
    source_dir.mkdir(parents=True, exist_ok=True)

    clear()
    momo_root, rig = create_momo()
    create_actions(rig)
    bpy.ops.wm.save_as_mainfile(filepath=str(source_dir / "Momo.blend"))
    export_gltf(out_dir / "momo.glb")

    clear()
    create_architecture()
    bpy.ops.wm.save_as_mainfile(filepath=str(source_dir / "AgentCommunityKit.blend"))
    export_gltf(out_dir / "community-kit.glb")


if __name__ == "__main__":
    main()
