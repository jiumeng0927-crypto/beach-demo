export const COASTAL_PALETTE = Object.freeze({
  chalk: 0xe5e7df,
  coral: 0xad7066,
  seaGlass: 0x588f91,
  sage: 0x718674,
  ochre: 0xb6a173,
  timber: 0x968672,
  timberShadow: 0x6d6052,
  metal: 0xa3afad,
});

export const TIDAL_WETNESS_GLSL = /* glsl */ `
  uniform float uTidalWaterHeight;
  float tidalWetness(vec3 p) {
    float edge = sin(p.x * 2.7 + sin(p.z * 1.9)) * 0.035
      + sin(p.z * 5.1 + p.x * 0.9) * 0.018;
    float height = p.y - uTidalWaterHeight - edge;
    return (1.0 - smoothstep(0.02, 0.38, height))
      * (1.0 - smoothstep(12.0, 18.0, p.z));
  }
`;

export function addTidalWetness(material, waterHeight) {
  if (material.userData.tidalWetness) return material;
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.uTidalWaterHeight = waterHeight;
    shader.vertexShader = `varying vec3 vTidalWorldPosition;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>', `
        vec4 tidalPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          tidalPosition = instanceMatrix * tidalPosition;
        #endif
        vTidalWorldPosition = (modelMatrix * tidalPosition).xyz;
        #include <project_vertex>
      `,
    );
    shader.fragmentShader = `varying vec3 vTidalWorldPosition;\n${TIDAL_WETNESS_GLSL}\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>', `
        #include <color_fragment>
        float tidalWetMask = tidalWetness(vTidalWorldPosition);
        diffuseColor.rgb *= mix(1.0, 0.64, tidalWetMask);
      `,
    ).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, max(0.28, roughnessFactor * 0.58), tidalWetMask);
    `);
    material.userData.tidalWetnessCompiled = true;
  };
  material.customProgramCacheKey = () => `${previousKey}-tidal-wetness-v1`;
  material.userData.tidalWetness = waterHeight;
  material.needsUpdate = true;
  return material;
}

// Keep surface detail in the PBR lighting path, not an unlit screen-wide filter.
export function addCoastalSurfaceDetail(material, kind) {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.vertexShader = `varying vec3 vCoastalSurface;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvCoastalSurface = position;',
    );
    shader.fragmentShader = `varying vec3 vCoastalSurface;\n${shader.fragmentShader}`.replace(
      '#include <map_fragment>', `
        #include <map_fragment>
        vec3 coastalP = vCoastalSurface;
        float coastalPatina = sin(coastalP.x * 7.3 + sin(coastalP.y * 9.1))
          * sin(coastalP.z * 12.7 + coastalP.y * 5.6);
        diffuseColor.rgb *= 0.97 + coastalPatina * ${kind === 'cloth' ? '0.035' : '0.018'};
        ${kind === 'cloth' ? `
          vec2 weaveP = vec2(coastalP.x + coastalP.y, coastalP.z + coastalP.y) * 220.0;
          vec2 weaveFade = 1.0 - smoothstep(vec2(0.8), vec2(2.8), fwidth(weaveP));
          float weave = dot(sin(weaveP) * weaveFade, vec2(0.5));
          diffuseColor.rgb *= 1.0 + weave * 0.035;
        ` : ''}
      `,
    );
    material.userData.coastalSurfaceCompiled = true;
  };
  material.customProgramCacheKey = () => `${previousKey}-coastal-surface-v1-${kind}`;
  material.userData.coastalSurface = kind;
  material.needsUpdate = true;
  return material;
}

export function styleCoastalAsset(source, id, waterHeight) {
  const materials = new Set();
  source.traverse((mesh) => {
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      if (material?.isMeshStandardMaterial) materials.add(material);
    }
  });
  for (const material of materials) {
    // Preserve albedo, roughness, metalness and normal maps from the source.
    material.normalScale.multiplyScalar(id === 'boulder_01' ? 0.78 : 0.6);
    material.aoMapIntensity = 0.65;
    material.envMapIntensity = 0.55;
    const previousCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float coastalLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(coastalLuma), diffuseColor.rgb, 0.8);
        diffuseColor.rgb = diffuseColor.rgb * 0.88 + vec3(0.024, 0.025, 0.023);
      `);
      material.userData.coastalSurfaceCompiled = true;
    };
    material.customProgramCacheKey = () => 'coastal-scanned-pbr-v1';
    material.userData.coastalSurface = 'scanned-pbr';
    if (id === 'boulder_01' && waterHeight) addTidalWetness(material, waterHeight);
    material.needsUpdate = true;
  }
}
