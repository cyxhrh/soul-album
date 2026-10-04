# 本轮提交准备验证

日期：2026-10-05。对象：`codex/teammate-frontend-integration` 分支的当前提交准备包。

## 已完成

- `npm test`：39 个文件、372 个测试通过，包含本地记录、模型接线、画册与预设流程。
- `npm run lint`：通过。
- `VITE_JUDGE_DEMO=true npm run build -- --base=./`：TypeScript 与静态构建通过。
- `npm run test:e2e -- tests/judge-demo.spec.ts tests/judge-daily.spec.ts tests/judge-tools.spec.ts`：9 个通过，覆盖无 API 的五轮流程、.md 下载、重置、原话依据、通话与语音预览，以及 320 / 375 像素布局。
- 浏览器打开生产构建的 `/`：默认为评委模式；完整体验五次发送、原话弹窗、理解修正、两种画册阅读方式、日常和下一次见面。
- 用实际界面保存 8 张原始截图；从画册显示的完整 Markdown 保存样例文件。
- AI 实践正文为 201 字符，低于截图规定的 300；提交文案与源码能力对照检查通过。
- 新材料未包含真实私人对话、身份信息或模型密钥；未打包本机环境配置与日志。

## 部署与版本

静态构建用公开布尔开关 `VITE_JUDGE_DEMO=true`，保证直接打开根网址进入预设流程。GitHub Pages 工作流可从 main 发起并指定待发布提交，保留已有 main 部署规则；托管资产按 `/soul-album/` 构建。便携静态 ZIP 使用 `./` 相对资源路径。两种构建的产品源码一致。

本次代码与材料可在 [准备包发布页](https://github.com/cyxhrh/soul-album/releases/tag/submission-2026-10-05) 核对版本并下载。页面持续部署记录见 [GitHub Actions](https://github.com/cyxhrh/soul-album/actions/workflows/pages.yml)。

## 仍待实际提交人验收

本机没有 Docker，本轮未实际构建或运行容器。创空间尚未创建或部署，不能将 Dockerfile 的准备完成等同于平台上线成功。

队友须用自己的 ModelScope 账号完成部署，在匿名窗口与手机验证公开应用，回填必填创空间 URL，并核对登录表单中的完整字段、资格和截止时刻。最终提交及条款核对由参赛人完成。
