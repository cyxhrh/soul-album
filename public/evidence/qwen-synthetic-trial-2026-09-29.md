# 阿禾合成资料：千问真实试调用记录

2026-09-29 18:26:44（中国标准时间），本地服务通过阿里云百炼北京地域的 OpenAI 兼容接口，对 `qwen3.8-flash` 发起**一次**真实请求。接口返回 HTTP 200；服务端完成结构、轻问格式与引文逐字校验。此次只使用虚构人物“阿禾”的固定资料，未发送用户自由区原话、真实健康或设备数据。

## 固定输入与模型设置

- 场景版本：`ahe-v1`，来源：[shared/aheScenario.ts](../../shared/aheScenario.ts)。
- 四条合成片段：
  - `ahe-past-friends`：和朋友吃饭很开心，回家后休息得早。
  - `ahe-past-return`：活动结束后返程过零点，第二天起床很累。
  - `ahe-today-joy`：昨晚见了朋友，聊天很开心。
  - `ahe-today-return`：返程过零点，今天起床才觉得累。
- 已确认上下文：阿禾补充：和朋友相处让我开心，可能是返程太晚。原因尚未确定。
- 系统 Prompt 与请求组装：[server/qwen.ts](../../server/qwen.ts)。要求仅一句温和中文问题、不得诊断或将推测当事实、来源 ID 与完整原话逐字匹配；无法可靠关联时报告失败。
- 模型参数：`qwen3.8-flash`、`temperature: 0.35`、`max_tokens: 256`、`enable_thinking: false`、`response_format: json_object`、非流式。
- 客户端仅提交 `{ "scenario": "ahe" }`；服务器从上述固定语料构造模型输入。密钥只在本地启动器内存和服务端子进程中使用，不在本文或 HTTP 响应中。

## 实际返回

```json
{
  "status": "generated",
  "scenario": "ahe",
  "scenarioVersion": "ahe-v1",
  "question": "阿禾，你提到和朋友相处很开心，但返程过零点后第二天起床很累，这两件事之间有什么联系吗？",
  "citations": [
    { "id": "ahe-today-joy", "quote": "昨晚见了朋友，聊天很开心。" },
    { "id": "ahe-today-return", "quote": "返程过零点，今天起床才觉得累。" }
  ],
  "model": { "provider": "qwen", "id": "qwen3.8-flash" },
  "generatedAt": "2026-09-29T10:26:44.613Z"
}
```

人工复核：两条引文均与固定片段逐字相同；问题语气温和，能把今天的开心与疲劳联系成一个可由用户回应的追问，没有直接下诊断。它仍有“二者可能相关”的暗示；因阿禾只是猜测返程时间可能造成疲劳，这个问题应被视为**待用户确认的提议**，不能自动写入用户画像为既定因果。

## 复现与边界

在不含密钥的终端运行 `npm run build:server`。在本机 PowerShell 运行 `powershell -NoProfile -File scripts/run-qwen-local.ps1 -Region cn -Model qwen3.8-flash -OneCall`，只在该窗口输入未公开的新 Key。随后向 `http://127.0.0.1:8787/api/ai/synthetic-question` 发送 `Content-Type: application/json` 的 POST，正文仅为 `{ "scenario": "ahe" }`。启动器限制本次服务至多一次上游尝试；请求后停止服务。本次调用结束后服务已停止。

这条记录保存了真实响应文本及其固定输入、参数与时间；目前没有一张不含密钥的原始请求／响应截图。它记录了本次真实调用的结果，但尚缺可供独立复核的原始截图，不能单独作为完整的赛事展示素材，也不能证明开放输入、真实用户数据或长期提问质量。
