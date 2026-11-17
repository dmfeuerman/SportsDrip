# Hand-made avatar assets

`<key>.glb` here replaces the procedural asset of that key when `generate.mjs` builds it. Keys are
`base`, `hair_<style>`, `beard_<style>` and the garment template keys in `templates.mjs`.

Export these files with `blender/sd_export.py` from the authoring kit (`blender/sd_kit.py`). The
contract and workflow are in AVATAR_3D.md §2.2. Delete a file, or set `AVATAR_NO_ART=1`, to go back
to the procedural asset.
