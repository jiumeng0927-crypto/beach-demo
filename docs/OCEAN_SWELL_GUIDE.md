# 远海涌浪指南

## 1. 目标

Three.js `Water` 的法线贴图适合表现连续的小尺度波纹，但默认镜头中的远海容易呈现尺度单一的
镜面纹理。本轮在不改变原场景物体和水面高度的前提下，加入两组低频法线坡度，使远海反射和
高光具有更长的起伏节奏。

参考入口：

- [Three.js ShaderMaterial 官方文档](https://threejs.org/docs/#api/en/materials/ShaderMaterial)
- [Three.js Ocean Shader 官方示例](https://threejs.org/examples/webgl_shaders_ocean.html)

## 2. 实现结构

`src/experience/OceanSwell.js` 通过 `injectOceanSwellShader()` 扩展项目当前使用的 Three.js r160
`Water` 片元 Shader。注入位置紧跟 Water 原有 `surfaceNormal` 计算，原法线贴图结果被完整保留。

两组涌浪各自使用世界坐标方向、空间频率和时间速度：

```glsl
float phaseA = dot(worldPosition.xz, directionA) * 0.052 + time * 0.31;
float phaseB = dot(worldPosition.xz, directionB) * 0.034 - time * 0.19;
```

相位的余弦值被解析为二维坡度，再叠加到表面法线。两组方向不平行、速度不同，避免远海形成
整齐重复的单向条纹。时间直接读取 Water 的 `time` uniform，没有新增定时器。

## 3. 近岸淡出

`worldPosition.z` 决定涌浪遮罩：

- `Z <= -72`：远海使用完整涌浪强度；
- `-72 < Z < -12`：使用 `smoothstep` 平滑衰减；
- `Z >= -12`：近岸不叠加低频涌浪。

这样可以强化海平线附近的尺度感，同时保留潮线泡沫、浅水高光和船边水面的原有细节。该功能
只调整片元法线，不移动顶点，因此不会改变 Water 高度、动态潮位、碰撞或物体摆放。

## 4. 控制与成本

设置面板的“远海涌浪”范围为 `0.00-1.00`，步长 `0.01`，默认值 `0.42`。修改后直接更新
`uSwellStrength`，不重建材质或几何。

本功能的渲染成本边界：

- 新增几何和三角形：0；
- 新增 Draw Call：0；
- 新增纹理采样：0；
- 新增网络资源和运行依赖：0。

## 5. 验收

```bash
npm run test:swell
npm run test:visual
```

`test:swell` 校验 Water 注入点、uniform 数量、时间源、世界坐标淡出和纹理采样预算。
浏览器回归会停止动画、冻结 Water 时间，依次渲染强度 `0` 与 `1` 的同一帧并比较像素；随后恢复
默认 `0.42`，逐项确认控件、uniform、调试状态及单帧 Draw Call/三角形预算。桌面和移动端都保存
对应截图，防止远海变化只在单一视口中成立。
