import hashlib
import json
import sys
from pathlib import Path

import bpy
import bmesh

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'tmp' / 'coastal-source'
STREET = '--street' in sys.argv
OUTPUT = ROOT / 'public' / 'models' / ('street' if STREET else 'coastal')
LIMITS = {
    'wooden_picnic_table': 4500,
    'wooden_crate_02': 1800,
    'plastic_crate_01': 2400,
    'lifebuoy': 1400,
    'lambis_shell': 800,
    'boulder_01': 3500,
    'outdoor_table_chair_set_01': 1600,
    'planter_box_01': 600,
}


def triangles(objects):
    total = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


OUTPUT.mkdir(parents=True, exist_ok=True)
records = json.loads((SOURCE / ('sources-street.json' if STREET else 'sources.json')).read_text(encoding='utf8'))
for record in records:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE / record['file']))
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    before = triangles(objects)
    ratio = min(1.0, LIMITS[record['id']] / max(1, before))
    for obj in objects:
        if record['id'] == 'boulder_01' or STREET:
            # glTF splits coincident vertices at shading/UV seams; weld positions
            # while retaining per-corner UVs so collapse can simplify the surface.
            mesh = bmesh.new()
            mesh.from_mesh(obj.data)
            bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=0.00001)
            mesh.to_mesh(obj.data)
            mesh.free()
        if ratio < 1:
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new('Browser triangle budget', 'DECIMATE')
            modifier.ratio = ratio
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        if STREET:
            obj.data.validate(clean_customdata=False)
            obj.data.update()
    if triangles(objects) > LIMITS[record['id']] + 10:
        raise RuntimeError(f"Decimation did not meet the budget for {record['id']}")
    if record['id'] == 'boulder_01':
        for obj in list(objects):
            lod = obj.copy()
            lod.data = obj.data.copy()
            lod.name = 'CoastalShoreLOD'
            lod.data.name = 'CoastalShoreLOD'
            bpy.context.collection.objects.link(lod)
            bpy.context.view_layer.objects.active = lod
            modifier = lod.modifiers.new('Distant shore instances', 'DECIMATE')
            modifier.ratio = 480 / max(1, triangles(objects))
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            objects.append(lod)
    texture_limit = 1024 if record['id'] == 'wooden_picnic_table' else 512
    for image in bpy.data.images:
        if image.type != 'IMAGE' or not image.size[0]:
            continue
        scale = min(1.0, texture_limit / max(image.size))
        image.scale(max(1, round(image.size[0] * scale)), max(1, round(image.size[1] * scale)))
    target = OUTPUT / f"{record['id']}.glb"
    credits = ', '.join(record['authors'])
    bpy.ops.export_scene.gltf(
        filepath=str(target), export_format='GLB', export_apply=True,
        export_image_format='JPEG', export_image_quality=85,
        export_animations=False, export_copyright=f"CC0-1.0 | {credits} | {record['source']}",
    )
    record.update({
        'file': target.name, 'sourceTriangles': before, 'triangles': triangles(objects),
        'textureLimit': texture_limit, 'bytes': target.stat().st_size,
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'processing': 'Blender 4.5 decimation, reduced textures, embedded glTF 2.0',
    })
    print(f"COASTAL {record['id']}: {before} -> {record['triangles']} triangles, {record['bytes']} bytes", flush=True)
(OUTPUT / 'manifest.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf8')
