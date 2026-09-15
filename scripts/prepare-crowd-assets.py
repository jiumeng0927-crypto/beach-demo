"""Build lightweight skeletal visitors from the verified, locally authored NPCs."""
import hashlib
import json
from pathlib import Path
import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / 'public/models/npc'
manifest_path = folder / 'manifest.json'
entries = json.loads(manifest_path.read_text(encoding='utf8'))
entries = [e for e in entries if not e['file'].endswith('-crowd.glb')]
derived = []
for original in entries:
    source = folder / original['file']
    if hashlib.sha256(source.read_bytes()).hexdigest() != original['sha256']:
        raise ValueError('Source NPC checksum mismatch')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    for rig in rigs:
        rig.data.pose_position = 'REST'
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        mesh = bmesh.new(); mesh.from_mesh(obj.data)
        bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=0.000001)
        mesh.to_mesh(obj.data); mesh.free()
        obj.data.calc_loop_triangles()
        modifier = obj.modifiers.new('Street crowd silhouette budget', 'DECIMATE')
        modifier.ratio = min(1, 1400 / max(1, len(obj.data.loop_triangles)))
        modifier.use_collapse_triangulate = True
        while obj.modifiers.find(modifier.name) > 0:
            bpy.ops.object.modifier_move_up(modifier=modifier.name)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.data.validate(clean_customdata=False); obj.data.update()
    for rig in rigs:
        rig.data.pose_position = 'POSE'
    target = folder / original['file'].replace('.glb', '-crowd.glb')
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_animations=True,
        export_animation_mode='ACTIONS', export_force_sampling=True, export_anim_slide_to_zero=True,
        export_skins=True, export_cameras=False, export_lights=False)
    record = dict(original)
    record.update(file=target.name, sourceAsset=original['file'], sourceAssetSha256=original['sha256'],
        sha256=hashlib.sha256(target.read_bytes()).hexdigest(), bytes=target.stat().st_size,
        meshTriangles=sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes),
        modifications='Lightweight street crowd derivative of the authored coastal visitor. Welded and decimated in Blender; original rig, vertex colors and Idle/Walk/Victory retained.')
    derived.append(record)
    print('CROWD', record['file'], record['meshTriangles'], record['bytes'], flush=True)
manifest_path.write_text(json.dumps(entries + derived, indent=2) + '\n', encoding='utf8')
