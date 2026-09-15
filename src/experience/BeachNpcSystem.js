import * as THREE from 'three';
import { assetUrl } from './assetUrl.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { applyNpcPalette, createNpcAccessory, NPC_APPEARANCES } from './NpcAppearance.js';

export const NPC_SPECS = Object.freeze([
  { id: 'lin', name: '小林', role: '海岸拾光客', file: 'casual-female.glb', x: 9, z: 23, heading: 0.5 },
  { id: 'chen', name: '阿辰', role: '沙滩球友', file: 'casual-male.glb', x: 5, z: 30, heading: 0.9 },
  { id: 'mei', name: '阿梅', role: '咖啡店常客', file: 'casual-female-crowd.glb', x: -22, z: 72.7, heading: -1.1, street: true, height: 1.78,
    text: '我刚点了一杯冰咖啡。这里能看见海，也能听到沙滩上传来的击球声。' },
  { id: 'hao', name: '阿浩', role: '冲浪爱好者', file: 'casual-male-crowd.glb', x: -9, z: 73.3, heading: 2.6, street: true, height: 1.94,
    text: '等风的时候，我喜欢在这条小街逛一会儿。前面是冲浪用品店，海就在身后。' },
  { id: 'fan', name: '小帆', role: '沿街散步', file: 'casual-male-crowd.glb', x: -39, z: 69.7, heading: 1.57, street: true, height: 1.84,
    route: [-39, -20], speed: 0.68, text: '从人行道慢慢走过去，可以一路看到咖啡店、冲浪店和小卖部。' },
  { id: 'le', name: '小乐', role: '海边旅人', file: 'casual-female-crowd.glb', x: 4, z: 59.9, heading: 1.57, street: true, height: 1.86,
    route: [4, 28], speed: 0.59, text: '不用赶路。沿着海边走一走，等光线慢慢变暖就很好。' },
  { id: 'yu', name: '小屿', role: '潮岸小铺店主', file: 'casual-male-crowd.glb', x: 17, z: 74.2, heading: 3.05, street: true, merchant: true, height: 1.88,
    text: '拾到的海玻璃、空贝壳和瓶罐都可以在这里登记寄售，也可以换些海岸纪念品。' },
  { id: 'qing', name: '青青', role: '咖啡店店员', file: 'casual-female-crowd.glb', x: -28, z: 72.2, heading: 3.0, street: true, height: 1.82,
    text: '咖啡刚磨好。沿街慢慢走，转过身就是开阔的海面。' },
  { id: 'ran', name: '阿冉', role: '净滩志愿者', file: 'casual-male.glb', x: -36, z: 50.5, heading: 1.57, height: 1.91,
    route: [-36, -20], speed: 0.52, text: '我在整理潮线附近的瓶罐。捡到后可以带去潮岸小铺登记换潮贝。' },
  { id: 'ning', name: '宁宁', role: '沙滩游客', file: 'casual-female.glb', x: 17, z: 40.8, heading: 1.57, height: 1.80,
    route: [17, 28], speed: 0.46, text: '这里离躺椅和瞭望点都很近，傍晚看海最好。' },
]);

export function getNpcRouteState(spec, routeTime) {
  const distance = Math.abs(spec.route[1] - spec.route[0]);
  const duration = distance / spec.speed;
  const leg = duration + 2;
  const phase = routeTime % (leg * 2);
  const reverse = phase >= leg;
  const local = phase % leg;
  const progress = Math.min(1, local / duration);
  return { x: THREE.MathUtils.lerp(spec.route[reverse ? 1 : 0], spec.route[reverse ? 0 : 1], progress),
    reverse, moving: local < duration };
}

