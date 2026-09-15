import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { STREET_WALK_MAX_Z } from './CoastalStreet.js';

const MOVEMENT_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'Space',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
]);

function isEditableTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))
  );
}

/**
 * Adds damped first-person translation around Three.js PointerLockControls.
 * Mouse orientation remains inside the official add-on; this class owns the
 * grounded walk/free-flight strategies, scene boundaries and lifecycle cleanup.
 */
export class FreeCameraController extends EventTarget {
  constructor(
    camera,
    domElement,
    {
      bounds = new THREE.Box3(
        new THREE.Vector3(-45, 1.2, -36),
        new THREE.Vector3(45, 20, STREET_WALK_MAX_Z),
      ),
      moveSpeed = 7.5,
      boostMultiplier = 2.2,
      damping = 11,
      walkSpeed = 4.2,
      walkBoostMultiplier = 1.65,
      walkDamping = 14,
      minimumHeightAt = null,
      groundClearance = 1.45,
      walkEyeHeight = 1.68,
      walkMinimumZAt = null,
      groundFollow = 18,
      headBobAmount = 0.035,
      headBobFrequency = 9.2,
      enableHeadBob = true,
      resolvePosition = null,
      collisionRadius = 0.42,
      lockTimeout = 2800,
    } = {},
  ) {
    super();
    this.camera = camera;
    this.domElement = domElement;
    this.bounds = bounds.clone();
    this.moveSpeed = moveSpeed;
    this.boostMultiplier = boostMultiplier;
    this.damping = damping;
    this.walkSpeed = walkSpeed;
    this.walkBoostMultiplier = walkBoostMultiplier;
    this.walkDamping = walkDamping;
    this.minimumHeightAt = minimumHeightAt;
    this.groundClearance = groundClearance;
    this.walkEyeHeight = walkEyeHeight;
    this.walkMinimumZAt = walkMinimumZAt;
    this.groundFollow = groundFollow;
    this.headBobAmount = headBobAmount;
    this.headBobFrequency = headBobFrequency;
    this.enableHeadBob = enableHeadBob;
    this.resolvePosition = resolvePosition;
    this.collisionRadius = collisionRadius;
    this.lockTimeout = lockTimeout;
    this.enabled = false;
    this.movementMode = 'free';
    this.allowUnlockedMovement = false;
    this.lockPending = false;
    this.lockTimer = 0;
    this.lockAttempt = 0;
    this.sessionWasLocked = false;
    this.lastActivationError = null;
    this.collisionEvents = 0;
    this.walkCycle = 0;
    this.walkMotionBlend = 0;
    this.walkBobOffset = 0;
    this.lastSurfaceHeight = 0;
    this.pressedKeys = new Set();
    this.velocity = new THREE.Vector3();
    this.previousPosition = new THREE.Vector3();
    this.worldVelocity = new THREE.Vector3();
    this.rightDirection = new THREE.Vector3();
    this.forwardDirection = new THREE.Vector3();
    this.boundaryNormal = new THREE.Vector3();
    this.cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.collisionQuery = {
      previousPosition: this.previousPosition,
      radius: this.collisionRadius,
      eyeHeight: this.groundClearance,
    };
    this.controls = new PointerLockControls(camera, domElement);
    this.controls.pointerSpeed = 0.62;
    this.controls.minPolarAngle = Math.PI * 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.92;

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handlePointerLockChange = this.handlePointerLockChange.bind(this);
    this.handlePointerLockError = this.handlePointerLockError.bind(this);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    document.addEventListener(
      'pointerlockchange',
      this.handlePointerLockChange,
    );
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
  }

  get supportsPointerLock() {
    return typeof this.domElement.requestPointerLock === 'function';
  }

  get isPointerLocked() {
    return document.pointerLockElement === this.domElement;
  }

  activate({ requestPointerLock = true, movementMode = this.movementMode } = {}) {
    if (requestPointerLock && !this.supportsPointerLock) return false;
    if (
      requestPointerLock &&
      document.pointerLockElement &&
      !this.isPointerLocked
    ) {
      return false;
    }

    this.setMovementMode(movementMode, {
      snapToGround: movementMode === 'walk',
    });
    this.enabled = true;
    this.allowUnlockedMovement = !requestPointerLock;
    this.lockPending = requestPointerLock;
    this.sessionWasLocked = false;
    this.lastActivationError = null;
    this.clearMovement();
    // Toolbar clicks leave focus on a button; returning focus to the canvas
    // ensures movement keys reach the controller after pointer lock begins.
    this.domElement.focus({ preventScroll: true });
    this.dispatchStateChange();
    if (requestPointerLock) {
      const attempt = ++this.lockAttempt;
      this.armLockTimeout(attempt);
      try {
        // Calling the platform API directly lets us observe modern browsers'
        // promise rejection. Three.js r160's lock() discards that promise.
        const request = this.domElement.requestPointerLock();
        if (request && typeof request.catch === 'function') {
          request.catch((error) => {
            if (
              attempt !== this.lockAttempt ||
              !this.enabled ||
              this.isPointerLocked
            ) {
              return;
            }
            this.failActivation('request-rejected', error);
          });
        }
      } catch (error) {
        this.failActivation('request-threw', error);
        return false;
      }
    }
    return true;
  }

