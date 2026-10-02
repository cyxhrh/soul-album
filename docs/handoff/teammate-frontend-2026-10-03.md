# 渐知前端：队友接手入口

本次交付对应 5176 的当前前端，2026-10-03 上传到 `cyxhrh/soul-album`。

- 开发分支：`codex/teammate-frontend-integration`
- 现有 PR：https://github.com/cyxhrh/soul-album/pull/5
- [功能、验证与截图](jianzhi-competition-upgrade-2026-10-01.md)
- [当前对话与每日整理接口](../contracts/auto-chat-v2.md)

## 拉取与启动

建议 Node.js 24。首次下载：

```sh
git clone --branch codex/teammate-frontend-integration https://github.com/cyxhrh/soul-album.git
cd soul-album
npm ci --ignore-scripts
npm run dev -- --host 127.0.0.1 --port 5176
```

已有仓库时，先保留自己的未提交工作，再切到该分支并拉取。默认地址为 http://127.0.0.1:5176/ 。无需模型密钥即可修改前端、体验离线聊天、查看合成画册、编辑日记及下载 Markdown。

## 修改入口

| 内容 | 文件 |
| --- | --- |
| 对话、导航、记录管理与画册整合 | `src/features/free/FreeTrial.tsx` |
| 联系人头像与图标 | `src/features/free/ChatIdentity.tsx` |
| 分时段开场文案 | `shared/chatOpening.ts` |
| 画册正反面、生成采用、编辑与下载 | `src/features/album/DailyAlbum.tsx` |
| 完整对话收录与修订、Markdown 格式 | `src/features/album/dailyArchive.ts`、`dailyRecord.ts` |
| 聊天与画册样式 | `src/styles/messenger.css`、`daily-album.css`；基础样式 `product.css` |
| 本机缓存验证与恢复 | `src/features/free/sessionPersistence.ts`、`freeSessionCache.ts` |
| 本日整理请求与输出类型 | `shared/dailyAlbum.ts` |

## 接口与验证

Vite 将 `/api` 代理到 `127.0.0.1:8787`。需要真实模型聊天或“整理今天”时，按仓库 README 启动本机 Qwen 服务；缺少服务时页面保留记录与编辑能力，明确显示离线。密钥和本机用户数据不在本次交付中。

保持普通聊天与每日整理发送范围不同：聊天本句片段最多 800 字；每日整理发送当天完整有效对话，最多 30,000 字符、200 条。翻面、编辑与下载不能自动调用模型；改动来源后不能保留过时肖像或迟到模型回应。

本次上传前重新运行 `npm test`（342 项通过）及 `npm run build:all`（通过）。上一轮浏览器已验证 57 个不同场景，截图使用合成示例；真实模型生成质量尚未实测。

修改后可按影响范围运行组件测试及 `tests/daily-album.spec.ts`、`tests/messenger.spec.ts`。完整本地检查为 `npm test`、`npm run build:all`、`npm run lint`。

当前版本保留每日档案有效修订，尚未接入跨日记忆、账号或跨设备同步。浏览器刷新会恢复聊天与草稿；清除需确认，不能静默丢失已保存内容。

## 知知形象更新（2026-10-03）

产品名保持“渐知”，AI 记录伙伴更名为“知知”。顶部联系人、开场白、聊天回答统一使用用户设计的黄色毛绒画册形象；头像已去除黑色背景，保留眼镜、蝴蝶结和圆角本子轮廓，资源为 `src/assets/zhizhi-avatar.png`。

画册展示及新导出的 Markdown 使用“知知”署名。编辑器仍接受以前的“小册回答”标题，历史用户原文和模型回答不作替换。

本轮验证：343 项单元/组件测试通过；聊天开场与输入交互的 8 个浏览器场景通过；前端构建及 lint 通过。实际桌面与 375px 手机预览见 [桌面截图](evidence/zhizhi-2026-10-03/desktop.png)、[手机截图](evidence/zhizhi-2026-10-03/mobile.png)。未调用真实模型。

## 合入队友伙伴与语音前端（2026-10-03）

合并来源：[LCX206 的前端分支](https://github.com/LCX206/soul-album/tree/codex/teammate-frontend-integration)，提交 `8bea9b1`。保留队友提交历史，将伙伴切换、三个新形象、电话入口、独立语音页面和转写接入现有聊天的流程合入本分支。

合并后的默认伙伴仍为“知知”，同时可以切换“小笺”“知墨”“慢慢”；头像、联系人名称、开场白标签和输入状态随选择同步。原画册正反面、Markdown 旧署名兼容、后端请求边界及聊天缓存恢复保留。手机伙伴菜单按聊天顶部定位，修复新增第四个选项后出现的左侧裁切。

语音页面使用本机录音识别，转写后自动通过原聊天入口发送，退出会释放录音资源并保留文字草稿。回复目前以文字展示，未增加语音合成。伙伴选择仅当前页面有效，刷新后恢复默认“知知”。

验证：343 项单元/组件测试、25 个相关浏览器场景通过；前端构建和 lint 通过。浏览器覆盖伙伴切换、320px 菜单边界、模拟语音转写及发送、退出时释放迟到麦克风、原聊天请求、画册编辑下载与缓存恢复。本轮未使用真实麦克风或真实模型验证语音识别质量。

实际预览：[桌面伙伴菜单](evidence/teammate-merge-2026-10-03/companions-desktop.png)、[手机伙伴菜单](evidence/teammate-merge-2026-10-03/companions-mobile.png)、[手机语音页面](evidence/teammate-merge-2026-10-03/voice-mobile.png)。
