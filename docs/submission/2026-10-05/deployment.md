# 渐记 Demo：魔搭创空间部署

本轮发布的是预设评委 Demo：聊天、画册、日常与通话界面均使用合成示例。采用 **Static SDK** 托管已构建文件，不需要模型 Key、不启动后端，不调用真实模型，也不连接设备、支付账单或麦克风。构建开关使根地址直接进入评委流程，无需输入查询参数。

## 本轮实际空间与状态

用户已选择比赛推荐的魔搭创空间提交方式。本轮已真实创建公开空间，无需队友重复创建：

| 项目 | 本轮记录 |
| --- | --- |
| 项目页（比赛所选方式的应用字段） | https://modelscope.cn/studios/Cy189789/jianji |
| 应用地址 | https://cy189789-jianji.ms.show |
| SDK / 可见性 | Static / 公开 |
| 构建产物对应源码 | `e5fca672522ee7d402edb36d6a7202cd127796e1` |
| 创空间普通推送版本 | `6504b05` |
| 部署记录 | 已触发；平台镜像构建日志 SUCCESS，API 仍为 Building，HTTP 与匿名体验验收待完成 |

最终运行状态和验收证据见 [verification.md](verification.md)。平台在内部构建中使用临时 Dockerfile，不是空间 Git 新版本；本项目所选 SDK 仍为 Static。

## Static 更新步骤

1. 按下方构建命令生成评委版，把 `dist/` **内部文件**同步到空间 Git 副本根目录，入口为 `index.html`；保留 `assets/`、`brand/`、`evidence/` 及其余所需公开资源。
2. 保留空间已有 README 和 `.gitattributes`。普通提交、推送到空间实际默认分支，本空间使用 `master`，不强推，不覆盖其他作品。
3. 调用部署并查看状态、运行日志；`modelscope-hub 0.4.5` 的 `ms upload` 不支持 studio，文件同步采用 Git。
4. 在未登录浏览器打开已有项目页/应用地址走完主流程，并记录本次实际提交版本；部署触发成功不等于应用验收通过。

可用 CLI：`ms studio deploy Cy189789/jianji`、`ms studio logs Cy189789/jianji --type run`。认证由账号持有人通过正常凭据机制完成，文档不含令牌。

官方依据：[ModelScope 官方创空间部署说明](https://github.com/modelscope/modelscope-skills/blob/main/skills/ms-studio-deploy/SKILL.md)、[静态入口与端点](https://github.com/modelscope/modelscope-skills/blob/main/skills/ms-studio-deploy/references/openapi-studio-endpoints.md)。Static 不执行项目构建，不需要选择硬件或设置模型密钥。

## 获取提交版本

```powershell
git clone --branch codex/teammate-frontend-integration --single-branch https://github.com/cyxhrh/soul-album.git
Set-Location soul-album
```

这只是拉取 GitHub 源码版本；创空间仓库保存的是其已构建产物。更新时先确认源码版本，避免部署旧快照。不要复制本机 `node_modules`、`.env`、日志或个人凭据。

## 可选 Docker 路线（本轮未采用）

若后续需要自定义 nginx 的 API 屏蔽或 SPA 深链接回退，可另选 Docker SDK。完整源码包：[jianji-modelscope-source-2026-10-05.zip](https://github.com/cyxhrh/soul-album/releases/download/submission-2026-10-05/jianji-modelscope-source-2026-10-05.zip)。解压后根目录包含 Dockerfile；需同步源码，不是直接上传 ZIP 作为入口。

Docker 要求阿里云绑定和实名；硬件从当前页面选择明确免费的 CPU 项，费用以页面为准。根目录配置包含 `Dockerfile`、`.dockerignore`、`package.json`、锁文件、源码/公开资源、TypeScript/Vite 配置及 `deploy/modelscope/nginx.conf`。服务实际监听 `0.0.0.0:7860`，不能用平台占用的 `8080`。这套可选配置不要求额外 `ms_deploy.json`。

```powershell
docker build -t jianji-judge-demo .
docker run --rm --name jianji-judge-demo -p 7860:7860 jianji-judge-demo
```

打开 `http://127.0.0.1:7860/`，应跳转到 `/?demo=judge`；深链接 `http://127.0.0.1:7860/preview?demo=judge` 应仍可加载静态资产；`/api/` 应返回 404。容器构建阶段使用 `npm ci --ignore-scripts` 安装锁定依赖，再构建相对资源路径。最终镜像只复制 `dist` 与 nginx 配置，不带 Node 运行时、源码或后端服务。

当前 Windows 环境没有 `docker` 命令，**本项目的可选 Docker 配置未实际构建或运行验证**。本轮 Static 已触发平台部署，不能据此宣称可选 Docker 路线已通过。切换路线前需执行上面的容器/空间验证。

## 可复用静态 ZIP

本项目也可将生成的 `dist/` **内部文件**打成 ZIP；使用公开布尔构建开关，使无查询参数的静态入口也进入评委流程：

```powershell
npm ci --ignore-scripts
$env:VITE_JUDGE_DEMO = 'true'
npm run build -- --base=./
Remove-Item Env:VITE_JUDGE_DEMO
```

静态托管时须保留 `assets/`、`brand/`、`evidence/` 等目录及已打包的所有公开资源，不要只上传 `index.html`。构建开关不包含 Key，也不会启动 API 或模型。没有设置开关的本地开发继续使用原入口行为。

ModelScope 的 **Static SDK 不提供前端构建步骤**，只有已经构建的 `index.html` 等产物才适合部署；ZIP 本身不能直接代替应用文件。本轮已按这条路线同步构建产物。Static 不包含上述自定义 nginx 配置，入口和资源的最终可用性以云端验收为准。

## 提交前由队友补齐

- 创空间公开项目链接已填： https://modelscope.cn/studios/Cy189789/jianji ，不能用 localhost 或 GitHub 源码地址替代。
- 应用在线预览链接已填： https://cy189789-jianji.ms.show ，仍待 HTTP 与匿名体验验收，首次进入须为评委流程。
- 部署分支 `master`、公开空间提交 `6504b05`；后续更新及最终运行版本以 verification.md 为准。
- 匿名窗口验证：五次发送 → 原话依据 → 纠正理解 → 画册 → 日常原话 → 下一次见面；检查形象选择、语音预览、通话界面仍可访问。

提交材料应将预设体验、历史模型实验和后续目标分开描述；公开静态部署不会使 Demo 变成实时模型应用。
