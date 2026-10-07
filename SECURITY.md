# 安全说明 / Security

当前维护版本为 0.3.1。请使用最新的 `main`；其他历史版本不单独维护。

## 报告漏洞

请在 GitHub 仓库的 **Security → Report a vulnerability** 中提交私有报告：

[私有漏洞报告](https://github.com/xincy22/feishu-chatgpt-plugin/security/advisories/new)

提供复现步骤、受影响版本和脱敏后的错误信息。请勿在公开 Issue 或报告中上传 App Secret、OAuth token、授权码、加密密钥、数据库或飞书私人内容。

## 部署边界

- 当前认证依赖 Sites 的可信入口。独立托管必须实现自己的认证，并移除客户端伪造的身份头。
- 每个部署使用自己的 `FEISHU_VAULT_KEY`。将密钥保存在托管平台的 secret 配置中。
- 源码公开不会公开现有私有服务的账号或凭据；部署者负责自己实例的访问权限、飞书授权和数据管理。

## English

Version 0.3.1 is the current maintained version; use the latest `main`. Older versions are not maintained separately.

Use the private reporting link above for vulnerabilities. Include reproduction steps, the affected version, and redacted errors. Never include app secrets, OAuth tokens, authorization codes, vault keys, databases, or private Feishu content.

The current implementation requires the Sites trusted authentication boundary. Independent hosting must implement its own authentication and strip spoofed identity headers. Use a separate vault key for each deployment and store it as a platform secret. Deployment owners manage their own access control, provider grants, and data.
