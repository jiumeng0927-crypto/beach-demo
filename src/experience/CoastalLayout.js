// Connect the boardwalk landing to the activity clearing and western rest area.
export const BEACH_WALK_ROUTE = Object.freeze([
  [25, 20], [23, 26], [14, 29], [7, 26], [-5, 23], [-18, 21],
].map(Object.freeze));

export function distanceToBeachWalk(x, z) {
  let distance = Infinity;
  for (let i = 1; i < BEACH_WALK_ROUTE.length; i++) {
    const [ax, az] = BEACH_WALK_ROUTE[i - 1], [bx, bz] = BEACH_WALK_ROUTE[i];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return distance;
}
