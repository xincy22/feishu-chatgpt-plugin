# 飞书连接：ChatGPT 与 Codex 插件

**简体中文** | [English](README.en.md) | [ChatGPT 安装指引](skill.md)

通过云端 MCP 服务，让 ChatGPT 和 Codex 访问你自己的飞书账号。连接在云端运行，使用时不依赖本机飞书 CLI 或电脑保持在线。

## 安装与开始使用

1. 准备已经部署的私有连接服务，以及它自动生成的「飞书连接」插件。自行部署见下文。
2. 在 ChatGPT 的 **插件 → 个人 → 我创建的 / 与我共享的** 中找到插件并安装。
3. 打开该服务的连接页，用同一个 ChatGPT 账号登录，配置飞书自建应用的 App ID 和 App Secret，再完成飞书授权。
4. 开始新对话，输入 `@` 选择「飞书连接」，先验证：

   > 检查连接状态，列出我的文档库，再读取一篇我指定的文档。

完整的安装、授权和故障处理步骤见 [skill.md](skill.md)。现有私有实例仅供获得访问权限的账号使用；自行部署会获得自己的服务地址和插件。

## 能力与使用方式

| 能力 | 说明 |
| --- | --- |
| 云文档 | 搜索、分段读取；通过官方工具创建、追加和编辑文档 |
| 我的文档库 | 独立列出个人文档库，按父节点和分页标记浏览下级目录 |
| 知识库 | 浏览知识空间和节点，并调用对应的读写 API |
| 多维表格 | 列出数据表与字段，查询记录；按用户指示创建、更新记录，可用于任务管理 |
| 消息、日历、任务等 | 按需查找官方工具并检查参数后调用 |
| 数学排版 | 行间公式独立成段并居中，行内公式保留正文排版 |

固定使用 `@larksuiteoapi/lark-mcp` **0.5.1** 中的 **501 个用户身份工具定义**，另有个人文档库快捷入口。工具目录不代表全部接口已经实测，调用仍受应用权限、用户授权和资源访问权限限制。二进制上传下载暂不支持。

对话直接提供这 7 个工具入口：

- `feishu_connection_status`
- `feishu_search_documents`
- `feishu_read_document`
- `feishu_find_tools`
- `feishu_describe_tool`
- `feishu_call_read_tool`
- `feishu_call_write_tool`

一般流程是 **查找工具 → 查看参数定义 → 选择读或写入口执行**。多维表格记录查询使用只读的 `bitable.v1.appTableRecord.search`；个人文档库使用 `feishu.library.list/get`。所有业务调用均使用当前用户身份，不自动回退到应用身份。写操作按照用户明确的任务执行，消息发送和权限变更需要明确指示。

## 开发

要求 Node.js **≥ 22.13.0**。项目使用 Vinext、Cloudflare D1 和 Drizzle。

```sh
npm ci
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填写自己新生成的加密密钥和本地服务地址。
npm run dev
```

开发服务启动前会自动应用本地 D1 迁移，也可单独运行 `npm run db:local`；重复执行不会重复建表。开发服务通常位于 `http://127.0.0.1:5173`。本地预览使用模拟的 ChatGPT 身份，不能替代真实 OAuth 验证。

```sh
node --test tests/*.test.mjs
npx tsc --noEmit --incremental false
npm run build
```

## 部署与飞书授权

目前使用 ChatGPT Sites 提供私有访问、ChatGPT 登录和插件的 MCP OAuth 认证。部署自己的服务时：

1. 创建自己的 Sites 项目，在 `.openai/hosting.json` 中设置它的 `project_id`，绑定 `DB`，并应用 `drizzle/` 下的迁移。
2. 在托管平台配置 `FEISHU_VAULT_KEY`（自己新生成的 32 字节 base64 密钥，作为 secret）和 `SITE_ORIGIN`（自己的服务域名）。
3. 在飞书自建应用中添加 `<SITE_ORIGIN>/oauth/feishu/callback` 重定向 URL，并开通基础用户身份权限：

   ```text
   offline_access
   search:docs:read
   docx:document:readonly
   wiki:node:read
   wiki:node:retrieve
   wiki:space:read
   wiki:space:retrieve
   drive:drive.metadata:readonly
   base:app:read
   base:table:read
   base:field:read
   base:record:retrieve
   ```