  deactivate({ unlock = true } = {}) {
    const wasEnabled = this.enabled;
    const wasLocked = this.isPointerLocked;
    this.enabled = false;
    this.allowUnlockedMovement = false;
    this.lockPending = false;
    this.lockAttempt += 1;
    this.clearLockTimeout();
    this.clearMovement();
    if (unlock && wasLocked) this.controls.unlock();
    if (wasEnabled || wasLocked) {
      this.dispatchStateChange(unlock ? false : this.isPointerLocked);
    }
  }

  handleKeyDown(event) {
    if (
      !this.enabled ||
      isEditableTarget(event.target) ||
      !MOVEMENT_CODES.has(event.code)
    ) {
      return;
    }
    this.pressedKeys.add(event.code);
    event.preventDefault();
  }

  handleKeyUp(event) {
    if (!MOVEMENT_CODES.has(event.code)) return;
    this.pressedKeys.delete(event.code);
    if (this.enabled) event.preventDefault();
  }

  handleWindowBlur() {
    this.clearMovement();
  }

  handlePointerLockChange() {
    const locked = this.isPointerLocked;
    this.lockPending = false;
    this.clearLockTimeout();
    if (locked) this.sessionWasLocked = true;

    // A pending browser request can resolve after the user has already
    // switched back to OrbitControls. Release that stale lock immediately.
    if (locked && !this.enabled) {
      this.controls.unlock();
      return;
    }

    const shouldExit =
      !locked && this.enabled && !this.allowUnlockedMovement;
    this.clearMovement();
    this.dispatchStateChange(locked);
    if (shouldExit) this.dispatchEvent(new Event('exitrequest'));
  }

  handlePointerLockError() {
    if (!this.enabled || !this.lockPending) return;
    this.failActivation('pointer-lock-error');
  }

  armLockTimeout(attempt) {
    this.clearLockTimeout();
    this.lockTimer = window.setTimeout(() => {
      if (
        attempt === this.lockAttempt &&
        this.enabled &&
        this.lockPending &&
        !this.isPointerLocked
      ) {
        this.failActivation('request-timeout');
      }
    }, this.lockTimeout);
  }

  clearLockTimeout() {
    window.clearTimeout(this.lockTimer);
    this.lockTimer = 0;
  }

  failActivation(reason, error = null) {
    if (!this.enabled || (!this.lockPending && !this.isPointerLocked)) return;
    this.lockPending = false;
    this.lastActivationError = reason;
    this.lockAttempt += 1;
    this.clearLockTimeout();
    this.clearMovement();
    this.dispatchStateChange(false);
    this.dispatchEvent(
      new CustomEvent('activationerror', {
        detail: {
          reason,
          errorName: error?.name ?? null,
        },
      }),
    );
    this.dispatchEvent(new Event('exitrequest'));
  }

  dispatchStateChange(locked = this.isPointerLocked) {
    this.dispatchEvent(
      new CustomEvent('statechange', {
        detail: {
          enabled: this.enabled,
          locked,
          pending: this.lockPending,
        },
      }),
    );
  }

  clearMovement() {
    this.pressedKeys.clear();
    this.velocity.set(0, 0, 0);
    this.walkMotionBlend = 0;
    this.walkBobOffset = 0;
  }

  setMovementMode(mode, { snapToGround = mode === 'walk' } = {}) {
    if (!['walk', 'free'].includes(mode)) return this.movementMode;
    const changed = mode !== this.movementMode;
    this.movementMode = mode;
    this.collisionQuery.eyeHeight = this.getEyeHeight();
    if (changed) this.clearMovement();
    if (mode === 'walk' && snapToGround) this.snapToGround();
    return this.movementMode;
  }

  getEyeHeight() {
    return this.movementMode === 'walk'
      ? this.walkEyeHeight
      : this.groundClearance;
  }

  getSurfaceHeight(x = this.camera.position.x, z = this.camera.position.z) {
    return typeof this.minimumHeightAt === 'function'
      ? this.minimumHeightAt(x, z)
      : this.bounds.min.y - this.getEyeHeight();
  }

