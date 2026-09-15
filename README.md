# 潮汐沙岸 / Tideline

基于 Three.js r160 的柔和半写实网页沙滩场景，包含分层 Water、Sky、程序化云层、
PBR 材质、与海浪相位联动的 GLSL 泡沫、近岸淡出的低频远海涌浪、默认关闭且延迟加载的柔光泛光、独立天气氛围、带触地飞溅的可开关立体雨幕、统一驱动云层/草地/棕榈叶/雨丝的可调海风、可运行时切档的程序化云层、Water 反射目标、法线贴图与程序化月面、首次月夜才创建的星月资源、清晨/日光/黄昏/月夜切换、环绕/漫步/自由三种视角、可选沙地/木栈道脚步声、三槽持久化构图书签、
首次操作引导、“潮汐拾光”探索玩法、带双人轮流、球组判定、黑八结算和自由球的沙滩中八、本地贴图/模型导入、资源场景布置、模型动画控制、简化碰撞与移动端画质分级。两位二头身角色的 Blender/GLB 素材继续保留，但按当前需求暂停运行时加载。项目独立于老师提供的
`D:\下载\boat.html`，原文件不会被修改。

## 运行

本仓库保留**手动上传网页成品**：开发入口是 `dev.html`，根目录 `index.html` 是发布快照。`npm run dev` 使用源码；`npm run export:web` 构建并同步最新成品，不上传网络。见 [手动发布说明](docs/MANUAL_PUBLISH.md)。

当前 `0.49.0`：优先修复 NPC 穿地、出生点压入设施及巡游穿物。十位 NPC 现在拥有独立肤色/服装色、头身轮廓和职业配件；移动角色会对设施、玩家和其他 NPC 停让，动画脚底保持动态净空。见 [NPC 个体化、动态贴地与避让学习记录](docs/NPC_QUALITY_049.md)，专项验证为 `npm run test:npc-quality`。

`0.48.0` 新增三日轮换的海滨订单、十位 NPC 独立关系和社区声望。拾取物既可普通寄售，也可向指定 NPC 定向交付获得更高报酬；每日首次见面与完成订单提升关系，声望等级提高后续订单奖励。交易页、NPC 对话和本地存档保持同步。见 [海滨订单、NPC 关系与社区声望学习记录](docs/COASTAL_COMMUNITY_048.md)。

`0.47.0` 新增按海岸日轮换的每日委托，把低潮、拾取交易、台球、天气漫步和黄昏相机收藏串成持续目标。见 [每日海岸委托与跨系统事件学习记录](docs/COASTAL_COMMISSIONS_047.md)。

`0.46.0` 增加本地库存、潮贝和购买系统，将游客扩展为十位，并收敛远端空地与道路。见 [拾光交易与场景收敛学习记录](docs/COASTAL_MARKET_046.md)。

按照场景截图复核，删除屋后绿色空地、叶簇、两端过长公路及外围露出的沙地长尾，只保留三家商铺周围 104 个世界单位的有效街段。外围地形仍完整封闭，但快速下潜到水下；海面两侧各用两个远海三角形接入雾区，消除高位沿岸视角的斜切硬边。主沙滩、台球、18 个拾取点和商铺位置不变。

`0.45.0` 增加三家商铺、道路、CC0 户外桌椅和花箱，并细化主沙滩设施、房屋及光影。后续 `0.46.0` 已收短道路并移除屋后绿化边界。见 [海滨街区学习记录](docs/COASTAL_STREET_045.md)。

主沙滩保留四张躺椅、原有三把遮阳伞和带爬梯/救生圈的瞭望点；删除遮挡视线的大型帆布棚及两把重复遮阳伞，并减少随机草、石子和贝壳，使主要动线更清楚。咖啡店保留外摆桌椅，小铺保留货架与木箱；房屋补齐山墙封口、檐口、雨水管、侧窗及遮阳支架。直射光强度、天空补光、曝光和软阴影也重新平衡，原有台球场、栈道和 18 处收集点不变。

