import * as THREE from 'three';

import { terrainHeight } from './world.js';
import { ChineseEightBallRules } from './ChineseEightBallRules.js';
import { createNumberedBallMaterial, createTableClothTexture, createTableWoodTexture } from './billiardsAssets.js';
import { BilliardsAudio } from './BilliardsAudio.js';
import { createFrameBevel, createTableHardware, createPocketLeather, createCueModel } from './billiardsModel.js';
import { TABLE, RAILS, POCKET_GEOMETRY, capturesPocket, createClothGeometry, createPocketGeometry } from './billiardsTable.js';
import { BALL_MASS, CLOTH_DEFAULTS, applyCloth, setSphereInertia, createBilliardsSolver } from './billiardsPhysics.js';

const TABLE_CENTER = Object.freeze([0, 31.2]);
const TABLE_SIZE = Object.freeze([7.4, 4.25]);
const INNER_HALF_WIDTH = 3.175;
const INNER_HALF_DEPTH = 1.5875;
const TABLE_TOP = 1.86;
const BALL_RADIUS = 0.05715 * 2.5 / 2;
const BALL_Y = TABLE_TOP + BALL_RADIUS;
const TARGET_COUNT = 15;
const FIXED_STEP = 1 / 240;
const MAX_PHYSICS_STEPS = 12;
const MIN_DRAG_PIXELS = 6;
const RESPAWN_CLEARANCE = BALL_RADIUS * 2 + 0.006;
const HEAD_LINE = -INNER_HALF_WIDTH / 2;

const rackOrder = [1, 9, 2, 10, 8, 3, 4, 11, 5, 12, 6, 13, 7, 14, 15];
const rackPositions = new Map();
let rackIndex = 0;
for (let row = 0; row < 5; row += 1) {
  for (let col = 0; col <= row; col += 1) {
    rackPositions.set(rackOrder[rackIndex++], [INNER_HALF_WIDTH / 2 + row * Math.sqrt(3) * BALL_RADIUS,
      (col * 2 - row) * BALL_RADIUS]);
  }
}
const BALL_SPECS = Object.freeze(Array.from({ length: 16 }, (_, n) => Object.freeze({
  id: n ? `ball-${n}` : 'cue', number: n, position: n ? rackPositions.get(n) : [-2.2, 0],
})));

const POCKETS = Object.freeze(POCKET_GEOMETRY.map((p) => p.center));

export const BEACH_BILLIARDS_PROFILE = Object.freeze({
  targetBalls: TARGET_COUNT,
  totalBalls: BALL_SPECS.length,
  pockets: POCKETS.length,
  railBodies: RAILS.length,
  pocketMouthMM: [85, 100],
  residentDrawObjects: 8,
  physics: 'cannon-es',
  playingSize: [INNER_HALF_WIDTH * 2, INNER_HALF_DEPTH * 2],
  ballRadius: BALL_RADIUS,
  headLine: HEAD_LINE,
  pocketPositions: POCKETS,
});

function getGeometryTriangles(geometry) {
  return Math.floor(
    (geometry?.index?.count ?? geometry?.attributes.position?.count ?? 0) / 3,
  );
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  material?.dispose();
}

export class BeachBilliardsGame extends EventTarget {
  constructor({ scene, camera, domElement, quality = 'high' }) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.quality = quality === 'high' ? 'high' : 'low';
    this.enabled = false;
    this.initialized = false;
    this.loading = false;
    this.shadowsEnabled = this.quality === 'high';
    this.cameraMode = 'orbit';
    this.allocations = 0;
    this.releases = 0;
    this.loadRevision = 0;
    this.lastError = null;
    this.shots = 0;
    this.pocketed = 0;
    this.fouls = 0;
    this.aiming = false;
    this.aimPower = 0;
    this.aimPointerId = null;
    this.hoveredCue = false;
    this.cueRespawnDelay = 0;
    this.completed = false;
    this.lastProgressSettled = null;
    this.rules = new ChineseEightBallRules();
    this.shot = null;
    this.placingCue = false;
    this.contactPairs = new Set();
    this.cloth = { ...CLOTH_DEFAULTS };
    this.cueTip = { x: 0, y: 0 };
    this.audio = new BilliardsAudio();
    this.cueView = false;
    this.viewYaw = 0;
    this.viewStartYaw = 0;
    this.shotPower = 0.55;
    this.viewPosition = new THREE.Vector3();
    this.viewTarget = new THREE.Vector3();
    this.audioPosition = new THREE.Vector3();
    this.audioRight = new THREE.Vector3();
    this.textureOrientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this.groundY = terrainHeight(TABLE_CENTER[0], TABLE_CENTER[1]);
    this.cameraCollider = Object.freeze({
      type: 'box',
      name: 'beach-billiards-table',
      x: TABLE_CENTER[0],
      z: TABLE_CENTER[1],
      halfX: TABLE_SIZE[0] * 0.5,
      halfZ: TABLE_SIZE[1] * 0.5,
      rotation: 0,
      minY: this.groundY - 0.1,
      maxY: this.groundY + TABLE_TOP + 0.42,
    });

