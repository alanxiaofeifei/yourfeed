# Save discoveries to your knowledge library · 保存到自己的知识库

## Markdown downloads

Every content card in the feed and Favorites has a **Download Markdown** action. Choose:

- **Source content:** the text already available in this instance, with its original title, URL, source and publication time. RSS excerpts, news extracted from a newsletter, video descriptions and project metadata are identified as such. The download does not fetch unavailable full text or create a video transcript.
- **AI notes:** existing AI reading notes, including key points, personal relevance, evidence coverage, model and source references. Generate the notes from the reading view first if none exist. Downloading does not invoke a model or incur new AI usage.

The `.md` file is created in your browser and saved locally. You can import it into your own knowledge tools. AI notes can contain personal relevance information; review the file before sharing it with other people or services.

**Share** copies the original content URL, so recipients can visit the source without an account on your private feed. It does not share your profile, saved state, API settings or AI notes. Source websites may still require their own account or region access.

For Google Notebook / NotebookLM, see [the integration guide](notebook.md). Copy-and-open is available without integration credentials. Direct import requires separate Google consent and API setup; signing in with Google does not grant permission to write to notebooks.

## AI profile suggestions

In **Preferences & AI → My profile**, below the topic weights, choose the AI profile action. It uses the preferences currently in the form, enabled-source topic counts and topic-level feedback statistics, including feedback on manually saved links. Disabled or blocked sources are excluded. It does not send source URLs, saved-content text, your name or an identity archive as part of this report.

The result describes the available interest signals, suggests directions and identifies gaps in the evidence. It is advice, not a verified biography, and does not silently rewrite your profile or subscribe to sources. An edited form marks the previous result as out of date.

Connect your own AI provider first. Each explicitly requested report uses the selected provider and the same daily limit and monthly budget as other AI tasks. No automatic provider fallback is used.

## Markdown 下载

推荐流和“我喜欢的”等内容卡片提供 **下载 Markdown**，可选择：

- **来源内容**：导出本站已获取的文字，保留原标题、原链接、来源与发布时间。RSS 摘要、早报拆分新闻、视频简介和项目元数据会标注范围；不会将缺失的正文或视频字幕冒充全文。
- **AI 阅读笔记**：导出已经生成的要点、个人关联、覆盖范围、模型和来源引用。没有笔记时，先在阅读页生成；下载本身不会调用模型或增加 AI 用量。

浏览器会在本地生成 `.md` 文件，方便导入自己的知识库。AI 笔记可能包含个人关联信息，向他人或其他服务提供前请先查看内容。

**分享**复制的是原始来源链接，对方可以直接访问原站；不会公开你的画像、收藏状态、API 设置或 AI 笔记。原站自身仍可能要求登录或限制地区。

Google Notebook / NotebookLM 的使用与配置见[集成指南](notebook.md)。无需额外凭据即可复制链接并打开 Notebook；直接导入需要单独授权及 API 配置，Google 登录不等于授权写入笔记本。

## AI 画像与建议

打开 **偏好与 AI 设置 → 我的偏好**，在兴趣权重下方点击生成按钮。报告依据表单中的当前偏好、启用来源的主题数量和主题层面的反馈统计，也包含手动收藏链接的反馈；禁用或屏蔽的来源不会参与。不会为此发送来源链接、收藏正文、显示名称或个人记忆库原文。

AI 会描述目前的兴趣信号，给出推荐方向，并指出资料不足的地方。结果是建议，不是已核验的人生履历，也不会直接修改偏好或添加订阅。修改表单后，旧报告会提示需要重新生成。

需要先配置可用的 AI 服务商。每次主动生成沿用当前服务商、每日额度和月预算，不会在失败后自动切换到另一家付费服务。