  getWalkMinimumZ(x = this.camera.position.x) {
    const authoredBoundary =
      typeof this.walkMinimumZAt === 'function'
        ? this.walkMinimumZAt(x)
        : 3.6;
    return THREE.MathUtils.clamp(
      authoredBoundary,
      this.bounds.min.z,
      this.bounds.max.z,
    );
  }

  snapToGround() {
    this.lastSurfaceHeight = this.getSurfaceHeight();
    this.camera.position.y = THREE.MathUtils.clamp(
      this.lastSurfaceHeight + this.walkEyeHeight,
      this.bounds.min.y,
      this.bounds.max.y,
    );
    // Keep the current yaw when entering walk mode, but remove steep flight
    // pitch so the first grounded frame looks toward the route, not the sand.
    this.cameraEuler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.cameraEuler.x = THREE.MathUtils.clamp(this.cameraEuler.x, -0.18, 0.14);
    this.cameraEuler.z = 0;
    this.camera.quaternion.setFromEuler(this.cameraEuler);
    this.camera.updateMatrixWorld(true);
    this.walkCycle = 0;
    this.walkMotionBlend = 0;
    this.walkBobOffset = 0;
  }

  getMinimumHeight(x = this.camera.position.x, z = this.camera.position.z) {
    const terrainFloor = this.getSurfaceHeight(x, z) + this.getEyeHeight();
    return THREE.MathUtils.clamp(
      Math.max(this.bounds.min.y, terrainFloor),
      this.bounds.min.y,
      this.bounds.max.y,
    );
  }

  removeVelocityInto(normal) {
    if (!normal || normal.lengthSq() < 0.0001) return;

    this.rightDirection.setFromMatrixColumn(this.camera.matrix, 0);
    this.rightDirection.y = 0;
    this.rightDirection.normalize();
    this.forwardDirection.crossVectors(this.camera.up, this.rightDirection);
    this.forwardDirection.normalize();
    this.worldVelocity
      .copy(this.rightDirection)
      .multiplyScalar(this.velocity.x)
      .addScaledVector(this.forwardDirection, this.velocity.z);

    const inwardSpeed = this.worldVelocity.dot(normal);
    if (inwardSpeed < 0) {
      this.worldVelocity.addScaledVector(normal, -inwardSpeed);
      this.velocity.x = this.worldVelocity.dot(this.rightDirection);
      this.velocity.z = this.worldVelocity.dot(this.forwardDirection);
    }
  }

  constrainHorizontalPosition() {
    this.boundaryNormal.set(0, 0, 0);
    if (this.camera.position.x < this.bounds.min.x) {
      this.camera.position.x = this.bounds.min.x;
      this.boundaryNormal.x += 1;
    } else if (this.camera.position.x > this.bounds.max.x) {
      this.camera.position.x = this.bounds.max.x;
      this.boundaryNormal.x -= 1;
    }

    const minimumZ =
      this.movementMode === 'walk'
        ? Math.max(this.bounds.min.z, this.getWalkMinimumZ())
        : this.bounds.min.z;
    if (this.camera.position.z < minimumZ) {
      this.camera.position.z = minimumZ;
      this.boundaryNormal.z += 1;
    } else if (this.camera.position.z > this.bounds.max.z) {
      this.camera.position.z = this.bounds.max.z;
      this.boundaryNormal.z -= 1;
    }

    if (this.boundaryNormal.lengthSq() > 0) {
      this.boundaryNormal.normalize();
      this.removeVelocityInto(this.boundaryNormal);
      return true;
    }
    return false;
  }

