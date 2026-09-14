# Shader 学习入口

0.40 补充：沙地使用带屏幕足迹过滤的解析噪声梯度；近岸泡沫使用贴合地形的冲刷分层；草叶修正顶点色与实例色相乘造成的重复压暗。具体改动和隔离测试见 [近岸细节学习记录](NEAR_SHORE_FINISH_040.md)。

这个项目里有三种 Shader 使用方式，分别对应技美工作中常见的三类需求。

## 1. 湿沙：扩展标准 PBR 材质

文件：`src/experience/shaders.js`

`createSandMaterial()` 先创建 `MeshStandardMaterial` 或
`MeshPhysicalMaterial`，再通过
`onBeforeCompile` 向 Three.js 的标准着色器注入 GLSL。这样可以继续使用
PBR 光照、环境反射和实时阴影，同时按照世界坐标生成干沙、湿沙和水下沙地的过渡。

重点 Uniform：

- `uSandTime`：让潮线产生缓慢变化
- `uShoreline`：控制海岸线位置
- `uDrySandColor`：干沙颜色
- `uWetSandColor`：湿沙颜色
- `uUnderwaterSandColor`：浅水区沙地颜色

湿沙区域除了颜色更深，还会降低 `roughnessFactor`，因此反射更明显。
桌面高画质还会加入程序化微法线、浅水焦散和只覆盖湿区的 Clearcoat。
大尺度沙色由两组不同旋转角度的 Value Noise 混合，目的是打散单一噪声网格在
低角度观察时容易出现的方格感。

## 2. 泡沫：完整自定义 ShaderMaterial

`createFoamMaterial()` 自己提供顶点着色器和片元着色器。

- 顶点着色器让泡沫平面产生轻微上下波动。
- 片元着色器使用 Value Noise 和四层 FBM 生成不规则潮线。
- `uTime` 驱动动画，`uStrength` 控制泡沫强度。
- 两条不同宽度的遮罩分别表现主浪线和回流细线。
- 泡沫网格在 CPU 端用平滑上包络连接 `terrainHeight()` 与海平面；Shader 只负责
  轮廓、透明度和细微位移，因此不会被深度缓冲裁切或露出硬折痕。

## 3. Water：局部扩展现成库

`environment.js` 仍使用 Three.js `Water` 完成镜像相机、法线扰动和基础 Fresnel，
随后只对当前项目创建的材质实例补充 Uniform 与片元逻辑：

- `uHorizonWaterColor`：控制远处反射的水色；
- `uDeepWaterColor`：随观察距离增加深水吸收；
- `uReflectionStrength`：独立控制反射占比；
- `uSunGlintStrength`：控制与太阳方向一致的窄高光；
- 近岸散射让浅水不只是整片换色。

这种方式保留库已验证的反射流程，又能针对场景艺术目标调色。它没有改
`node_modules`、Three.js 源码或老师提供的 `boat.html`；Three.js 升级后仍需通过
Shader 编译断言和三时段截图重新验收注入点。

## 4. 礁石：潮湿层与苔藓遮罩

`createRockMaterial()` 使用世界坐标和表面朝向生成三层材质：

- 大尺度 Noise 与岩层条纹控制基础色变化。
- 靠近海面且高度较低的区域混入深色湿润层，同时降低 Roughness。
- 朝上的表面按 Noise 混入苔藓色，并提高 Roughness。
- 高画质根据程序噪声的屏幕空间导数扰动法线，增加细小凹凸，而不需要额外法线贴图。

三个礁石材质共享同一个 Shader Program，只通过 Uniform 改变颜色与随机种子。
礁石使用 `InstancedMesh`，因此顶点阶段计算世界坐标时还必须乘
`instanceMatrix`，否则所有实例会得到错误的湿润与苔藓位置。

## 5. 木材与船漆

`createWoodMaterial()` 使用物体局部坐标生成木纹、纤维与磨损。船体在木材上覆盖一层
可剥落的蓝绿色船漆，高画质下还会给完整漆面增加 Clearcoat；裸露木材不会获得这层反射。

## 6. 画质分级

- 桌面高画质：湿沙使用 `MeshPhysicalMaterial`，启用微法线、浅水焦散与 Clearcoat。
- 移动端低画质：沙地保留湿润颜色与 Roughness；岩石和木材使用代表色的
  `MeshStandardMaterial`，不编译程序化噪声与清漆层。
- 两档都保留 Water、Sky、泡沫和低成本云层动画。

视觉回归会验证 Shader 编译状态、材质分级、Water 深浅色与高光参数，以及三时段
亮度和色温差异。

## 7. 云层：预计算密度 + 低成本 Shader

`environment.js` 在启动时通过多层 Value Noise 生成一张可平铺密度图。云层片元
Shader 每帧只采样两次：

- 低频采样定义大云块；
- 高频采样打散边缘；
- 基于观察方向的平面投影避免球面 UV 在天顶拉伸；
- `uSunDirection`、亮面色和暗面色让三个时段共享同一光向；
- 云穹先绘制，随后会自然进入 Water 的反射。

这种方式比每像素实时计算多层 FBM 更适合网页和移动端。

## 8. `customProgramCacheKey`

`onBeforeCompile` 修改后的源码不在普通材质参数中。为不同 Shader 结构提供稳定的
`customProgramCacheKey()`，可以避免 Three.js 错误复用 Program。

例如沙地的 Physical 与 Standard 版本拥有不同 Key；带船漆 Clearcoat 的木材和普通
木材也使用不同 Key。

## 9. 沙丘草：实例化顶点风动

`createDuneGrassMaterial()` 保留 `MeshStandardMaterial` 的光照和阴影，只在顶点阶段加入风摆。
叶片根部到尖端的局部高度生成 `grassTip`，所以根部不动、叶尖位移最大。每个实例从
`instanceMatrix` 的世界平移得到不同相位，避免 460 簇草同步摇摆。

CPU 每帧只更新 `uGrassTime` 和昼夜亮度 Uniform。位移在 GPU 顶点阶段并行完成，不需要遍历
数百个 Object3D，也不会增加 Draw Call。这是本项目中最直接的“Shader 用计算换对象动画”案例。

## 推荐学习顺序

1. 修改 `uDrySandColor` 和 `uWetSandColor`，观察颜色混合。
2. 修改 `smoothstep` 的两个边界，观察潮湿区域宽度。
3. 分别修改 Water 的 `uReflectionStrength` 和 `uSunGlintStrength`，比较反射与高光。
4. 修改泡沫 Shader 中 FBM 的频率，观察泡沫尺度。
5. 调整云层密度阈值，观察覆盖率与轮廓的关系。
6. 给泡沫新增一个 `uSpeed` Uniform，并接到 UI。
7. 调整礁石微法线强度，比较轮廓、近景细节与高光稳定性，同时监控桌面端预算。
8. 修改草地 `uWindStrength`、两层正弦频率和 `grassTip` 曲线，比较风力、节奏与根部稳定性。

每次修改后运行 `npm run test:visual`，确认桌面和移动端都能正常渲染。完整项目流程
见 [`PRODUCTION_GUIDE.md`](./PRODUCTION_GUIDE.md)。
