# 渐知 · 产品 Demo 与本地后端核心

**2026-10-04 最新评委体验**在 [`codex/teammate-frontend-integration` 分支](https://github.com/cyxhrh/soul-album/tree/codex/teammate-frontend-integration)。队友先看[本次交接与体验入口](docs/handoff/teammate-frontend-2026-10-04.md)，启动后打开 `/?demo=judge`：五轮预设对话、画册目录与正反面、下一次见面、知知表情，以及步数／静息心率／消费的日常页。原通话、语音输入和伙伴选择界面均保留；所有评委体验内容使用合成数据，无需后端或模型密钥。

“每天问一点，慢慢看见自己”。打开应用即进入对话：首页用气泡消息记录日常，画册翻看已有记录，生活数据页展示逐项开启的模拟图表。这个阶段先确认产品本身的交互与功能，暂不制作作品介绍页。

在线体验：[GitHub Pages 前端 Demo](https://cyxhrh.github.io/soul-album/)；队友可从[公开源码仓库](https://github.com/cyxhrh/soul-album)获取代码。

本版三页视觉、画册详情、日报式生活数据与语音输入体验以队友的 [LCX206/soul-album](https://github.com/LCX206/soul-album/tree/6fe3831d85287a685a6310187c4c410da902833a) 为基准移植；其[原版在线界面](https://lcx206.github.io/soul-album/)是纯前端规则 Demo。本仓库还保留本地记录服务，并把千问接为统一对话入口：页面只显示本机服务配置的当前模型，不要求用户在“千问／本地规则”间切换或逐句批准。

这是可在手机和电脑浏览器中操作的**本机比赛 Demo**。对话与画册共用 `backend/local/` 的记录领域服务；聊天、未发送草稿及每日档案保存在当前浏览器，刷新可恢复，明确确认清除后删除。每日画册正面为可编辑日记，背面保存完整用户原话、模型回答和有依据的暂定今日肖像，可编辑及下载 `.md`。点击“整理今天”才会发送当天完整有效档案，翻面、浏览和编辑不会调用模型；超出 30,000 字符或 200 条时拒绝整理，不截断原文。本机模型服务可用时，普通聊天仍只发送本句前 800 字及限量的近期已发送上下文，未接入跨日画册检索。未配置服务时规则回退，模型请求失败不伪造回复。浏览器缓存没有加密或跨设备同步，也不会自动写入电脑文件夹；建议下载备份。手表步数、消费记录、应用时长仍是固定演示数据与模拟授权，刷新重置模拟开关，不随聊天发送。此前合成资料实测是历史证据，不代表新版整理质量；送达模型提供方的数据不能通过本机清除撤回。详见[本轮交付与验证](docs/handoff/jianzhi-competition-upgrade-2026-10-01.md)。

输入框旁的麦克风可把最长 30 秒的语音转成**未发送草稿**，经用户查看、修改后才发送。录音和识别在浏览器内完成，不上传至语音服务；首次使用会从本站加载约 67 MB 的 Whisper Tiny 模型与 WASM 文件。模型固定于 [onnx-community/whisper-tiny 的修订 `ff41770`](https://huggingface.co/onnx-community/whisper-tiny/tree/ff4177021cc41f7db950912b73ea4fdf7d01d8e7)，推理由 `@huggingface/transformers@4.3.0` 执行；噪声、设备性能与 Tiny 模型本身会影响中文准确度。浏览器不支持录音时仍可键盘输入。

随站点分发的模型与语音运行时的来源和许可证说明见 [THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt)。

## 运行

队友接手当前 5176 版本请先看[分支、启动与修改入口](docs/handoff/teammate-frontend-2026-10-03.md)。

需要 Node.js 24 和 npm。在本目录执行：

```bash
npm ci
npm run dev
```

若 Windows 上可选的 Node 原生 ONNX 安装脚本失败，可改用 `npm ci --ignore-scripts`；本网页语音使用站内 WASM，已用该安装方式验证前端构建。

打开终端输出的本地地址，通常为 `http://localhost:5173/`。无需账号或 API 密钥。`npm run build` 生成静态构建，`npm run preview` 可预览构建结果。

本地领域服务的纯合成示例可运行：

```bash
npm run demo:backend
```

`backend/local/` 提供消息、日页、编辑删除、来源关联的模型候选题采纳和用户纠正、邀请节奏与逐来源许可等 TypeScript 领域能力；`backend/demo.ts` 在 Node 中演示一次记录及其修订、删除。默认网页通过 `src/domain/browserLocalSession.ts` 调用记录和日页服务，并把演示日期映射成领域服务需要的日期。`InMemorySpaceRepository` 只存当前页面或 Node 进程内数据，退出即清空；它不是加密数据库。网页的邀请节奏与生活数据授权仍由独立演示规则驱动，没有账号、真实设备权限或同步能力。模型只在用户主动发送聊天时调用，不在后台自动分析。

## 模型实验与本机统一对话

无密钥也可检查完整的页面请求和失败回退；`dev:all` 会明确剔除模型密钥，即使启动它的终端原本配置了密钥也只运行规则回退：

```bash
npm run dev:all
```

在 `http://127.0.0.1:5175/?demo=ai` 打开独立阿禾实验页，也可从合成剧情结尾进入。浏览器只向同源 `/api/ai/synthetic-question` 发送 `{ "scenario": "ahe" }`；服务端自行选择固定合成语料。无模型配置时接口返回 `503 model_not_configured`，页面显示明确的规则示例，不把它称为真实 AI 结果。`npm run test` 使用注入的假提供方验证接线、错误、限流和逐字引文检查，不消耗模型额度；这些测试不能证明真实模型的提问质量。

有可用百炼密钥时，在 Windows 上**只需本机保存一次**：运行 `powershell -NoProfile -STA -File scripts/save-qwen-key-gui.ps1 -Region cn`，只在标题为“渐知 · 保存百炼 Key”的独立遮蔽窗口中输入北京地域密钥，**不要在普通终端或聊天中输入**。窗口以 [Windows DPAPI](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/convertfrom-securestring) 加密后保存到当前用户的 `%LOCALAPPDATA%\SoulAlbum\dashscope-cn.dpapi`，仓库中不存密钥；此文件只能由同一台电脑的当前 Windows 账户解密。可运行 `powershell -NoProfile -File scripts/save-qwen-key.ps1 -Region cn -Status` 检查是否存在，或用 `-Remove` 删除本机保存副本；删除后已经运行的服务需重启才能停止使用内存里的旧 Key。密钥需要更换时，先在百炼控制台撤销旧 Key，再重新打开遮蔽窗口覆盖本机副本；只覆盖本地文件不会让旧 Key 失效。其他地域分别用 `intl`、`us`。

之后在**没有密钥的终端**运行 `npm run build:server`；可另开无密钥终端运行 `npm run dev -- --host 127.0.0.1 --port 5175 --strictPort`。最后运行 `powershell -NoProfile -File scripts/run-qwen-local.ps1 -Region cn`：启动器会自动读取已保存的北京地域密钥，若未保存则明确报错而不会要求在终端输入；在运行期间把解密后的 Key 放入启动器与后端 Node 子进程环境变量，正常退出时清理启动器环境变量。仅需临时使用另一枚 Key 时可显式加 `-PromptForKey`，不会覆盖保存值。脚本默认模型是 `qwen-plus`，自动采用 Windows 系统 HTTPS 代理；使用代理时需 Node.js 22.21.0+ 或 24.5.0+。非默认业务空间可用 `-BaseUrl` 指定百炼提供的专属兼容地址。当前机制只用于本机开发，不提供跨设备共享密钥；同一 Windows 用户下运行的程序可能检查运行中进程的环境；强制结束进程也可能跳过清理，因此这不能替代生产凭据管理。

若 `qwen-plus` 免费额度不可用，先在百炼控制台确认北京地域的 `qwen3.8-flash` 仍有足够免费额度；建议在额度未耗尽时开启该模型的“免费额度用完即停”。再运行 `powershell -NoProfile -File scripts/run-qwen-local.ps1 -Region cn -Model qwen3.8-flash -OneCall` 做合成资料试调用。`qwen3.8-flash` 是[官方模型 ID](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)；各模型额度独立，切换模型不会自动发生。不要为已用尽额度的 `qwen-flash` 关闭“免费额度用完即停”来试用：关闭后因没有剩余额度，无法重新开启该保护。详见[百炼免费额度开关规则](https://help.aliyun.com/zh/model-studio/model-usage-statistics)。`-OneCall` 使该次启动最多发起一次上游模型调用尝试，失败也会用掉这次机会；重新启动会重置计数，且此开关不是费用上限。不要把密钥放进 `VITE_` 变量、前端文件、仓库或聊天消息。

旧版曾在主对话里单独提供“让千问提议这一问”的逐次弹窗；该入口已从统一对话中移除。底层 `/api/ai/private-question` 及[历史契约](docs/contracts/private-question-pilot.md)暂保留供合成试验回溯，不是当前产品的发送流程。

要试**连续模型对话**，先按上文保存一次密钥并构建服务与前端，再在单独终端运行 `powershell -NoProfile -File scripts/run-qwen-local.ps1 -Region cn -Model qwen3.8-flash -EnablePrivateChat -MaxCalls 3`。本机服务配置的模型名会显示在对话页；用户直接发送，页面不再要求选择模式或逐句同意。自动请求仅包含本句、同一演示日内最多两条此前实际发给模型且仍有效的用户消息，以及上一条有效模型回复；离线旧句、设备数据和整本画册不会补发。`-MaxCalls 3` 限制本次进程最多三次上游尝试，失败也计数，重启会重置，不能视为费用上限。无服务时明确规则回退；模型请求失败时保留原话但不伪造回复、不自动重试。编辑或删除已发来源会撤下依赖它的模型气泡。详见[统一模型对话契约](docs/contracts/auto-chat-v2.md)。初次验证请只用合成人物，不输入真实私人经历。

服务端只监听本机，端口默认为 `127.0.0.1:8787`；`npm run build:all` 后可用 `npm run start` 从同一服务提供静态页面和接口。现有 GitHub Pages 链接是静态规则版，不承载私人或合成模型接口。若以后公开部署并配置付费密钥，须先另外设计访问控制和运营限额。一次真实试调用的固定输入、模型设置与返回见[阿禾合成资料试调用记录](docs/evidence/2026-09-29-qwen38-flash-synthetic-trial.md)；这不证明自由聊天或长期提问质量。

## 体验路径

1. **对话**：微信式白绿气泡、无气泡内时间、按打开时段主动问候，单一输入框支持文字与语音草稿。当前模型的详细状态收在设置里，离线提示仍可见。演示日需要显式推进，回看历史不会推进时间；“看看今天这一页”直达当天画册。
2. **画册**：桌面保留画册布局，手机单页；“日记正面 / 记录背面”切换、单独编辑日记、Markdown 修改预览及下载均可用。已有日记重新整理后先比较再采用。原话变更撤下旧模型理解，手写日记保留；删除前说明并撤下可能包含该原话的日记及肖像。页面工具保留原话管理、历史依据与主动摘录对照；空白时提供独立合成样例，不写入真实记录。控制回应也归档，但不自动生成日记或肖像。
3. **生活数据**：分别开启手表步数、手机消费记录、应用时长的模拟授权，查看七日图表和数值表；撤回后对应图表立即隐藏。这些数据不会进入私人画册，也不用于判断情绪或健康。

规则回退不声称理解开放式话语的深层意图。有待答问题时，普通消息暂按本轮回应保存；少量明确的完整句子由本地规则识别。模型可直接回应自然话语，但也可能误解，用户可像平常聊天一样纠正；纠正不会自动改写原日记。切换三个页面会保留当前会话与未发送草稿。阿禾合成剧情、独立节奏场景与合成 AI 实验分别在 `?demo=story`、`?demo=rhythm`、`?demo=ai`，均与默认产品会话隔离。

当前界面见[队友版集成截图](docs/evidence/2026-09-29-teammate-frontend-integration.md)，前端结构与行为边界见[接手说明](docs/handoff/frontend.md)。[项目架构](docs/architecture/README.md)、[领域词汇](CONTEXT.md)与 [API v1 协议](docs/contracts/api-v1.yaml)用于前后端协作；浏览器内存记录与日页已有实现，当前聊天发送范围见[统一模型对话契约](docs/contracts/auto-chat-v2.md)。旧的[私人提问](docs/contracts/private-question-pilot.md)及[逐句预览](docs/contracts/private-chat-pilot.md)契约只供回溯。生产级私人云分析与密文同步 HTTP 接口仍未实现。阿禾合成 AI 实验有[独立契约](docs/contracts/ai-experiment.md)和[一次真实调用记录](docs/evidence/2026-09-29-qwen38-flash-synthetic-trial.md)；该记录尚缺不含密钥的原始请求／响应截图。

前端优化可直接修改 `src/features/` 与 `src/styles/`，保留单一对话输入、从有效记录派生画册、逐来源展示模拟数据的行为边界。接入后端前应先核对 API v1 的授权与数据删除约束；当前模拟开关不能直接当作系统权限或云端授权。

## 验证

```bash
npm run test
npm run test:e2e
npm run build
npm run build:backend
npm run build:server
npm run lint
```

浏览器测试使用本机 Chromium；首次运行若缺少浏览器，可执行 `npx playwright install chromium`。独立阿禾合成实验与主对话逐轮聊天各有真实模型调用记录，私人提问路径仍需单独证明；假 provider 回归不能代替真实效果。完整展示佐证、视频、面向评委的安全在线模型服务及正式提交仍在后续阶段。