`0.44.0`：修复侧面和高处看到沙地、海底及海面矩形尽头的问题。外围地形逐点接续原网格，远海延展至相机裁剪范围之外，天空地平线与场景雾色同步。原有布局、近岸网格和台球操作不变。见 [场景边界学习记录](docs/SCENE_BOUNDARIES_044.md)，专项验证为 `npm run test:boundary`。

`0.43.0`：明确区分观察与击球。观察可自由转动镜头，只有击球状态可拉杆；拉杆期间相机位置、朝向、目标点和出杆方向锁定，斜向拖动只影响力度。击球后自动回到观察，切换/取消不误击。用本地 CC0 台球录音及其滤波衍生音替代合成音调。见 [状态与锁镜学习记录](docs/BILLIARDS_INTERACTION_043.md)，专项验证为 `npm run test:billiards-presentation`。

`0.42.0`：加入实体球杆、方向微调、力度控制及倒角木框、六脚支撑、袋圈和台呢细化。沙滩布局和中八物理不变。历史实现见 [台球视听学习记录](docs/BILLIARDS_PRESENTATION_042.md)，其俯视拖拽和合成音效已由 0.43 替代。

`0.41.0`：立体折面草叶与棕榈、实体拍翼海鸥、细化后的两位游客；拾取扩为海玻璃、退潮贝壳与净滩三章，共 18 处，带图鉴、徽记和本机存档。默认连续昼夜与实时演变云层，保留原布局和中八。见 [生态与玩法学习记录](docs/LIVING_COAST_041.md)，专项验证为 `npm run test:living-coast`。

`0.40.0`：近岸泡沫增加推进、破碎残留和回退，直接贴合沙地三角网格；修正草叶重复压暗，使用稳定的解析沙地梯度。见 [近岸细节学习记录](docs/NEAR_SHORE_FINISH_040.md)。

`0.39.0`：接入 CC0 实拍 HDR 天空，让海面倒影与模型环境光一致；重新分层几何浪、细波、吸收与散射，修复薄水层掠射反射暴露三角片的问题。提高近岸网格采样及高档反射/折射精度。见 [水体质感学习记录](docs/WATER_QUALITY_039.md)。这是网页实时近似，尚非虚幻引擎级完整水体。

原创代码采用 **MIT**，第三方素材单独列明许可。新增素材哈希检查、跨平台测试浏览器、CI 和根目录/仓库子路径发布测试。参阅 [GitHub 发布准备](docs/GITHUB_RELEASE.md)、[第三方声明](THIRD_PARTY_NOTICES.md)。

`0.38.0`：岸边真实材质岩块增加随潮位变化的湿润色差与粗糙度，备用岩石同步处理；按实际物体包围盒清理器材、野餐桌周围的草丛穿插。远处帆船跟随潮位升降，摇摆与水面时钟同步。详见 [水体与 NPC 学习记录及许可](docs/OCEAN_AND_NPC_GUIDE.md)，专项测试为 `npm run test:shore-detail`。

`0.37.0` 修复转动视角后的水面残影和三角形色块，改善水下焦散、细波反射与涨退潮岸线。布局为西侧休憩、中部活动、东侧器材，增加连接脚印路线并调整默认构图；手机球局面板默认收起。

`0.36.0` 的 Gerstner 几何浪、HDR 反射、深度折射与两位游客继续保留。入口为工具栏“海滨相遇”，也可点击/触摸人物；原 Q 版素材仍不加载。

上一版 `0.35.0` 从 Poly Haven 引入六类 CC0 真实材质模型，组成野餐休憩区、冲浪器材区与岸边自然细节。16 个模型实例、三把遮阳伞、冲浪板架及条纹沙滩巾继续保留；26 块岸石在原有 X/Z 分布上使用纹理岩块。参阅 [模型接入学习记录](docs/COASTAL_ASSETS_GUIDE.md)、[作者与许可](docs/THIRD_PARTY_COASTAL_ASSETS.md)、[原建模记录](docs/SCENE_MODELING_GUIDE.md) 和 [台球物理](docs/BILLIARDS_PHYSICS_GUIDE.md)。

