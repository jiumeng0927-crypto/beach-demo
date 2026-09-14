# 水体质感与发布验证：0.39.0

项目：潮汐沙岸。学习者：钱奕好。日期：2026-09-12。

## 本轮目标

提升水体质感，保留现有沙滩分区、物体位置和玩法。目标参考高质量实时引擎，但本轮没有迁移到虚幻引擎，也没有实现 Lumen、路径追踪、完整流体或真实碎浪。

## 渲染组成

1. **共享天空光照**：本地加载 Poly Haven 的 2K 纯天空 HDRI。日光环境下，背景、平面水面倒影和模型 PMREM 环境光使用同一张图，统一太阳方向。阴天逐渐降低 HDR 占比；清晨、黄昏、月夜继续使用程序化天空。下载或解码失败时回退，场景仍可启动。切画质复用原纹理，销毁时只释放一次。
2. **几何浪与细波分层**：四组 Gerstner 浪的波长为 48、25、14、8 场景单位，基准振幅为 1.15、0.65、0.28、0.10，再乘现有强度与近岸衰减。近岸衰减区改为 Z=-55 到 4；世界坐标、画质和调试状态使用同一组参数。
3. **避免规则条纹**：片元法线中叠加多尺度纹理与轻微毛细波，并使用扰动坐标打散周期。通过屏幕导数衰减低于像素尺寸的细波，减少远处闪烁。试验中过大的周期波会像整齐横纹，已降低振幅，不能只靠增加噪声制造细节。
4. **透射和散射分开**：按重建水深分别计算 RGB 吸收与散射系数，透射采用指数衰减；近岸可看到沙底，深处逐渐转为水体散射色。加入有限的相位函数、折射角近似和逆光浪脊项。Fresnel 决定反射占比，GGX 高光随距离和法线变化适度变宽。
5. **修复薄水层亮片**：单靠菲涅耳，在几乎零水深、低视角处仍会产生很强反射，暴露岸线网格三角形。用垂直水深与屏幕导数计算连续覆盖率，薄水层平滑回到折射底色。关闭原岸线泡沫做隔离截图，确认这次亮片不是泡沫网格引起。
6. **把采样分配给近景**：保持高/低档 24,576 / 13,824 个水面三角形，将更多网格分配给中央近岸，远海继续扩展覆盖。高档反射提高到 1024 方形目标，折射最长边提高到 1536；低档仍用 256 反射，折射最长边为 768。增加的是渲染目标像素成本，不应宣称性能免费。

## 必须保留的修复

`OceanRefraction.capture()` 清空深度前必须恢复 `depthMask=true`。WebGL 深度清理受写掩码影响，上一帧透明物体可能留下关闭状态。漏掉这一步会重新出现转动相机后的残影、三角色块。反射/折射偏移使用扰动法线减去平面法线，避免相机俯仰时整张画面错误偏移。

岸石湿润带、草丛避让、帆船潮位联动来自 0.38，继续保留。帆船仍是随潮位和水面时间摇摆的视觉动画，不是逐浪船体浮力求解。

## 素材来源

- 天空：Greg Zaal / Jarod Guest，[Kloofendal 48d Partly Cloudy PureSky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky)，CC0，原始 2K HDR 文件。
- 法线：[Three.js r160 waternormals.jpg](https://github.com/mrdoob/three.js/blob/r160/examples/textures/waternormals.jpg)，MIT，原始 1024×1024 文件；运行时仍按高/低档采样成 512/256。
- 精确下载地址、大小和 SHA-256 在 `public/textures/manifest.json`；`npm run fetch:water` 可复取并校验。
- 旧 `water-normal.jpg` 无法确认与官方原始字节一致，仅保留本地，不再使用、不随公开构建发布。

参考思路：[Epic Single Layer Water](https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model-in-unreal-engine)、[GPU Gems 水面模拟](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models)。这里借鉴分层光学与多尺度波形，不代表实现了这些引擎的全部功能。

## 复现实验

```bash
npm ci
npm test
npm run build
npm run test:production
npm run test:water-quality
npm run test:water-layout
npm run test:shore-detail
npm run test:visual
```

水体截图固定水面时间与相机，覆盖桌面 1440×900、手机 390×844、岸边、海面、礁石、俯瞰和黄昏。另比较两次真实渲染的像素，确认波浪会动。截图输出在 `screenshots/water-quality-after-*.png`。已有的 `before` 截图为 0.38 对照；不要用新版本覆盖它冒充旧版。

`test:production` 从构建目录分别测试站点根路径和 `/tideline/` 仓库子路径，检查素材请求、非空画布、HDR 404 回退、反复切档和释放。测试通过只能说明已覆盖场景未复现问题，不能保证所有 GPU、角度和网络都没有缺陷。视觉评审仍需观察近岸边缘、掠射倒影和运动稳定性。

## 仍需提高

目前是平面倒影与单层深度近似，不是 SSR/Lumen，也没有屏幕外折射、多层透明或浪花流体。近景模型的轮廓和贴图精度仍限制整体写实感；2K 天空近看也有限。后续应优先完善破浪泡沫与岸滩过渡、升级近景模型和地表材质，并持续测量 GPU 帧时，不能仅增加曝光、锐度或反射分辨率。

## 本次验收记录

2026-09-12，本机 Chrome 验证生产 `index-BY5m94qv.js`（127.0.0.1:5175）：18 个确定性套件、8 个生产浏览器套件及根路径/仓库子路径检查通过，76 个 JS/MJS 模块语法检查通过。完整视觉回归记录桌面 130 次绘制 / 445,998 三角形，移动端 63 / 212,327；无控制台错误、布局溢出，所测资源释放检查通过。`npm audit` 当次报告 0 个已知漏洞。云端 CI 尚未运行；这些结果不是所有设备的帧率保证，也不是写实度评分。
