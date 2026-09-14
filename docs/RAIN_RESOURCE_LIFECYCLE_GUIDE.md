# 雨幕资源延迟创建与释放指南

## 1. 问题与目标

立体雨幕默认关闭，但旧实现会在 `RainSystem` 构造时立即创建所有雨滴数组、两个 GPU 顶点属性、
`BufferGeometry`、`LineBasicMaterial` 和 `LineSegments`。这些资源在首屏没有任何视觉贡献，却一直
占用 CPU 与 GPU 内存。

本轮只调整资源生命周期。雨丝密度、颜色、速度、长度、风向、地形碰撞、触地水花、开关操作、
场景构图和开启后的 Draw Call 都保持不变。

## 2. 统一画质配置

`RainQuality.js` 集中保存 High 与 Low 配置：

| 画质 | 雨滴 | 半径 | 水花时长 | 材质透明度 |
| --- | ---: | ---: | ---: | ---: |
| High | 1100 | 27 | 0.21 s | 0.50 |
| Low / 移动端 | 520 | 22 | 0.16 s | 0.42 |

每滴雨使用 6 个位置顶点和 6 个颜色顶点。常驻数据还包含速度、长度、水花年龄和三维水花落点，
合计 `42` 个 `Float32`；真正上传为 GPU 顶点属性的是位置和颜色，合计 `36` 个 `Float32`。

| 画质 | 常驻 Float32 | CPU 常驻字节 | GPU 属性字节 |
| --- | ---: | ---: | ---: |
| High | 46,200 | 184,800 | 158,400 |
| Low | 21,840 | 87,360 | 74,880 |

默认关闭时以上实际分配均为 0，只保留不足百字节的画质参数。

## 3. 生命周期

`RainSystem` 按以下状态管理资源：

| 操作 | 资源行为 |
| --- | --- |
| 构造、默认关闭 | 只读取画质配置，不创建数组、Geometry、Material 或 LineSegments |
| 首次开启 | 创建当前画质资源，加入场景并重置雨滴 |
| 关闭 | 隐藏雨线、停止更新并清空水花，保留资源以便快速重开 |
| 再次开启 | 复用同一个 LineSegments、Geometry、Material 和数组 |
| 关闭时切换画质 | 释放旧规格资源，新规格延迟到下次开启时创建 |
| 开启时切换画质 | 释放旧规格并立即创建新规格，保持雨幕开启 |
| 页面卸载 | 从场景移除并释放剩余 Geometry 与 Material，清空数组引用 |

Three.js 不会因为对象被移出场景而自动释放 GPU 缓冲和着色器程序，因此废弃资源会显式调用
`BufferGeometry.dispose()` 与 `Material.dispose()`。

## 4. Water 反射登记

雨线需要排除在 Water 镜像相机之外。由于默认状态不再存在雨线对象，`BeachExperience` 会在首次
开启后把新对象登记到 `world.registerReflectionExclusion()`。关闭但复用时保持登记；关闭状态切换
画质并释放对象时注销旧对象；下次创建后再登记新对象。这样列表中不会出现 `null`、重复对象或
已释放对象。

## 5. 调试状态

`BeachExperience.getDebugState().rain` 新增：

- `initialized`：资源是否真实存在；
- `allocations` 与 `releases`：创建和释放次数；
- `residentFloats`、`residentBytes` 与 `gpuAttributeBytes`：当前实际资源量；
- `plannedResidentBytes`：当前画质开启后所需资源量；
- `resourcesLinked`：雨线、场景、位置属性和活动数组是否仍指向同一资源。

原有 `enabled`、`visible`、雨滴数、水花、更新次数、风力与偏移数据继续保留。

## 6. 自动验收

```bash
npm run test:rain-lifecycle
npm run test:visual
```

确定性测试覆盖精确字节数、默认零分配、关闭复用、禁用状态换档释放和最终销毁。浏览器测试在
桌面与移动端验证首次页面无雨线对象、首次开启登记反射排除、同对象复用、雨丝和水花真实渲染、
高低画质生命周期、控制状态、渲染预算及无布局溢出。

## 7. 修改注意事项

- 改变每滴顶点结构时同步更新位置数、常驻字节和 GPU 属性字节公式。
- 不要在每次关闭时销毁资源，否则快速开关会反复分配并造成明显卡顿。
- 不要在构造函数或默认 `setEnabled(false)` 中调用 `build()`。
- 替换雨线对象时必须同步 Water 反射排除登记。
- 新增雨滴数组后必须计入 `getRainResidentFloatCount()` 和自动化断言。

参考：Three.js 官方 [资源处置指南](https://threejs.org/manual/en/how-to-dispose-of-objects.html) 与
[`BufferGeometry.dispose()` 文档](https://threejs.org/docs/pages/BufferGeometry.html)。
