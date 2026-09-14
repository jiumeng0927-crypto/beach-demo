export const DEFAULT_OCEAN_SWELL_STRENGTH = 0.42;
export const OCEAN_SWELL_FADE_START_Z = -55;
export const OCEAN_SWELL_FADE_END_Z = 4;

const SURFACE_NORMAL_MARKER =
  'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );';

/** Adds two analytical low-frequency slopes after Water's texture normal. */
export function injectOceanSwellShader(fragmentShader) {
  if (typeof fragmentShader !== 'string' || !fragmentShader.includes(SURFACE_NORMAL_MARKER)) {
    throw new Error('Water surface-normal marker was not found.');
  }

  return /* glsl */ `uniform float uSwellStrength;
${fragmentShader}`.replace(
    SURFACE_NORMAL_MARKER,
    /* glsl */ `
      vec3 surfaceNormal = normalize(
        noise.xzy * vec3(1.5, 1.0, 1.5)
      );

      // Large analytical slopes break up the distant mirror without adding
      // geometry or normal-map samples. The authored shoreline stays calm.
      float farOceanMask = 1.0 - smoothstep(
        ${OCEAN_SWELL_FADE_START_Z.toFixed(1)},
        ${OCEAN_SWELL_FADE_END_Z.toFixed(1)},
        worldPosition.z
      );
      vec2 swellDirectionA = vec2(0.819, 0.574);
      vec2 swellDirectionB = vec2(-0.342, 0.940);
      float swellPhaseA =
        dot(worldPosition.xz, swellDirectionA) * 0.052 + time * 0.31;
      float swellPhaseB =
        dot(worldPosition.xz, swellDirectionB) * 0.034 - time * 0.19;
      vec2 swellSlope =
        swellDirectionA * cos(swellPhaseA) * 0.22 +
        swellDirectionB * cos(swellPhaseB) * 0.14;
      surfaceNormal = normalize(
        surfaceNormal +
        vec3(swellSlope.x, 0.0, swellSlope.y) *
          uSwellStrength * farOceanMask
      );
    `,
  );
}
