export const DISCOVERY_SITE_COUNT = 6;

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const GLASS_VERTEX_COUNT = 240;
const GLASS_FLOATS_PER_VERTEX = 8;
const INSTANCE_MATRIX_FLOATS = 16;
const INSTANCE_COLOR_FLOATS = 3;
const GLOW_FLOATS_PER_SITE = 8;

const glassGeometryBytes =
  GLASS_VERTEX_COUNT * GLASS_FLOATS_PER_VERTEX * FLOAT_BYTES;
const instanceMatrixBytes =
  DISCOVERY_SITE_COUNT * INSTANCE_MATRIX_FLOATS * FLOAT_BYTES;
const instanceColorBytes =
  DISCOVERY_SITE_COUNT * INSTANCE_COLOR_FLOATS * FLOAT_BYTES;
const glowAttributeBytes =
  DISCOVERY_SITE_COUNT * GLOW_FLOATS_PER_SITE * FLOAT_BYTES;

export const DISCOVERY_RESOURCE_PROFILE = Object.freeze({
  siteCount: DISCOVERY_SITE_COUNT,
  glassVertexCount: GLASS_VERTEX_COUNT,
  glassGeometryBytes,
  instanceMatrixBytes,
  instanceColorBytes,
  glowAttributeBytes,
  totalAttributeBytes:
    glassGeometryBytes +
    instanceMatrixBytes +
    instanceColorBytes +
    glowAttributeBytes,
});

const CHAPTER_PROFILES = Object.freeze(Object.fromEntries([
  ['shell', 153, 6336], ['bottle', 136, 5696],
].map(([kind, vertices, bytes]) => [kind, Object.freeze({
  ...DISCOVERY_RESOURCE_PROFILE, glassVertexCount: vertices, glassGeometryBytes: bytes,
  totalAttributeBytes: bytes + instanceMatrixBytes + instanceColorBytes + glowAttributeBytes,
})])));

export function getDiscoveryResourceProfile(kind = 'glass') {
  return CHAPTER_PROFILES[kind] ?? DISCOVERY_RESOURCE_PROFILE;
}
