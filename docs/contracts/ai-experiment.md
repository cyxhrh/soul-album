# 下一阶段：受限合成 AI 提问接口契约

**状态：设计契约，尚未实现或调用。** 本接口只用于可复核的阿禾合成数据实验，不接收自由试用正文，不提供账号同步。当前网页仍是纯前端规则 Demo；真实模型成功调用和证据需要另行完成。

## 请求

`POST /api/ai/synthetic-question`，同源 HTTPS，`Content-Type: application/json`。唯一可接受的 JSON 对象是：

```json
{ "scenario": "ahe" }
```

服务端严格校验对象、字段和值：缺失、未知字段、数组、非字符串或除 `ahe` 外的值一律 `400 invalid_request`。不得接受 `prompt`、`answer`、`entries`、`userId`、自由文本、客户端指定模型或客户端给出的引文。服务端按 `scenario` 从固定、版本化的阿禾合成语料选择输入与来源 ID，构造 Prompt；客户端只发场景标识。服务端对请求频率和模型调用次数设限，并设置超时；不在 URL、访问日志、错误日志或埋点记录语料正文、Prompt、响应正文与密钥。

## 成功响应

成功只表示**这一次真实模型调用**完成，且服务端通过结构和引用校验；不代表问题的语义判断已获用户确认。`200` 响应示意（占位模型名和时间只是格式示例，不是调用证据）：

```json
{
  "status": "generated",
  "scenario": "ahe",
  "scenarioVersion": "ahe-v1",
  "question": "返程过零点后，今天的作息有什么变化？",
  "citations": [
    {
      "id": "ahe-today-return",
      "quote": "返程过零点，今天起床才觉得累。"
    }
  ],
  "model": { "provider": "configured-provider", "id": "configured-model-id" },
  "generatedAt": "2026-09-28T00:00:00Z"
}
```

`generatedAt` 是服务端生成的 RFC 3339 时间。`citations` 至少一项，每项 ID 必须指向本次服务端选定、当前有效的合成片段；`quote` 必须与该片段的**完整原话逐字相同**。服务端还要校验问题为单句轻问、长度上限、无外部工具指令、无未经证实的心理或医疗判断。对未找到可靠关联、引用 ID 不存在、引文不逐字匹配、输出结构无效、过时结果，均不得返回 `generated`。接入页面时，要在应用当前版本的语料与授权状态上再次核对引用，状态已改变就丢弃旧响应。模型输出始终是待确认的提议。

## 失败与规则回退

错误统一为 JSON，不回传上游原始错误、Prompt、密钥或合成语料：

```json
{
  "status": "error",
  "code": "model_timeout",
  "message": "合成提问暂时不可用，请使用规则问题。"
}
```

| HTTP | `code` | 含义 |
| --- | --- | --- |
| 400 | `invalid_request` | 请求不是严格的 `{ "scenario": "ahe" }`。 |
| 429 | `rate_limited` | 本地实验限流或调用次数已达上限。 |
| 503 | `model_not_configured`、`model_unavailable` | 服务端缺少模型配置或上游不可用。 |
| 504 | `model_timeout` | 上游超时；不自动重发。 |
| 502 | `invalid_model_output` | 结构、长度、引用或内容校验未通过。 |
| 422 | `no_reliable_citation` | 模型未能给出可验证的合成原话关联。 |

UI 收到任何错误、网络中断或过时响应时，可以显示预设的中性轻问，但必须标成“规则模式／模型未生成”，不能计入真实 AI 成功证据。响应建议设置 `Cache-Control: no-store`。模型密钥仅由服务端环境持有，不进入 Vite 环境变量、前端包、浏览器响应或提交文件。自由区原话上传、逐次云端授权、真实设备连接与跨设备账号同步均不属于此接口；若以后设计这些能力，须另立数据流和授权契约。

实际 AI 佐证应另存固定合成输入版本、Prompt、模型配置名称、调用时间、经过校验的输出、无密钥的请求／响应截图和复现步骤。规则回退或本文件中的示例 JSON 都不能代替一次真实调用。