4. 完成飞书后台要求的发布流程，在私有连接页填写应用凭据并授权。
5. 使用 Sites 为该项目生成的插件，按 [安装指引](skill.md) 连接到 ChatGPT。

连接页可选择“文档和知识库：创建与编辑”“多维表格任务：新增与更新记录”，并填写其他接口返回的额外权限名称。选择后点击授权按钮，并在飞书页面核对新增范围。其他读写 API 需要对应权限。默认请求权限不是当前 token 的完整授权清单；`scopes=null` 表示无法确认实际范围，不能据此断言只有只读权限。

独立托管需要自行实现可信认证边界并移除客户端伪造的身份头，不能直接公开部署后信任 `oai-authenticated-user-id`。

## 提示词与文档排版

统一提示词在 [lib/plugin-instructions.ts](lib/plugin-instructions.ts)，包含连接使用规则和 `DOCUMENT_MATH_RULES`。它同时用于 MCP 初始化说明和文档写入工具的动态说明；修改后需要发布云端服务。

行间公式用独立文本块承载公式元素，并设置 `text.style.align=2`：

```json
{
  "block_type": 2,
  "text": {
    "style": { "align": 2 },
    "elements": [{ "equation": { "content": "A=LL^{T}" } }]
  }
}
```

`equation.content` 使用原始 KaTeX 公式，不带 `$$` 等外层定界符。行内公式不改变整段的对齐方式。提示词指导模型生成参数，不会自动改写所有历史文档。

## 数据与授权状态

App Secret 和 OAuth token 使用 AES-GCM 加密保存，加密数据绑定到用户及用途。服务保存连接所需的用户标识、App ID 和飞书显示名；读取的文档正文返回给客户端，目前不持久缓存正文。

不要提交真实凭据、`.dev.vars`、数据库、日志、授权码或账号数据。连接页的“清除连接”会删除本服务中当前用户的凭据和协调状态。飞书端的授权撤销仍在飞书应用授权管理中完成。

## 常见问题

- **只能看到团队知识空间**：团队列表不包含「我的文档库」，改用 `feishu.library.list/get`。
- **多维表格能列出字段，读不到记录**：检查 `base:record:retrieve`；字段读取权限与记录查询权限不同。
- **错误 131002**：先检查参数。知识库列表每页最多 50 项，服务已为相关工具加入上限保护；不要直接解释成 OAuth 缺失。
- **更新后仍只有旧工具**：先新建对话；若工具清单仍未更新，再卸载并重新安装该插件。
- **反复要求授权**：根据结构化错误区分权限缺失、认证失效和资源/参数错误。只有确有授权问题才重新连接。

## 源码与许可

此仓库保存可复用的源码，包含授权诊断、分页保护、公式居中提示词和带租期、恢复能力的 token 续期机制。限流或续期进行中会保留凭据；已保存的轮换结果可以接续提交。结果未确认的外部轮换不能安全重放，必要时通过重新连接恢复。原实例的部署 ID、真实凭据和运行数据不包含在仓库中。GitHub 推送与云端部署是两个独立步骤。

本项目以 [MIT 许可证](LICENSE) 开源，允许使用、修改、分发和商业使用，并须保留版权及许可声明。第三方代码和生成的工具定义保留各自的许可，见 [第三方声明](THIRD_PARTY_NOTICES.md)。

这是社区维护的飞书连接项目，不是飞书或 OpenAI 的官方插件。源码公开不代表原私有实例向公众开放；请部署自己的服务并配置自己的飞书应用。安全问题请通过仓库的私有安全报告渠道反馈，见 [安全说明](SECURITY.md)。
