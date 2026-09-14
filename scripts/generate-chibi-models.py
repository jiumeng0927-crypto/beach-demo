from pathlib import Path
import math

import bpy


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "public" / "characters"
BLEND_DIR = ROOT / "blender"


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def material(name, color, roughness=0.78, metallic=0.0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return result


def vertex_color_material(name, roughness=0.8):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    nodes = result.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    colors = nodes.new("ShaderNodeVertexColor")
    colors.layer_name = "Color"
    result.node_tree.links.new(colors.outputs["Color"], shader.inputs["Base Color"])
    return result


def smooth(object_):
    if object_.type != "MESH":
        return object_
    for polygon in object_.data.polygons:
        polygon.use_smooth = True
    return object_


def sphere(name, location, scale, material_, parent=None, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    object_ = bpy.context.object
    object_.name = name
    object_.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    object_.data.materials.append(material_)
    object_.parent = parent
    return smooth(object_)


def cylinder(
    name,
    location,
    radius,
    depth,
    material_,
    parent=None,
    scale=(1.0, 1.0, 1.0),
    vertices=24,
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
    )
    object_ = bpy.context.object
    object_.name = name
    object_.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    object_.data.materials.append(material_)
    object_.parent = parent
    bevel = object_.modifiers.new("SoftEdges", "BEVEL")
    bevel.width = min(radius, depth) * 0.12
    bevel.segments = 2
    bpy.context.view_layer.objects.active = object_
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return smooth(object_)


def box(name, location, scale, material_, parent=None, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    object_ = bpy.context.object
    object_.name = name
    object_.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    object_.data.materials.append(material_)
    object_.parent = parent
    bevel = object_.modifiers.new("SoftEdges", "BEVEL")
    bevel.width = min(scale) * 0.35
    bevel.segments = 2
    bpy.context.view_layer.objects.active = object_
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return smooth(object_)


def torus(
    name,
    location,
    major_radius,
    minor_radius,
    material_,
    parent=None,
    scale=(1.0, 1.0, 1.0),
):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=32,
        minor_segments=8,
        location=location,
    )
    object_ = bpy.context.object
    object_.name = name
    object_.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    object_.data.materials.append(material_)
    object_.parent = parent
    return smooth(object_)


def empty(name, location=(0.0, 0.0, 0.0), parent=None):
    object_ = bpy.data.objects.new(name, None)
    object_.empty_display_type = "PLAIN_AXES"
    object_.empty_display_size = 0.12
    object_.location = location
    object_.parent = parent
    bpy.context.collection.objects.link(object_)
    return object_


def join_child_meshes(parent, name):
    meshes = [child for child in parent.children if child.type == "MESH"]
    if not meshes:
        return None
    if len(meshes) == 1:
        meshes[0].name = name
        return meshes[0]
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    active = meshes[0]
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()
    active.name = name
    active.parent = parent
    if len(active.data.polygons) > 300:
        decimate = active.modifiers.new("WebDecimate", "DECIMATE")
        decimate.ratio = 0.55
        decimate.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = active
        bpy.ops.object.modifier_apply(modifier=decimate.name)
    return active


def bake_vertex_colors(root, target_material):
    for object_ in [root, *root.children_recursive]:
        if object_.type != "MESH":
            continue
        mesh = object_.data
        colors = mesh.color_attributes.get("Color")
        if colors is None:
            colors = mesh.color_attributes.new(
                name="Color",
                type="BYTE_COLOR",
                domain="CORNER",
            )
        for polygon in mesh.polygons:
            source = mesh.materials[polygon.material_index]
            value = (*source.diffuse_color[:3], source.diffuse_color[3])
            for loop_index in polygon.loop_indices:
                if hasattr(colors.data[loop_index], "color_srgb"):
                    colors.data[loop_index].color_srgb = value
                else:
                    colors.data[loop_index].color = value
        mesh.materials.clear()
        mesh.materials.append(target_material)


def add_eye(prefix, x, z, iris_material, black, white, parent):
    sphere(
        f"{prefix}EyeWhite",
        (x, -0.478, z),
        (0.135, 0.035, 0.165),
        white,
        parent,
        16,
        10,
    )
    sphere(
        f"{prefix}Iris",
        (x, -0.512, z - 0.012),
        (0.088, 0.021, 0.112),
        iris_material,
        parent,
        16,
        10,
    )
    sphere(
        f"{prefix}Pupil",
        (x, -0.532, z + 0.006),
        (0.038, 0.013, 0.055),
        black,
        parent,
        12,
        8,
    )
    sphere(
        f"{prefix}Highlight",
        (x - 0.032, -0.546, z + 0.06),
        (0.025, 0.01, 0.032),
        white,
        parent,
        10,
        6,
    )


def add_face(prefix, iris, skin, black, white, blush, parent, sleepy=False):
    if sleepy:
        for side in (-1, 1):
            sphere(
                f"{prefix}{'L' if side < 0 else 'R'}Eye",
                (0.19 * side, -0.49, 1.49),
                (0.105, 0.025, 0.11),
                white,
                parent,
                16,
                10,
            )
            sphere(
                f"{prefix}{'L' if side < 0 else 'R'}Iris",
                (0.19 * side, -0.518, 1.475),
                (0.068, 0.014, 0.072),
                iris,
                parent,
                14,
                8,
            )
            box(
                f"{prefix}{'L' if side < 0 else 'R'}Lid",
                (0.19 * side, -0.548, 1.565),
                (0.12, 0.012, 0.018),
                black,
                parent,
                rotation=(math.radians(5 * side), 0.0, math.radians(4 * side)),
            )
    else:
        add_eye(f"{prefix}L", -0.19, 1.51, iris, black, white, parent)
        add_eye(f"{prefix}R", 0.19, 1.51, iris, black, white, parent)

    sphere(f"{prefix}BlushL", (-0.34, -0.49, 1.36), (0.09, 0.015, 0.045), blush, parent, 12, 8)
    sphere(f"{prefix}BlushR", (0.34, -0.49, 1.36), (0.09, 0.015, 0.045), blush, parent, 12, 8)
    sphere(f"{prefix}Mouth", (0.0, -0.526, 1.33), (0.035, 0.012, 0.018), black, parent, 12, 8)


def add_hair_locks(prefix, hair, parent, back=False):
    y = 0.18 if back else -0.30
    z = 1.28 if back else 1.58
    for index, x in enumerate((-0.47, -0.31, -0.15, 0.15, 0.31, 0.47)):
        length = 0.52 if abs(x) > 0.35 else 0.38
        sphere(
            f"{prefix}HairLock{index}",
            (x, y, z - (0.06 if abs(x) > 0.35 else 0.0)),
            (0.16, 0.17, length),
            hair,
            parent,
            16,
            10,
        )


def build_hat_guide():
    palette = {
        "skin": material("Skin", (1.0, 0.78, 0.62)),
        "blush": material("Blush", (1.0, 0.43, 0.53)),
        "hair": material("GoldenHair", (0.95, 0.70, 0.22)),
        "hair_light": material("HairHighlight", (1.0, 0.86, 0.42)),
        "white": material("CoatWhite", (0.93, 0.97, 1.0)),
        "blue": material("TideBlue", (0.12, 0.45, 0.80)),
        "navy": material("DeepNavy", (0.035, 0.065, 0.11)),
        "purple": material("VioletEyes", (0.43, 0.25, 0.70), roughness=0.48),
        "black": material("Ink", (0.035, 0.024, 0.035)),
        "brown": material("BootBrown", (0.16, 0.075, 0.04)),
    }
    vertex_material = vertex_color_material("HatGuideVertexMaterial", 0.76)
    root = empty("HatGuideRoot")
    root["character_name"] = "晴帽向导"
    root["head_body_ratio"] = 1.0
    head = empty("HeadPivot", (0.0, 0.0, 1.03), root)
    left_arm = empty("LeftArmPivot", (-0.43, 0.0, 0.86), root)
    right_arm = empty("RightArmPivot", (0.43, 0.0, 0.86), root)

    sphere("Body", (0.0, 0.0, 0.64), (0.43, 0.32, 0.42), palette["white"], root)
    cylinder("Skirt", (0.0, 0.0, 0.49), 0.43, 0.42, palette["white"], root, scale=(1.0, 0.76, 1.0))
    box("Sash", (0.0, -0.315, 0.70), (0.31, 0.03, 0.075), palette["blue"], root)
    box("TieL", (-0.10, -0.34, 0.52), (0.07, 0.025, 0.18), palette["blue"], root, rotation=(0.0, math.radians(-8), math.radians(-8)))
    box("TieR", (0.10, -0.34, 0.52), (0.07, 0.025, 0.18), palette["blue"], root, rotation=(0.0, math.radians(8), math.radians(8)))
    for side in (-1, 1):
        x = 0.21 * side
        cylinder(f"Leg{side}", (x, -0.01, 0.22), 0.10, 0.34, palette["white"], root, scale=(1.0, 0.9, 1.0), vertices=16)
        cylinder(f"SockStripe{side}", (x, -0.02, 0.25), 0.106, 0.055, palette["navy"], root, scale=(1.0, 0.92, 1.0), vertices=16)
        sphere(f"Boot{side}", (x, -0.055, 0.075), (0.14, 0.20, 0.10), palette["brown"], root, 16, 8)

    sphere("Head", (0.0, 0.0, 0.48), (0.61, 0.49, 0.55), palette["skin"], head)
    sphere("HairBack", (0.0, 0.16, 0.47), (0.63, 0.42, 0.58), palette["hair"], head)
    add_hair_locks("GuideBack", palette["hair"], head, back=True)
    add_hair_locks("GuideFront", palette["hair_light"], head, back=False)
    add_face("Guide", palette["purple"], palette["skin"], palette["black"], palette["white"], palette["blush"], head)
    cylinder("HatBrim", (0.0, 0.0, 1.04), 0.82, 0.09, palette["white"], head, scale=(1.0, 0.74, 1.0), vertices=40)
    sphere("HatCrown", (0.0, 0.04, 1.22), (0.47, 0.38, 0.23), palette["white"], head, 24, 12)
    torus("HatBand", (0.0, 0.04, 1.13), 0.39, 0.045, palette["navy"], head, scale=(1.0, 0.76, 1.0))
    torus("HatRibbon", (0.0, 0.035, 1.15), 0.43, 0.018, palette["purple"], head, scale=(1.0, 0.76, 1.0))

    for side, pivot in ((-1, left_arm), (1, right_arm)):
        sphere(f"Sleeve{side}", (0.12 * side, -0.01, -0.10), (0.16, 0.15, 0.27), palette["white"], pivot, 16, 10)
        sphere(f"Glove{side}", (0.15 * side, -0.02, -0.36), (0.13, 0.13, 0.13), palette["brown"], pivot, 14, 8)

    bake_vertex_colors(root, vertex_material)
    join_child_meshes(root, "HatGuideBodyMesh")
    join_child_meshes(head, "HatGuideHeadMesh")
    join_child_meshes(left_arm, "HatGuideLeftArmMesh")
    join_child_meshes(right_arm, "HatGuideRightArmMesh")

    return root


def build_plush_dreamer():
    palette = {
        "skin": material("PlushPeach", (0.95, 0.73, 0.63), roughness=0.9),
        "blush": material("PlushBlush", (0.95, 0.42, 0.48), roughness=0.9),
        "hair": material("MistHair", (0.53, 0.68, 0.70), roughness=0.92),
        "hair_light": material("MistHighlight", (0.66, 0.79, 0.79), roughness=0.9),
        "white": material("EyeWhite", (0.95, 0.97, 0.97)),
        "iris": material("DuskEyes", (0.45, 0.45, 0.57), roughness=0.52),
        "black": material("SoftInk", (0.045, 0.04, 0.05)),
        "seafoam": material("SeafoamScarf", (0.20, 0.55, 0.58)),
    }
    vertex_material = vertex_color_material("PlushDreamerVertexMaterial", 0.9)
    root = empty("PlushDreamerRoot")
    root["character_name"] = "软绒旅伴"
    root["head_body_ratio"] = 1.0
    head = empty("HeadPivot", (0.0, 0.0, 1.0), root)
    left_arm = empty("LeftArmPivot", (-0.43, 0.0, 0.79), root)
    right_arm = empty("RightArmPivot", (0.43, 0.0, 0.79), root)

    sphere("PlushBody", (0.0, 0.0, 0.62), (0.53, 0.42, 0.54), palette["skin"], root, 20, 12)
    torus("SeafoamCollar", (0.0, -0.02, 0.91), 0.37, 0.055, palette["seafoam"], root, scale=(1.0, 0.82, 1.0))
    box("ScarfTail", (0.13, -0.40, 0.72), (0.09, 0.035, 0.21), palette["seafoam"], root, rotation=(0.0, 0.0, math.radians(-9)))
    for side in (-1, 1):
        sphere(f"PlushFoot{side}", (0.22 * side, -0.07, 0.15), (0.22, 0.27, 0.17), palette["skin"], root, 16, 10)

    sphere("PlushHead", (0.0, 0.0, 0.47), (0.62, 0.51, 0.56), palette["skin"], head)
    sphere("HairCap", (0.0, 0.10, 0.62), (0.65, 0.46, 0.56), palette["hair"], head, 20, 12)
    add_hair_locks("DreamBack", palette["hair"], head, back=True)
    for index, x in enumerate((-0.46, -0.30, -0.14, 0.02, 0.20, 0.38)):
        sphere(
            f"DreamBang{index}",
            (x, -0.34, 0.73 - abs(x) * 0.12),
            (0.16, 0.16, 0.34 + abs(x) * 0.22),
            palette["hair_light" if index in (2, 3) else "hair"],
            head,
            16,
            10,
        )
    add_face("Dream", palette["iris"], palette["skin"], palette["black"], palette["white"], palette["blush"], head, sleepy=True)

    for side, pivot in ((-1, left_arm), (1, right_arm)):
        sphere(f"PlushArm{side}", (0.14 * side, -0.01, -0.16), (0.17, 0.16, 0.31), palette["skin"], pivot, 16, 10)

    bake_vertex_colors(root, vertex_material)
    join_child_meshes(root, "PlushDreamerBodyMesh")
    join_child_meshes(head, "PlushDreamerHeadMesh")
    join_child_meshes(left_arm, "PlushDreamerLeftArmMesh")
    join_child_meshes(right_arm, "PlushDreamerRightArmMesh")

    return root


def export_character(root, slug):
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    BLEND_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / f"{slug}.blend"))
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(MODEL_DIR / f"{slug}.glb"),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_materials="EXPORT",
        export_vertex_color="MATERIAL",
        export_all_vertex_colors=True,
        export_normals=True,
        export_tangents=False,
    )


def main():
    bpy.context.preferences.filepaths.save_version = 0
    reset_scene()
    export_character(build_hat_guide(), "hat-guide")
    reset_scene()
    export_character(build_plush_dreamer(), "plush-dreamer")
    print(f"Generated Blender sources in {BLEND_DIR}")
    print(f"Generated GLB assets in {MODEL_DIR}")


if __name__ == "__main__":
    main()
