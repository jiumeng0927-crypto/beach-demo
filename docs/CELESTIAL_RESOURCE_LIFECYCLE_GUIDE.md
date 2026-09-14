# 星月资源延迟创建与复用指南

## 1. 问题与目标

项目默认以日光进入，星空、月球和月晕此时完全不可见。旧实现仍会在场景初始化时创建星点位置
数组、星空 BufferGeometry、程序化月面 CanvasTexture、月球 SphereGeometry 和月晕 CanvasTexture。
这些资源没有首屏视觉贡献，却提前占用 CPU 与 GPU 内存。

本轮只调整资源生命周期。日光、清晨、黄昏与月夜的颜色、透明度、星点分布、月球表面、位置、
场景构图、操作和 Draw Call 均保持不变。

## 2. 延后资源预算

`CelestialResources.js` 根据现有 `MoonQuality.js` 与 `StarQuality.js` 规格计算真实负载：

| 资源 | High | Low / 移动端 |
| --- | ---: | ---: |
| 月面 RGBA 纹理 | 262,144 B | 65,536 B |
| 月晕 RGBA 纹理 | 65,536 B | 65,536 B |
| 月球顶点与索引 | 25,872 B | 10,280 B |
| 星空位置缓冲 | 11,400 B | 5,760 B |
| 合计 | 364,952 B | 147,112 B |

默认日光下以上实际驻留量为 0。这里只统计可由规格精确推导的像素、顶点与索引负载，不把 Three.js
对象头、材质 uniform 或驱动内部开销混入结果。

## 3. 生命周期

构造阶段只创建复用型 Points、Mesh、Sprite 和 Material 外壳，不创建昂贵的纹理与顶点数据，也不
把天体对象加入场景。日光、清晨和黄昏的原有透明度公式都低于统一可见阈值，因此继续保持零驻留。

首次进入月夜时一次性完成以下操作：

1. 按当前画质生成确定性星点 Geometry；
2. 生成当前画质月面纹理与月球 Geometry；
3. 生成共享尺寸的月晕纹理；
4. 把资源连接到既有对象并加入场景。

离开月夜后对象会按原逻辑隐藏，但资源保留供下一次月夜直接复用，避免昼夜切换时反复创建纹理和
几何。已初始化状态切换画质时只替换月面纹理、月球 Geometry 和星空 Geometry，继续复用对象与
Material，并显式释放旧资源。页面退出时释放最后一组资源并清空引用。

## 4. 调试状态

`BeachExperience.getDebugState().celestialResources` 提供：

- `initialized` 与 `allocations`：是否已首次创建及创建次数；
- `residentPayloadBytes`：当前真实驻留的可计量负载；
- `plannedPayloadBytes`：当前画质首次月夜所需负载；
- 四类资源的独立字节数；
- `objectsInScene` 与 `linked`：三个天体对象是否已入场且资源链路完整。

`starQuality` 与 `moonQuality` 还提供各自的 `initialized` 字段。未初始化时真实点数、纹理尺寸、顶点
和三角形均为 0，但规格期望值仍可用于调试画质选择。

## 5. 自动验收

```bash
npm run test:celestial
npm run test:visual
```

确定性测试核对冻结配置与精确字节数。浏览器回归验证桌面和移动端首屏、日光、清晨、黄昏均为
零驻留，首次月夜只创建一次，辉光开关不会重复创建，High → Low → High 正确替换并释放旧资源，
最终页面销毁会释放月面、月晕和两类 Geometry。回归同时检查关键截图、Points 数、Draw Call、
控制台错误和布局溢出，证明场景外观与操作保持不变。

## 6. 修改注意事项

- 修改月面尺寸、球体分段、星点数或月晕尺寸时同步更新预算公式和断言。
- 不要在构造函数或日光预设中调用 `ensureCelestialResources()`。
- 不要在离开月夜时销毁资源，否则频繁昼夜切换会造成抖动和重复分配。
- 替换贴图后保留 `material.needsUpdate = true`，废弃 Texture 与 BufferGeometry 必须显式释放。
- 新增天体资源时把它计入调试负载、首次创建、画质替换和最终销毁路径。

参考：Three.js 官方 [资源处置指南](https://threejs.org/manual/en/how-to-dispose-of-objects.html)、
[`BufferGeometry` 文档](https://threejs.org/docs/pages/BufferGeometry.html) 与
[`Material` 文档](https://threejs.org/docs/pages/Material.html)。
