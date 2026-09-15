# GitHub 发布准备

原创源码和文档采用 MIT，作者钱奕好。第三方素材独立遵循其许可，见根目录 `THIRD_PARTY_NOTICES.md`。本地旧 Q 版参考图、实验 Blender 文件与来源未核实的旧法线不属于本项目 MIT 授权范围，不应上传。

## 本地验证

推荐 Node.js 22。依赖已锁定，使用 `npm ci`，然后执行 `npm test`、`npm run build`、`npm run test:production`。浏览器测试自动查找本机 Chrome；没有时运行 `npx playwright-core install chromium`，或设置 `CHROME_PATH`。Linux CI 使用 `--with-deps` 安装系统依赖。

`npm test` 包含 23 个确定性检查套件，涵盖资产哈希、资源生命周期、台球规则/物理、场景边界、街道采样及独立源码入口。浏览器检查另行运行，不要把纯逻辑测试当作画面验收。`.github/workflows/ci.yml` 会执行依赖审计、逻辑测试、构建、发布路径、水体与街区回归；云端是否通过，以实际上传后的 Actions 结果为准。

## 静态网站

当前用户选择继续手动上传网页成品。执行 `npm run export:web` 后使用最新 dist 内容，详见 [手动发布说明](MANUAL_PUBLISH.md)。dev.html 保留源码入口，根目录 index.html 保留发布快照；不启用自动部署。

`npm run build` 生成 `dist`。Vite 使用相对 `base`，运行时素材也统一通过 `assetUrl()` 解析，根域名和 GitHub Pages 仓库子目录均有本地实测覆盖。将 **dist 内容** 发布到静态站点，不是直接上传 src 后期待浏览器执行。

源码仓库使用 GitHub Pages 时，可依照 [Vite 官方 Pages 指南](https://vite.dev/guide/static-deploy.html#github-pages) 配置 Actions 构建并上传 `dist`。本项目只预置 CI 检查，没有自动发布或操作任何远程仓库。Windows 本机可继续双击启动脚本，地址以 `npm run status` 为准。

## 发布边界

- `.gitignore` 排除依赖、构建、日志、截图、临时规划、旧角色素材和本地实验；公开源码需包含 `package-lock.json`、`LICENSE`、第三方声明和经校验的运行时素材。
- `.gitignore` 不会阻止网页拖拽上传，也不会过滤 Vite 的 public 目录。因此生产构建关闭全量 public 拷贝，按 `public-assets.mjs` 验证过的清单复制资产。
- 原有学习资料源码 ZIP 用于本地留档，可能包含历史参考素材；不要直接作为公开仓库整体上传。GitHub 专用整理包不包含这些历史图片和模型。
- 素材使用本地文件，不依赖第三方 CDN。浏览器本地导入功能不会自动上传用户模型。
- 依赖审计不等于安全保证；未来增加新素材时补充来源、作者、许可和内容哈希，再执行资产测试。
