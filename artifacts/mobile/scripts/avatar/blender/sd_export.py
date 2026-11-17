"""
Checks and exports one avatar asset from the kit (sd_kit.py) to the art
folder the generator reads (scripts/avatar/art/<key>.glb).

    blender -b sd_kit.blend --python scripts/avatar/blender/sd_export.py -- --asset outerwear_varsity
    blender -b sd_kit.blend --python scripts/avatar/blender/sd_export.py -- --asset base --check

  --asset       base | hair_<style> | beard_<style> | a garment template key (sd_contract.json)
  --collection  where the asset's meshes are (default ART_<asset>)
  --out         output file (default scripts/avatar/art/<asset>.glb)
  --check       report only, export nothing
  --blend       open this .blend first (for running as a plain Python script with the bpy module)

Fails (exit 1) on anything the generator or the runtime can't use: unknown
part names, shape keys or bones, a mesh not in the rest pose, or a file over
its triangle budget. Warns about what it will fill in (weights, shape keys).
"""
import json
import os
import re
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"asset": None, "collection": None, "out": None, "check": False, "blend": None, "contract": os.path.join(HERE, "sd_contract.json")}
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-")
        if k == "check":
            out["check"] = True
            i += 1
            continue
        out[k] = argv[i + 1]
        i += 2
    if not out["asset"]:
        sys.exit("sd_export.py: --asset is required")
    out["collection"] = out["collection"] or f"ART_{out['asset']}"
    out["out"] = out["out"] or os.path.join(HERE, "..", "art", f"{out['asset']}.glb")
    return out


def kind_of(asset, K):
    if asset == "base":
        return "base"
    if asset.startswith("hair_") and asset[5:] in K["ids"]["hairStyles"]:
        return "hair"
    if asset.startswith("beard_") and asset[6:] in K["ids"]["facialHair"]:
        return "facialHair"
    if asset in K["templates"]:
        return "garment"
    sys.exit(f"sd_export.py: unknown asset {asset} (base, hair_<style>, beard_<style> or a template: {', '.join(sorted(K['templates']))})")


def allowed_names(kind, K):
    I = K["ids"]
    if kind == "base":
        heads = ["Head"] + [f"Head_{f}" for f in I["faces"]] + [f"Head_{f}_{n}" for f in I["faces"] for n in I["noses"] if n != "button"]
        return ["Body", "Underwear", "Bra", "Eyes", "Iris", "Pupils", "Teeth"] + heads + [f"Lids_{e}" for e in I["eyes"]] + [f"Lashes_{e}" for e in I["eyes"]] + [f"Brows_{b}" for b in I["eyebrows"]]
    if kind == "hair":
        return ["Hair", "HairTie"] + [f"Hair_{m}" for m in I["hairModes"]] + [f"HairTie_{m}" for m in I["hairModes"]]
    if kind == "facialHair":
        return ["Beard", "BeardShadow"] + [f"Beard_{f}" for f in I["faces"]] + [f"BeardShadow_{f}" for f in I["faces"]]
    return None  # garments: any names


def allowed_keys(kind, name, K):
    M = K["morphs"]
    face = M["mouth"] + [e for e in M["expressions"] if not e.startswith("eyeBlink")]
    if kind == "garment":
        return M["build"]
    if kind == "facialHair":
        return M["nose"] + face
    if kind == "hair":
        return []
    if name.startswith("Head"):
        return M["build"] + face
    if name.startswith(("Lids_", "Lashes_")):
        return ["eyeBlinkLeft", "eyeBlinkRight", "frameFem"]
    if name in ("Eyes", "Iris", "Pupils"):
        return ["frameFem"]
    if name in ("Body", "Underwear", "Bra"):
        return M["build"]
    return []


def tri_count(obj):
    me = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    return n