本版按用户确认的“柔和半写实海滨”统一船、栈道、伞、躺椅与扫描模型的配色、风化程度及光照；调整棕榈叶下垂轮廓。后续加模型先参照 [画风规范与学习练习](docs/COASTAL_ART_DIRECTION.md)。

继续细化了冲浪板的弧面厚度、翘头、中线和尾鳍，补齐遮阳伞垂边、连接环及支架底脚、斜撑；场景地标和台球物理不变。

Windows 下可直接双击根目录的 `启动网页.cmd`，打开已导出的网页快照。修改源码后先执行
`npm run export:web` 更新快照；启动脚本本身不重新构建。服务在后台运行，重复双击会复用原进程。结束时双击 `停止网页.cmd`。

命令行开发：

```bash
npm ci
npm run dev
```

生产构建：

```bash
npm run build
npm start
```

仅本地历史资料中的 Blender 角色实验（公开版本不含参考图/模型）：

```bash
npm run generate:characters
```

`npm start` 默认使用 `127.0.0.1:5175`，端口被占用时会自动尝试后续端口。`npm run status`
显示实际地址与 PID，`npm stop` 关闭后台服务。生产构建后的 `dist` 已经是完整的一键启动
网页成品目录，可直接压缩交付。

质量检查（本机 Chrome，或 `npx playwright-core install chromium` 安装测试浏览器）：

```bash
npm test
npm run build
npm run test:production
npm run test:water-quality
npm run test:swash
npm run test:boundary
npm run test:living-coast
npm run test:server
npm run test:gpu
npm run test:audio
npm run test:bookmarks
npm run test:swell
npm run test:bloom
npm run test:wind
npm run test:cloud
npm run test:reflection
npm run test:normal
npm run test:moon
npm run test:star
npm run test:visibility
npm run test:rain-lifecycle
npm run test:celestial
npm run test:discovery-lifecycle
npm run test:billiards
npm run test:billiards-input
npm run test:models
npm run test:coastal
npm run test:characters
npm run test:visual
```

测试会自行启动并关闭一个隔离的 Vite 服务；需要验证已部署地址时，可设置
`TIDELINE_URL=https://example.com` 后运行同一命令。

## 代码入口

