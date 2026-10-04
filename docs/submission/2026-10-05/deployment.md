# 渐记 Demo：魔搭创空间部署

这份配置发布的是预设评委 Demo：聊天、画册、日常与通话界面均使用合成示例。运行时只有静态文件服务器，不需要模型 Key、不启动后端，不调用真实模型，也不连接设备、支付账单或麦克风。访问空间应用的根地址会自动进入 `?demo=judge`。

## 创空间设置

1. 队友登录自己的 ModelScope 账号，创建公开创空间；选择 **Docker SDK**。
2. Docker 创建要求绑定阿里云账号并完成实名认证。计算资源从当前页面提供的可用选项里选择免费 CPU 项；硬件名称和费用以创建页面为准，不固定承诺某个规格免费。
3. 将本分支文件同步到创空间代码仓库根目录。根目录需要 `Dockerfile`、`.dockerignore`、`package.json`、`package-lock.json`、`src/`、`shared/`、`public/`、TypeScript/Vite 配置，以及 `deploy/modelscope/nginx.conf`。保留其余已有源码即可。
4. 创空间部署分支以设置页面为准，平台通常使用 `master`。不要把 GitHub 的分支名直接当作创空间已经采用的分支。
5. 配置监听 `0.0.0.0:7860`；本 Dockerfile 已设置该端口。平台占用 `8080`，不要改用该端口。
6. 提交代码并部署，依次检查构建日志、运行日志和应用预览。无需新增 `ms_deploy.json`，本配置按 Docker SDK 的根文件流程部署。

官方依据：[ModelScope 官方创空间部署说明](https://github.com/modelscope/modelscope-skills/blob/main/skills/ms-studio-deploy/SKILL.md)。账号要求、硬件和页面选项仍以实际创建界面为准。

## 获取提交版本

```powershell
git clone --branch codex/teammate-frontend-integration --single-branch https://github.com/cyxhrh/soul-album.git
Set-Location soul-album
```

这只是拉取 GitHub 版本；创空间代码仓库需要由持有账号的队友同步。请先确认 GitHub 本分支包含本目录和根 Dockerfile，避免部署旧快照。不要复制本机 `node_modules`、`.env`、日志或个人凭据。

## 本机容器验证命令

```powershell
docker build -t jianji-judge-demo .
docker run --rm --name jianji-judge-demo -p 7860:7860 jianji-judge-demo
```

打开 `http://127.0.0.1:7860/`，应跳转到 `/?demo=judge`；深链接 `http://127.0.0.1:7860/preview?demo=judge` 应仍可加载静态资产；`/api/` 应返回 404。容器构建阶段使用 `npm ci --ignore-scripts` 安装锁定依赖，再构建相对资源路径。最终镜像只复制 `dist` 与 nginx 配置，不带 Node 运行时、源码或后端服务。

当前 Windows 环境没有 `docker` 命令，**未实际构建或运行容器，也未在创空间部署**。本轮只能检查现有前端静态构建与配置内容；队友部署时需执行上面的容器/空间验证。Docker 基础镜像的拉取与 npm 安装需要空间构建环境能访问镜像仓库和 npm 源。

## 可复用静态 ZIP

本项目也可将生成的 `dist/` **内部文件**打成 ZIP；使用公开布尔构建开关，使无查询参数的静态入口也进入评委流程：

```powershell
npm ci --ignore-scripts
$env:VITE_JUDGE_DEMO = 'true'
npm run build -- --base=./
Remove-Item Env:VITE_JUDGE_DEMO
```

静态托管时须保留 `assets/`、`brand/`、`evidence/` 等目录及已打包的所有公开资源，不要只上传 `index.html`。构建开关不包含 Key，也不会启动 API 或模型。没有设置开关的本地开发继续使用原入口行为。

ModelScope 的 **Static SDK 不提供前端构建步骤**，只有已经构建的 `index.html` 等产物才适合直接上传；ZIP 本身不能直接代替应用文件。静态 SDK 下也可使用应用预览的 `?demo=judge` 入口。若需要屏蔽 `/api` 与 SPA 深链接回退，优先使用本 Docker SDK 配置。

## 提交前由队友补齐

- 创空间公开项目链接：待队友创建后填入。不能用 localhost 或 GitHub 源码地址替代。
- 应用在线预览链接：待部署成功后填入，首次进入须为评委流程。
- 部署分支、提交 SHA、资源选项：以本次实际部署为准。
- 匿名窗口验证：五次发送 → 原话依据 → 纠正理解 → 画册 → 日常原话 → 下一次见面；检查形象选择、语音预览、通话界面仍可访问。

提交材料应将预设体验、历史模型实验和后续目标分开描述；公开静态部署不会使 Demo 变成实时模型应用。
