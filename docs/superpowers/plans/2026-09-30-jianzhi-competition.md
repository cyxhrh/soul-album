# 渐知比赛体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在 5176 已集成版本上完成统一视觉与每日画册正反面，让真实聊天可整理、保存、修改和下载。
**Architecture:** 现有聊天领域保持兼容。每日档案独立模块管理 Markdown；新本日整理端点复用现有本机模型保护、限额和超时。浏览器保存当前会话及档案，默认不提供跨日检索。
**Tech Stack:** React 19、TypeScript、Vite、Node HTTP、现有 Qwen provider；不增加依赖。
**Spec:** ../../handoff/daily-album-two-sides-design-2026-09-30.md；本轮会话中已确认的六项前端方案。

## Global Constraints

- 产品名称渐知；聊天伙伴小册；画册是功能名称。
- 保留微信式气泡、无气泡内时间、分时段开场和现有后端能力。
- 正面精简日记，背面完整用户/模型记录及有证据的暂定今日肖像。
- 切页、翻面、查看与编辑不调用模型；只由“整理今天”发送本日完整有效记录。
- 合成示例明确标记，不混入真实用户档案；模型失败不伪造生成结果。
- 用户修订和原始模型输出区分，来源变化撤下旧推断；删除需清理派生记录。
- 在当前既有 codex/teammate-frontend-integration 工作树实施，不覆盖已有变更，不提交、不推送。

## Review Focus

- 消息中包含 Markdown 标题、围栏、HTML 时仍原样保留且不执行。
- 生成期间修改/删除来源、清除或切换日期，旧结果不能写入新档案。
- 保存空间不足、损坏档案、刷新恢复、多个页面同时打开时不得静默宣称保存成功。
- 长输入尾部不能被摘要请求截断；超限请求需明确失败。
- 手机键盘、长文、减少动效、仅键盘操作与打印时内容仍可读取。

## Task 1: 本日整理接口

Files: shared/dailyAlbum.ts; server/daily-album.test.ts; server/http.ts; server/qwen.ts; server/index.ts.
Interfaces: DailyMessage { id, role: user|assistant|system, text, recordedAt, revised?: boolean }; DailyAlbumRequest {date,messages}; DailyAlbumContent {title,diary,portrait:{facts:string[],feelings:string[],observations:{text,evidenceIds:string[]}[],uncertainties:string[]}}; DailyAlbumResponse adds status:generated, model:{provider,id}, generatedAt.
- [x] 写并运行验证输入限额、角色、重复 ID、输出引用真实性的失败测试。
- [x] 实现 POST /api/ai/daily-album；共享 loopback/origin/限额/超时保护，完整输入最多 30000 字符、200 条消息，超限拒绝不截断。
- [x] 添加 provider 与输出校验，只接受引用用户消息 ID 的观察；测试通过。

## Task 2: 每日档案与 Markdown

Files: src/features/album/dailyRecord.ts, dailyRecord.test.ts.
Interfaces: DailyRecord {version:1,date,revision,sourceFingerprint,title,diary,portrait,messages,generatedAt?,model?,userEdited:boolean}; createDailyRecord(date,messages), serializeDailyRecord(record), parseDailyRecord(markdown,baseline), fingerprintMessages(messages).
- [x] 写并运行中文、围栏、修改、非法结构和角色变更的失败测试。
- [x] 实现不依赖模型的完整档案创建、Markdown 导出与安全编辑解析；结构化元数据和角色不可通过编辑伪造，文本可改并标记用户修订。
- [x] 为来源变更后的摘要撤回提供可靠 fingerprint，测试往返及超限。

## Task 3: 本机恢复

Files: backend/local/store.ts; src/domain/browserLocalSession.ts; src/features/free/sessionPersistence.ts; 相应 tests.
- [x] 在失败测试中覆盖完整快照恢复、时区和 ID 保持、损坏存储与保存失败。
- [x] 为内部生成的本机快照增加验证与恢复；提供独立、版本化的会话缓存读取/写入/清除帮助函数，不自动同步外部目录。
- [x] 不改变调用服务的领域接口；恢复后的新操作继续按原修订约束工作。

## Task 4: 页面整合与视觉

Files: FreeTrial.tsx; 新 DailyAlbum.tsx、daily-album.css；messenger.css；相关界面测试。
- [x] 接入会话与草稿保存、清除确认、当前档案保存；显示真实保存状态。
- [x] 接入真实完整聊天与模型回答、正反面切换、编辑 Markdown、下载、生成与对照采用；正面可单独编辑。
- [x] 统一植物绿、浅灰和纸色；模型详情收进更多菜单，离线/异常仍可见；移动端保持可用。
- [x] 空画册给出明确合成预览；既有原话管理/对照保持可达；增加“看看今天这一页”。
- [x] 新增可重置的独立合成展示页，和真实档案隔离。

## Task 5: 验证与交付

- [x] 有意义的单元/接口/组件测试；build:all、lint。
- [x] 浏览器检查桌面和手机，实际截图前后页；真实用户内容不用于付费试验。
- [x] 核实独立代码审阅的初步发现并修复确认缺陷，更新交付与限制说明；全面独立复审未完成，见交付限制。

## 执行记录

- 用户已明确要求整理并开始；无需再次申请开发许可。
- Ruling: 保留当前工作树和所有未提交工作，不自动 commit — 避免把队友和此前变更混入本轮提交。
- Ruling: 子代理按文件所有权承担独立模块，主代理负责页面整合与验证 — 互不覆盖同一模块。
- 2026-10-01：完成五项核心实施任务。历史回退暂缓，当前为有效修订与采用前比较；独立合成展示整合在空画册内，避免额外添加主导航。完整交付与验证见 `../../handoff/jianzhi-competition-upgrade-2026-10-01.md`。
