"""
Builds the authoring kit: a .blend with the sd_rig_v3 armature and sockets,
the current procedural character as a locked reference, and the guides an
artist models against (garment layer shells, the shared cranium hats and
hair are fitted to, the eye and mouth landmarks the face parts use).

    blender -b --python scripts/avatar/blender/sd_kit.py -- \
        --base artifacts/mobile/assets/avatar/sd_base_v3.glb --out sd_kit.blend

Everything numeric comes from sd_contract.json (node scripts/avatar/contract.mjs),
so the kit always matches the generator and the checks. Works headless; tested
with Blender 5.x (the bpy module) and should work on 4.2+.

Coordinates: the glTF files are +Y up, facing +Z. Blender is +Z up; the glTF
importer/exporter convert, so in Blender the character faces -Y and a glTF
point (x, y, z) sits at (x, -z, y).
"""
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"base": None, "out": "sd_kit.blend", "contract": os.path.join(HERE, "sd_contract.json")}
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-")
        out[k] = argv[i + 1]
        i += 2
    if not out["base"]:
        sys.exit("sd_kit.py: --base path/to/sd_base_v3.glb is required")
    return out


def gl(p):
    """glTF (y up, +z forward) → Blender (z up, -y forward)."""
    return (p[0], -p[2], p[1])


def collection(name, parent=None):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in (parent or bpy.context.scene.collection).children:
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def move_to(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def main():
    a = args()
    with open(a["contract"]) as f:
        K = json.load(f)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    # Rest pose as authored: the bones' own transforms (guessing a bind pose from the quantised file's
    # inverse bind matrices misplaces them), and no animation (the importer poses the first clip).
    bpy.ops.import_scene.gltf(filepath=a["base"], guess_original_bind_pose=False, bone_heuristic="TEMPERANCE")

    rig = collection("RIG")
    ref = collection("REF_procedural")
    guides = collection("GUIDES")
    art = collection("ART")
    for sub in ("ART_base",):
        collection(sub, art)

    arm = next((o for o in scene.objects if o.type == "ARMATURE"), None)
    if arm is None:
        sys.exit("sd_kit.py: no armature in the base file")
    arm.name = K["rig"]
    arm.data.name = K["rig"]
    arm.show_in_front = True
    arm.data.display_type = "STICK"
    arm.animation_data_clear()
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    bpy.context.view_layer.update()
    missing = [b["name"] for b in K["bones"] if b["name"] not in arm.data.bones]
    if missing:
        sys.exit(f"sd_kit.py: base armature is missing bones {missing}")

    for o in list(scene.objects):
        if o.type == "ARMATURE" or (o.type == "EMPTY" and o.name.startswith("Socket_")):
            move_to(o, rig)
            if o.type == "EMPTY":
                o.empty_display_type = "SPHERE"
                o.empty_display_size = 0.01
        elif o.type == "MESH":
            move_to(o, ref)
            o.hide_select = True
            o.hide_render = True
        elif o.type == "EMPTY":
            move_to(o, rig)
    # Only one head / lid / brow variant visible in the reference, like the runtime.
    for o in ref.objects:
        variant = o.name.startswith(("Head_", "Lids_", "Lashes_", "Brows_"))
        keep = o.name in ("Head_oval", "Lids_round", "Lashes_round", "Brows_soft")
        o.hide_set(variant and not keep)
        if o.name == "Bra":
            o.hide_set(True)

    # Garment layer guides: the body pushed out by each layer's offset (contract.layerOffset).
    body = [o for o in ref.objects if o.name.startswith("Body_")]
    if body:
        bpy.ops.object.select_all(action="DESELECT")
        copies = []
        for o in body:
            c = o.copy()
            c.data = o.data.copy()
            c.modifiers.clear()
            c.shape_key_clear() if c.data.shape_keys else None
            guides.objects.link(c)
            copies.append(c)
        with bpy.context.temp_override(active_object=copies[0], selected_editable_objects=copies, selected_objects=copies):
            bpy.ops.object.join()
        joined = copies[0]
        joined.name = "GUIDE_skin"
        joined.vertex_groups.clear()
        mw = joined.matrix_world.copy()
        joined.parent = None
        joined.matrix_world = mw
        for layer in ("base", "bottom", "top", "outer", "shoes"):
            g = joined.copy()
            g.data = joined.data.copy()
            g.name = f"GUIDE_layer_{layer}"
            mod = g.modifiers.new("offset", "DISPLACE")
            mod.direction = "NORMAL"
            mod.mid_level = 0.0
            mod.strength = K["layerOffset"][layer]
            g.display_type = "WIRE"
            g.hide_select = True
            g.hide_render = True
            guides.objects.link(g)
            g.hide_set(layer != "top")
        joined.hide_set(True)
        joined.hide_render = True

    # Head guides: the shared cranium (hats and hair fit to it), the eyeballs, the mouth line.
    cr = K["head"]["cranium"]
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0, location=gl(cr["center"]))
    s = bpy.context.active_object
    s.name = "GUIDE_cranium"
    s.scale = (cr["radii"][0], cr["radii"][2], cr["radii"][1])
    s.display_type = "WIRE"
    s.hide_render = True
    move_to(s, guides)
    eye = K["head"]["eye"]
    for side in (1, -1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=eye["r"], location=gl([eye["x"] * side, eye["y"], eye["z"]]))
        e = bpy.context.active_object
        e.name = f"GUIDE_eye_{'L' if side > 0 else 'R'}"
        e.display_type = "WIRE"
        e.hide_render = True
        move_to(e, guides)
    m = K["head"]["mouth"]
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=gl([0, m["y"], m["z"]]))
    mo = bpy.context.active_object
    mo.name = "GUIDE_mouth_line"
    mo.scale = (m["w"] * 2, 0.002, 0.0006)
    mo.display_type = "WIRE"
    mo.hide_render = True
    move_to(mo, guides)

    # A readme inside the file.
    t = bpy.data.texts.new("SD_README")
    t.write(README.format(rig=K["rig"], templates=", ".join(sorted(K["templates"]))))
    scene["sd_contract"] = os.path.relpath(a["contract"], os.path.dirname(os.path.abspath(a["out"])))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a["out"]))
    print(f"sd_kit: wrote {a['out']}")


