# 程序化月面画质分级指南

## 1. 问题与目标

夜景月球使用确定性 CanvasTexture 表现灰阶表面和陨石坑。纹理画质分级完成后，月球球体仍固定
使用 `28×20` 分段，因此 Low 虽然减少了纹理开销，却继续提交 High 的几何数据。

现在纹理与球体分段共同跟随 High/Low 档位，并延迟到首次可见月夜才创建。月球 Mesh、Material、尺寸、位置、月光方向、透明度、
昼夜过渡、星空、场景物体和玩法保持不变。

## 2. 两档规格

| 档位 | 月面尺寸 | 陨石坑 | 球体分段 | 顶点 | 三角形 |
| --- | ---: | ---: | ---: | ---: | ---: |
| High | 256×256 | 46 | 28×20 | 609 | 1,064 |
| Low | 128×128 | 23 | 18×12 | 247 | 396 |

Low 的纹理宽高各减半，像素面积减少 75%；球体三角形减少约 63%。陨石坑数量按分辨率同比例缩减，
使低画质仍保持可读表面。两档都只有一个月球 Mesh、一张 CanvasTexture 和一个 Draw Call，不增加
Shader 采样、网络请求或运行依赖。

## 3. 实现方式

`MoonQuality.js` 集中保存冻结的纹理与分段规格，并计算像素、陨石坑、顶点和三角形数量。切换画质
时先生成目标纹理与 Geometry，再替换原 Mesh 的资源引用：

```js
const nextTexture = createMoonTexture(profile.size);
const nextGeometry = createMoonGeometry(profile);
moon.material.map = nextTexture;
moon.geometry = nextGeometry;
moon.material.needsUpdate = true;
previousTexture.dispose();
previousGeometry.dispose();
```

默认日光只保留月球 Mesh 与 Material 外壳，真实纹理和球体 Geometry 均为空。首次可见月夜按当前
画质创建资源。月球 Mesh 和 Material 始终复用，因此位置、透明度、色彩、昼夜状态和渲染顺序连续保留。旧纹理
与旧 Geometry 在成功替换后立即释放；页面退出时最终资源也会 `dispose()` 并清空引用。

## 4. 调试状态

`BeachExperience.getDebugState().moonQuality` 提供：

- 当前档位、纹理宽高、像素数和陨石坑数量；
- 球体分段、真实顶点数、真实三角形数和规格期望值；
- revision、替换次数、已释放纹理数与已释放 Geometry 数；
- 月球 Mesh、Material、活动 Texture 和活动 Geometry UUID；
- 活动纹理与 Geometry 是否仍属于当前档位。

## 5. 自动验收

```bash
npm run test:moon
npm run test:visual
```

确定性测试检查两档规格、冻结配置、4:1 像素比例、46/23 陨石坑以及 `1064/396` 三角形。浏览器
回归检查桌面 High → Low → High、移动端首次 Low、Mesh/Material 身份稳定、活动纹理与 Geometry
身份变化、每次旧资源释放，以及页面销毁时最终资源释放和引用清空。桌面 Low/High 夜景截图还用于
人工确认月面轮廓和表面可读性。

## 6. 修改注意事项

- 修改尺寸或分段时同步更新像素、陨石坑、几何计数、浏览器断言和性能说明。
- 保持 seededValue 输入不变，避免视觉回归因随机月面而失去可比性。
- 只替换 `moon.geometry`，不要重建月球 Mesh，否则会引入位置、透明度和场景身份变化。
- 新增月面资源时必须继续显式释放所有被替换的 Texture 与 BufferGeometry。
