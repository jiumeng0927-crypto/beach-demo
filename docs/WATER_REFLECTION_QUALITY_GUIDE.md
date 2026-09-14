# Water 反射画质分级指南

0.39 更新：高档目标已从 512 提高为 1024 方形，低档仍为 256，低档像素面积相对高档减少 93.75%。折射最长边为 1536/768。以下为原分级机制的历史记录，当前规格见 `WaterReflectionQuality.js` 与 [0.39 学习记录](WATER_QUALITY_039.md)，不是零成本画质提升。

## 1. 优化目标

Three.js `Water` 会把镜像场景渲染到独立 RenderTarget。原项目只在页面启动时根据初始画质创建
`512×512` 或 `256×256` 目标，运行时切换 High/Low 后，按钮显示与真实反射资源可能不一致。

本轮只让反射目标跟随现有画质档位，不改变 Water Shader、海面几何、潮位、岸线泡沫、船只、
镜头、天气或玩法。

## 2. 两档规格

| 档位 | 反射尺寸 | 像素数 | 使用场景 |
| --- | ---: | ---: | --- |
| High | 512×512 | 262,144 | 桌面高画质 |
| Low | 256×256 | 65,536 | 低画质与移动端 |

Low 的宽高各减半，RenderTarget 像素面积减少 75%。Water 仍使用原有一张镜像纹理、原有平面
几何和原有反射渲染流程，因此不会增加 Draw Call、三角形、贴图采样或运行依赖。

## 3. 实现方式

`WaterReflectionQuality.js` 只保存冻结的 High/Low 规格与像素数计算。`environment.js` 在 Water
第一次执行镜像渲染时，临时观察 `renderer.setRenderTarget()`，识别与 `mirrorSampler` 纹理相连的
RenderTarget 并保存引用。捕获结束后立即恢复渲染器原方法。

运行时切换画质时调用同一目标的 `setSize()`：

```js
const profile = getWaterReflectionProfile(quality);
waterReflectionTarget.setSize(profile.size, profile.size);
```

目标对象、Water Mesh 和 Water 材质都不会被替换，所以 Water 累积时间、远海涌浪相位、潮汐高度、
Shader Uniform 与天气反射连续保留。Three.js 在 `setSize()` 改变尺寸时会释放旧的底层 GPU 附件，
页面卸载时项目还会显式 `dispose()` 最终 RenderTarget。

## 4. 调试状态

`BeachExperience.getDebugState().waterReflection` 提供：

- 当前档位、目标宽高与实际像素数；
- 规格像素数以及纹理是否仍与 Water 相连；
- 运行时 revision 与实际 resize 次数；
- Water/纹理 UUID，用于确认切档没有重建对象；
- RenderTarget 是否已经在首帧反射中成功捕获。

## 5. 自动验收

```bash
npm run test:reflection
npm run test:visual
```

确定性测试检查两档尺寸、像素数、冻结配置和 4:1 像素面积比例。浏览器回归检查桌面
High → Low → High 双向切换、移动端首次 Low、同一 Water/纹理身份、Water 时间连续、每次缩放触发
旧附件释放，以及页面销毁时 RenderTarget 被释放并清空。

## 6. 后续修改注意事项

- 修改分辨率时同时更新规格测试、视觉断言与性能说明。
- 升级 Three.js 后需重新确认 Water 的 `mirrorSampler` 与 RenderTarget 关系。
- 不要通过重建 Water 来切换尺寸，否则容易重置时间、Shader 注入和外部状态。
- 任何新的反射后处理都应继续包含在现有 GPU Timer Query 与浏览器回归中。