  updateVerticalPosition(delta, hasMovementInput, speed) {
    if (this.movementMode === 'free') {
      this.camera.position.y += this.velocity.y * delta;
      if (this.camera.position.y > this.bounds.max.y) {
        this.camera.position.y = this.bounds.max.y;
        if (this.velocity.y > 0) this.velocity.y = 0;
      }
      const minimumHeight = this.getMinimumHeight();
      if (this.camera.position.y < minimumHeight) {
        this.camera.position.y = minimumHeight;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
      return;
    }

    this.velocity.y = 0;
    this.lastSurfaceHeight = this.getSurfaceHeight();
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const motionTarget = hasMovementInput
      ? THREE.MathUtils.clamp(horizontalSpeed / Math.max(speed, 0.001), 0, 1)
      : 0;
    this.walkMotionBlend = THREE.MathUtils.damp(
      this.walkMotionBlend,
      motionTarget,
      10,
      delta,
    );
    this.walkCycle += delta * this.headBobFrequency * (0.7 + this.walkMotionBlend);
    this.walkBobOffset = this.enableHeadBob
      ? Math.sin(this.walkCycle) * this.headBobAmount * this.walkMotionBlend
      : 0;
    const groundedHeight = this.lastSurfaceHeight + this.walkEyeHeight;
    const desiredHeight = groundedHeight + this.walkBobOffset;
    this.camera.position.y = THREE.MathUtils.damp(
      this.camera.position.y,
      desiredHeight,
      this.groundFollow,
      delta,
    );
    this.camera.position.y = Math.max(
      groundedHeight - 0.008,
      Math.min(this.camera.position.y, this.bounds.max.y),
    );
  }

  update(delta) {
    if (
      !this.enabled ||
      (!this.isPointerLocked && !this.allowUnlockedMovement)
    ) {
      return;
    }

    const right =
      Number(this.pressedKeys.has('KeyD')) -
      Number(this.pressedKeys.has('KeyA'));
    const forward =
      Number(this.pressedKeys.has('KeyW')) -
      Number(this.pressedKeys.has('KeyS'));
    const up =
      this.movementMode === 'free'
        ? Number(this.pressedKeys.has('Space')) -
          Number(
            this.pressedKeys.has('KeyQ') ||
              this.pressedKeys.has('ControlLeft') ||
              this.pressedKeys.has('ControlRight'),
          )
        : 0;
    const boosting =
      this.pressedKeys.has('ShiftLeft') ||
      this.pressedKeys.has('ShiftRight');
    const baseSpeed =
      this.movementMode === 'walk' ? this.walkSpeed : this.moveSpeed;
    const boost =
      this.movementMode === 'walk'
        ? this.walkBoostMultiplier
        : this.boostMultiplier;
    const speed = baseSpeed * (boosting ? boost : 1);
    const horizontalLength = Math.hypot(right, forward);
    const normalizedRight = horizontalLength > 1 ? right / horizontalLength : right;
    const normalizedForward =
      horizontalLength > 1 ? forward / horizontalLength : forward;
    const activeDamping =
      this.movementMode === 'walk' ? this.walkDamping : this.damping;
    const blend = 1 - Math.exp(-activeDamping * delta);

    this.velocity.x = THREE.MathUtils.lerp(
      this.velocity.x,
      normalizedRight * speed,
      blend,
    );
    this.velocity.z = THREE.MathUtils.lerp(
      this.velocity.z,
      normalizedForward * speed,
      blend,
    );
    this.velocity.y = THREE.MathUtils.lerp(
      this.velocity.y,
      up * speed * 0.72,
      blend,
    );

    this.previousPosition.copy(this.camera.position);

    // PointerLockControls r160 reads camera.matrix for movement axes. Refresh
    // it after mouse rotation so keyboard motion follows the latest heading.
    this.camera.updateMatrix();
    this.controls.moveRight(this.velocity.x * delta);
    this.controls.moveForward(this.velocity.z * delta);
    this.constrainHorizontalPosition();

    const collision =
      typeof this.resolvePosition === 'function'
        ? this.resolvePosition(this.camera.position, this.collisionQuery)
        : null;
    if (collision?.collided) {
      this.collisionEvents += 1;
      this.removeVelocityInto(collision.normal);
      this.constrainHorizontalPosition();
    }
    this.updateVerticalPosition(delta, horizontalLength > 0, speed);
  }

  isGrounded() {
    return (
      this.movementMode === 'walk' &&
      Math.abs(
        this.camera.position.y -
          (this.lastSurfaceHeight + this.walkEyeHeight + this.walkBobOffset),
      ) < 0.08
    );
  }

  getHorizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  getDebugState() {
    return {
      enabled: this.enabled,
      locked: this.isPointerLocked,
      lockPending: this.lockPending,
      sessionWasLocked: this.sessionWasLocked,
      lastActivationError: this.lastActivationError,
      allowUnlockedMovement: this.allowUnlockedMovement,
      movementMode: this.movementMode,
      speed: this.moveSpeed,
      walkSpeed: this.walkSpeed,
      groundClearance: this.groundClearance,
      walkEyeHeight: this.walkEyeHeight,
      walkMinimumZ: Number(this.getWalkMinimumZ().toFixed(3)),
      surfaceHeight: Number(this.getSurfaceHeight().toFixed(3)),
      headBobOffset: Number(this.walkBobOffset.toFixed(4)),
      grounded: this.isGrounded(),
      collisionRadius: this.collisionRadius,
      collisionEvents: this.collisionEvents,
      minimumHeight: Number(this.getMinimumHeight().toFixed(3)),
      velocity: this.velocity.toArray().map((value) => Number(value.toFixed(3))),
      bounds: {
        min: this.bounds.min.toArray(),
        max: this.bounds.max.toArray(),
      },
    };
  }

  dispose() {
    this.deactivate();
    this.clearLockTimeout();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    document.removeEventListener(
      'pointerlockchange',
      this.handlePointerLockChange,
    );
    document.removeEventListener(
      'pointerlockerror',
      this.handlePointerLockError,
    );
    this.controls.dispose();
  }
}