- `src/experience/BeachExperience.js`：渲染器、相机、交互与性能档位
- `src/experience/CoastalProps.js`：内置 GLB 的归一化、批量布置、贴地、碰撞与资源所有权
- `src/experience/CoastalStyle.js`：共用海滨配色、扫描模型 PBR 协调与布料细节
- `src/experience/BeachDiscoveryGame.js`：海玻璃收集、射线交互与拾取动画
- `src/experience/CollectionCampaign.js`：三章拾取、库存、交易、购买与存档迁移
- `src/ui/CollectionJournal.js`：图鉴与潮岸小铺交易界面
- `src/experience/BeachNpcSystem.js`：十位游客、共享骨骼资源、巡逻、对话与移动端可见性
- `src/experience/DiscoveryResources.js`：拾取玩法的延迟资源规格与精确字节预算
- `src/experience/BeachBilliardsGame.js`：沙滩台球输入、cannon-es 物理、落袋、计分与资源生命周期
- `src/experience/ChineseEightBallRules.js`：独立的中八规则、回合与犯规状态
- `src/experience/billiardsAssets.js`：球号/花色图集、台呢纹理与开球线
- `src/experience/billiardsTable.js`：视觉和碰撞共用的库边、袋角与袋口尺寸
- `src/experience/billiardsPhysics.js`：实心球转动惯量、杆头偏移冲量、台呢摩擦与库边切向摩擦
- `src/experience/ChibiCharacterSystem.js`：保留的 Blender GLB 角色加载模块，当前不接入运行时
- `scripts/generate-chibi-models.py`：Blender 无界面建模、减面、顶点色烘焙与 GLB 导出
- `blender/*.blend`：两位二头身角色的可编辑 Blender 4.5 源文件
- `src/experience/FreeCameraController.js`：指针锁定、贴地漫步、自由飞行、阻尼、碰撞与边界
- `src/experience/GpuFrameTimer.js`：非阻塞 WebGL2 GPU 帧计时、平滑采样与上下文恢复
- `src/experience/FootstepAudio.js`：延迟初始化、位移步距与程序化地表脚步声
- `src/experience/CameraBookmarks.js`：三槽构图校验、复制与 localStorage 持久化
- `src/experience/BloomPostProcessor.js`：延迟加载、质量参数和资源释放完整的可选后处理链
- `src/experience/OceanSwell.js`：Water 片元 Shader 的低频远海法线浪涌注入
- `src/experience/CoastalWind.js`：统一海风强度、相位、缓动与雨丝漂移状态
- `src/experience/CloudQuality.js`：程序化云层 High/Low 纹理与网格规格
- `src/experience/WaterReflectionQuality.js`：Water 镜像 RenderTarget 的 High/Low 规格
- `src/experience/WaterNormalQuality.js`：Water 法线纹理尺寸与各向异性规格
- `src/experience/MoonQuality.js`：程序化月面纹理、陨石坑密度与球体分段规格
- `src/experience/StarQuality.js`：星空 High/Low 点数与顶点缓冲规格
- `src/experience/CelestialResources.js`：星空、月面与月晕的延迟负载预算
- `src/experience/AtmosphereVisibility.js`：星月与夜间灯光的统一可见性阈值
- `src/experience/RainSystem.js`：动态雨线、镜头跟随体积和画质分级
- `src/experience/LocalAssetManager.js`：本地贴图/glTF 导入、规格化、动画与释放
- `src/experience/environment.js`：Water、Sky、光照、昼夜、天气与潮位节律
- `src/experience/world.js`：地形、道具、实例化、动态潮线、相机碰撞体与局部动画
- `src/experience/shaders.js`：沙、岩石、木材、植被与泡沫 Shader
- `src/ui/UIController.js`：开场、首次引导、控制面板与全屏交互

## 文档

- [整体制作流程与设计思路](./docs/PRODUCTION_GUIDE.md)
- [Shader 学习入口](./docs/SHADER_GUIDE.md)
- [自由视角实现与学习指南](./docs/FREE_CAMERA_GUIDE.md)
- [玩法与场景迭代指南](./docs/GAMEPLAY_AND_SCENE_GUIDE.md)
- [动态潮位系统指南](./docs/TIDE_SYSTEM_GUIDE.md)
- [本地交付与稳定启动指南](./docs/LOCAL_DELIVERY_GUIDE.md)
- [雨幕与本地资源导入指南](./docs/RAIN_AND_IMPORT_GUIDE.md)
- [雨幕资源延迟创建与释放指南](./docs/RAIN_RESOURCE_LIFECYCLE_GUIDE.md)
- [天气氛围系统指南](./docs/WEATHER_SYSTEM_GUIDE.md)
- [海浪与岸线泡沫联动指南](./docs/WAVE_FOAM_GUIDE.md)
- [GPU 帧计时与自动画质指南](./docs/GPU_TIMING_GUIDE.md)
- [清晨薄雾预设指南](./docs/DAWN_MIST_GUIDE.md)
- [地表脚步声指南](./docs/FOOTSTEP_AUDIO_GUIDE.md)
- [构图书签指南](./docs/CAMERA_BOOKMARKS_GUIDE.md)
- [远海涌浪指南](./docs/OCEAN_SWELL_GUIDE.md)
- [柔光泛光与后处理指南](./docs/POST_PROCESSING_GUIDE.md)
- [统一海风系统指南](./docs/COASTAL_WIND_GUIDE.md)
- [程序化云层画质分级指南](./docs/CLOUD_QUALITY_GUIDE.md)
- [Water 反射画质分级指南](./docs/WATER_REFLECTION_QUALITY_GUIDE.md)
- [Water 法线贴图画质分级指南](./docs/WATER_NORMAL_QUALITY_GUIDE.md)
- [程序化月面画质分级指南](./docs/MOON_QUALITY_GUIDE.md)
- [星空画质分级与白天天体剔除指南](./docs/STAR_QUALITY_GUIDE.md)
- [星月资源延迟创建与复用指南](./docs/CELESTIAL_RESOURCE_LIFECYCLE_GUIDE.md)
- [潮汐拾光资源延迟创建指南](./docs/DISCOVERY_RESOURCE_LIFECYCLE_GUIDE.md)
- [沙滩台球物理、交互与资源生命周期指南](./docs/BEACH_BILLIARDS_GUIDE.md)
- [二头身角色建模与场景接入指南](./docs/CHIBI_CHARACTER_GUIDE.md)
- [日光灯笼与不可见光照剔除指南](./docs/DAYLIGHT_LIGHTING_CULLING_GUIDE.md)

