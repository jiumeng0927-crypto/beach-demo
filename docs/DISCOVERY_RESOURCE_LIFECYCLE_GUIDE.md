# 潮汐拾光资源延迟创建指南

## 1. 优化目标

“潮汐拾光”只有进入场景后才会显示，但旧实现会在开场页期间提前创建海玻璃、实例属性、
微光点、Geometry 和 Material。本轮将可视资源延迟到首次进入，任务数据与交互规则保持不变。

## 2. 精确资源量

六个拾取点共享一个 `InstancedMesh` 和一个 `Points`：

| 资源 | 字节 |
| --- | ---: |
| 海玻璃 Geometry 属性 | 7,680 |
| 实例矩阵 | 384 |
| 实例颜色 | 72 |
| 微光位置、颜色、相位与可见性 | 192 |
| 合计 | 8,328 |

默认开场页的实际常驻量为 0。首次进入后一次性创建 8,328 字节顶点与实例属性。

## 3. 生命周期

- 构造阶段只创建空 `Group` 和六个轻量位置状态；
- `BeachExperience.enter()` 首次调用 `setEnabled(true)` 时创建可视资源；
- 暂时关闭只隐藏对象，重新开启复用原 Mesh、Points、Geometry 与 Material；
- 画质切换只更新现有参数，不重复创建同规格资源；
- 页面退出时释放实例网格、两份 Geometry 和两份 Material，并将引用清空；
- Water 反射排除登记只在真实 Group 加入场景后发生。

## 4. 验收

```bash
npm run test:discovery-lifecycle
npm run test:visual
```

确定性测试验证精确字节数、首次进入分配、关闭复用和最终释放。浏览器测试同时验证桌面与手机
开场零负载、进入后的对象身份、画质往返、反射登记、玩法完成流程和销毁事件。

参考 Three.js 官方[资源处置指南](https://threejs.org/manual/en/how-to-dispose-of-objects.html)。
