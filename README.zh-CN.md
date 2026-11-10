# YourFeed

[English](README.md)

把视频、文章、新闻、收藏帖子和开源项目放进自己的私人首页。休息时轻松发现，学习时专注进阶。由你的来源和反馈影响推荐，只在打开网站或手动操作时更新。

[![部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/alanxiaofeifei/yourfeed)

按钮会为你复制仓库、创建 Worker 和 D1 数据库。**使用内容流前，需要完成本人登录配置。** 未配置的实例只显示设置指引，私人接口保持关闭。支持 Google、GitHub 登录；邮箱验证码是可选项，无需为了部署先购买邮件服务。详细步骤见[部署指南](docs/deployment.md)。

`OWNER_EMAIL` 填写**你本人用于登录和接收验证码的邮箱**。`onboarding@resend.dev` 只是测试**发件地址**，不是你的登录邮箱，而且只能给注册 Resend 的邮箱发信；正式使用需要验证自己的发件域名。`RESEND_API_KEY` 必须在 Cloudflare 中设为 **Secret（密钥）**，不要选 Text。发送接口成功仅表示服务商已受理，不代表邮件已到收件箱；请求被拒绝时网站会显示发送错误。

- 视频、阅读、新闻、帖子、项目混合推荐，支持筛选、稍后看、喜欢、足迹和来源反馈。
- 中英文界面、个人引导与三种可编辑起点：IT 与 AI 实践、开发与创作、通识探索。
- 支持 RSS、公开 GitHub Stars、使用个人 API Key 的 YouTube 元数据、尽力更新的 B 站接口及链接导入。
- 可选 OpenAI、DeepSeek、GLM 和兼容 HTTPS 接口。明确选择服务商与模型，以每日数量、预算预留和分析缓存限制使用，不会自动切换服务商产生费用。
- 独立部署仅本人登录，API Key 在服务端加密；保留可选 ChatGPT Sites 适配层。
- 域名向导检查公开 DNS、HTTPS 和当前实例，不收集 Cloudflare 管理令牌，不自动修改登录主地址。

## 适合谁？

- **IT 与 AI 实践：**希望积累 IT、网络、Linux 和工作自动化能力，同时在休息时看看动手实践、科学内容的人。
- **开发与创作：**关注编程、开源、AI 工具和创作流程，也喜欢制作与视觉灵感的人。
- **通识探索：**享受科学、历史、人文和深度阅读，希望学习能帮助下一阶段目标的工具的人。

这三种只是可编辑的起点，每种都兼顾休息和学习。你的反馈会逐渐优先于初始兴趣。

## 本地开始

需要 Node.js 22.13 以上和 npm。

```sh
npm ci
cp .env.example .dev.vars
# 填写实例配置和一种 OAuth 登录方式，见 docs/deployment.md。
npm run db:migrate:local
npm run dev
```

示例不含可用凭据。使用 `openssl rand -hex 32` 分别生成两个不同的加密、登录密钥。AI 默认关闭；模型费用、第三方 API 费用和托管费用分别由各自服务商计费。

## 部署与维护

阅读[部署与登录](docs/deployment.md)、[自定义域名](docs/domains.md)、[备份和回滚](docs/backup-and-rollback.md)。默认部署目标为 Cloudflare Workers + D1。`YOURFEED_BUILD_PROFILE=sites` 提供独立的 Sites 构建适配；真实 Sites ID 和访问设置只应保存在你的私人部署中。

```sh
npm run typecheck
npm test
npm run build
# 检查目标账户、D1 ID、密钥后再执行：
npm run deploy
```

`deploy` 会先执行数据库迁移，再发布代码。代码回滚不会撤销数据库迁移。请按自己的账户设置 Cloudflare 计费与预算，不要假定所有工作负载始终免费。

可以每六小时或手动生成共享代码更新 PR。更新器保护部署配置、个人种子资料和本地改动，不自动合并、不部署、不执行数据库迁移。启用方法见[共享核心更新](docs/shared-core.md)。所有更新需要你审阅。

## 技术与限制

TypeScript、React/Vinext、Cloudflare Workers、D1 和 Drizzle。内容保存在自己的实例中，视频保留官方播放器与出处。部分视频无法嵌入时提供原站链接。B 站公开接口可能限流或变化；X 与 APPSO 支持链接导入，不承诺免费实时接口。AI 笔记会说明基于正文、摘要还是元数据。

每个部署服务一位主人，不是多人托管平台。外部内容只是资料，不是系统指令。请勿把个人档案、密钥、Cookie、数据库导出提交到 Git。

MIT 许可；第三方内容、媒体及服务遵循各自条款。
