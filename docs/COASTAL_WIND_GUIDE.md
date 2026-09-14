# 统一海风系统指南

## 1. 改造目标

原场景的云层、沙丘草、棕榈叶和雨丝都已经有风动效果，但四处分别写死了时间、幅度与偏移。
它们单独看都能工作，组合后却无法一起变强、减弱或停止。本轮没有改变场景物体和默认构图，
只建立一个共享海风状态，让现有效果使用同一相位与倍率。

官方参考：

- [Three.js BufferAttribute 文档](https://threejs.org/docs/#api/en/core/BufferAttribute)
- [Three.js InstancedMesh 文档](https://threejs.org/docs/#api/en/objects/InstancedMesh)
- [Three.js 动态实例官方示例](https://threejs.org/examples/#webgl_instancing_dynamic)

## 2. 强度映射

设置面板提供 `0.00-1.20` 的“海风强度”滑杆：

| 强度 | 倍率 | 结果 |
| ---: | ---: | --- |
| `0.00` | `0x` | 云层相位冻结，草和棕榈回到静止姿态，雨丝垂直下落 |
| `0.60` | `1x` | 与改造前默认场景完全相同的风速与幅度 |
| `1.20` | `2x` | 云层、植被和雨丝同步使用双倍风效 |

用户拖动滑杆时，`CoastalWind` 使用指数缓动逐渐靠近目标值，避免植被和雨丝突然跳变。自动测试
可以使用 `immediate` 参数直接到达目标，以便冻结同一帧进行精确比较。

## 3. 单一帧状态

`src/experience/CoastalWind.js` 每帧返回同一个可复用对象：

```js
{
  targetStrength,
  effectiveStrength,
  factor,
  phase,
  driftX,
  driftZ,
}
```

这个对象不在帧循环中重复分配。`BeachEnvironment` 先更新海风，再把状态传给 World；
`BeachExperience` 同一帧把倍率传给 RainSystem。这样所有消费者读取的是同一份结果。

## 4. 四套效果如何联动

- 云层：程序化云 Shader 的 `uTime` 改读共享 `phase`，云穹旋转按 `delta * factor` 累积。
- 沙丘草：`uGrassTime` 使用共享相位，原 High/Low 幅度分别乘以风倍率。
- 棕榈叶：55 片叶簇继续通过一个动态 `InstancedMesh` 更新矩阵，只改变摆动相位和幅度。
- 雨丝：原 `1.8 / -0.55` 水平漂移作为 `1x` 基准，雨线倾角和落点移动同时乘以风倍率。

雨线 position attribute 继续使用 `DynamicDrawUsage`，每次写入后设置 `needsUpdate`；棕榈叶继续通过
`setMatrixAt()` 更新实例矩阵，并设置 `instanceMatrix.needsUpdate = true`。这些做法与 Three.js 官方
动态 BufferAttribute 和 InstancedMesh 更新方式一致。

## 5. 性能与验收

统一海风只修改已有 uniform、实例矩阵和雨线顶点，不增加对象、几何、纹理、材质、Draw Call、
三角形或运行依赖。验证命令：

```bash
npm run test:wind
npm run test:visual
```

纯逻辑测试覆盖默认倍率、静风冻结、双倍风、平滑过渡、边界限制和帧对象复用。浏览器回归通过
真实滑杆分别设置 `0.00 / 1.20 / 0.60`，检查云层 uniform、草地 uniform、棕榈实例矩阵、雨线
倾角、渲染预算和恢复状态，并保存桌面/移动端静风与强风截图。
