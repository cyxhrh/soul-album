# 渐记｜让 AI 更了解你，也让你更了解自己

我们每天接收海量外界信息，却容易忽略自己的感受：今天为什么疲惫？哪些事情让自己开心？生活中又有哪些变化一直没被留意？

渐记是一款通过轻松对话记录生活、帮助用户了解自己的 AI 伙伴原型。我们希望伙伴每天先提出一个容易回答的问题，再结合你的讲述继续交流；经历与感受留在画册中，随时回看、补充与纠正。

**渐记日常，渐见自己。**

[查看渐记产品宣传图](https://github.com/cyxhrh/soul-album/blob/codex/teammate-frontend-integration/docs/submission/2026-10-05/spotlight/assets/jianji-poster.png)

当前在线 Demo 展示对话记录、原话核对、理解修订、画册回看与日常数据。点击五次“发送”即可完成体验。对话与数据均为合成预设示例，回复不实时生成，尚未接入真实设备或账单。

2026 年 9 月 29 日，我们以虚构人物“阿禾”的固定记录完成了一次真实千问 `qwen3.8-flash` 调用：模型联系生活细节提出问题，同时返回两条原话依据；服务端校验回复结构、问题格式与引文逐字一致。实验输入、实际返回与参数见[公开实验记录](https://github.com/cyxhrh/soul-album/blob/codex/teammate-frontend-integration/public/evidence/qwen-synthetic-trial-2026-09-29.md)。这次实验验证固定资料下的调用与校验过程，不代表长期提问质量已经验证。

后续将结合过往记录，提出情绪与行为变化的线索，由用户确认和修正；逐步接入经授权的手机、穿戴和办公记录。持续跨日模型检索与真实设备接入仍在后续开发计划中。

![产品长图：对话、画册与日常数据](https://resources.modelscope.cn/race/image/77d4396d-1297-4661-a922-c4f36fdd0422.png)

渐记宣传片 · 90 秒 · 1920 × 1080

宣传图为产品设计展示，视频包含界面演示与合成情境。当前完成程度以在线 Demo、源码与实验记录为准。

[下载完整宣传片（90 秒）](https://github.com/cyxhrh/soul-album/releases/download/submission-2026-10-05/jianji-promo-v4-creative-minds-2026-10-05.mp4)

[直接体验渐记](https://cy189789-jianji.ms.show/) · [魔搭创空间项目页](https://modelscope.cn/studios/Cy189789/jianji)

面向“智能日常”赛道，渐记希望让 AI 成为持续理解生活的伙伴，让你在记录中看见自己。
