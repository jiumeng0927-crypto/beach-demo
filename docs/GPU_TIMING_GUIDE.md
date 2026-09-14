# 潮汐沙岸：GPU 帧计时与自动画质指南

## 1. 目标

此前自动画质只使用 CPU 侧统计的平均 FPS。FPS 能反映最终体验，但无法区分 GPU 长时间过载、
浏览器调度停顿和后台任务。本轮增加完整渲染帧的 GPU 时间，同时保持原有场景、材质、几何和 UI。

## 2. 测量范围

`BeachExperience.animate()` 在 `renderer.render(scene, camera)` 前后调用 `begin()` 与 `end()`。
Three.js Water 会在这次调用内执行镜像渲染，因此测量值包含：

1. Water 镜像相机通道；
2. 主相机完整场景；
3. 这两个通道实际提交的 GPU 绘制工作。

计时不包括帧循环中的 JavaScript 更新、DOM 或浏览器合成，所以需要与 FPS 一起判断。

## 3. 非阻塞查询

实现遵循 Khronos 的
[`EXT_disjoint_timer_query_webgl2`](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)
规范：本帧结束查询，后续帧只在 `QUERY_RESULT_AVAILABLE` 为真时读取纳秒结果。
未完成的结果不会被同步读取，因此不会为了“测性能”反而制造 GPU 等待。

保护规则：

- 最多同时保留 4 个未完成查询；
- 查询超过 120 次轮询仍未完成时回收；
- `GPU_DISJOINT_EXT` 为真时丢弃全部不可信样本；
- 上下文丢失时清空句柄，恢复后重新获取扩展；
- 不支持扩展时 `supported=false`，页面继续运行。

## 4. 自动画质规则

进入场景且画质为 Auto 时，系统观察 5 秒：

- 平均 FPS 低于 42，High 降为 Low；
- GPU 至少有 12 个有效样本，指数平滑值超过 20ms，High 降为 Low；
- 两项同时超限时记录 `fps-and-gpu`；
- 只允许自动向下降一次，避免分辨率反复跳动；
- 手动 High/Low 不会被计时器改写。

扩展不可用时只执行第一条，行为与旧版本一致。

## 5. 调试与验收

控制台执行：

```js
window.__TIDELINE__.getState().gpuTiming
```

重点字段为 `latestMs`、`smoothedMs`、`samples`、`pendingQueries`、`disjointEvents`、
`droppedQueries`、`skippedFrames`、`overBudget` 与 `autoQualityReason`。

专项与浏览器验收：

```bash
npm run test:gpu
npm run test:visual
```

前者用可控 WebGL2 替身验证查询生命周期，后者在真实浏览器中验证支持/降级状态、队列上限、
有效毫秒值以及原有 Draw Call 和三角形预算。
