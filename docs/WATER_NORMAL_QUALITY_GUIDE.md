# Water 法线贴图画质分级指南

0.39 更新：源图替换为校验过原始字节的 Three.js r160 `water-normal-three-r160.jpg`（1024×1024），高/低档运行时纹理仍为 512/256。旧图仅本地保留，不随公开构建复制。以下为历史实现记录，当前素材来源见 [0.39 学习记录](WATER_QUALITY_039.md)。

## 1. 问题与目标

项目使用本地 `water-normal.jpg` 驱动 Three.js Water 的四次法线采样。源图实测为 `512×512`，
此前无论 High、Low 还是移动端都会直接上传同一尺寸；运行时切换画质也不会替换
`normalSampler`，因此界面档位和真实 GPU 纹理不一致。

本轮只调整 Water 法线纹理资源，不改变沙滩布局、Water Mesh、Shader、镜像反射、潮位、岸线、
涌浪、天气或玩法。

## 2. 两档规格

| 档位 | 法线尺寸 | 像素数 | 各向异性 |
| --- | ---: | ---: | ---: |
| High | 512×512 | 262,144 | 8× |
| Low | 256×256 | 65,536 | 4× |

Low 的宽高各减半，法线纹理像素面积减少 75%。两档继续复用 Water 原有四次 `normalSampler`
采样，因此不会增加 Draw Call、三角形、Shader 采样次数、网络请求或运行依赖。

## 3. 资源创建

`WaterNormalQuality.js` 集中保存冻结的规格。成功加载本地源图后，环境长期保留一份只读源纹理：

- High 直接从 512² 源图创建活动纹理；
- Low 使用 Canvas 2D 高质量缩放为 256²，再创建 `CanvasTexture`；
- 如果本地图片加载或缩放失败，则按目标尺寸创建程序化 `DataTexture`。

活动纹理统一设置 `RepeatWrapping`、`6×6` 重复、`NoColorSpace` 和目标各向异性。

## 4. 运行时切换

切换画质时先完整创建目标纹理，再更新 Water uniform：

```js
water.material.uniforms.normalSampler.value = nextTexture;
waterNormals = nextTexture;
previousTexture.dispose();
```

Water Mesh、Material、镜像 RenderTarget 和源图不会重建，所以 Water 时间、涌浪相位、潮位、
天气反射与 Shader 注入连续保留。旧活动纹理在替换后立即 `dispose()`；页面退出时最终活动纹理和
只读源纹理都会显式释放。

## 5. 调试与验收

`BeachExperience.getDebugState().waterNormal` 提供当前档位、尺寸、像素数、各向异性、源图尺寸、
源类型、revision、替换/释放次数、源图和活动纹理 UUID，以及 uniform 是否仍正确绑定。

```bash
npm run test:normal
npm run test:visual
```

确定性测试检查两档规格、冻结配置和 4:1 像素比例。浏览器回归检查桌面 High → Low → High、
移动端首次 Low、每次活动纹理身份变化、源图身份稳定、旧纹理真实释放、Water 时间连续，以及
页面销毁时两类纹理都被释放并清空。

## 6. 修改注意事项

- 修改规格时同步更新确定性测试、视觉断言和性能说明。
- 升级 Three.js 后重新确认 Water 仍通过 `normalSampler` uniform 读取法线纹理。
- 不要通过重建 Water 切换法线，否则容易重置时间、Shader 注入和镜像资源。
- 替换本地源图时保持无色彩空间法线数据，并重新检查 High/Low 水面截图。