def main():
    a = args()
    if a["blend"]:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a["blend"]))
    with open(a["contract"]) as f:
        K = json.load(f)
    kind = kind_of(a["asset"], K)
    coll = bpy.data.collections.get(a["collection"])
    if coll is None:
        sys.exit(f"sd_export.py: no collection {a['collection']}")
    meshes = [o for o in coll.all_objects if o.type == "MESH"]
    if not meshes:
        sys.exit(f"sd_export.py: {a['collection']} has no meshes")
    bones = {b["name"] for b in K["bones"]}
    errors, warnings = [], []
    names = allowed_names(kind, K)
    budgets = K["budgets"]
    total = 0
    for o in meshes:
        n = re.sub(r"\.\d{3}$", "", o.name)
        if names is not None and n not in names:
            errors.append(f"{o.name}: not a {kind} part name (expected one of {', '.join(names)})")
        # Rest pose: unapplied rotation/scale on a skinned mesh, or a posed armature, breaks the bind.
        arm_mods = [m for m in o.modifiers if m.type == "ARMATURE" and m.object]
        if arm_mods:
            arm = arm_mods[0].object
            if arm.name != K["rig"]:
                warnings.append(f"{o.name}: armature is {arm.name}, not {K['rig']} (bones are matched by name)")
            if any(pb.matrix_basis != pb.matrix_basis.Identity(4) for pb in arm.pose.bones):
                errors.append(f"{o.name}: its armature is posed; export in the rest pose")
            if o.matrix_world != arm.matrix_world:
                warnings.append(f"{o.name}: object transform differs from the armature's; apply it (Ctrl+A) so the bind is the rest pose")
        groups = [g.name for g in o.vertex_groups]
        bad = [g for g in groups if g not in bones]
        if bad and arm_mods:
            errors.append(f"{o.name}: vertex groups that aren't {K['rig']} bones: {', '.join(bad[:6])}")
        if kind in ("base", "garment") and not arm_mods and not (kind == "garment" and K["templates"][a["asset"]]["socket"]):
            warnings.append(f"{o.name}: not skinned; weights will come from the body")
        keys = [k.name for k in o.data.shape_keys.key_blocks[1:]] if o.data.shape_keys else []
        allowed = allowed_keys(kind, n, K)
        unknown = [k for k in keys if k not in allowed]
        if unknown:
            errors.append(f"{o.name}: shape keys the runtime doesn't drive: {', '.join(unknown)} (allowed: {', '.join(allowed) or 'none'})")
        for k in o.data.shape_keys.key_blocks[1:] if o.data.shape_keys else []:
            if k.relative_key != o.data.shape_keys.reference_key:
                errors.append(f"{o.name}: shape key {k.name} must be relative to Basis")
        mats = [s.material.name if s.material else "" for s in o.material_slots] or [""]
        for m in mats:
            mb = re.sub(r"\.\d{3}$", "", m)
            ok = K["materials"]["tint"] + ["plastic"] if kind == "garment" else K["materials"][kind]
            if mb not in ok:
                (errors if kind != "garment" else warnings).append(f"{o.name}: material '{m}' is not one of {', '.join(ok)}")
            mat = bpy.data.materials.get(m)
            if mat is not None and "sdLook" in mat and mat["sdLook"] not in K["fabrics"]:
                errors.append(f"material {m}: sdLook '{mat['sdLook']}' is not one of {', '.join(K['fabrics'])}")
        t = tri_count(o)
        total += t
        print(f"  {o.name:28s} {t:6d} tris  keys: {', '.join(keys) or '-'}  groups: {len(groups)}")
    file_budget = budgets["files"][kind]["tris"]
    if kind == "garment":
        file_budget = min(file_budget, K["templates"][a["asset"]]["tris"] * 1.25)
    if total > file_budget:
        errors.append(f"{total} triangles, over the {kind} budget of {int(file_budget)}")
    for w in warnings:
        print(f"  warning: {w}")
    for e in errors:
        print(f"  ERROR: {e}")
    print(f"sd_export: {a['asset']} ({kind}) {len(meshes)} meshes, {total} tris, {len(errors)} errors, {len(warnings)} warnings")
    if errors:
        sys.exit(1)
    if a["check"]:
        return

    scene = bpy.context.scene
    scene["sdAvatar"] = {"rig": K["rig"], "version": K["version"], "kind": kind, "asset": a["asset"], "source": bpy.data.filepath and os.path.basename(bpy.data.filepath)}
    bpy.ops.object.select_all(action="DESELECT")
    sel = set(meshes)
    for o in meshes:
        for m in o.modifiers:
            if m.type == "ARMATURE" and m.object:
                sel.add(m.object)
        p = o.parent
        while p is not None:  # sockets / bones the mesh hangs from
            sel.add(p)
            p = p.parent
    for o in sel:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    opts = dict(
        filepath=os.path.abspath(a["out"]),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_skins=True,
        export_all_influences=False,
        export_morph=True,
        export_morph_normal=False,
        export_tangents=(kind == "hair"),
        export_extras=True,
        export_animations=False,
        export_texcoords=True,
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_def_bones=False,
        export_cameras=False,
        export_lights=False,
    )
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    os.makedirs(os.path.dirname(os.path.abspath(a["out"])), exist_ok=True)
    bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in known})
    print(f"sd_export: wrote {a['out']}")


if __name__ == "__main__":
    main()
