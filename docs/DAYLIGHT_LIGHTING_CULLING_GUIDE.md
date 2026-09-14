# 日光灯笼与不可见光照剔除指南

## 1. 问题与目标

灯笼由一个 PointLight、一个球形灯芯 Mesh 和一个光晕 Sprite 组成。原有昼夜更新会在日光档把
三者的强度或透明度降为 0，却没有关闭对象可见性。结果是透明几何仍可能提交绘制，零强度灯光
仍进入 Three.js 灯光收集，每帧还继续计算不可见的闪烁。

本轮只剔除没有任何视觉贡献的日光状态。灯柱、位置、材质、几何、清晨微光、黄昏暖光、月夜
灯光、碰撞、反射排除和场景构图保持不变。

## 2. 统一可见性阈值

`AtmosphereVisibility.js` 定义统一阈值：

```js
export const ATMOSPHERE_VISIBILITY_THRESHOLD = 0.002;

export function hasVisibleAtmosphereContribution(value) {
  return Number.isFinite(value) && value > ATMOSPHERE_VISIBILITY_THRESHOLD;
}
```

星空、月球、月晕和灯笼使用同一判定。`NaN`、无穷大、负值、0 和阈值本身均视为不可见；高于
阈值才进入渲染。日光 `night=0` 会隐藏灯笼，清晨目标值 `0.02` 仍会保留原有微光。

## 3. 每帧更新

`world.update()` 先计算灯笼是否有效，再统一同步三类对象：

```js
lantern.visible = lanternActive;
lanternGlow.visible = lanternActive;
lanternHalo.visible = lanternActive;
lantern.intensity = lanternActive ? atmosphere.night * 12 : 0;
```

只有 `lanternActive=true` 时才计算两组正弦闪烁、灯芯缩放与光晕缩放。日光时透明度显式归零，
但不会重建或释放对象，因此再次进入清晨、黄昏或月夜时仍复用原 Light、Mesh、Sprite、Geometry、
Material 与 Texture。

Three.js r160 的 `WebGLRenderer.projectObject()` 会在 `object.visible === false` 时直接返回，这发生在
Light 的 `pushLight()` 和 Mesh/Sprite 入渲染列表之前。因此同一个可见性开关既能移除透明绘制，
也能移除零强度 PointLight 的灯光收集。

## 4. 实测结果

浏览器回归停止动画，在同一日光帧中先把三个零贡献对象强制恢复为可见，再切回剔除状态：

| 视口 | 旧状态 | 剔除后 | 实际变化 |
| --- | --- | --- | --- |
| 桌面 High 默认镜头 | 95 Calls / 139,406 Triangles | 93 / 139,236 | -2 Calls / -170 Triangles |
| 移动 Low 默认镜头 | 47 Calls / 52,062 Triangles | 47 / 52,062 | 几何原本在视锥外，PointLight 退出 |

两端采样像素的 changed ratio、mean difference 均为 0。桌面偶发最大通道舍入差不超过 1，连续
复跑可达到 0。清晨会恢复约 `0.24` 灯光强度和两个发光对象，月夜恢复约 `12` 强度与完整闪烁。

## 5. 调试状态

`BeachExperience.getDebugState().lantern` 提供：

- active、flickerActive 和统一阈值；
- Light、灯芯 Mesh、光晕 Sprite 的真实可见性；
- 灯光强度、两种透明度和当前可绘制对象数；
- 昼夜可见性切换次数；
- Light、Mesh 和 Sprite UUID，便于确认对象始终复用。

## 6. 自动验收

```bash
npm run test:visibility
npm run test:visual
```

确定性测试覆盖阈值和非法输入。浏览器测试覆盖桌面与移动端同帧像素、真实渲染统计、日光三对象
隐藏、PointLight 退出、闪烁停算，以及清晨/月夜三对象、强度、透明度和闪烁恢复。

## 7. 修改注意事项

- 不要只把透明度设为 0；完全无贡献的对象应同步更新 `visible`。
- 调整阈值时同步检查星空、月球、月晕和灯笼，避免不同系统使用不同临界值。
- 不要在昼夜切换时重建灯笼对象，保持对象身份和 GPU 资源稳定。
- 若改变灯芯球体分段或光晕几何，必须同步更新 170 三角形的浏览器断言和性能说明。
- 新增夜间灯光时先确认日光下的强度、透明度和可见性都能归零。
