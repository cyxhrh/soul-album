# 魔搭实践内容发布材料

更新：2026-10-05。魔搭文章已发布：[渐记｜让 AI 更了解你，也让你更了解自己](https://modelscope.cn/posts/437111)，关联创空间 `Cy189789/jianji`。比赛“实践内容”选填项使用该正式规范地址。匿名 HTTP 验收通过：无 Cookie 请求最终返回 200，HTML 包含文章标题、两图文件名、原片文件名、Demo 域名与 `qwen3.8-flash`；具体字段及原详情地址的有效跳转记录见 [media-manifest.json](media-manifest.json)。比赛最终表单尚未提交。

公开详情页 DOM 已核对：标语后为主海报 GitHub 文件链接，未来计划段后为产品长图 GitHub 文件链接，文末提供完整 90 秒原片下载。文章没有内嵌图片或视频；自定义封面上传亦未成功，最终使用平台默认 `learn_cyan.png` 封面。未完成的媒体占位与测试文本已清除。

## 可直接使用的内容

| 内容 | 文件或链接 |
| --- | --- |
| 标题 | 渐记｜让 AI 更了解你，也让你更了解自己 |
| 摘要 | 通过轻松对话留下生活片段，在画册中回看、补充与纠正。固定流程 Demo 展示产品体验，真实千问实验说明 AI 实践与当前完成程度。 |
| 实践内容提交链接 | https://modelscope.cn/posts/437111 |
| 文章正文 | [article.md](article.md)，已对齐并核对实际公开正文与链接位置 |
| 主宣传图 | [jianji-poster.png](assets/jianji-poster.png)，1086 × 1448；文章仅提供 GitHub 文件链接 |
| 产品介绍长图 | [jianji-product-story.png](assets/jianji-product-story.png)，750 × 4952；编辑器上传后公开文章未显示，最终改用已核对的 GitHub 文件链接 |
| 用户选定的视频 | [90 秒宣传片](https://github.com/cyxhrh/soul-album/releases/download/submission-2026-10-05/jianji-promo-v4-creative-minds-2026-10-05.mp4)，原文件字节未修改 |
| 本项完整下载包 | [图文视频材料 ZIP](https://github.com/cyxhrh/soul-album/releases/download/submission-2026-10-05/jianji-spotlight-materials-2026-10-05.zip)，原准备快照，发布记录待同步更新 |
| 素材核对 | [media-manifest.json](media-manifest.json)，文件规格、SHA256 及用户授权确认 |

用户于 2026-10-05 明确确认：“已取得，可以公开使用这版视频”。本包按该确认使用选定的 Creative Minds 配乐版，未替换配乐，也未审核授权证明文件。旧视频目录中的“本地预览”说明属于确认前的历史记录，原文件保持不变。

## 媒体上传记录

实际编辑器已核实支持本地 mp4 / mov / webm，单文件最大 2 GB。35,065,008 字节原片的最终上传尝试停在 88.5%，控制台出现 `Uncaught (in promise) undefined`，未完成原生嵌入。

随后生成 `jianji-promo-upload.mp4` 技术副本：11,555,797 字节（11.56 MB），保留完整 90 秒、1920 × 1080、30 fps、2700 帧，使用 H.264 重压缩和 faststart，AAC 音轨直接复制。音轨数据包 SHA256 与原片一致，全片解码无错误，原片保持不变；副本 SHA256 与来源记录见 [media-manifest.json](media-manifest.json)。副本在重建视频组件、保存和重载后仍报错且未开始传输，未上传成功、未公开发布，也未验证平台原生播放。

长图在编辑器完成上传后，公开文章仍未显示；不能据上传完成推定发布成功。自定义封面上传亦失败，最终使用平台默认封面。上述是本次操作结果，不代表平台不支持这些媒体格式。文末视频下载仍指向已获用户公开授权的完整原片。

## 提交与复核

1. [实际发布文章](https://modelscope.cn/posts/437111)的公开正文 DOM 与匿名 HTTP 已核对；提交前可再次打开标题、两张图片的 GitHub 文件链接、原片下载链接与 Demo 入口确认可用。
2. 比赛“实践内容”填 `https://modelscope.cn/posts/437111`；应用字段继续填 [Cy189789/jianji 创空间](https://modelscope.cn/studios/Cy189789/jianji)。不要以 MP4 下载地址代替文章地址。
3. 如需后续编辑，从 [开发者实践 / Spotlight](https://modelscope.cn/spotlight)的可见入口进入；官方“创建内容”链接为 [创建页](https://modelscope.cn/learn/create)。本次发布已完成，不必另建重复文章。

官方 [ms-cookbook 中文说明](https://github.com/modelscope/ms-cookbook/blob/main/README.zh-CN.md#参与共建)也给出“开发者实践 → 创建内容”的路径。当前已核对的 `modelscope-hub` 0.4.5 官方 CLI / OpenAPI 未发现文章创建或发布功能，本包不提供猜测的发帖命令。

比赛最终表单尚未提交；原生图片展示与视频播放不在本次已完成项中。
