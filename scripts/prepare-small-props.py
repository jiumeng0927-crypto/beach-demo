"""Rebudget small verified props so added furniture does not inflate frame cost."""
import hashlib
import json
from pathlib import Path
import bpy
import bmesh

folder = Path(__file__).resolve().parents[1] / 'public/models/coastal'
manifest_path = folder / 'manifest.json'
records = json.loads(manifest_path.read_text(encoding='utf8'))
limits = {'lifebuoy': 1400, 'lambis_shell': 800}
for record in records:
    if record['id'] not in limits or record['triangles'] <= limits[record['id']]:
        continue
    target = folder / record['file']
    source_hash = hashlib.sha256(target.read_bytes()).hexdigest()
    if source_hash != record['sha256']:
        raise ValueError(f"Unverified source: {target}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(target))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    ratio = limits[record['id']] / record['triangles']
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        mesh = bmesh.new(); mesh.from_mesh(obj.data)
        bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=0.000001)
        mesh.to_mesh(obj.data); mesh.free()
        modifier = obj.modifiers.new('Small prop screen-space budget', 'DECIMATE')
        modifier.ratio = ratio; modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.data.validate(clean_customdata=False); obj.data.update()
        obj.data.calc_loop_triangles()
    triangles = sum(len(o.data.loop_triangles) for o in meshes)
    if triangles > limits[record['id']] or triangles < 100:
        raise ValueError('Unexpected decimation result')
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_apply=True,
        export_animations=False, export_copyright=f"CC0-1.0 | {record['source']}")
    record.update(previousWebSha256=source_hash, triangles=triangles, bytes=target.stat().st_size,
        sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
        processing=record['processing'] + '; 0.45 small-prop weld/decimation; retain PBR textures')
    print('SMALL_PROP', record['id'], triangles, record['bytes'], flush=True)
manifest_path.write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
