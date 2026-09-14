# 天气氛围系统指南

## 1. 功能边界

设置面板提供晴朗、多云、阴天三档天气。天气与日光、黄昏、月夜可以自由组合，也与
雨幕和潮位相互独立。选择阴天不会自动下雨，关闭雨幕也不会恢复晴朗。

晴朗是默认状态，其覆盖量为 `0`，所有光照与曝光乘数为 `1`。因此新增天气系统不会改变
项目原有的默认构图、物体、材质或日光效果。

## 2. 状态组合

`src/experience/environment.js` 保留两套并行状态：

- `current` / `target`：日光、黄昏、月夜的完整环境预设；
- `weatherCurrent` / `weatherTarget`：天气覆盖量与环境乘数。

每帧使用指数平滑插值，再在 `applyCurrentState()` 中组合两层状态。天气主要调整：

- 程序化云层覆盖量、亮部和阴影色；
- DirectionalLight、HemisphereLight 与 AmbientLight 强度；
- `FogExp2.density` 与 `WebGLRenderer.toneMappingExposure`；
- Water 的环境反射强度与太阳高光；
- Sky 的 turbidity。

颜色对象原地插值，帧循环中不创建新的材质或几何体。

## 3. 性能成本

天气系统复用已有 Sky、云层、Water、雾和灯光，不增加 Draw Call、三角形或网络资源。
桌面和移动端使用同一套天气参数，差异仍由原有高低画质系统负责。

## 4. 验收

`npm run test:visual` 会在桌面与移动端依次切换晴朗、多云、阴天并恢复晴朗，验证：

1. 云量、雾密度随天气增强；
2. 主光、曝光、反射和水面高光按预期降低；
3. 雨幕始终保持关闭；
4. Draw Call 与三角形数保持不变；
5. 控件状态、文字和移动端布局正确；
6. 自动保存 `desktop-overcast.png` 与 `mobile-overcast.png` 供人工检查。