    this.group = new THREE.Group();
    this.group.name = 'BeachBilliards';
    this.group.visible = false;
    this.world = null;
    this.physicsAccumulator = 0;
    this.CANNON = null;
    this.physicsMaterial = null;
    this.balls = [];
    this.wallBodies = [];
    this.bed = null;
    this.frame = null;
    this.pockets = null;
    this.ballMesh = null;
    this.aimLine = null;
    this.ready = Promise.resolve(null);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.pointerWorld = new THREE.Vector3();
    this.pointerLocal = new THREE.Vector3();
    this.aimStartLocal = new THREE.Vector3();
    this.aimStartScreen = new THREE.Vector2();
    this.shotDirection = new THREE.Vector3();
    this.ballPath = new THREE.Line3();
    this.pocketCenter = new THREE.Vector3();
    this.nearestPocketPoint = new THREE.Vector3();
    this.instanceMatrix = new THREE.Matrix4();
    this.instanceQuaternion = new THREE.Quaternion();
    this.instanceScale = new THREE.Vector3(1, 1, 1);
    this.instancePosition = new THREE.Vector3();
    this.impulse = null;
    this.eventController = new AbortController();
    this.bindEvents();
  }

  setCueView(enabled) {
    this.cancelAim();
    this.cueView = Boolean(enabled);
    this.updateCueModel();
    this.dispatchProgress();
  }

  getCueViewPose() {
    const cue = this.balls[0]?.body.position;
    if (!cue) return null;
    this.viewTarget.set(cue.x, BALL_Y, cue.z).add(this.group.position);
    const distance = this.camera.aspect < 1 ? 1.85 : 1.65;
    this.viewPosition.set(-Math.cos(this.viewYaw) * distance, 0.48,
      -Math.sin(this.viewYaw) * distance).add(this.viewTarget);
    return { position: this.viewPosition, target: this.viewTarget };
  }

  adjustViewAim(radians) {
    if (this.aiming || !this.canAim() || !Number.isFinite(radians)) return false;
    this.viewYaw = Math.atan2(Math.sin(this.viewYaw + radians), Math.cos(this.viewYaw + radians));
    this.updateCueModel();
    return true;
  }

  shootFromView() {
    if (!this.cueView || this.aiming) return false;
    void this.audio.unlock();
    return this.shoot(Math.cos(this.viewYaw), Math.sin(this.viewYaw), this.shotPower, 'cue-view');
  }

  playImpact(type, speed, x, z) {
    this.audioPosition.set(x, BALL_Y, z).add(this.group.position).sub(this.camera.position);
    const distance = this.audioPosition.length();
    this.audioRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.audio.play(type, { speed, distance, pan: this.audioPosition.dot(this.audioRight) / Math.max(distance, 1) });
  }

  bindEvents() {
    const options = { signal: this.eventController.signal, capture: true };
    this.domElement.addEventListener(
      'pointerdown',
      (event) => this.handlePointerDown(event),
      options,
    );
    this.domElement.addEventListener(
      'pointermove',
      (event) => this.handlePointerMove(event),
      options,
    );
    this.domElement.addEventListener(
      'pointerup',
      (event) => this.handlePointerUp(event),
      options,
    );
    this.domElement.addEventListener(
      'pointercancel',
      (event) => {
        if (event.pointerId === this.aimPointerId) this.cancelAim();
      },
      options,
    );
    this.domElement.addEventListener(
      'lostpointercapture',
      (event) => {
        if (event.pointerId === this.aimPointerId) this.cancelAim();
      },
      options,
    );
    this.domElement.ownerDocument?.defaultView?.addEventListener(
      'blur',
      () => this.cancelAim(),
      { signal: this.eventController.signal },
    );
    this.domElement.ownerDocument?.defaultView?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.cancelAim();
    }, { signal: this.eventController.signal });
    this.domElement.addEventListener(
      'pointerleave',
      () => {
        if (!this.aiming) this.setHoveredCue(false);
      },
      options,
    );
  }

  suppressPointer(event) {
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  updatePointer(event) {
    const bounds = this.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
  }

  canAim() {
    return Boolean(
      this.enabled
      && this.cueView
      && this.initialized
      && this.cameraMode === 'orbit'
      && !this.completed
      && !this.rules.pending
      && !this.shot
      && !this.placingCue
      && this.balls[0]?.active
      && this.areBallsSettled(),
    );
  }

  hitCueBall(event) {
    if (!this.ballMesh || !this.canAim()) return false;
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const match = this.raycaster
      .intersectObject(this.ballMesh, false)
      .find(({ instanceId }) => instanceId === 0);
    if (match) return true;
    // Keep a small screen-space touch target even with regulation-size balls.
    const cue = this.balls[0].body.position;
    this.instancePosition.set(cue.x, BALL_Y, cue.z);
    this.group.localToWorld(this.instancePosition).project(this.camera);
    const bounds = this.domElement.getBoundingClientRect();
    return Math.hypot((this.pointer.x - this.instancePosition.x) * bounds.width / 2,
      (this.pointer.y - this.instancePosition.y) * bounds.height / 2) <= 14;
  }

  handlePointerDown(event) {
    if (this.domElement.ownerDocument?.querySelector('dialog[open]')) return;
    if (this.placingCue && this.enabled && this.cameraMode === 'orbit' && event.button === 0) {
      if (this.projectPointerToTable(event)) {
        this.suppressPointer(event);
        this.placeCue(this.pointerLocal.x, this.pointerLocal.z);
      }
      return;
    }
    if (this.aiming) {
      this.suppressPointer(event);
      return;
    }
    if (event.button !== 0 || event.isPrimary === false || !this.canAim()) return;
    if (!this.cueView && (!this.hitCueBall(event) || !this.projectPointerToTable(event))) return;
    this.suppressPointer(event);
    void this.audio.unlock();
    this.viewStartYaw = this.viewYaw;
    this.aimStartLocal.copy(this.pointerLocal);
    this.aimStartScreen.set(event.clientX, event.clientY);
    this.aiming = true;
    this.aimPointerId = event.pointerId;
    this.domElement.setPointerCapture?.(event.pointerId);
    this.setHoveredCue(true);
    this.updateAim(event);
  }

  handlePointerMove(event) {
    if (this.aiming) {
      this.suppressPointer(event);
      if (event.pointerId === this.aimPointerId) this.updateAim(event);
      return;
    }
    if (this.enabled && this.cameraMode === 'orbit') {
      this.setHoveredCue(this.cueView ? this.canAim() : this.hitCueBall(event));
    }
  }

  handlePointerUp(event) {
    if (!this.aiming) return;
    this.suppressPointer(event);
    if (event.pointerId !== this.aimPointerId) return;
    this.updateAim(event);
    const power = this.aimPower;
    const directionX = this.shotDirection.x;
    const directionZ = this.shotDirection.z;
    this.cancelAim();
    if (power >= 0.06) this.shoot(directionX, directionZ, power, 'pointer');
  }

  setHoveredCue(hovered) {
    const next = Boolean(hovered);
    if (next === this.hoveredCue) return;
    this.hoveredCue = next;
    this.domElement.classList.toggle('is-billiards-target', next);
  }

  projectPointerToTable(event) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.tablePlane, this.pointerWorld)) {
      return false;
    }
    this.pointerLocal.copy(this.pointerWorld);
    this.group.worldToLocal(this.pointerLocal);
    return true;
  }

  updateAim(event) {
    if (!this.aiming || !this.balls[0]?.active) return;
    if (this.cueView) {
      const dy = event.clientY - this.aimStartScreen.y;
      // A stroke only changes power. Its direction is latched at pointerdown.
      this.shotDirection.set(Math.cos(this.viewStartYaw), 0, Math.sin(this.viewStartYaw));
      this.aimPower = dy < MIN_DRAG_PIXELS ? 0 : THREE.MathUtils.clamp(dy / 240, 0, 1);
      this.updateCueModel();
      this.dispatchAimChange();
      return;
    }
    if (!this.projectPointerToTable(event)) {
      this.aimPower = 0;
      this.aimLine.visible = false;
      this.dispatchAimChange();
      return;
    }
    const cue = this.balls[0].body.position;
    this.shotDirection.set(
      this.aimStartLocal.x - this.pointerLocal.x,
      0,
      this.aimStartLocal.z - this.pointerLocal.z,
    );
    const pullDistance = this.shotDirection.length();
    const dragPixels = Math.hypot(
      event.clientX - this.aimStartScreen.x,
      event.clientY - this.aimStartScreen.y,
    );
    if (pullDistance <= 0.001 || dragPixels < MIN_DRAG_PIXELS) {
      this.aimPower = 0;
      this.aimLine.visible = false;
      this.dispatchAimChange();
      return;
    }
    this.shotDirection.normalize();
    this.aimPower = THREE.MathUtils.clamp(pullDistance / 2.7, 0, 1);
    const positions = this.aimLine.geometry.attributes.position;
    const pull = Math.min(pullDistance, 2.7);
    positions.setXYZ(
      0,
      cue.x - this.shotDirection.x * pull,
      BALL_Y + 0.035,
      cue.z - this.shotDirection.z * pull,
    );
    positions.setXYZ(1, cue.x, BALL_Y + 0.035, cue.z);
    positions.setXYZ(
      2,
      cue.x + this.shotDirection.x * (1.1 + this.aimPower * 2.15),
      BALL_Y + 0.035,
      cue.z + this.shotDirection.z * (1.1 + this.aimPower * 2.15),
    );
    positions.needsUpdate = true;
    this.aimLine.material.opacity = 0.42 + this.aimPower * 0.5;
    this.aimLine.visible = true;
    this.dispatchAimChange();
  }

  dispatchAimChange() {
    this.dispatchEvent(
      new CustomEvent('aimchange', {
        detail: {
          aiming: this.aiming,
          power: Number(this.aimPower.toFixed(3)),
        },
      }),
    );
  }

  cancelAim() {
    const wasAiming = this.aiming;
    const pointerId = this.aimPointerId;
    this.aiming = false;
    this.aimPointerId = null;
    this.aimPower = 0;
    if (pointerId !== null && this.domElement.hasPointerCapture?.(pointerId)) {
      this.domElement.releasePointerCapture(pointerId);
    }
    if (this.aimLine) this.aimLine.visible = false;
    this.setHoveredCue(false);
    if (wasAiming) this.dispatchAimChange();
    this.updateCueModel();
  }

  updateCueModel() {
    if (!this.cueModel) return;
    this.cueModel.visible = this.cueView && this.canAim();
    if (!this.cueModel.visible) return;
    const cue = this.balls[0].body.position, dx = Math.cos(this.viewYaw), dz = Math.sin(this.viewYaw);
    const pull = BALL_RADIUS + 0.05 + (this.aiming ? this.aimPower * 0.55 : 0);
    this.cueModel.position.set(cue.x - dx * pull - dz * this.cueTip.x * BALL_RADIUS * 0.7,
      BALL_Y + this.cueTip.y * BALL_RADIUS * 0.7, cue.z - dz * pull + dx * this.cueTip.x * BALL_RADIUS * 0.7);
    const backX = dx > 0 ? (cue.x + INNER_HALF_WIDTH) / dx : (cue.x - INNER_HALF_WIDTH) / dx;
    const backZ = dz > 0 ? (cue.z + INNER_HALF_DEPTH) / dz : (cue.z - INNER_HALF_DEPTH) / dz;
    const backRail = Math.min(Math.abs(backX), Math.abs(backZ));
    const elevation = THREE.MathUtils.clamp(Math.atan2(0.17 - (this.cueModel.position.y - TABLE_TOP),
      Math.max(0.1, backRail - pull)), 0.14, 0.6);
    this.cueModel.rotation.set(-elevation, Math.atan2(-dx, -dz), 0, 'YXZ');
  }

  async createVisuals() {
    if (this.initialized || this.loading) return this.ready;
    this.loading = true;
    this.lastError = null;
    const revision = ++this.loadRevision;
    this.ready = import('cannon-es').then((CANNON) => {
      if (revision !== this.loadRevision) return null;
      this.CANNON = CANNON;
      this.createPhysics();
      this.createTable();
      this.createBalls();
      const [x, z] = TABLE_CENTER;
      this.group.position.set(x, this.groundY, z);
      this.group.updateMatrixWorld(true);
      this.tablePlane.constant = -(this.groundY + BALL_Y);
      this.scene.add(this.group);
      this.group.visible = this.enabled;
      this.initialized = true;
      this.loading = false;
      this.allocations += 1;
      this.reset(false);
      return this.getDebugState();
    }).catch((error) => {
      if (revision !== this.loadRevision) return null;
      this.loading = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error('沙滩台球物理模块加载失败。', error);
      return null;
    });
    return this.ready;
  }

  createPhysics() {
    const CANNON = this.CANNON;
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, 0, 0),
      frictionGravity: new CANNON.Vec3(0, -24.525, 0),
      allowSleep: true,
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver = createBilliardsSolver(CANNON);
    this.physicsMaterial = new CANNON.Material('BeachBilliardsMaterial');
    this.world.defaultContactMaterial.friction = 0.05;
    this.world.defaultContactMaterial.restitution = 0.95;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.impulse = new CANNON.Vec3();
    this.contactPoint = new CANNON.Vec3();
    const cushionMaterial = new CANNON.Material('BilliardsCushion');
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.physicsMaterial, cushionMaterial,
      { friction: 0.2, restitution: 0.85, contactEquationStiffness: 1e8 }));

    RAILS.forEach(({ center: [x, z], size: [width, depth], jaws }) => {
      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        material: cushionMaterial,
        position: new CANNON.Vec3(x, 0, z),
        shape: new CANNON.Box(
          new CANNON.Vec3(width * 0.5, 0.22, depth * 0.5),
        ),
      });
      body.isCushion = true;
      jaws.forEach(([jx, jz]) => body.addShape(new CANNON.Cylinder(TABLE.jawRadius, TABLE.jawRadius, 0.44, 16),
        new CANNON.Vec3(jx - x, 0, jz - z)));
      body.updateAABB();
      this.world.addBody(body);
      this.wallBodies.push(body);
    });
  }

  createTable() {
    const high = this.quality === 'high';
    this.bed = new THREE.Mesh(
      createClothGeometry(),
      new THREE.MeshStandardMaterial({
        name: 'BilliardsSandCloth',
        vertexColors: true,
        map: createTableClothTexture(),
        color: 0xffffff,
        roughness: 0.88,
        metalness: 0,
      }),
    );
    this.bed.name = 'BilliardsBed';
    this.bed.castShadow = high && this.shadowsEnabled;
    this.bed.receiveShadow = true;
    this.group.add(this.bed);

    const frameGeometry = createFrameBevel();
    const frameMaterial = new THREE.MeshStandardMaterial({
      name: 'BilliardsDriftwood',
      color: 0xffffff,
      map: createTableWoodTexture(),
      roughness: 0.36,
      metalness: 0,
    });
    const frameParts = [
      ...[-1, 0, 1].flatMap((x) => [-1, 1].map((z) => ({
        position: [x * 2.8, 0.84, z * 1.3], scale: [0.48, 1.38, 0.48],
      }))),
      ...[-1, 1].map((z) => ({ position: [0, TABLE_TOP - 0.32, z * 1.92], scale: [7.2, 0.42, 0.2] })),
      ...[-1, 1].map((x) => ({ position: [x * 3.44, TABLE_TOP - 0.32, 0], scale: [0.2, 0.42, 3.8] })),
      ...[-1, 1].flatMap((z) => [-1, 1].map((x) => ({ position: [x * 1.87, TABLE_TOP + 0.06, z * 1.98], scale: [3.66, 0.16, 0.28] }))),
      ...[-1, 1].map((x) => ({ position: [x * 3.54, TABLE_TOP + 0.06, 0], scale: [0.32, 0.16, 3.66] })),
      ...[-1, 1].map((z) => ({ position: [0, 0.6, z * 1.3], scale: [5.8, 0.18, 0.18] })),
    ];
    this.frame = new THREE.InstancedMesh(
      frameGeometry,
      frameMaterial,
      frameParts.length,
    );
    this.frame.name = 'InstancedBilliardsFrame';
    frameParts.forEach(({ position, scale }, index) => {
      this.instancePosition.fromArray(position);
      this.instanceScale.fromArray(scale);
      this.instanceMatrix.compose(
        this.instancePosition,
        this.instanceQuaternion,
        this.instanceScale,
      );
      this.frame.setMatrixAt(index, this.instanceMatrix);
      this.frame.setColorAt(index, new THREE.Color(0xffffff));
    });
    this.frame.instanceMatrix.needsUpdate = true;
    this.frame.instanceColor.needsUpdate = true;
    this.frame.castShadow = high && this.shadowsEnabled;
    this.frame.receiveShadow = true;
    this.group.add(this.frame);
    this.hardware = createTableHardware();
    this.leather = createPocketLeather();
    this.cueModel = createCueModel();
    this.group.add(this.hardware, this.leather, this.cueModel);

    const pocketGeometry = createPocketGeometry();
    const pocketMaterial = new THREE.MeshBasicMaterial({
      name: 'BilliardsPockets',
      color: 0x142326,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.pockets = new THREE.InstancedMesh(
      pocketGeometry,
      pocketMaterial,
      POCKETS.length,
    );
    this.pockets.name = 'InstancedBilliardsPockets';
    const flat = new THREE.Quaternion();
    POCKETS.forEach(([x, z], index) => {
      this.instancePosition.set(x, TABLE_TOP + 0.006, z);
      this.instanceScale.set(1, 1, 1);
      this.instanceMatrix.compose(this.instancePosition, flat, this.instanceScale);
      this.pockets.setMatrixAt(index, this.instanceMatrix);
    });
    this.pockets.instanceMatrix.needsUpdate = true;
    this.group.add(this.pockets);

    const aimGeometry = new THREE.BufferGeometry();
    aimGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(9), 3),
    );
    const aimMaterial = new THREE.LineBasicMaterial({
      name: 'BilliardsAimLine',
      color: 0xffe4a3,
      transparent: true,
      opacity: 0.65,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.aimLine = new THREE.Line(aimGeometry, aimMaterial);
    this.aimLine.name = 'BilliardsAimLine';
    this.aimLine.visible = false;
    this.aimLine.frustumCulled = false;
    this.aimLine.renderOrder = 8;
    this.group.add(this.aimLine);
  }

  createBalls() {
    const CANNON = this.CANNON;
    const geometry = new THREE.SphereGeometry(BALL_RADIUS, 24, 16);
    const material = createNumberedBallMaterial(geometry);
    this.ballMesh = new THREE.InstancedMesh(
      geometry,
      material,
      BALL_SPECS.length,
    );
    this.ballMesh.name = 'InstancedBilliardsBalls';
    this.ballMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ballMesh.castShadow = this.shadowsEnabled && this.quality === 'high';
    this.ballMesh.receiveShadow = false;
    BALL_SPECS.forEach((spec, index) => {
      const body = new CANNON.Body({
        mass: BALL_MASS,
        material: this.physicsMaterial,
        shape: new CANNON.Sphere(BALL_RADIUS),
        linearDamping: 0,
        angularDamping: 0,
        allowSleep: true,
        sleepSpeedLimit: 0.001,
        sleepTimeLimit: 0.42,
      });
      body.linearFactor.set(1, 0, 1);
      body.angularFactor.set(1, 1, 1);
      setSphereInertia(body, BALL_RADIUS);
      this.world.addBody(body);
      body.ballNumber = index;
      this.balls.push({
        spec,
        index,
        body,
        active: true,
        rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
      });
    });
    this.group.add(this.ballMesh);
    this.syncBallInstances();
  }

  shoot(directionX, directionZ, power = 0.5, source = 'api') {
    if (!this.canAim()) return false;
    if (![directionX, directionZ, power].every(Number.isFinite)) return false;
    const length = Math.hypot(directionX, directionZ);
    if (length <= 0.0001) return false;
    const normalizedPower = THREE.MathUtils.clamp(power, 0.06, 1);
    // Finesse shots need a low-speed range; full pull retains the same break speed.
    const strength = BALL_MASS * 9 * normalizedPower ** 1.5;
    this.impulse.set(
      (directionX / length) * strength,
      0,
      (directionZ / length) * strength,
    );
    const cue = this.balls[0].body;
    if (this.rules.hand === 'kitchen' && (cue.position.x >= HEAD_LINE || directionX <= 0)) return false;
    this.shotPower = normalizedPower;
    this.shot = { first: null, pocketed: [], rails: new Set(), railAfterContact: false,
      offTable: [], kitchen: this.rules.hand === 'kitchen', kitchenCrossed: false,
      kitchenViolation: false, age: 0 };
    this.contactPairs.clear();
    for (const contact of this.world.contacts) this.contactPairs.add(this.contactKey(contact));
    cue.wakeUp();
    this.contactPoint.set(-directionZ / length * this.cueTip.x * BALL_RADIUS * 0.7,
      this.cueTip.y * BALL_RADIUS * 0.7, directionX / length * this.cueTip.x * BALL_RADIUS * 0.7);
    cue.applyImpulse(this.impulse, this.contactPoint);
    this.playImpact('cue', strength / BALL_MASS, cue.position.x, cue.position.z);
    this.cueView = false;
    this.updateCueModel();
    this.shots += 1;
    this.dispatchEvent(
      new CustomEvent('shot', {
        detail: {
          shots: this.shots,
          pocketed: this.pocketed,
          total: TARGET_COUNT,
          power: Number(normalizedPower.toFixed(3)),
          source,
        },
      }),
    );
    this.dispatchProgress();
    return true;
  }

  areBallsSettled() {
    if (!this.initialized || this.cueRespawnDelay > 0) return false;
    return this.balls.every(({ active, body }) =>
      !active
      || (
        body.velocity.lengthSquared() < 0.000625
        && body.angularVelocity.lengthSquared() < 0.05
      ),
    );
  }

  isInsidePocket(x, z) {
    return capturesPocket(x, z);
  }

  crossedPocket(body) {
    this.ballPath.start.set(body.previousPosition.x, 0, body.previousPosition.z);
    this.ballPath.end.set(body.position.x, 0, body.position.z);
    if (this.ballPath.distanceSq() < 1e-12) return false;
    return POCKETS.some(([x, z]) => {
      this.pocketCenter.set(x, 0, z);
      this.ballPath.closestPointToPoint(this.pocketCenter, true, this.nearestPocketPoint);
      return capturesPocket(this.nearestPocketPoint.x, this.nearestPocketPoint.z);
    });
  }

  pocketBall(ball) {
    if (!ball.active) return;
    ball.active = false;
    this.playImpact('pocket', Math.max(0.3, ball.body.velocity.length()), ball.body.position.x, ball.body.position.z);
    this.world.removeBody(ball.body);
    ball.body.velocity.setZero();
    ball.body.angularVelocity.setZero();
    if (this.shot) this.shot.pocketed.push(ball.index);
    if (ball.index !== 0) {
      this.pocketed += 1;
    }
    this.dispatchEvent(
      new CustomEvent('pocket', {
        detail: {
          id: ball.spec.id,
          cue: ball.index === 0,
          pocketed: this.pocketed,
          total: TARGET_COUNT,
          shots: this.shots,
          fouls: this.fouls,
        },
      }),
    );
    this.dispatchProgress();
  }

  contactKey({ bi, bj }) {
    return bi.id < bj.id ? `${bi.id}:${bj.id}` : `${bj.id}:${bi.id}`;
  }

  readContacts() {
    const shot = this.shot;
    if (this.balls[0].body.position.x >= HEAD_LINE) shot.kitchenCrossed = true;
    const nextPairs = new Set();
    const firstCandidates = [];
    for (const contact of this.world.contacts) {
      const key = this.contactKey(contact);
      if (!nextPairs.has(key) && !this.contactPairs.has(key)) {
        const bothBalls = contact.bi.ballNumber !== undefined && contact.bj.ballNumber !== undefined;
        const speed = Math.abs(contact.multiplier) * FIXED_STEP / BALL_MASS * (bothBalls ? 2 : 1);
        const body = contact.bi.ballNumber !== undefined ? contact.bi : contact.bj;
        this.playImpact(bothBalls ? 'ball' : 'rail', speed, body.position.x, body.position.z);
      }
      nextPairs.add(key);
      const a = contact.bi.ballNumber;
      const b = contact.bj.ballNumber;
      if (shot.first === null && a !== undefined && b !== undefined && (a === 0 || b === 0)) {
        firstCandidates.push(a === 0 ? b : a);
      }
    }
    if (firstCandidates.length) {
      shot.first = firstCandidates.find((n) => this.rules.legalFirst(n)) ?? firstCandidates[0];
      shot.kitchenViolation = shot.kitchen && !shot.kitchenCrossed
        && this.balls[shot.first].body.position.x < HEAD_LINE;
    }
    for (const contact of this.world.contacts) {
      const a = contact.bi.ballNumber;
      const b = contact.bj.ballNumber;
      if ((a === undefined) === (b === undefined) || this.contactPairs.has(this.contactKey(contact))) continue;
      const number = a ?? b;
      shot.rails.add(number);
      if (shot.first !== null) shot.railAfterContact = true;
    }
    this.contactPairs = nextPairs;
  }

  finishShot() {
    const result = this.rules.settle({ ...this.shot, rails: [...this.shot.rails] });
    this.shot = null;
    this.balls.forEach(({ active, body }) => {
      if (!active) return;
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.sleep();
    });
    result.respot.forEach((number) => this.respotBall(number));
    this.pocketed = this.rules.down.size;
    this.fouls = this.rules.fouls;
    this.completed = this.rules.winner !== null;
    if (this.rules.hand && !this.completed) this.beginCuePlacement();
    this.syncBallInstances();
    this.dispatchProgress();
    if (this.completed) this.dispatchEvent(new CustomEvent('complete', { detail: this.getProgressState() }));
  }

  respotBall(number) {
    const ball = this.balls[number];
    const clear = (x) => this.balls.every((other) => other === ball || !other.active
      || Math.hypot(other.body.position.x - x, other.body.position.z) >= RESPAWN_CLEARANCE);
    const spot = INNER_HALF_WIDTH / 2;
    let x = spot;
    while (x < INNER_HALF_WIDTH - BALL_RADIUS && !clear(x)) x += 0.005;
    if (x >= INNER_HALF_WIDTH - BALL_RADIUS) {
      x = spot;
      while (x > -INNER_HALF_WIDTH + BALL_RADIUS && !clear(x)) x -= 0.005;
    }
    if (!ball.active) this.world.addBody(ball.body);
    ball.active = true;
    ball.body.position.set(x, 0, 0);
    ball.body.previousPosition.copy(ball.body.position);
    ball.body.velocity.setZero();
    ball.body.angularVelocity.setZero();
    ball.body.aabbNeedsUpdate = true;
    ball.body.sleep();
  }

  beginCuePlacement() {
    if (!this.rules.hand || this.shot || this.rules.pending || this.completed) return false;
    this.cancelAim();
    if (this.rules.hand === 'kitchen' && !this.rules.breaking) {
      const legal = this.balls.filter((b) => b.index > 0 && b.active && this.rules.legalFirst(b.index));
      if (legal.length && legal.every((b) => b.body.position.x < HEAD_LINE)) {
        this.respotBall(legal.reduce((a, b) => a.body.position.x >= b.body.position.x ? a : b).index);
      }
    }
    this.respawnCue();
    this.placingCue = true;
    const cue = this.balls[0].body.position;
    if (!this.validCuePosition(cue.x, cue.z)) {
      const free = this.findCueRespawnPosition();
      if (free) this.placeCue(...free);
    }
    this.dispatchProgress();
    return true;
  }

  validCuePosition(x, z) {
    return Number.isFinite(x) && Number.isFinite(z)
      && Math.abs(x) <= INNER_HALF_WIDTH - BALL_RADIUS
      && Math.abs(z) <= INNER_HALF_DEPTH - BALL_RADIUS
      && (this.rules.hand !== 'kitchen' || x < HEAD_LINE)
      && POCKETS.every(([px, pz]) => Math.hypot(x - px, z - pz) > TABLE.holeRadius + 0.01)
      && this.balls.every((b) => b.index === 0 || !b.active
        || Math.hypot(x - b.body.position.x, z - b.body.position.z) >= RESPAWN_CLEARANCE);
  }

  placeCue(x, z) {
    if (!this.placingCue || !this.rules.hand || this.shot || !this.validCuePosition(x, z)) return false;
    const cue = this.balls[0].body;
    cue.position.set(x, 0, z);
    cue.previousPosition.copy(cue.position);
    cue.velocity.setZero();
    cue.angularVelocity.setZero();
    cue.aabbNeedsUpdate = true;
    this.syncBallInstances();
    this.dispatchProgress();
    return true;
  }

  confirmCuePlacement() {
    const cue = this.balls[0]?.body.position;
    if (!this.placingCue || !cue || !this.validCuePosition(cue.x, cue.z)) return false;
    this.placingCue = false;
    this.dispatchProgress();
    return true;
  }

  chooseBreak(action) {
    const result = this.rules.choose(action);
    if (!result) return false;
    if (result.rerack) {
      const { breaker, warnedBreaker } = this.rules;
      this.reset(false);
      this.rules.reset(breaker, warnedBreaker);
    }
    if (this.rules.hand) this.beginCuePlacement();
    this.dispatchProgress();
    return true;
  }

  respawnCue() {
    const cue = this.balls[0];
    if (cue.active || !this.world) return false;
    const position = this.findCueRespawnPosition();
    if (!position) return false;
    const [x, z] = position;
    cue.body.position.set(x, 0, z);
    cue.body.previousPosition.copy(cue.body.position);
    cue.body.velocity.setZero();
    cue.body.angularVelocity.setZero();
    cue.body.force.setZero();
    cue.body.torque.setZero();
    cue.body.quaternion.set(0, 0, 0, 1);
    cue.body.aabbNeedsUpdate = true;
    cue.body.wakeUp();
    this.world.addBody(cue.body);
    cue.active = true;
    this.cueRespawnDelay = 0;
    return true;
  }

  findCueRespawnPosition() {
    const clear = (x, z) => this.validCuePosition(x, z);
    const [startX, startZ] = this.balls[0].spec.position;
    if (clear(startX, startZ)) return [startX, startZ];

    // Search inward from the cushions and use the free spot nearest the opening position.
    const limitX = INNER_HALF_WIDTH - BALL_RADIUS - 0.16;
    const limitZ = INNER_HALF_DEPTH - BALL_RADIUS - 0.16;
    let nearest = null;
    let nearestDistance = Infinity;
    for (let x = -limitX; x <= limitX; x += RESPAWN_CLEARANCE) {
      for (let z = -limitZ; z <= limitZ; z += RESPAWN_CLEARANCE) {
        const distance = Math.hypot(x - startX, z - startZ);
        if (distance < nearestDistance && clear(x, z)) {
          nearest = [x, z];
          nearestDistance = distance;
        }
      }
    }
    return nearest;
  }

  clampBallSpeed(ball) {
    const speedSquared = ball.body.velocity.lengthSquared();
    if (speedSquared <= 81) return;
    ball.body.velocity.scale(9 / Math.sqrt(speedSquared), ball.body.velocity);
  }

  syncBallInstances() {
    if (!this.ballMesh) return;
    this.balls.forEach((ball, index) => {
      if (ball.active) {
        this.instancePosition.set(
          ball.body.position.x,
          BALL_Y,
          ball.body.position.z,
        );
        this.instanceScale.set(1, 1, 1);
      } else {
        this.instancePosition.set(0, -100, 0);
        this.instanceScale.set(0, 0, 0);
      }
      this.instanceMatrix.compose(
        this.instancePosition,
        ball.rotation,
        this.instanceScale,
      );
      this.ballMesh.setMatrixAt(index, this.instanceMatrix);
    });
    this.ballMesh.instanceMatrix.needsUpdate = true;
    this.ballMesh.computeBoundingSphere();
  }

  update(delta) {
    if (!this.enabled || !this.initialized || !Number.isFinite(delta) || delta <= 0) return;
    this.physicsAccumulator += Math.min(delta, FIXED_STEP * MAX_PHYSICS_STEPS);
    for (
      let step = 0;
      step < MAX_PHYSICS_STEPS && this.physicsAccumulator + 1e-10 >= FIXED_STEP;
      step += 1
    ) {
      this.balls.forEach((ball) => {
        if (ball.active) {
          this.clampBallSpeed(ball);
          applyCloth(ball.body, BALL_RADIUS, FIXED_STEP, this.cloth, this.impulse, this.contactPoint);
        }
      });
      this.world.step(FIXED_STEP);
      if (this.shot) {
        this.shot.age += FIXED_STEP;
        this.readContacts();
      }
      this.physicsAccumulator = Math.max(0, this.physicsAccumulator - FIXED_STEP);
      // Retire pocketed bodies between engine steps, before they can bounce out again.
      this.balls.forEach((ball) => {
        if (!ball.active) return;
        ball.body.position.y = 0;
        ball.body.velocity.y = 0;
        ball.rotation.copy(ball.body.quaternion).multiply(this.textureOrientation);
        if (this.isInsidePocket(ball.body.position.x, ball.body.position.z)
          || this.crossedPocket(ball.body)) {
          this.pocketBall(ball);
        } else if (Math.abs(ball.body.position.x) > INNER_HALF_WIDTH + 0.3
          || Math.abs(ball.body.position.z) > INNER_HALF_DEPTH + 0.3) {
          if (this.shot) this.shot.offTable.push(ball.index);
          ball.active = false;
          this.world.removeBody(ball.body);
        }
      });
    }
    if (this.shot && this.shot.age > 0.15 && this.areBallsSettled()) this.finishShot();
    this.syncBallInstances();
    this.updateCueModel();
    if (this.lastProgressSettled !== this.areBallsSettled()) this.dispatchProgress();
  }

  areTargetBallsSettled() {
    return this.balls.slice(1).every(({ active, body }) =>
      !active || body.velocity.lengthSquared() < 0.012,
    );
  }

  reset(dispatch = true) {
    if (!this.initialized) return false;
    this.cancelAim();
    this.cueView = false;
    this.rules.reset();
    this.shot = null;
    this.placingCue = false;
    this.shots = 0;
    this.pocketed = 0;
    this.fouls = 0;
    this.completed = false;
    this.cueRespawnDelay = 0;
    this.physicsAccumulator = 0;
    this.viewYaw = 0;
    this.audio.stopVoices();
    this.balls.forEach((ball) => {
      if (!ball.active) this.world.addBody(ball.body);
      ball.active = true;
      ball.body.position.set(ball.spec.position[0], 0, ball.spec.position[1]);
      ball.body.previousPosition.copy(ball.body.position);
      ball.body.velocity.setZero();
      ball.body.angularVelocity.setZero();
      ball.body.force.setZero();
      ball.body.torque.setZero();
      ball.body.quaternion.set(0, 0, 0, 1);
      ball.body.aabbNeedsUpdate = true;
      ball.body.wakeUp();
      ball.rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    });
    this.syncBallInstances();
    if (dispatch) this.dispatchEvent(new Event('reset'));
    this.dispatchProgress();
    return true;
  }

  getProgressState() {
    return {
      pocketed: this.pocketed,
      remaining: TARGET_COUNT - this.pocketed,
      total: TARGET_COUNT,
      shots: this.shots,
      fouls: this.fouls,
      completed: this.completed,
      settled: this.areBallsSettled(),
      ...this.rules.snapshot(),
      placingCue: this.placingCue,
      cueTip: { ...this.cueTip },
      cloth: { ...this.cloth },
      cueView: this.cueView,
      interactionMode: this.cueView ? 'shoot' : 'observe',
      canShoot: this.canAim(),
      shotPower: this.shotPower,
    };
  }

  setShotSettings({ tipX = this.cueTip.x, tipY = this.cueTip.y,
    sliding = this.cloth.sliding, rolling = this.cloth.rolling } = {}) {
    if (this.shot || this.aiming || ![tipX, tipY, sliding, rolling].every(Number.isFinite)) return false;
    const length = Math.max(1, Math.hypot(tipX, tipY));
    this.cueTip = { x: tipX / length, y: tipY / length };
    this.cloth = { sliding: THREE.MathUtils.clamp(sliding, 0.12, 0.3),
      rolling: THREE.MathUtils.clamp(rolling, 0.006, 0.02) };
    this.dispatchProgress();
    this.updateCueModel();
    return true;
  }

  dispatchProgress() {
    const detail = this.getProgressState();
    this.lastProgressSettled = detail.settled;
    this.dispatchEvent(
      new CustomEvent('progresschange', { detail }),
    );
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) this.createVisuals();
    this.group.visible = this.enabled && this.initialized;
    if (!this.enabled) this.cancelAim();
    if (!this.enabled) this.audio.stopVoices();
    return this.enabled
      ? this.ready
      : Promise.resolve(this.getDebugState());
  }

  setCameraState(mode) {
    this.cameraMode = mode;
    if (mode !== 'orbit') this.cancelAim();
    this.updateCueModel();
  }

  setQuality(quality) {
    this.quality = quality === 'high' ? 'high' : 'low';
    this.setShadows(this.shadowsEnabled);
  }

  setShadows(enabled) {
    this.shadowsEnabled = Boolean(enabled);
    const cast = this.shadowsEnabled && this.quality === 'high';
    if (this.bed) this.bed.castShadow = cast;
    if (this.frame) this.frame.castShadow = cast;
    if (this.ballMesh) this.ballMesh.castShadow = cast;
  }

  getDebugState() {
    const tableTriangles =
      getGeometryTriangles(this.bed?.geometry)
      + getGeometryTriangles(this.frame?.geometry) * (this.frame?.count ?? 0)
      + getGeometryTriangles(this.pockets?.geometry) * (this.pockets?.count ?? 0)
      + getGeometryTriangles(this.ballMesh?.geometry) * (this.ballMesh?.count ?? 0);
    return {
      enabled: this.enabled,
      initialized: this.initialized,
      loading: this.loading,
      visible: this.group.visible,
      physics: BEACH_BILLIARDS_PROFILE.physics,
      quality: this.quality,
      shadowsEnabled: this.shadowsEnabled,
      targetBalls: TARGET_COUNT,
      totalBalls: BALL_SPECS.length,
      activeBalls: this.balls.filter(({ active }) => active).length,
      pocketed: this.pocketed,
      remaining: TARGET_COUNT - this.pocketed,
      shots: this.shots,
      fouls: this.fouls,
      completed: this.completed,
      settled: this.areBallsSettled(),
      aiming: this.aiming,
      aimPower: Number(this.aimPower.toFixed(3)),
      pockets: POCKETS.length,
      physicsBodies: this.world?.bodies.length ?? 0,
      railBodies: this.wallBodies.length,
      drawObjects: this.group.visible && this.initialized
        ? 6 + Number(Boolean(this.aimLine?.visible)) + Number(Boolean(this.cueModel?.visible))
        : 0,
      residentDrawObjects: this.initialized
        ? BEACH_BILLIARDS_PROFILE.residentDrawObjects
        : 0,
      triangles: tableTriangles + [this.hardware, this.leather, this.cueModel].reduce((sum, mesh) => sum + getGeometryTriangles(mesh?.geometry), 0),
      audio: this.audio.getState(),
      cueView: this.cueView,
      viewYaw: this.viewYaw,
      allocations: this.allocations,
      releases: this.releases,
      groupInScene: this.group.parent === this.scene,
      groupUuid: this.group.parent ? this.group.uuid : null,
      resourcesLinked: Boolean(
        this.initialized
        && this.bed?.parent === this.group
        && this.frame?.parent === this.group
        && this.pockets?.parent === this.group
        && this.ballMesh?.parent === this.group
        && this.aimLine?.parent === this.group
        && this.world
        && this.balls.length === BALL_SPECS.length,
      ),
      position: [TABLE_CENTER[0], TABLE_CENTER[1]],
      cameraCollider: {
        name: this.cameraCollider.name,
        halfX: this.cameraCollider.halfX,
        halfZ: this.cameraCollider.halfZ,
        minY: Number(this.cameraCollider.minY.toFixed(3)),
        maxY: Number(this.cameraCollider.maxY.toFixed(3)),
      },
      ballPositions: this.balls.map(({ spec, body, active }) => ({
        id: spec.id,
        active,
        position: [
          Number(body.position.x.toFixed(3)),
          Number(body.position.z.toFixed(3)),
        ],
      })),
      lastError: this.lastError,
      rules: this.rules.snapshot(),
      placingCue: this.placingCue,
    };
  }

  releaseVisuals() {
    if (!this.initialized) return false;
    this.cancelAim();
    this.bed.geometry.dispose();
    this.bed.material.map?.dispose();
    disposeMaterial(this.bed.material);
    this.frame.geometry.dispose();
    this.frame.material.map?.dispose();
    disposeMaterial(this.frame.material);
    this.pockets.geometry.dispose();
    disposeMaterial(this.pockets.material);
    this.ballMesh.geometry.dispose();
    this.ballMesh.material.map?.dispose();
    disposeMaterial(this.ballMesh.material);
    this.aimLine.geometry.dispose();
    disposeMaterial(this.aimLine.material);
    for (const mesh of [this.hardware, this.leather, this.cueModel]) {
      mesh?.geometry.dispose(); mesh?.material.dispose();
    }
    this.hardware = this.leather = this.cueModel = null;
    this.group.clear();
    this.group.removeFromParent();
    this.world = null;
    this.physicsAccumulator = 0;
    this.shot = null;
    this.CANNON = null;
    this.physicsMaterial = null;
    this.balls = [];
    this.wallBodies = [];
    this.bed = null;
    this.frame = null;
    this.pockets = null;
    this.ballMesh = null;
    this.aimLine = null;
    this.initialized = false;
    this.releases += 1;
    this.ready = Promise.resolve(null);
    return true;
  }

  dispose() {
    this.enabled = false;
    void this.audio.dispose();
    this.loadRevision += 1;
    this.loading = false;
    this.eventController.abort();
    this.domElement.classList.remove('is-billiards-target');
    this.releaseVisuals();
  }
}