首次进入会显示桌面/移动端自适应操作图，之后可用右上角问号重新打开。桌面端的脚印图标进入
第一视角漫步，空间移动图标进入自由飞行。两种模式都用鼠标控制朝向、`W/A/S/D` 移动、
`Shift` 加速、`E` 拾取、`Esc` 返回；只有自由飞行使用 `Space` 上升、`Q/Ctrl` 下降。
锁定失败会自动恢复，船、礁石、棕榈与灯柱使用低成本简化碰撞体；触屏设备保留更稳定的 OrbitControls。

设置面板中的“漫步脚步声”默认关闭。主动开启后，第一视角漫步会按实际行走距离播放程序化
脚步声，沙地较松软、木栈道较清脆；环绕视角和自由飞行不会触发。音频延迟初始化，不加载外部文件。

“构图书签”提供 3 个可保存槽位。选择槽位后可保存当前观察位置，之后点击“前往”会平滑恢复
相机位置和观察目标；书签保存在当前浏览器，下次打开仍可使用。删除只清理所选槽位，恢复镜头
不会切换时间、天气、潮位、画质或玩法状态。

进入场景后可寻找 6 枚海玻璃。环绕视角点击微光、移动端轻触微光，漫步或自由视角靠近后按
`E` 拾取；收集完成后可从任务 HUD 重新开始。木栈道、潮池、遮阳休憩点、湿脚印与风动草丛
共同构成探索路线。漫步相机跟随沙地与栈道表面，并由动态岸线阻止继续走入海水。
设置面板可选择退潮、自动潮汐或涨潮；自动模式以 180 秒完成一个潮汐周期，并同步移动
水面、湿沙、泡沫和漫步边界。

进入场景后，空旷干沙区会出现一张可玩的沙滩台球桌。环绕视角按住白球并反向拖拽可调整方向
和力度，松开后由 `cannon-es` 计算 16 球碰撞、库边反弹，台呢模型处理滑动、滚动与旋转摩擦；每杆停止后统一判定
球组、换手、犯规和黑八胜负，自由球可自行摆放并确认。台球模块仅在首次进入场景后加载，平时 4 个 Draw
Object，瞄准时增加一条线，并可从独立 HUD 随时重开。HUD 的定位图标会退出漫步或自由视角，
平滑切换到适配桌面或手机的完整台桌构图，不会改变当前球局。台桌还登记到既有简化碰撞列表，
漫步和自由视角会被推出桌体，运行时切换画质重建世界后仍保持边界。
轻点白球不会出杆，拖动中断会取消蓄力。球全部停稳后 HUD 显示当前玩家与判罚；母球落袋后会等待
其他球停止，再提供不重叠的自由球落点，须确认后才能出杆。可用 `npm run test:billiards-input` 验证桌面鼠标和
手机触屏的完整击球流程。

“晴帽向导”和“软绒旅伴”的 Blender 4.5.3 `.blend`、本地 `.glb`、生成脚本和学习指南仍完整
保留，便于后续替换为用户提供的最终角色模型。当前版本不导入、不创建、不更新任何角色对象，
调试状态明确返回 `characters: null`，因此角色不会占用运行时网络、内存、Draw Call 或三角形预算。

