export const CLOTH_DEFAULTS = Object.freeze({ sliding: 0.2, rolling: 0.01 });
export const BALL_MASS = 0.17;
const GRAVITY = 9.81 * 2.5;

// Solid-sphere contact slip: v + omega x (0, -R, 0). Collision solving stays in Cannon.
export function applyCloth(body, radius, dt, cloth, impulse, contact) {
  if (body.sleepState === 2) return;
  const v = body.velocity, w = body.angularVelocity;
  const sx = v.x + radius * w.z, sz = v.z - radius * w.x;
  const slip = Math.hypot(sx, sz);
  if (slip > 0.00001) {
    const magnitude = Math.min(cloth.sliding * body.mass * GRAVITY * dt, 2 / 7 * body.mass * slip);
    impulse.set(-sx / slip * magnitude, 0, -sz / slip * magnitude);
    contact.set(0, -radius, 0);
    body.applyImpulse(impulse, contact);
  } else {
    const speed = Math.hypot(v.x, v.z);
    const factor = speed > 0 ? Math.max(0, 1 - cloth.rolling * GRAVITY * dt / speed) : 0;
    v.x *= factor; v.z *= factor;
    w.x = v.z / radius; w.z = -v.x / radius;
  }
  // Finite cloth contact patch damps vertical spin independently of translational rolling.
  const spinLoss = 2.5 * (4 / 9) * cloth.rolling * GRAVITY / radius * dt;
  w.y = Math.sign(w.y) * Math.max(0, Math.abs(w.y) - spinLoss);
}

export function setSphereInertia(body, radius) {
  const inertia = 2 / 5 * body.mass * radius * radius;
  body.inertia.set(inertia, inertia, inertia);
  body.invInertia.set(1 / inertia, 1 / inertia, 1 / inertia);
  body.updateInertiaWorld(true);
}

export function createBilliardsSolver(CANNON) {
  return new class extends CANNON.GSSolver {
    constructor() { super(); this.iterations = 24; this.tolerance = 1e-7; }
    solve(dt, world) {
      // Cannon's GS bounds clamp impulses (lambda), not forces. Use impact-normal impulse
      // for Coulomb friction; the default gravity-based cap cannot model cushion English.
      for (const f of world.frictionEquations) {
        const c = world.contacts.find((c) => c.bi === f.bi && c.bj === f.bj
          && c.ri.distanceSquared(f.ri) < 1e-8);
        if (!c) continue;
        const inverseMass = c.bi.invMass + c.bj.invMass;
        const closing = Math.max(0, c.getImpactVelocityAlongNormal());
        const coefficient = c.bi.isCushion || c.bj.isCushion ? 0.2 : 0.05;
        const cap = inverseMass ? coefficient * (1 + c.restitution) * closing / inverseMass : 0;
        f.maxForce = cap; f.minForce = -cap;
      }
      return super.solve(dt, world);
    }
  }();
}
