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
- 除非你自己额外改代码，否则它不会默认自动提交。

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
  本地配置检查脚本。
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

## 免责声明

这是一个非官方社区项目。请只在你有权限访问的账号和表单范围内使用，并自行承担最终提交前的人工核对责任。

## License

MIT
