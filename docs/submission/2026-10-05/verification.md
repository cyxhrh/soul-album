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

## 魔搭本轮部署记录

- 已创建公开 Static 创空间：[Cy189789/jianji](https://modelscope.cn/studios/Cy189789/jianji)。平台 API 返回的真实应用地址为 https://cy189789-jianji.ms.show 。
- 对应源码 `e5fca672522ee7d402edb36d6a7202cd127796e1` 的构建产物已普通推送，空间提交 `6504b05`。27 个构建文件与本机 `dist` 的 SHA256 全部一致。
- 已触发部署；平台镜像构建和镜像推送日志显示 SUCCESS，当前 API 为 `Deploying`。
- 启动阶段的匿名请求暂未返回应用 HTML。早期响应为 404 / Unauthorized，最新匿名响应为 412 / PreconditionFailed / function is pending state；此时不能判定公开体验已通过，也不能由早期响应断言平台必须登录。
- 知知素材、封面及模型实验说明已上传；封面设置 API 已成功返回平台托管图片地址。公开资源内容与页面交互仍需服务运行后验收。
- 本轮外部网页的浏览器控制持续超时，未完成云端界面操作验证；前述完整流程验证来自本机同一生产构建。

## 仍待实际提交人验收

本机没有 Docker，未运行可选根 Dockerfile；实际魔搭路线为 Static，由平台完成其托管镜像构建。

待服务进入 Running 并通过匿名 HTTP 检查后，再在未登录窗口与手机验证公开应用，核对表单中的完整字段、资格和截止时刻。最终提交及条款核对由参赛人完成，比赛表单尚未提交。