function release(models) {
  const resources = new Set();
  for (const model of (Array.isArray(models) ? models : [models])) model.traverse((o) => {
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
    this.sources = new Map();
    this.sourcePromises = new Map();
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.visibilitySphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
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
    this.collisionProbe = new THREE.Vector3();
    this.previousProbe = new THREE.Vector3();
    this.poseBox = new THREE.Box3();
    this.objectBox = new THREE.Box3();
    this.bindWorld(experience.world);
    this.bindInput();
    this.ready = this.load();
  }

  async load() {
    const timer = setTimeout(() => this.controller.abort(), 15000);
    try {
      for (const spec of NPC_SPECS) {
        if (this.disposed) break;
        try {
          if (!this.sourcePromises.has(spec.file)) this.sourcePromises.set(spec.file, (async () => {
            const response = await fetch(assetUrl(`models/npc/${spec.file}`), { signal: this.controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
            if (this.disposed) { release(gltf.scene); return null; }
            this.sources.set(spec.file, gltf);
            return gltf;
          })());
          const gltf = await this.sourcePromises.get(spec.file);
          if (!gltf || this.disposed) break;
          if (!['Idle', 'Walk', 'Victory'].every(name => gltf.animations.some(clip => clip.name === name))) throw new Error('Missing authored clips');
          const model = cloneSkeleton(gltf.scene), root = new THREE.Group();
          root.name = `Visitor-${spec.id}`;
          const appearance = NPC_APPEARANCES[spec.id];
          const gender = spec.file.includes('female') ? 'female' : 'male';
          const recoloredVertices = applyNpcPalette(model, appearance, gender);
          const mixer = new THREE.AnimationMixer(model);
          const actions = Object.fromEntries(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
          actions.Idle.play();
          mixer.update(0);
          model.updateMatrixWorld(true);
          model.traverse(o => o.skeleton?.update());
          const bounds = new THREE.Box3().setFromObject(model, true), size = bounds.getSize(new THREE.Vector3());
          const height = spec.height ?? 1.9, scale = height / size.y;
          const scaleX = scale * appearance.width, scaleZ = scale * appearance.depth;
          model.scale.set(scaleX, scale, scaleZ);
          model.getObjectByName('Head')?.scale.set(...appearance.headScale);
          model.position.set(-(bounds.min.x + bounds.max.x) * scaleX / 2, -bounds.min.y * scale,
            -(bounds.min.z + bounds.max.z) * scaleZ / 2);
          const accessory = createNpcAccessory(appearance);
          root.add(model, accessory);
          root.position.set(spec.x, this.world.getWalkSurfaceHeight(spec.x, spec.z), spec.z);
          root.rotation.y = spec.heading;
          model.traverse((mesh) => {
            if (!mesh.isMesh) return;
            mesh.frustumCulled = false;
            mesh.receiveShadow = true;
          });
          const collider = { type: 'circle', name: `visitor-${spec.id}`, x: spec.x, z: spec.z,
            radius: 0.39 * Math.max(appearance.width, appearance.depth), minY: root.position.y, maxY: root.position.y + height };
          const item = { spec, appearance, root, model, accessory, mixer, actions, collider, greeting: 0,
            routeTime: 0, walking: false, yielding: false, blockedBy: [], poseClock: 0,
            groundClearance: 0, groundLift: 0, recoloredVertices };
          this.items.push(item);
          mixer.update(this.items.length * 0.27);
          this.world.registerCameraCollider(collider);
          this.root.add(root);
          this.updateGrounding(item, true);
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
    for (const item of this.items) {
      world.registerCameraCollider(item.collider);
      item.groundLift = 0;
      item.root.position.y = world.getWalkSurfaceHeight(item.root.position.x, item.root.position.z);
      this.updateGrounding(item, true);
      item.collider.minY = item.root.position.y;
      item.collider.maxY = item.root.position.y + (item.spec.height ?? 1.9);
    }
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
    const hits = this.items.filter(item => item.root.visible).flatMap(item => {
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
    this.experience.community?.meet(id);
    this.greet(item);
    this.dispatchEvent(new Event('dialogchange'));
    return true;
  }

  greet(item) {
    const action = item.actions.Victory;
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.25).play();
    item.actions.Idle.fadeOut(0.25);
    item.actions.Walk.fadeOut(0.25);
    item.walking = false;
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
    const inventory = this.experience.discovery.campaign.getState().economy.inventory;
    const relationship = this.experience.community?.getRelationship(item.spec.id);
    const order = this.experience.community?.getOrderForNpc(item.spec.id, inventory);
    const enrich = (conversation) => {
      const actions = [...conversation.actions];
      let text = conversation.text;
      if (order?.fulfilled) {
        text += ` 今天的“${order.title}”已经交付，谢谢你。`;
      } else if (order) {
        text += ` 我今天需要${order.kindName} ${order.count} 件，交付可获得 ${order.reward} 枚潮贝。`;
        if (order.available) actions.unshift({ id: 'delivery', text: `交付${order.kindName} × ${order.count}` });
      }
      return { ...conversation,
        role: `${conversation.role} · ${relationship?.label ?? '初次相遇'}`,
        text, actions };
    };
    if (item.spec.merchant) {
      const economy = this.experience.discovery.campaign.getState().economy;
      const commissions = this.experience.commissions?.getState();
      return enrich({ ...item.spec,
        text: `${item.spec.text} 你现在有 ${economy.inventoryTotal} 件可售物品和 ${economy.coins} 枚潮贝。今日委托已完成 ${commissions?.completed ?? 0} 项。`,
        actions: [{ id: 'market', text: '打开海滨交易' }, { id: 'commissions', text: '查看今日委托' }, { id: 'chat', text: '询问价格' }] });
    }
    if (item.spec.street) return enrich({ ...item.spec, text: item.spec.text,
      actions: [{ id: 'street', text: '看看海滨小街' }, { id: 'chat', text: '聊聊海边' }] });
    if (item.spec.text) return enrich({ ...item.spec, text: item.spec.text,
      actions: [{ id: 'chat', text: '聊聊海边' }] });
    const discovery = this.experience.discovery.getDebugState();
    if (item.spec.id === 'chen') return enrich({ ...item.spec,
      text: '海风正好，来台球区打一局？当前球局会原样保留。',
      actions: [{ id: 'pool', text: '前往台球区' }, { id: 'chat', text: '聊聊海边' }] });
    const done = discovery.completed;
    return enrich({ ...item.spec,
      text: this.questClaimed ? '标本、潮间带和净滩记录都齐了，你已经是一位净滩守护者。谢谢你照顾这片海岸。'
        : done && this.questAccepted ? '十八处海岸记录完成了！三枚徽记都属于你。'
        : this.questAccepted ? `${discovery.chapterTitle}：${discovery.collected} / 6；总记录 ${discovery.overallCollected} / 18。${discovery.chapterComplete ? '这一章完成了，接着看看下一个任务吧。' : discovery.chapter === 1 ? '潮沟里的空贝壳要等低潮才会露出来。' : '需要我指出下一处吗？'}`
        : '我在做一份海岸手记：记录海玻璃、观察退潮后的空贝壳，再把废弃瓶罐带离沙滩。愿意一起完成吗？',
      actions: this.questClaimed ? [{ id: 'chat', text: '聊聊潮汐' }]
        : done && this.questAccepted ? [{ id: 'claim', text: '完成海岸记录' }]
        : this.questAccepted ? discovery.chapterComplete ? [{ id: 'next', text: '开始下一章' }] : [{ id: 'hint', text: '下一处线索' }]
        : [{ id: 'accept', text: '一起寻找' }] });
  }

  perform(action) {
    const item = this.items.find(i => i.spec.id === this.activeId);
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
    if (action === 'market') return 'market';
    if (action === 'commissions') return 'commissions';
    if (action === 'delivery') {
      const inventory = this.experience.discovery.campaign.getState().economy.inventory;
      const order = this.experience.community?.getOrderForNpc(this.activeId, inventory);
      if (order && this.experience.fulfillCommunityOrder(order.id)) this.greet(item);
    }
    if (action === 'street') { this.close(); this.experience.focusStreet(); return 'close'; }
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
    if (action === 'chat' && conversation.merchant) {
      const values = this.experience.discovery.campaign.getState().economy.saleValues;
      return `当前寄售价：海玻璃 ${values.glass}、空贝壳 ${values.shell}、瓶罐 ${values.bottle} 枚潮贝。加固拾光袋会提高之后的寄售价。`;
    }
    if (action === 'chat' && conversation.street) return conversation.text;
    if (action === 'chat' && item?.spec.text) return item.spec.text;
    if (action === 'chat') return this.activeId === 'chen'
      ? '我最喜欢傍晚的海面。等这一局结束，再去岸边看日落吧。'
      : `现在是${{ low: '低潮', mid: '中潮', high: '高潮' }[this.experience.environment.getTideState().band]}，退潮时沙滩上会多露出一些潮纹。`;
    this.dispatchEvent(new Event('dialogchange'));
    return null;
  }

  canAdvance(item, x, z) {
    const height = item.spec.height ?? 1.9;
    const ground = this.world.getWalkSurfaceHeight(x, z);
    this.collisionProbe.set(x, ground + height, z);
    this.previousProbe.set(item.root.position.x, item.root.position.y + height, item.root.position.z);
    const collision = this.world.resolveCameraPosition(this.collisionProbe, {
      previousPosition: this.previousProbe,
      radius: item.collider.radius + 0.08,
      eyeHeight: height,
      ignore: item.collider,
    });
    item.blockedBy = collision?.names ?? [];
    return !collision;
  }

  updateGrounding(item, snap = false) {
    const ground = this.world.getWalkSurfaceHeight(item.root.position.x, item.root.position.z);
    item.root.position.y = ground + item.groundLift;
    item.root.updateMatrixWorld(true);
    this.poseBox.makeEmpty();
    item.model.traverse((object) => {
      if (!object.isSkinnedMesh) return;
      object.skeleton.update();
      object.computeBoundingBox();
      this.objectBox.copy(object.boundingBox).applyMatrix4(object.matrixWorld);
      this.poseBox.union(this.objectBox);
    });
    const relativeBottom = this.poseBox.isEmpty() ? 0 : this.poseBox.min.y - item.root.position.y;
    const desiredLift = THREE.MathUtils.clamp(0.025 - relativeBottom, 0, 0.12);
    item.groundLift = snap || desiredLift > item.groundLift
      ? desiredLift
      : THREE.MathUtils.lerp(item.groundLift, desiredLift, 0.35);
    item.groundClearance = relativeBottom + item.groundLift;
    item.root.position.y = ground + item.groundLift;
  }

  update(delta) {
    if (!this.enabled || this.disposed) return;
    const camera = this.experience.camera;
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    for (const item of this.items) {
      const { spec } = item;
      if (spec.route && this.activeId !== spec.id && item.greeting <= 0) {
        const yieldingToPlayer = this.experience.cameraMode === 'walk'
          && Math.hypot(camera.position.x - item.root.position.x, camera.position.z - item.root.position.z) < 1.25;
        const proposed = getNpcRouteState(spec, item.routeTime + delta);
        const blocked = proposed.moving && !yieldingToPlayer && !this.canAdvance(item, proposed.x, spec.z);
        if (yieldingToPlayer) item.blockedBy = [];
        if (!yieldingToPlayer && !blocked) item.routeTime += delta;
        const route = getNpcRouteState(spec, item.routeTime);
        item.root.position.x = route.x;
        const heading = route.reverse ? -Math.PI / 2 : Math.PI / 2;
        const turn = Math.atan2(Math.sin(heading - item.root.rotation.y), Math.cos(heading - item.root.rotation.y));
        item.root.rotation.y += turn * (1 - Math.exp(-delta * 6));
        const walking = route.moving && !yieldingToPlayer && !blocked;
        item.yielding = yieldingToPlayer || blocked;
        if (walking !== item.walking) {
          item.actions[walking ? 'Idle' : 'Walk'].fadeOut(0.25);
          item.actions[walking ? 'Walk' : 'Idle'].reset().fadeIn(0.25).play();
          item.actions.Walk.timeScale = spec.speed / 0.75;
          item.walking = walking;
        }
      }
      item.mixer.update(delta);
      if (item.greeting > 0) {
        item.greeting -= delta;
        if (item.greeting <= 0) {
          item.actions.Victory.fadeOut(0.25);
          item.actions.Idle.reset().fadeIn(0.25).play();
        }
      }
      item.poseClock += delta;
      if (item.poseClock >= 0.12) {
        item.poseClock %= 0.12;
        this.updateGrounding(item);
      } else {
        item.root.position.y = this.world.getWalkSurfaceHeight(item.root.position.x, item.root.position.z) + item.groundLift;
      }
      Object.assign(item.collider, { x: item.root.position.x, z: item.root.position.z,
        minY: item.root.position.y, maxY: item.root.position.y + (spec.height ?? 1.9) });
    }
    const visible = this.items.filter(item => {
      this.visibilitySphere.center.copy(item.root.position).y += 1;
      return this.frustum.intersectsSphere(this.visibilitySphere);
    }).sort((a, b) => camera.position.distanceToSquared(a.root.position)
      - camera.position.distanceToSquared(b.root.position));
    const limit = this.experience.effectiveQuality === 'low' ? 4 : visible.length;
    const shown = new Set(visible.slice(0, limit));
    const detailed = new Set(visible.slice(0, this.experience.effectiveQuality === 'low' ? 4 : 8));
    const active = this.items.find(item => item.spec.id === this.activeId);
    if (active) { shown.add(active); detailed.add(active); }
    for (const item of this.items) {
      item.root.visible = shown.has(item);
      item.accessory.visible = detailed.has(item);
    }
  }

  setShadows(enabled) { this.root.traverse(o => { if (o.isMesh) o.castShadow = enabled; }); }
  setEnabled(enabled) { this.enabled = enabled; this.root.visible = enabled; }
  getState() {
    return { enabled: this.enabled, loaded: this.items.length, errors: this.errors, activeId: this.activeId,
      questAccepted: this.questAccepted, questClaimed: this.questClaimed, disposed: this.disposed,
      sources: this.sources.size,
      items: this.items.map(i => ({ id: i.spec.id, name: i.spec.name, position: i.root.position.toArray(), walking: i.walking,
        yielding: i.yielding, blockedBy: i.blockedBy, visible: i.root.visible, appearance: i.appearance.label,
        kit: i.appearance.kit, headScale: i.appearance.headScale, recoloredVertices: i.recoloredVertices, groundClearance: i.groundClearance,
        clips: Object.keys(i.actions), animationTime: i.mixer.time, uuid: i.root.uuid })) };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.controller.abort(); this.inputController.abort(); this.press = null;
    this.world.unregisterReflectionExclusion(this.root);
    for (const item of this.items) {
      this.world.unregisterCameraCollider(item.collider);
      item.mixer.stopAllAction(); item.mixer.uncacheRoot(item.model);
    }
    release([this.root, ...[...this.sources.values()].map(gltf => gltf.scene)]);
    this.sources.clear(); this.sourcePromises.clear();
    this.root.removeFromParent();
  }
}
