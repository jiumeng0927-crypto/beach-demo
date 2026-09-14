# 动态潮位系统指南

本版本把项目名称里的“潮汐”从视觉主题变成真实运行状态。潮位变化不新增模型或
Draw Call，而是让已有 Water、湿沙 Shader、泡沫网格和漫步边界共享一个归一化数值。

## 1. 状态约定

`BeachEnvironment` 是潮位的唯一状态源：

- `-1`：低潮；
- `0`：中潮；
- `1`：高潮；
- `auto`：180 秒完成一个正弦周期。

手动切换使用指数平滑靠近目标，避免水面和泡沫瞬移。自动模式持续计算目标值，页面
进入后台时沿用项目已有的动画暂停机制，不会积累巨大的时间步长。

## 2. 四个同步反馈

### 2.1 水面高度

Water 以 `0` 为基础高度，完整低潮到高潮的垂直行程为 `0.32`。变化幅度保持克制，
避免反射相机穿过岸边模型。

### 2.2 湿沙分界

沙材质的 `uShoreline` 从固定值变为动态值。低潮到高潮的岸线行程为 `6.4` 个场景
单位，干沙、湿沙和浅水色带会随潮位一起移动。

### 2.3 泡沫位置

现有 `ShorelineFoam` 网格不重建，只更新 `position.z`。它与 `uShoreline` 使用相同的
偏移，所以泡沫不会和湿沙线分离。

### 2.4 漫步边界

`getWalkBoundaryZ()` 在原有不规则岸线函数上叠加同一潮位偏移。高潮时第一视角会更早
被岸线挡住，退潮时可以继续向海面方向探索，但仍不会走入 Water 平面。

## 3. 模块调用关系

```text
UIController
  -> BeachExperience.setTideMode()
    -> BeachEnvironment.setTideMode()
      -> BeachEnvironment.applyTideState()
        -> Water.position.y
        -> BeachWorld.setTideState()
          -> sand uShoreline
          -> foam position.z
          -> walk boundary offset
```

`BeachExperience` 只在模式或潮位区间发生变化时派发 `tidechange`，HUD 不会每帧更新
DOM。内部帧循环使用纯数值参数，只有调试状态和事件需要时才创建可序列化对象。

## 4. 质量切换

高低画质切换会重建陆地侧世界，但不会重建 Water。重建后依次恢复泡沫强度、时间颜色
和当前潮位，随后清理旧 RenderList，避免旧材质被反射相机继续引用。

## 5. 自动测试

`npm run test:visual` 会在桌面和 390 x 844 移动视口分别验证：

1. 三档潮位按钮的选中状态和文案；
2. 水面垂直行程不小于 `0.31`；
3. 湿沙、泡沫和漫步边界行程均不小于 `6.3`；
4. 高潮后能恢复自动模式；
5. Draw Call、三角形预算、玩法、相机和移动端布局没有回归。

测试还会生成 `desktop-high-tide.png` 与 `mobile-high-tide.png`，用于人工检查岸线构图。

## 6. 后续扩展

潮位已经形成独立状态接口，后续可以继续添加潮汐表、月相关联、浪花粒子或潮位影响的
拾取点，但应继续遵守两个约束：所有岸线系统共享同一标量，帧循环不创建新资源。
