# 手动更新 GitHub 网页

本仓库保留手动上传网页成品，不自动部署。原创代码与文档作者为钱奕好，MIT 许可；素材许可见 `THIRD_PARTY_NOTICES.md`。

## 源码和成品分开

- `src/` 与 `dev.html`：继续开发的源码。`npm run dev` 打开的根地址会加载源码入口，不受上次成品覆盖影响。
- `dist/`：`npm run build` 生成的最新网页成品，内含对外使用的 `index.html`。
- 根目录的 `index.html`、`assets/`、`models/` 等：已上传网站的本地快照，保留现有手动发布方式。

以前根目录入口只引用旧的压缩 JS，直接修改 src 可能看不到变化；不要把成品入口再覆盖到 dev.html。

## 更新步骤

1. 修改源码后执行 `npm test`。
2. 执行 `npm run export:web`。它构建最新 dist，再将入口、打包脚本、经过验证的素材和许可同步到根目录，不删除旧文件，不进行网络上传。
3. 执行 `npm run test:production`，检查 dist 在根路径、仓库子路径和 HDR 加载失败时均可运行。
4. 手动上传 **dist 里面的文件和文件夹** 到当前 GitHub 网页发布目录，保留 `assets/`、`models/` 等结构；不要再套一层 dist 文件夹，也不要只替换 index.html。
5. 需要同步学习源码时，另行提交 src、dev.html、scripts、docs、配置文件及 package-lock.json。不要上传 node_modules、临时截图或本机导入模型。

保留根目录快照是为了兼容当前发布方式，旧哈希资源不会自动删除，避免误伤已有文件。上传最新 dist 不依赖那些旧哈希文件。网页更新后若仍显示旧内容，强制刷新，并核对入口中的脚本文件名是否与本地 dist 一致。

本地成品执行 `npm start`；它会打印实际地址。默认尝试 5175，其他程序占用时会使用后续端口。脚本不会推送提交、改仓库设置或启动 GitHub Actions 部署。
