"""Export Quaternius' CC0 casual visitors, retaining authored skeletal clips."""
import bpy
import json
import hashlib
import sys
import math
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
gender = sys.argv[sys.argv.index('--') + 1]
if gender not in ('Female', 'Male'):
    raise ValueError('Expected Female or Male')
manifest_path = root / 'public/models/npc/manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
entry = next(item for item in manifest if item['sourceFile'] == f'Casual_{gender}.blend')
source = root / 'tmp/npc-source' / entry['sourceFile']
if hashlib.sha256(source.read_bytes()).hexdigest() != entry['sourceSha256']:
    raise ValueError('Original author source checksum mismatch')
bpy.ops.wm.open_mainfile(filepath=str(source), use_scripts=False)
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH')
armature.data.pose_position = 'REST'
bpy.context.view_layer.objects.active = body
for modifier in list(body.modifiers):
    if modifier.type == 'NODES':
        body.modifiers.remove(modifier)
subdivision = body.modifiers.new('Coastal silhouette', 'SUBSURF')
subdivision.levels = 1
subdivision.render_levels = 1
bpy.ops.object.modifier_move_up(modifier=subdivision.name)
bpy.ops.object.modifier_apply(modifier=subdivision.name)
reduction = body.modifiers.new('Web silhouette budget', 'DECIMATE')
reduction.ratio = .4
bpy.ops.object.modifier_move_up(modifier=reduction.name)
bpy.ops.object.modifier_apply(modifier=reduction.name)
for polygon in body.data.polygons:
    polygon.use_smooth = True
palette = {'Shirt': (0.588, 0.341, 0.286, 1) if gender == 'Female' else (0.22, 0.43, 0.44, 1),
           'Pants': (0.15, 0.18, 0.19, 1), 'Belt': (0.075, 0.062, 0.047, 1),
           'Hair': (0.10, 0.058, 0.036, 1), 'Face': (0.015, 0.021, 0.023, 1),
           'Skin': (0.75, 0.49, 0.33, 1)}
colors = body.data.color_attributes.new(name='CoastalColor', type='FLOAT_COLOR', domain='CORNER')
for polygon in body.data.polygons:
    color = palette[body.data.materials[polygon.material_index].name]
    for loop in polygon.loop_indices:
        colors.data[loop].color = color
    polygon.material_index = 0
material = bpy.data.materials.new('VisitorCloth')
material.use_nodes = True
material.node_tree.nodes.clear()
shader = material.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
output_node = material.node_tree.nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(shader.outputs['BSDF'], output_node.inputs['Surface'])
shader.inputs['Roughness'].default_value = 0.88
vertex = material.node_tree.nodes.new('ShaderNodeVertexColor')
vertex.layer_name = 'CoastalColor'
material.node_tree.links.new(vertex.outputs['Color'], shader.inputs['Base Color'])
body.data.materials.clear()
body.data.materials.append(material)

# Accessories share the same vertex-colored material and the existing rig.
# Rigid bone weights retain the author's Idle/Walk/Victory animation clips.
accessories = []
def finish(obj, name, color, bone):
    obj.name = name
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    colors = obj.data.color_attributes.new(name='CoastalColor', type='FLOAT_COLOR', domain='CORNER')
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
        for loop in polygon.loop_indices:
            colors.data[loop].color = (*color, 1)
    obj.data.materials.append(material)
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    accessories.append(obj)
    return obj

def oval(name, position, scale, color, bone='Head'):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=position)
    obj = bpy.context.object
    obj.scale = scale
    return finish(obj, name, color, bone)

def strap(start, end, radius, color, bone='Torso'):
    a, b = Vector(start), Vector(end)
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=radius, depth=(b-a).length, location=(a+b)/2)
    obj = bpy.context.object
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return finish(obj, 'Stitched strap', color, bone)

linen = (.76, .71, .56)
if gender == 'Female':
    oval('Woven sun hat brim', (0, .01, 3.04), (.74, .67, .045), linen)
    oval('Woven sun hat crown', (0, .04, 3.13), (.49, .46, .22), linen)
    oval('Hat ribbon', (0, .02, 3.087), (.51, .48, .054), (.12, .29, .29))
    oval('Canvas collecting bag', (.43, -.21, 1.14), (.22, .12, .24), (.65, .68, .57), 'Torso')
    oval('Bag front pocket', (.43, -.322, 1.12), (.13, .018, .14), (.47, .53, .40), 'Torso')
    strap((-.28, -.27, 1.93), (.43, -.31, 1.23), .036, (.37, .40, .30))
else:
    oval('Sea green cap', (0, .05, 3.16), (.53, .48, .23), (.12, .34, .34))
    oval('Cap visor', (0, -.41, 3.13), (.45, .37, .035), (.10, .25, .26))
    for x in [-.20, .20]:
        oval('Sunglass frame', (x, -.525, 2.54), (.177, .038, .13), (.035, .055, .065))
        oval('Sunglass lens', (x, -.561, 2.54), (.139, .012, .10), (.14, .25, .29))
    strap((-.05, -.55, 2.55), (.05, -.55, 2.55), .018, (.06, .085, .085), 'Head')
for side, x in [('L', .264), ('R', -.264)]:
    oval('Canvas shoe', (x, -.07, .08), (.17, .26, .13), (.83, .81, .72), f'Foot.{side}')
    oval('Rubber sole', (x, -.07, -.005), (.173, .263, .038), (.24, .29, .27), f'Foot.{side}')
    for y in [-.14, -.08, -.02]:
        strap((x-.07, y, .184), (x+.07, y, .184), .009, (.95, .95, .87), f'Foot.{side}')
for obj in bpy.context.view_layer.objects:
    obj.select_set(False)
for obj in [body, *accessories]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
armature.data.pose_position = 'POSE'
for action in list(bpy.data.actions):
    if action.name not in ('Idle', 'Walk', 'Victory'):
        bpy.data.actions.remove(action)
armature.animation_data.action = bpy.data.actions.get('Idle')
bpy.context.scene.frame_set(0)
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
for obj in bpy.context.view_layer.objects:
    obj.select_set(False)
armature.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = armature
output = root / 'public/models/npc' / f'casual-{gender.lower()}.glb'
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='ACTIONS', export_frame_range=False,
    export_force_sampling=True, export_anim_slide_to_zero=True, export_skins=True,
    export_cameras=False, export_lights=False, export_yup=True)
print('NPC_EXPORT', json.dumps({'file': output.name, 'bytes': output.stat().st_size,
    'animations': [a.name for a in bpy.data.actions]}))
entry['sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
entry['modificationsLicense'] = 'MIT'
entry['meshTriangles'] = sum(len(p.vertices) - 2 for p in body.data.polygons)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