README = """SportDrip avatar kit ({rig})

Model in the rest pose, in metres, on the {rig} armature. Don't move, rename or rotate bones.

Collections
  RIG             armature + Socket_* empties (HeadTop, Face, Neck, Wrist_L/R)
  REF_procedural  the current generated character, locked (reference only)
  GUIDES          GUIDE_layer_<base|bottom|top|outer|shoes>: where each garment layer's surface goes
                  GUIDE_cranium: hats and hair are fitted to this; keep the scalp within ~3 mm of it
                  GUIDE_eye_L/R, GUIDE_mouth_line: the eyes, lids, lashes and mouth blendshapes use these
  ART/ART_<asset> what gets exported: one collection per asset (ART_base, ART_top_tee, ART_hair_fade, ...)

Names (exact)
  base:     Body, Underwear, Bra, Head (or Head_<face>, Head_<face>_<nose>), optionally Eyes, Iris,
            Pupils, Teeth, Lids_<eye>, Lashes_<eye>, Brows_<brow>
  hair:     Hair, Hair_capped, Hair_covered, Hair_helmet, Hair_banded, [HairTie, HairTie_<mode>]
  beard:    Beard (or Beard_<face>), [BeardShadow / BeardShadow_<face>]
  garments: any mesh names; materials primary / secondary / primary_dark / secondary_dark /
            metal / lens / sole / laces (colour comes from the item). Optional custom property
            sdLook on a material: cotton, fleece, mesh, nylon, leather, wool, knit, canvas, plastic,
            rubber, suede, denim.
Shape keys (optional; the pipeline fills in what's missing)
  buildSlim, buildBroad, frameFem; heads/beards: lipsFull, mouthWide, mouthSmileLeft/Right, jawOpen
Weights (optional): vertex groups named after bones, ≤ 4 per vertex. Without them the body's are used.

Templates: {templates}

Export:  blender -b sd_kit.blend --python scripts/avatar/blender/sd_export.py -- --asset <key>
Then:    node scripts/avatar/generate.mjs --only <key>   and the checks (AVATAR_3D.md §2.2).
"""

if __name__ == "__main__":
    main()
