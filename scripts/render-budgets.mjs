// 0.41 adds folded vegetation and authored visitor/gull geometry. These count
// the entire frame, including water optical passes, not only the main camera.
export const RENDER_BUDGETS = Object.freeze({
  desktop: Object.freeze({ calls: 180, triangles: 650000 }),
  mobile: Object.freeze({ calls: 96, triangles: 270000 }),
});
