# 柔光泛光与后处理指南

## 1. 为什么做成可选

场景中的月亮、灯柱、海玻璃和水面反射具有明确高亮，但直接渲染的亮部边缘较硬。项目已经通过
WebGL2 Timer Query 测量包含 Water 镜像的完整 GPU 帧，并在当前桌面 High 档确认存在余量后，
才加入克制的 Bloom。它默认关闭，原场景首次画面和性能不变。

官方参考：

- [Three.js EffectComposer 文档](https://threejs.org/docs/pages/EffectComposer.html)
- [Three.js 后处理使用指南](https://threejs.org/manual/en/how-to-use-post-processing.html)
- [Three.js Unreal Bloom 官方示例](https://threejs.org/examples/webgl_postprocessing_unreal_bloom.html)

## 2. 延迟加载结构

`src/experience/BloomPostProcessor.js` 只静态引用 `Vector2`。首次开启前，下列模块不会请求，也不会
创建任何后处理 RenderTarget：

```text
RenderPass -> UnrealBloomPass -> OutputPass
```

首次开启时四个模块通过动态 `import()` 并行加载。重复开启复用同一个 Composer；并发请求共享
初始化 Promise，关闭或释放期间完成的加载不会重新启用效果。加载失败时 Toggle 自动恢复关闭，
错误写入调试状态，主场景继续直接渲染。

## 3. 渲染分流与色彩输出

关闭时：

```js
renderer.render(scene, camera);
```

开启时：

```js
composer.render(delta);
```

`RenderPass` 先产生场景颜色，`UnrealBloomPass` 提取高于阈值的亮部并进行多级模糊，`OutputPass`
最后执行色调映射和 sRGB 输出。整条链仍位于 `GpuFrameTimer.begin()` 与 `end()` 之间，自动画质
判断包含真实后处理成本。

## 4. 画质参数

| 档位 | Strength | Radius | Threshold |
| --- | ---: | ---: | ---: |
| High | 0.32 | 0.22 | 0.84 |
| Low / 移动端 | 0.22 | 0.16 | 0.90 |

较高阈值避免天空和沙地整体发灰。Low 档降低强度和模糊半径，同时复用现有 `1.0` 像素比上限。
窗口尺寸、设备像素比或画质变化时，Composer 与所有 Pass 的 RenderTarget 会同步调整。

当前默认构图下，开启约增加 14 个后处理 Draw Call；关闭后直接渲染的 Draw Call、三角形与 Points
恢复原值。场景对象、Water、材质、潮位、天气、玩法和相机不会因开关而重建。

## 5. 生命周期与验收

页面卸载时依次释放 Bloom 多级纹理、各 Pass 材质、全屏网格与 Composer 双缓冲，最后再释放
WebGLRenderer。验证命令：

```bash
npm run test:bloom
npm run test:visual
```

确定性测试覆盖默认不加载、单次初始化、三 Pass 顺序、质量切换、尺寸同步、禁用复用、加载失败
与释放。浏览器回归通过真实 Toggle，在冻结 Water 时间的月夜同帧比较开关截图，并验证桌面和移动
端都产生足够但不过度的像素变化；关闭后再次手动渲染，确保直接路径预算完全恢复。
