# HKUST Student Expense Agent

英文版： [README.md](README.md)

这是一个非官方、仅限本地使用的 HKUST 学生报销 eForm 浏览器自动化工具。

它的设计边界很明确：

1. 你自己在浏览器里手动登录 HKUST 账号。
2. 脚本只复用你本机上的浏览器会话。
3. 脚本只在你自己的电脑上做快照或填表。
4. 脚本填完后停下来，等你人工检查，而不是默认自动提交。

## 使用边界

- 这不是 HKUST 官方工具。
- 这个项目不收集账号密码。
- 这个项目不绕过 SSO、MFA、验证码或访问控制。
- 不建议把它做成代别人登录的托管服务。
- 默认不开启自动提交，最好保持这样。

## 这个项目解决什么问题

HKUST 学生报销 eForm 的流程比较固定，但前端 DOM 动态生成较多，普通表单填写工具往往不稳定。这个仓库通过 `Playwright + 表单快照 + 显式配置` 的方式，把流程变成可检查、可重复执行的本地自动化。

## 安装

```bash
npm install
npx playwright install chromium
cp config/claim.sample.json config/claim.local.json
```

## 快速开始

先抓一份真实登录后的表单快照：

```bash
npm run snapshot
```

然后编辑你自己的本地配置，再执行：

```bash
npm run check
npm run fill
```

脚本会：

- 打开真实 Chromium 浏览器
- 如果需要，等你自己先完成登录
- 按配置填写字段并上传附件
- 在提交前停下来让你人工确认

## 哪些文件不能提交到 Git

- `.auth/`
- `artifacts/`
- `config/claim.local.json`
- 任何真实收据、发票、银行信息、截图
- 任何登录后抓下来的真实 DOM 快照

## 目录结构

- `scripts/eform-agent.mjs`：快照和填表主脚本
- `scripts/check-config.mjs`：本地配置检查脚本
- `config/claim.sample.json`：安全的假数据示例配置
- `examples/receipts/`：本地开发时的占位目录
- `docs/PUBLISHING.md`：发布前检查清单
- `docs/CLI_ANYTHING.md`：如何包装成更大 agent 工作流的说明

## HKUST 场景下的建议

- 保持本地优先。
- 要求用户自己登录。
- 把浏览器会话和 DOM 快照视为敏感数据。
- 不要在命名和文档里暗示官方背书。

## License

MIT
