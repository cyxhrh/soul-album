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
- 平台镜像构建和镜像推送日志显示 SUCCESS，最终 API 为 `Running`。
- 运行后的匿名 HTTP 验证通过：根入口及 12 项资源，共 13 个 URL 均返回 200，无登录重定向，不发送令牌或 cookie。覆盖 `?demo=judge`、JS/CSS、知知头像、3 款角色、2 张表情、图标、封面和模型实验说明。
- 其中 12 个 URL 的原始 SHA256 与本机文件一致；模型实验 Markdown 的差异仅为 Git/Linux 把 41 个 CRLF 换行为 LF，文本规范化后 SHA256 一致。封面实际尺寸为 1920 × 1080。
- 公开的逐项 HTTP 验证结果见 [deployment-http-checks.json](deployment-http-checks.json)，不包含令牌、cookie 或本机私人路径。
- 启动阶段曾返回 404 和 412 / function is pending state；服务运行后已恢复正常。它们不代表本产品要求登录。
- 知知素材、封面及模型实验说明已上传；封面设置成功，平台已保存托管图片地址。
- 本轮外部网页的浏览器控制持续超时，未完成云端界面操作验证；前述完整流程验证来自本机同一生产构建。

## 仍待实际提交人验收

本机没有 Docker，未运行可选根 Dockerfile；实际魔搭路线为 Static，由平台完成其托管镜像构建。

服务已进入 Running 并通过匿名 HTTP 检查。队友仍须在未登录浏览器与手机走完云端交互流程，核对表单中的完整字段、资格和截止时刻。最终提交及条款核对由参赛人完成，比赛表单尚未提交。