“海浪速度”同时控制 Water 法线流动和岸线泡沫推进。泡沫从 Water 的累积时间读取同一相位，
主浪线会向岸上推进并回撤，回流水线反相变化；切换速度不会再出现海面加速而泡沫节奏不变的脱节。

“远海涌浪”在 Water 原有法线后叠加两组低频解析坡度，默认强度 `0.42`。效果从远海逐渐增强，
到近岸平滑淡出，因此不会改变潮线、船只、拾取物或漫步碰撞。它复用 Water 时间，不新增几何、
贴图采样、Draw Call 或运行依赖。

“海风强度”统一控制程序化云层漂移、沙丘草摆动、棕榈叶摇曳和雨丝斜向偏移。默认 `0.60`
精确对应改造前效果；`0.00` 为静风，`1.20` 为双倍风。调整会平滑过渡，只更新已有 uniform、
实例矩阵和雨线顶点，不增加场景物体、Draw Call、三角形、贴图或依赖。

“柔光泛光”默认关闭。首次开启时才异步加载 Three.js 的 Composer、Bloom 和 Output 分包，
以高阈值柔化月亮、灯柱、海玻璃和水面高光；关闭后立即恢复原有直接渲染路径。桌面 High 与
移动/Low 使用不同强度和半径，画质切换时同步更新。开启约增加 14 个后处理 Draw Call，关闭后
原场景渲染统计完全恢复。

自动画质会在进入场景后同时参考 5 秒平均 FPS 与完整帧 GPU 耗时。支持
`EXT_disjoint_timer_query_webgl2` 的浏览器使用异步查询统计 Water 镜像和主场景的总 GPU 时间；
不支持扩展时继续使用原有 FPS 判断，不影响页面运行。

程序化云层现在完整响应运行时画质切换。High 使用 `512×256` 密度纹理和 2208 个三角形，Low
使用 `256×128` 和 728 个三角形；Low 的纹理面积减少 75%，云穹三角形减少约 67%。切档会保留
当前天气、海风相位和云穹旋转，并释放旧 Geometry、Material 与 Texture，不增加 Draw Call。

Water 镜像反射也完整响应运行时画质切换。High 使用 `512×512` RenderTarget，Low 使用
`256×256`；Low 的反射像素面积减少 75%。切档复用同一个 Water 和 RenderTarget，通过 `setSize()`
释放旧尺寸的 GPU 附件，保留海浪时间、涌浪相位、潮位与 Shader 状态，不增加 Draw Call。

Water 法线贴图同样响应运行时画质切换。High 使用 `512×512` 与 8× 各向异性，Low 使用
`256×256` 与 4× 各向异性；Low 的法线像素面积减少 75%。切档复用只读源图和同一个 Water，
替换 `normalSampler` 后释放旧活动纹理，保留海浪时间、潮位、涌浪和天气状态。

程序化月面也响应运行时画质切换。High 使用 `256×256`、46 个陨石坑和 `1064` 个三角形，Low
使用 `128×128`、23 个陨石坑和 `396` 个三角形；Low 的像素面积减少 75%，月球三角形减少约
63%。切档复用原月球 Mesh 与 Material，替换 map 与 Geometry 后释放旧资源，保留月球位置、
月夜透明度和昼夜过渡状态。

星空也响应运行时画质切换。High 使用 950 个星点，Low 使用 480 个，Low 的星点与位置缓冲均
减少约 49%。切档复用原 `THREE.Points` 与 `PointsMaterial`，只替换并释放 BufferGeometry，保留
星空旋转和月夜透明度。清晨与日光中原本透明的星空、月球和月晕会直接停止提交渲染，画面不变，
同时减少 Water 镜像与主场景中的无效天体绘制。沙滩台球组从 Water 镜像通道排除，避免近岸
玩法几何在反射通道重复绘制。

