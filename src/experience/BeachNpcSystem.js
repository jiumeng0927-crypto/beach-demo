import * as THREE from 'three';
import { assetUrl } from './assetUrl.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const NPC_SPECS = Object.freeze([
  { id: 'lin', name: '小林', role: '海岸拾光客', file: 'casual-female.glb', x: 9, z: 23, heading: 0.5 },
  { id: 'chen', name: '阿辰', role: '沙滩球友', file: 'casual-male.glb', x: 5, z: 30, heading: 0.9 },
]);

function release(model) {
  const resources = new Set();
  model.traverse((o) => {
    if (o.geometry) resources.add(o.geometry);
    if (o.skeleton) resources.add(o.skeleton);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean)) {
      resources.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
}

export class BeachNpcSystem extends EventTarget {
  constructor(experience) {
    super();
    this.experience = experience;
    this.root = new THREE.Group();
    this.root.name = 'BeachVisitors';
    this.root.visible = false;
    experience.scene.add(this.root);
    this.items = [];
    this.errors = [];
    this.activeId = null;
    this.enabled = false;
    this.disposed = false;
    this.questAccepted = false;
    this.questClaimed = experience.discovery.campaign.rewardClaimed;
    this.controller = new AbortController();
    this.inputController = new AbortController();
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindWorld(experience.world);
    this.bindInput();
    this.ready = this.load();
  }

  async load() {
    const timer = setTimeout(() => this.controller.abort(), 15000);
    try {
      for (const spec of NPC_SPECS) {
        try {
          const response = await fetch(assetUrl(`models/npc/${spec.file}`), { signal: this.controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
          if (this.disposed) { release(gltf.scene); continue; }
          const model = gltf.scene, root = new THREE.Group();
          root.name = `Visitor-${spec.id}`;
          const mixer = new THREE.AnimationMixer(model);
          const actions = Object.fromEntries(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
          if (!actions.Idle || !actions.Victory) { release(model); throw new Error('Missing authored clips'); }
          actions.Idle.play();
          mixer.update(0);
          model.updateMatrixWorld(true);
          model.traverse(o => o.skeleton?.update());
          const bounds = new THREE.Box3().setFromObject(model, true), size = bounds.getSize(new THREE.Vector3());
          const scale = 1.9 / size.y;
          model.scale.setScalar(scale);
          model.position.set(-(bounds.min.x + bounds.max.x) * scale / 2, -bounds.min.y * scale,
            -(bounds.min.z + bounds.max.z) * scale / 2);
          root.add(model);
          root.position.set(spec.x, this.world.getWalkSurfaceHeight(spec.x, spec.z), spec.z);
          root.rotation.y = spec.heading;
          model.traverse((mesh) => {
            if (!mesh.isMesh) return;
            mesh.frustumCulled = false;
            mesh.receiveShadow = true;
            mesh.material.envMapIntensity = 0.55;
            mesh.material.roughness = 0.88;
          });
          const collider = { type: 'circle', name: `visitor-${spec.id}`, x: spec.x, z: spec.z,
            radius: 0.36, minY: root.position.y, maxY: root.position.y + 1.9 };
          this.items.push({ spec, root, model, mixer, actions, collider, greeting: 0 });
          this.world.registerCameraCollider(collider);
          this.root.add(root);
          this.setShadows(this.experience.shadowsEnabled && this.experience.effectiveQuality === 'high');
        } catch (error) {
          if (!this.disposed) this.errors.push({ id: spec.id, message: error.message });
        }
      }
    } finally { clearTimeout(timer); }
  }

  bindWorld(world) {
    if (this.world) {
      this.world.unregisterReflectionExclusion(this.root);
      for (const item of this.items) this.world.unregisterCameraCollider(item.collider);
    }
    this.world = world;
    world.registerReflectionExclusion(this.root);
    for (const item of this.items) world.registerCameraCollider(item.collider);
  }

  bindInput() {
    const canvas = this.experience.canvas;
    const options = { capture: true, signal: this.inputController.signal };
    canvas.addEventListener('pointerdown', event => {
      if (!this.enabled || this.activeId || event.button !== 0 || this.experience.cameraMode !== 'orbit') return;
      const item = this.pick(event.clientX, event.clientY);
      if (!item) return;
      this.press = { id: event.pointerId, x: event.clientX, y: event.clientY, item };
      canvas.setPointerCapture(event.pointerId);
      event.stopImmediatePropagation();
    }, options);
    canvas.addEventListener('pointerup', event => {
      const press = this.press;
      if (!press || press.id !== event.pointerId) return;
      this.press = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      event.stopImmediatePropagation();
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 8
        && this.pick(event.clientX, event.clientY) === press.item) this.open(press.item.spec.id);
    }, options);
    canvas.addEventListener('pointercancel', () => { this.press = null; }, options);
    canvas.addEventListener('lostpointercapture', () => { this.press = null; }, options);
    document.addEventListener('keydown', event => {
      if (!this.enabled || this.activeId || event.repeat || event.code !== 'KeyE'
        || document.querySelector('dialog[open]') || event.target.closest?.('input,textarea,select,[contenteditable]')
        || this.experience.cameraMode === 'orbit'
        || !(this.experience.freeCamera.isPointerLocked || this.experience.freeCamera.allowUnlockedMovement)) return;
      const rect = canvas.getBoundingClientRect();
      const item = this.pick(rect.x + rect.width / 2, rect.y + rect.height / 2, 4.5);
      if (!item) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.open(item.spec.id);
    }, options);
  }

  pick(x, y, maxDistance = 70) {
    const e = this.experience, rect = e.canvas.getBoundingClientRect();
    this.pointer.set((x - rect.x) / rect.width * 2 - 1, 1 - (y - rect.y) / rect.height * 2);
    this.ray.setFromCamera(this.pointer, e.camera);
    this.ray.far = maxDistance;
    this.root.updateMatrixWorld(true);
    this.root.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.skeleton.update(); o.computeBoundingSphere(); o.computeBoundingBox();
    });
    // A pose-aware interaction volume keeps small animated visitors tappable.
    const hits = this.items.flatMap(item => {
      const box = new THREE.Box3().setFromObject(item.root, true).expandByScalar(0.12);
      const point = this.ray.ray.intersectBox(box, new THREE.Vector3());
      const distance = point ? point.distanceTo(this.ray.ray.origin) : Infinity;
      return distance <= maxDistance ? [{ item, distance }] : [];
    }).sort((a, b) => a.distance - b.distance);
    if (!hits.length) return null;
    const hit = hits[0];
    const blockers = [this.world.root, e.coastalProps?.root, e.coastalProps?.reflectedRoot, e.billiards?.group].filter(Boolean);
    const visible = object => {
      for (let o = object; o; o = o.parent) if (!o.visible) return false;
      return !object.material?.transparent;
    };
    if (this.ray.intersectObjects(blockers, true).some(h => h.distance < hit.distance - 0.05 && visible(h.object))) return null;
    return hit.item;
  }

  open(id) {
    const item = this.items.find(item => item.spec.id === id);
    if (!this.enabled || !item || this.disposed) return false;
    this.activeId = id;
    this.experience.billiards?.cancelAim();
    this.experience.setCameraMode('orbit');
    this.experience.controls.enabled = false;
    item.root.rotation.y = Math.atan2(this.experience.camera.position.x - item.root.position.x,
      this.experience.camera.position.z - item.root.position.z);
    this.greet(item);
    this.dispatchEvent(new Event('dialogchange'));
    return true;
  }

  greet(item) {
    const action = item.actions.Victory;
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.25).play();
    item.actions.Idle.fadeOut(0.25);
    item.greeting = action.getClip().duration;
  }

  close() {
    this.activeId = null;
    this.experience.controls.enabled = this.experience.entered && this.experience.cameraMode === 'orbit'
      && !this.experience.cameraTween;
  }

  getConversation() {
    const item = this.items.find(i => i.spec.id === this.activeId);
    if (!item) return null;
    const discovery = this.experience.discovery.getDebugState();
    if (item.spec.id === 'chen') return { ...item.spec,
      text: '海风正好，来台球区打一局？当前球局会原样保留。',
      actions: [{ id: 'pool', text: '前往台球区' }, { id: 'chat', text: '聊聊海边' }] };
    const done = discovery.completed;
    return { ...item.spec,
      text: this.questClaimed ? '标本、潮间带和净滩记录都齐了，你已经是一位净滩守护者。谢谢你照顾这片海岸。'
        : done && this.questAccepted ? '十八处海岸记录完成了！三枚徽记都属于你。'
        : this.questAccepted ? `${discovery.chapterTitle}：${discovery.collected} / 6；总记录 ${discovery.overallCollected} / 18。${discovery.chapterComplete ? '这一章完成了，接着看看下一个任务吧。' : discovery.chapter === 1 ? '潮沟里的空贝壳要等低潮才会露出来。' : '需要我指出下一处吗？'}`
        : '我在做一份海岸手记：记录海玻璃、观察退潮后的空贝壳，再把废弃瓶罐带离沙滩。愿意一起完成吗？',
      actions: this.questClaimed ? [{ id: 'chat', text: '聊聊潮汐' }]
        : done && this.questAccepted ? [{ id: 'claim', text: '完成海岸记录' }]
        : this.questAccepted ? discovery.chapterComplete ? [{ id: 'next', text: '开始下一章' }] : [{ id: 'hint', text: '下一处线索' }]
        : [{ id: 'accept', text: '一起寻找' }] };
  }

  perform(action) {
    const conversation = this.getConversation();
    if (!conversation?.actions.some(a => a.id === action)) return null;
    if (action === 'accept') this.questAccepted = true;
    if (action === 'claim') {
      this.questClaimed = true;
      this.experience.discovery.campaign.rewardClaimed = true;
      this.experience.discovery.campaign.persist();
      this.greet(this.items.find(i => i.spec.id === this.activeId));
    }
    if (action === 'next') this.experience.discovery.nextChapter();
    if (action === 'pool') { this.close(); this.experience.focusBilliards(); return 'close'; }
    if (action === 'hint') {
      const site = this.experience.discovery.getDebugState().sites.find(site => site.available);
      if (!site) return '剩下的贝壳还在潮水下面。等退潮后再来，或者先去打一局台球吧。';
      if (site) {
        this.close();
        const target = new THREE.Vector3().fromArray(site.position);
        this.experience.startCameraTween(target.clone().add(new THREE.Vector3(5, 4, 7)), target);
        return 'close';
      }
    }
    if (action === 'chat') return this.activeId === 'chen'
      ? '我最喜欢傍晚的海面。等这一局结束，再去岸边看日落吧。'
      : `现在是${{ low: '低潮', mid: '中潮', high: '高潮' }[this.experience.environment.getTideState().band]}，退潮时沙滩上会多露出一些潮纹。`;
    this.dispatchEvent(new Event('dialogchange'));
    return null;
  }

  update(delta) {
    if (!this.enabled || this.disposed) return;
    for (const item of this.items) {
      item.mixer.update(delta);
      if (item.greeting > 0) {
        item.greeting -= delta;
        if (item.greeting <= 0) {
          item.actions.Victory.fadeOut(0.25);
          item.actions.Idle.reset().fadeIn(0.25).play();
        }
      }
    }
  }

  setShadows(enabled) { this.root.traverse(o => { if (o.isMesh) o.castShadow = enabled; }); }
  setEnabled(enabled) { this.enabled = enabled; this.root.visible = enabled; }
  getState() {
    return { enabled: this.enabled, loaded: this.items.length, errors: this.errors, activeId: this.activeId,
      questAccepted: this.questAccepted, questClaimed: this.questClaimed, disposed: this.disposed,
      items: this.items.map(i => ({ id: i.spec.id, name: i.spec.name, position: i.root.position.toArray(),
        clips: Object.keys(i.actions), animationTime: i.mixer.time, uuid: i.root.uuid })) };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.controller.abort(); this.inputController.abort(); this.press = null;
    this.world.unregisterReflectionExclusion(this.root);
    for (const item of this.items) {
      this.world.unregisterCameraCollider(item.collider);
      item.mixer.stopAllAction(); item.mixer.uncacheRoot(item.model); release(item.model);
    }
    this.root.removeFromParent();
  }
}
