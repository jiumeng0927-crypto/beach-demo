# Blender 二头身角色与场景接入指南

> 当前状态：角色源文件、GLB 和生成脚本完整保留，但 `0.28.0` 按需求暂停网页运行时加载。
> 收到最终角色建模文件后，可继续复用本指南中的归一化、落地、动画、阴影和释放流程。

## 1. 角色资产

本轮根据用户提供的两张三视图建立两位真实 3D 角色：

- “晴帽向导”：金发、白色宽檐帽、紫色大眼与蓝白服装；
- “软绒旅伴”：浅灰长发、低饱和眼睛、圆润布偶体型与海沫色围巾。

两位角色均按头部与头部以下身体约 `1:1` 的二头身比例制作。参考图片仅用于提炼轮廓、配色与
装饰特征，网页运行时不读取参考图。

| 角色 | Blender 源文件 | 网页资产 | Mesh | 三角形 | GLB 大小 |
| --- | --- | --- | ---: | ---: | ---: |
| 晴帽向导 | `blender/hat-guide.blend` | `public/characters/hat-guide.glb` | 4 | 6,908 | 244,912 B |
| 软绒旅伴 | `blender/plush-dreamer.blend` | `public/characters/plush-dreamer.glb` | 4 | 4,786 | 164,024 B |

## 2. Blender 生成流程

`scripts/generate-chibi-models.py` 可在 Blender 4.5.3 LTS 中无界面运行。脚本会：

1. 用低面数 Sphere、Cylinder、Box 与 Torus 组合身体、头发、五官、服装和配饰；
2. 为 `HeadPivot`、`LeftArmPivot`、`RightArmPivot` 保留独立层级；
3. 将多种角色颜色烘焙进 `Color` 顶点色；
4. 按身体、头部、左右手臂合并网格，并对高密度网格减面；
5. 保存可编辑 `.blend`，再导出内嵌材质的 glTF 2.0 `.glb`。

项目内置的生成命令：

```bash
npm run generate:characters
```

PowerShell 包装器会先检查 PATH，再检查当前电脑的 `D:\blender.exe` 和常见安装目录。Python 脚本
使用相对项目路径，移动项目后仍可运行。

## 3. 运行时加载

`ChibiCharacterSystem.js` 在首次进入场景时动态导入 `GLTFLoader`，并并行加载两份本地 GLB。
加载后会按角色目标身高归一化包围盒、把脚底移动到原点，再通过 `terrainHeight()` 贴合沙地。

两位角色分别放置在：

- 晴帽向导：`(9.2, 23.6)`；
- 软绒旅伴：`(16.5, 25.5)`。

位置避开木栈道、船体碰撞、潮线和六个海玻璃拾取点，桌面与 390px 手机默认构图均可看到。

## 4. 动画与光照

每帧只更新已有 Group 的矩阵，不创建新对象：

- 两位角色都有轻微上下呼吸、身体迎风摆动和头部转动；
- 晴帽向导持续做小幅右臂招手；
- 软绒旅伴使用更慢的双臂反向摆动；
- Desktop High 投射真实阴影，Mobile Low 关闭投射阴影；
- PBR 顶点色材质响应原场景的日夜光照；
- 整组角色排除在 Water 镜像通道外，避免反射重复提交。

## 5. 性能与生命周期

两位角色合计 8 个 Mesh、8 个 Draw Object、2 个材质、11,694 个三角形，不使用运行时贴图。
模型在开场页保持零常驻资源；首次进入只加载一次，隐藏再显示、昼夜和画质切换均复用原对象。
页面销毁时，8 份 Geometry 与 2 份 Material 各释放一次。

最终全场景实测：

| 档位 | Draw Call | 三角形 | 控制台错误 | 资源释放 |
| --- | ---: | ---: | ---: | --- |
| Desktop High | 111 | 161,895 | 0 | 通过 |
| Mobile Low | 55 | 63,756 | 0 | 通过 |

## 6. 验证命令

```bash
npm run test:characters
npm run build
npm run test:visual
```

确定性测试验证延迟加载、8 个网格、6 个动画枢轴、阴影切换、复用和精确销毁；浏览器测试验证
桌面与手机的可见性、地形落位、Water 反射排除、渲染预算、控制台和最终资源释放。

实现遵循 Three.js 官方 `GLTFLoader` 加载方式与 Blender 官方 glTF 2.0 导出接口。