星空位置缓冲、程序化月面纹理与几何、月晕纹理现在还会延迟到首次可见月夜才创建。默认日光、
清晨和黄昏的真实天体负载为 0，High 延后 364,952 字节，Low / 移动端延后 147,112 字节。首次
创建后资源会在昼夜往返中复用；画质切换仍替换并释放旧规格，退出页面时释放最终资源。场景外观、
星月位置、透明度曲线和夜景 Draw Call 不变。

日光档的灯笼也会停止提交零强度 PointLight、全透明灯芯和全透明光晕，并跳过两组闪烁计算。
桌面默认镜头实测减少 2 个 Draw Call 和 170 个三角形，同一冻结帧像素完全一致；移动端默认镜头
中的灯芯本就位于视锥外，因此 Draw Call 不变，但零强度 PointLight 仍会退出灯光收集。清晨、黄昏
和月夜达到统一可见性阈值后自动恢复原有灯光、灯芯、光晕与闪烁。

“天气氛围”提供晴朗、多云和阴天三档，并独立于日光、黄昏、月夜和雨幕开关。天气切换
平滑控制云量、直射光、环境补光、雾、曝光与水面反射，不增减场景物体。默认使用晴朗，
因此原有场景首次进入时保持不变。

时间控件增加可选“清晨”档：低角度暖阳、指数薄雾、冷灰远景、水面晨光和略湿润的沙色
由同一预设平滑驱动，并可继续叠加晴朗、多云或阴天。默认仍为“日光”，原有首次画面不变。

设置面板中的“立体雨幕”可独立开关，不改动当前时段或场景光照。桌面高画质使用 1100 滴、
低画质和移动端使用 520 滴；每滴包含雨丝和两束短促触地水花，并按沙地或水面的实际高度碰撞。
全部线段仍合并为一个 `LineSegments` Draw Call。雨幕默认关闭。

默认关闭时不再提前创建雨滴数组、Geometry、Material 或 LineSegments；首次开启才按当前画质
分配资源。High 延后 184,800 字节常驻数组与 158,400 字节 GPU 顶点属性，Low 分别延后 87,360
和 74,880 字节。普通关闭保留同一对象供快速重开；关闭状态切换画质会释放旧规格并把新规格继续
延迟到下一次开启，Water 反射排除登记随对象生命周期同步更新。

“本地资源”可导入 PNG/JPG/WebP/AVIF 贴图，或 GLB、资源已内嵌的 glTF 模型。贴图会进入
海滩展示板，模型自动落地并缩放到约 4 米范围；一次只保留一个导入资源，移除后释放几何、
材质、贴图与动画。导入后可调整沙滩 X/Z 位置、水平朝向和 0.5-2 倍整体缩放，移动时自动贴合
地形，也可一键恢复展示点。模型包含动画时会显示片段菜单、播放/暂停、重播和 0.25-2 倍速控制，
片段切换使用 0.35 秒平滑融合。本地文件只在当前浏览器内读取，不会上传。

0.35.0 柔和半写实版完整帧统计（包含 Water 镜像及阴影，完整回归测试固定镜头）约为：

- 桌面高画质完整回归：实测约 112 Draw Calls / 290,279 Triangles
- 移动端低画质完整回归：实测约 49 Draw Calls / 123,192 Triangles
- 0.35.0 自动测试预算：桌面不超过 112 / 300,000，移动端不超过 56 / 125,000；新增道具和岸石分别受 55,000 / 13,000 几何预算约束

GPU 计时、清晨预设、天气、泡沫联动、远海涌浪、统一海风、云层、Water 反射、法线、月面与星空画质切换、脚步声和构图书签不增加 Draw Call；Low 云层会主动减少纹理面积与三角形，Low Water 反射、法线和月面纹理像素面积各减少 75%，Low 月球三角形减少约 63%，Low 星空点数与位置缓冲减少约 49%，清晨/日光会剔除透明星月，默认日光还会剔除零贡献灯笼光照，沙滩台球平时增加 4 个主场景 Draw Object、瞄准时增加 1 条线，人物运行时当前为 0，开启柔光泛光约增加 14 个后处理 Draw Call，开启雨幕后增加 1 个 Draw Call；
导入资源的额外成本取决于用户文件。
