# 程序化云层画质分级指南

0.41 更新：可见天空改为实时演变云层，分别保存风漂移和密度演变时钟；昼夜连续推进。当前实现与限制见 [生态与玩法学习记录](LIVING_COAST_041.md)，下文为画质资源切换的历史设计。

## 1. 为什么需要修正

场景的渲染质量可以在 High、Low 和 Auto 之间切换。原实现会重建海滩 World、调整阴影、雨幕、
像素比和后处理参数，但程序化云层只在页面启动时创建一次。结果是桌面从 High 切到 Low 后仍保留
高精度云穹与密度纹理，移动设备也无法在切到 High 时得到完整云层细节。

本轮不改云层 Shader、天气参数或场景构图，只让云层资源真正跟随运行时画质档位。

官方参考：

- [Three.js BufferGeometry.dispose()](https://threejs.org/docs/#api/en/core/BufferGeometry.dispose)
- [Three.js Texture.dispose()](https://threejs.org/docs/#api/en/textures/Texture.dispose)
- [Three.js 对象释放指南](https://threejs.org/manual/en/how-to-dispose-of-objects.html)
- [Three.js 几何体官方示例](https://threejs.org/examples/#webgl_geometries)

## 2. 统一质量配置

`src/experience/CloudQuality.js` 集中定义云层规格：

| 档位 | 密度纹理 | 噪声 Octave | 云穹分段 | 三角形 |
| --- | ---: | ---: | ---: | ---: |
| High | `512 × 256` | 5 | `48 × 24` | 2208 |
| Low | `256 × 128` | 4 | `28 × 14` | 728 |

Low 的密度纹理像素面积减少 75%，云穹三角形减少约 67%。两个档位仍使用同一个 Shader、同样的
两次纹理采样和一个 Mesh，因此 Draw Call 不变。

## 3. 无跳变替换流程

`BeachEnvironment.setQuality()` 检测档位变化后调用 `replaceCloudLayer()`：

1. 按目标档位创建新的 SphereGeometry、DataTexture 和 ShaderMaterial。
2. 复制旧云层的位置、旋转、缩放、时间相位、透明度、明暗颜色和太阳方向。
3. 将新云层加入原 Scene，并更新环境持有的引用。
4. 从 Scene 移除旧云层。
5. 分别调用旧 Geometry、Material 和 Texture 的 `dispose()`。
6. 清理 renderer render lists，避免镜像相机继续保留旧对象条目。

天气、昼夜和统一海风仍从原有入口更新当前云层。切档不会重建 Water、Sky、PMREM、月亮、玩法、
导入资源或相机，也不会重置云层漂移。

## 4. 调试状态

`getCloudQualityState()` 暴露当前实际资源，而不是只回报用户选择：

```js
{
  quality,
  revision,
  replacements,
  disposedLayers,
  textureWidth,
  textureHeight,
  densityBytes,
  octaveCount,
  widthSegments,
  heightSegments,
  triangles,
  phase,
  rotationY,
  shaderLinked,
}
```

这可以区分“按钮显示 Low”和“GPU 资源真的已经变成 Low”。`revision` 每次成功替换加一，
`disposedLayers` 记录完成释放的旧云层数量。

## 5. 验收

```bash
npm run test:cloud
npm run test:visual
```

专用测试校验档位参数、冻结配置、纹理面积与三角形比例。浏览器回归使用真实质量按钮执行
High → Low → High，监听旧 Geometry、Material、Texture 的 `dispose` 事件，检查相位和旋转连续、
World 与云层 revision 同步、最终资源规格正确，并保存 Low/High 桌面截图。移动端则验证首次启动
直接使用 Low 云层且没有多余替换。
