# 星空画质分级与白天天体剔除指南

## 1. 问题与目标

夜景星空原本固定创建 950 个点。桌面 High、Low 和移动端使用相同 BufferGeometry，因此 Low 档
并未减少星空顶点数据。清晨与日光虽然把星空、月球和月晕透明度降为 0，这些对象仍参与 Water
镜像和主场景渲染。

本轮让星点数量跟随 High/Low 档位，在天体完全透明时停止提交绘制，并延迟到首次可见月夜才创建
星点位置缓冲。天空色、月夜构图、星点
分布、昼夜过渡、场景物体和玩法均保持不变。

## 2. 两档规格

| 档位 | 星点数 | 位置 Float 数 | 位置缓冲字节 |
| --- | ---: | ---: | ---: |
| High | 950 | 2,850 | 11,400 |
| Low | 480 | 1,440 | 5,760 |

Low 的星点与位置缓冲均减少约 49%。两档仍使用一个 `THREE.Points`、一个 `PointsMaterial` 和夜景
中的一个星空 Draw Call，不增加 Shader、贴图、网络请求或运行依赖。

## 3. 运行时切换

`StarQuality.js` 集中保存冻结的点数规格，并计算位置 Float 数和字节数。`environment.js` 使用同一
确定性序列生成目标 BufferGeometry，切档时只交换 Geometry：

```js
const nextGeometry = createStarGeometry(quality);
const previousGeometry = stars.geometry;
stars.geometry = nextGeometry;
previousGeometry.dispose();
```

默认日光只保留 Points 与 Material 外壳，BufferGeometry 不含位置属性。首次可见月夜按当前画质
生成星点。Points 对象与 Material 始终复用，因此位置、渲染顺序、透明度和旋转连续保留。High 与 Low 使用
同一确定性序列的前缀，Low 不会出现完全不同的一片天空。每次被替换的 Geometry 都会立即释放，
页面退出时最终 Geometry 也会释放并清空引用。

## 4. 白天天体剔除

昼夜预设仍按原逻辑计算星空和月面透明度。当星空透明度或月面透明度不高于 `0.002` 时，同步设置：

```js
stars.visible = false;
moon.visible = false;
moonHalo.visible = false;
```

Three.js 会跳过 `visible=false` 对象及其渲染提交。清晨和日光原本就是全透明画面，因此视觉结果
不变；进入黄昏或月夜后，同一批对象按透明度自动恢复可见。移动端日光实测 Points 从 Low 月夜的
966 降到仅保留玩法微光的 6，避免星空在 Water 镜像和主场景中各提交一次。

## 5. 调试状态

`BeachExperience.getDebugState().starQuality` 提供：

- 当前档位、真实星点数、位置 Float 数与字节数；
- revision、替换次数和已释放 Geometry 数；
- 当前透明度、可见性与旋转角；
- Points、Material 和活动 Geometry UUID；
- 活动 Geometry 是否与当前规格一致。

`lighting` 还公开星空、月球和月晕的可见性，`render.points` 用于确认实际提交的点数。

## 6. 自动验收

```bash
npm run test:star
npm run test:visual
```

确定性测试检查 `950/480` 点、`11400/5760` 字节、冻结配置和未知档位回退。浏览器回归检查桌面
High → Low → High、Points/Material 身份稳定、Geometry 身份变化、旋转连续、旧 Geometry 释放、
夜景 Points 数；移动端检查首次 Low、清晨/日光天体剔除和页面销毁时最终资源释放。

## 7. 修改注意事项

- 修改点数时同步更新缓冲字节、浏览器 Points 统计、性能说明和测试断言。
- 保持星点确定性序列不变，避免视觉回归因随机分布而失去可比性。
- 只替换 `stars.geometry`，不要重建 Points 或 Material。
- 可见性阈值必须与透明度过渡配套，避免淡入淡出阶段突然闪现或消失。
- 新增星空资源时继续显式释放所有被替换的 BufferGeometry。
