<p align="center">
  <img src="assets/logo.svg" alt="HKUST Student Expense Agent" width="720">
</p>

# HKUST Student Expense Agent

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Local First](https://img.shields.io/badge/local-first-blue.svg)](#安全模型)
[![Browser Automation](https://img.shields.io/badge/browser-playwright-black.svg)](https://playwright.dev/)

英文版： [README.md](README.md)

这是一个非官方、仅限本地使用的 HKUST 学生报销 eForm 浏览器自动化工具。

它的目标不是“代替用户提交”，而是把重复的报销填写流程整理成一套可复用、可检查、可修改的本地工具链：

- 抓取真实登录后表单结构
- 利用稳定字段绑定做映射
- 按本地配置自动填写和上传附件
- 在提交前停下来给用户人工确认

## 当前状态

项目处于实验阶段，但已经适合本地浏览器辅助填表。

## 分支说明

- `main`：相对稳定的本地浏览器自动化版本，提供 snapshot/check/fill
- `v0.2-llm-foundation`：LLM 辅助收据提取与报销草稿的实验分支

如果你想直接使用当前的 LLM 版本，请切到 `v0.2-llm-foundation`。

当前支持范围：

- HKUST `Expense Claim for Student Form`
- 仅支持用户自己手动登录
- 复用本地浏览器会话
- 基于配置的自动填写与附件上传
- 默认不自动提交

## 为什么做这个项目

HKUST 报销 eForm 的流程足够固定，适合自动化；但页面里的 DOM 又足够动态，普通的自动填表工具通常不稳定。这个表单大量使用 YZSoft 的自定义控件和动态生成 id，因此更稳的做法不是“盲点输入框”，而是先观察真实表单结构，再基于稳定字段绑定去执行。

这个仓库就是把这套思路整理成一个小型 CLI 工作流，保持本地优先、行为透明、可重复执行。

## 核心特性

- `snapshot`：抓取真实登录后表单的本地快照
- `fill`：按配置对真实表单执行自动填写
- 支持 `dataBind` 这类稳定定位方式，不依赖脆弱的动态 id
- 支持附件上传
- 浏览器启动前可先做本地配置检查
- 在任何真实提交动作前默认停下人工复核

## 安全模型

这个项目是刻意保守设计的。

- 你自己在真实浏览器里登录 HKUST 账号。
- 工具只复用你本地的浏览器 profile，存放在 `.auth/`。
- 它不会要求你把密码写进代码、配置或聊天记录。
- 它不会绕过 SSO、MFA、验证码或访问控制。
- 不应该把它做成替别人登录的托管服务。
- 可选提交需要单独配置提交步骤，并在终端输入 `SUBMIT` 确认。

## 快速开始

```bash
npm install
npx playwright install chromium
cp config/claim.sample.json config/claim.local.json
```

先抓一份真实登录后的表单快照：

```bash
npm run snapshot
```

然后检查并执行填写：

```bash
npm run check
npm run fill
```

检查或填写前，请把示例中的附件占位路径替换为真实本地文件。`fill` 现在会在
打开浏览器前执行与 `check` 相同的校验：不支持的动作、错误的定位器或等待时间、
不存在的附件以及占位路径都会直接报错，避免填到一半才发现配置有问题。

检查其他配置可运行 `npm run check -- config/my-claim.local.json`。
相对配置路径以仓库根目录为基准；相对附件路径以运行命令时的目录为基准。
使用附件绝对路径可以避免工作目录变化带来的问题。
所有定位器类型都支持从 0 开始的 `locator.nth`，可明确指定重复报销行。

如需启用可选提交，请单独配置 `action: "click"` 的 `submitStep`，并设置
`submit: true` 或传入 `--submit`；执行时仍须在终端输入 `SUBMIT`。
普通 `steps` 会按配置执行，包括其中的点击操作，因此最终提交按钮应只放在
`submitStep` 中。

## 工作流说明

1. `snapshot`
   打开目标表单，必要时等用户自己完成登录，然后把 frames、controls 和字段附近文本保存成本地快照。

2. `check`
   在真正打开浏览器前，先检查本地配置结构和附件路径。

3. `fill`
   复用本地登录态重新打开表单，按配置填写字段、上传附件，并在最后停下来等待人工检查。

## 仓库结构

- `scripts/eform-agent.mjs`
  快照与填表主脚本。
- `scripts/check-config.mjs`
  本地配置检查入口，与填表脚本共用 `scripts/lib/config.mjs` 校验模块。
- `scripts/lib/automation.mjs`
  可复用的浏览器动作与字段定位逻辑。
- `config/claim.sample.json`
  使用假数据的安全示例配置。
- `docs/PUBLISHING.md`
  公开发布前的检查清单。
- `docs/CLI_ANYTHING.md`
  如何把本项目包装进更大 agent 工作流的说明。

## 哪些文件绝对不要提交

- `.auth/`
- `artifacts/`
- `config/claim.local.json`
- 真实收据、发票、截图、银行信息、登机牌
- 真实登录后抓下来的 DOM 快照

## 适合谁使用

- 想做本地优先报销辅助工具的 HKUST 同学
- 更信任透明浏览器自动化而不是黑盒 SaaS 的开发者
- 想把校园行政流程沉淀成 agent 工作流的人

## 不打算做什么

- 冒充 HKUST 官方产品
- 收集或管理用户账号密码
- 搭一个共享机器人替别人登录提交
- 把需要人工复核的流程完全隐藏掉

## 后续方向

- 更稳的字段发现和映射工具
- 常见报销模式的模板化配置
- 更好的快照脱敏工具
- 和更大 agent 生态的集成包装

## 开发与测试

建议使用 Node.js 22，并通过已提交的锁文件安装依赖：

```bash
npm ci
npx playwright install chromium
npm test
```

`npm run test:config` 仅测试配置校验，无需启动浏览器。
`npm run test:browser` 使用本地模拟表单验证字段定位和填写动作。
GitHub Actions 会在 Linux 上运行这两组测试。测试不使用学校账号、真实票据或
在线 eForm；SSO 登录和 YZSoft 控件联动仍需要在真实环境中人工验证。

## 免责声明

这是一个非官方社区项目。请只在你有权限访问的账号和表单范围内使用，并自行承担最终提交前的人工核对责任。

## License

MIT
