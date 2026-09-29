# 心灵画册 · 产品 Demo 与本地后端核心

“每天问一点，慢慢看见自己”。打开应用即进入对话：首页用气泡消息记录日常，画册翻看已有记录，生活数据页展示逐项开启的模拟图表。这个阶段先确认产品本身的交互与功能，暂不制作作品介绍页。

在线体验：[GitHub Pages 前端 Demo](https://cyxhrh.github.io/soul-album/)；队友可从[公开源码仓库](https://github.com/cyxhrh/soul-album)获取代码。

这是可在手机和电脑浏览器中操作的**本地内存 Demo**。默认对话与画册共用 `backend/local/` 的记录领域服务，经浏览器适配层在当前页面内存中运行；默认提问由本地规则生成。本机另有可选的逐轮千问聊天：用户的自然语言先保存在本页，每轮查看并同意后才会发送所选片段并等待模型回应。原有“让千问提议这一问”仍是独立试验。[本机主对话的合成资料实测](docs/evidence/2026-09-29-private-chat-synthetic-trial.md)完成了两轮浏览器真实回复和一次纠正轮次的独立接口复测；这不代表长期对话质量。手表步数、手机消费记录和应用时长仍是固定演示数据及模拟授权。没有真实设备连接、账号、跨设备同步、用户记录的加密存储或长期保存。未发送的输入、草稿和开关状态只在当前页面内存中，刷新、关闭或点“清除”后消失；**已明确同意交给百炼的片段可能由提供方保存**。请不要把它当作正式日记存储。

## 运行

需要 Node.js 24 和 npm。在本目录执行：

```bash
npm ci
npm run dev
```

打开终端输出的本地地址，通常为 `http://localhost:5173/`。无需账号或 API 密钥。`npm run build` 生成静态构建，`npm run preview` 可预览构建结果。

本地领域服务的纯合成示例可运行：

```bash
npm run demo:backend
```

`backend/local/` 提供消息、日页、编辑删除、来源关联的模型候选题采纳和用户纠正、邀请节奏与逐来源许可等 TypeScript 领域能力；`backend/demo.ts` 在 Node 中演示一次记录及其修订、删除。默认网页通过 `src/domain/browserLocalSession.ts` 调用记录、日页及问句服务，并把演示日期映射成领域服务需要的日期。`InMemorySpaceRepository` 只存当前页面或 Node 进程内数据，退出即清空；它不是加密数据库。网页的邀请节奏与生活数据授权仍由独立演示规则驱动，没有账号、真实设备权限或同步能力；可选模型提问和逐轮聊天都要逐次授权，不是后台自动分析。

## 模型实验与本机可选提问

无密钥也可检查完整的页面请求和失败回退；`dev:all` 会明确剔除模型密钥，即使启动它的终端原本配置了密钥也只运行规则回退：

```bash
npm run dev:all
```

在 `http://127.0.0.1:5175/?demo=ai` 打开独立阿禾实验页，也可从合成剧情结尾进入。浏览器只向同源 `/api/ai/synthetic-question` 发送 `{ "scenario": "ahe" }`；服务端自行选择固定合成语料。无模型配置时接口返回 `503 model_not_configured`，页面显示明确的规则示例，不把它称为真实 AI 结果。`npm run test` 使用注入的假提供方验证接线、错误、限流和逐字引文检查，不消耗模型额度；这些测试不能证明真实模型的提问质量。

有可用百炼密钥时，在 Windows 上**只需本机保存一次**：运行 `powershell -NoProfile -STA -File scripts/save-qwen-key-gui.ps1 -Region cn`，只在标题为“心灵画册 · 保存百炼 Key”的独立遮蔽窗口中输入北京地域密钥，**不要在普通终端或聊天中输入**。窗口以 [Windows DPAPI](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/convertfrom-securestring) 加密后保存到当前用户的 `%LOCALAPPDATA%\SoulAlbum\dashscope-cn.dpapi`，仓库中不存密钥；此文件只能由同一台电脑的当前 Windows 账户解密。可运行 `powershell -NoProfile -File scripts/save-qwen-key.ps1 -Region cn -Status` 检查是否存在，或用 `-Remove` 删除本机保存副本；删除后已经运行的服务需重启才能停止使用内存里的旧 Key。密钥需要更换时，先在百炼控制台撤销旧 Key，再重新打开遮蔽窗口覆盖本机副本；只覆盖本地文件不会让旧 Key 失效。其他地域分别用 `intl`、`us`。

之后在**没有密钥的终端**运行 `npm run build:server`；可另开无密钥终端运行 `npm run dev -- --host 127.0.0.1 --port 5175 --strictPort`。最后运行 `powershell -NoProfile -File scripts/run-qwen-local.ps1 -Region cn`：启动器会自动读取已保存的北京地域密钥，若未保存则明确报错而不会要求在终端输入；在运行期间把解密后的 Key 放入启动器与后端 Node 子进程环境变量，正常退出时清理启动器环境变量。仅需临时使用另一枚 Key 时可显式加 `-PromptForKey`，不会覆盖保存值。脚本默认模型是 `qwen-plus`，自动采用 Windows 系统 HTTPS 代理；使用代理时需 Node.js 22.21.0+ 或 24.5.0+。非默认业务空间可用 `-BaseUrl` 指定百炼提供的专属兼容地址。当前机制只用于本机开发，不提供跨设备共享密钥；同一 Windows 用户下运行的程序可能检查运行中进程的环境；强制结束进程也可能跳过清理，因此这不能替代生产凭据管理。

若 `qwen-plus` 免费额度不可用，先在百炼控制台确认北京地域的 `qwen3.8-flash` 仍有足够免费额度；建议在额度未耗尽时开启该模型的“免费额度用完即停”。再运行 `powershell -NoProfile -File scripts/run-qwen-local.ps1 -Region cn -Model qwen3.8-flash -OneCall` 做合成资料试调用。`qwen3.8-flash` 是[官方模型 ID](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)；各模型额度独立，切换模型不会自动发生。不要为已用尽额度的 `qwen-flash` 关闭“免费额度用完即停”来试用：关闭后因没有剩余额度，无法重新开启该保护。详见[百炼免费额度开关规则](https://help.aliyun.com/zh/model-studio/model-usage-statistics)。`-OneCall` 使该次启动最多发起一次上游模型调用尝试，失败也会用掉这次机会；重新启动会重置计数，且此开关不是费用上限。不要把密钥放进 `VITE_` 变量、前端文件、仓库或聊天消息。

若要在**本机**试验默认对话中的千问提问，先按上文保存一次密钥、构建服务并启动前端，再使用 `powershell -NoProfile -File scripts/run-qwen-local.ps1 -Region cn -Model qwen3.8-flash -EnablePrivateQuestions -OneCall`。`-OneCall` 把这次进程的上游调用尝试限制为一次，重新启动才会重置；`-Region cn` 只是示例配置，实际地域需与密钥和百炼模型地址一致。只配置密钥不加 `-EnablePrivateQuestions` 不开启私人端点；启用后仍须在网页弹窗查看实际请求并点“同意并发送这一次”。默认网页先给本地规则题；选定一段至少 6 字、至多 800 字的原话连续片段后，浏览器向本机 `/api/ai/private-question` 发送片段、来源 ID 与修订号，本机服务向百炼发送片段与来源 ID。代理检查格式；浏览器发送前与响应后、领域服务采纳时检查来源是否还是当前修订。可在弹窗内删减片段，不能改写成原话以外的句子。若采纳千问候选题，本次获准发送的精确片段随题目保存在页面内存，当前题和已回答历史题都可展开证据核对；修改或删除来源会撤下失效题干并清除片段副本。发送前取消是零请求；发送后取消会放弃结果并尝试中止未完成的上游调用，但已传出的内容无法撤回，也可能计费。拒绝或模型失败时规则题仍可使用，不会自动重试。百炼的[隐私说明](https://help.aliyun.com/zh/model-studio/privacy-notice)称不将客户数据用于模型训练，也明确会存储模型与应用调用产生的数据。此处请只用合成记录测试，不输入实际私人经历来验证链路。

要试真正的**连续模型对话**，在本机主对话顶部切换到“千问聊天”；这个模式不受当天邀请题数限制。先按上文保存一次密钥、构建服务、启动本机前端，再在单独的终端运行 `powershell -NoProfile -File scripts/run-qwen-local.ps1 -Region cn -Model qwen3.8-flash -EnablePrivateChat -MaxCalls 3`，此后启动不会反复要求输入 Key。`-MaxCalls 3` 限制本次进程最多三次上游尝试，失败也计数，重启会重置，不能视为费用上限。每条用户话先在本页保存，再显示完整请求预览：本句的一段原话、勾选的最多两条旧片段和上一轮模型回应（如选择携带）。取消预览不会发请求；同意后模型生成一段聊天回复和可选追问。下一轮需重新预览授权。无服务、断网、取消或模型失败时，不会出现伪造的千问回复；本地原话仍可在画册查看。编辑或删除已发来源会撤下依赖它的模型气泡。详见[逐轮对话契约](docs/contracts/private-chat-pilot.md)。仅用合成人物验证；不输入真实私人经历。

服务端只监听本机，端口默认为 `127.0.0.1:8787`；`npm run build:all` 后可用 `npm run start` 从同一服务提供静态页面和接口。现有 GitHub Pages 链接是静态规则版，不承载私人或合成模型接口。若以后公开部署并配置付费密钥，须先另外设计访问控制和运营限额。一次真实试调用的固定输入、模型设置与返回见[阿禾合成资料试调用记录](docs/evidence/2026-09-29-qwen38-flash-synthetic-trial.md)；这不证明自由聊天或长期提问质量。

## 体验路径

1. **对话**：只有一个消息框。本地规则模式允许直接回答或随时留言；输入“换个问题”或“今天先不聊了”可体验明确话语的规则演示，无需选择“回答／分享／跳过”模式。本机切到“千问聊天”后可自由开场并连续接话，不受每日邀请题数限制，每轮均有独立发送预览。用户原话以气泡呈现并进入画册；模型回复只作为有来源的聊天气泡显示，不写成用户记录。演示日需要在“邀请节奏与演示日期”中显式推进，翻看旧记录不会推进时间。
2. **画册**：回答后切换到画册，查看当天的原话、时间和来源；可改标题、修改或删除原话。若在较晚的演示日纠正一条引用旧日原话的模型问题，纠正记在**实际纠正日**的画册，依据仍链接旧日原话；即使当天没有新回答，也能翻到纠正页；同一天多次纠正会逐条显示。旧日来源改写或删除后，依赖它的纠正从纠正日撤下。从当前页和更早一页各**主动选择**一条记录，才能并排看摘录；主动分享也可选，系统不替你判断话题是否相关或变化原因。可在提醒后打印当前页；没有有效记录或纠正时显示空状态。
3. **生活数据**：分别开启手表步数、手机消费记录、应用时长的模拟授权，查看七日图表和数值表；撤回后对应图表立即隐藏。这些数据不会进入私人画册，也不用于判断情绪或健康。

本地规则模式不声称理解开放式话语的深层意图。有待答问题时，普通消息暂按本轮回应保存；若想在问题中途明确另记一件事，可说“随手记：下班时看到了晚霞”。只有少量明确的完整句子由本地规则识别；旧的可选千问提问仅提议一条后续问题。独立的“千问聊天”让模型直接对自然话语作答，但它的解释可能有误，用户可像平常聊天一样纠正；纠正不会自动改写原日记。切换三个页面会保留当前会话与未发送草稿。阿禾合成剧情、独立节奏场景与合成 AI 实验分别在 `?demo=story`、`?demo=rhythm`、`?demo=ai`，均与默认产品会话隔离。

当前界面见[交接截图](docs/handoff/evidence/README.md)，前端结构与行为边界见[接手说明](docs/handoff/frontend.md)。[项目架构](docs/architecture/README.md)、[领域词汇](CONTEXT.md)与 [API v1 协议](docs/contracts/api-v1.yaml)用于前后端协作；浏览器内存记录与日页已有实现，本机单片段私人提问见[独立接口契约](docs/contracts/private-question-pilot.md)，连续模型聊天见[逐轮对话契约](docs/contracts/private-chat-pilot.md)。生产级私人云分析与密文同步 HTTP 接口仍未实现。阿禾合成 AI 实验有[独立契约](docs/contracts/ai-experiment.md)和[一次真实调用记录](docs/evidence/2026-09-29-qwen38-flash-synthetic-trial.md)；该记录尚缺不含密钥的原始请求／响应截图。

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
