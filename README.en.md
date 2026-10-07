# Feishu integration for ChatGPT and Codex

[简体中文 (default)](README.md) | **English** | [ChatGPT installation guide (Chinese)](skill.md)

A cloud-hosted MCP service that connects ChatGPT and Codex to your own Feishu account. It does not require the local Feishu CLI or an always-on computer.

## Install and get started

1. Have a deployed private connection service and the Feishu plugin provisioned for it. Deployment requirements are below.
2. In ChatGPT, open **Plugins → Personal → Created by me / Shared with me**, find the plugin, and install it.
3. Open the service's connection page, sign in with the same ChatGPT account, configure your Feishu custom app's App ID and App Secret, and authorize Feishu.
4. Start a new chat, type `@`, select the plugin, and test:

   > Check my connection, list My Document Library, and read a document I specify.

See [skill.md](skill.md) for the full installation, authorization, and troubleshooting workflow. An existing private instance is available only to accounts granted access. Your own deployment has its own service URL and plugin.

## Capabilities and workflow

| Capability | Support |
| --- | --- |
| Cloud documents | Search and paginated reading; official tools for creation, appending, and editing |
| My Document Library | A separate personal-library entry point, with parent-node traversal and pagination |
| Wiki | Browse spaces and nodes, then use their read/write APIs |
| Bitable | List tables and fields, query records, and create/update records as instructed; suitable for task management |
| Messaging, calendars, tasks, and more | Discover official tools and inspect their schemas before calling them |
| Math formatting | Center standalone display equations while keeping inline math in its paragraph |

The pinned catalogue contains **501 user-identity tool definitions** from `@larksuiteoapi/lark-mcp` **0.5.1**, plus personal-library helpers. Catalogue presence does not mean every API has been tested live or that the account has every required permission. Binary uploads and downloads are not supported.

Seven tools are exposed directly to the conversation:

- `feishu_connection_status`
- `feishu_search_documents`
- `feishu_read_document`
- `feishu_find_tools`
- `feishu_describe_tool`
- `feishu_call_read_tool`
- `feishu_call_write_tool`

Use **find → describe → execute through the read or write entry point**. Use the read-only `bitable.v1.appTableRecord.search` for record queries and `feishu.library.list/get` for My Document Library. Calls always use the connected user identity, without silently falling back to app identity. Writes follow the user's specific task; messaging and permission changes require explicit instructions.

## Development

Requires Node.js **≥ 22.13.0**. The stack is Vinext, Cloudflare D1, and Drizzle.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Configure your own freshly generated encryption key and local service origin.
npm run dev
```

Development startup automatically applies local D1 migrations; `npm run db:local` can also be run separately and is idempotent. The development server normally starts at `http://127.0.0.1:5173`. Local preview uses a simulated ChatGPT identity and is not real OAuth acceptance.

```sh
node --test tests/*.test.mjs
npx tsc --noEmit --incremental false
npm run build
```

## Deployment and Feishu authorization

The current service uses ChatGPT Sites for private access, ChatGPT sign-in, and the plugin's MCP OAuth boundary.

1. Create your own Sites project, set its `project_id` in `.openai/hosting.json`, bind `DB`, and apply the migrations under `drizzle/`.
2. Configure `FEISHU_VAULT_KEY` as a secret containing your own fresh 32-byte base64 key, and set `SITE_ORIGIN` to your service origin.
3. Add `<SITE_ORIGIN>/oauth/feishu/callback` as a redirect URL in your Feishu custom app and enable these baseline user scopes:

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

4. Complete any publication steps required by Feishu, enter the app credentials on your private connection page, and authorize your account.
5. Install the plugin provisioned by Sites for that project, following the [installation guide](skill.md).

The connection page supports optional document/wiki editing and Bitable record creation/update profiles, plus explicit additional scopes. Select the capabilities and review the added permissions on Feishu's authorization page. Other APIs require their corresponding permissions. Default requested scopes are not a complete report of the current token's grants. `scopes=null` means the actual scope set is unknown, not that the connection is read-only.

Independent hosting needs its own trusted authentication boundary that removes spoofed identity headers. Do not expose a public Worker that trusts caller-supplied `oai-authenticated-user-id`.

## Prompts and math formatting

Unified instructions are maintained in [lib/plugin-instructions.ts](lib/plugin-instructions.ts), including connection behavior and `DOCUMENT_MATH_RULES`. They are returned during MCP initialization and in dynamic document-write tool descriptions. Publish the cloud service after editing them.

Represent a display equation as a standalone text block containing an equation element, with `text.style.align=2`:

```json
{
  "block_type": 2,
  "text": {
    "style": { "align": 2 },
    "elements": [{ "equation": { "content": "A=LL^{T}" } }]
  }
}
```

Use raw KaTeX in `equation.content`, without outer delimiters such as `$$`. Inline equations retain their paragraph alignment. These instructions guide generated tool arguments; they do not automatically rewrite historical documents.

## Data and authorization state

App Secret and OAuth tokens are encrypted with AES-GCM and bound to the user and purpose. The service stores the connection's user identifier, app ID, and Feishu display name. Requested document content is returned to the client without a persistent content cache.

Do not commit live credentials, `.dev.vars`, databases, logs, authorization codes, or account data. The connection page can clear the current user's stored credentials and coordination state. Revoke the provider-side authorization separately through Feishu's app authorization management.

## Troubleshooting

- **Only team spaces appear:** the team-space list excludes My Document Library. Use `feishu.library.list/get`.
- **Fields load, records do not:** check `base:record:retrieve`; these are separate permissions.
- **Error 131002:** check parameters first. Wiki lists allow at most 50 items per page, and the gateway caps oversized requests for these tools.
- **An updated plugin still exposes old tools:** start a new chat first; if the catalogue remains stale, uninstall and reinstall the plugin.
- **Repeated authorization requests:** distinguish missing scopes, invalid authentication, and resource/parameter failures using the structured error report.

## Source and licensing

This reusable source repository includes authorization diagnostics, pagination safeguards, centered-equation instructions, and lease-based token rotation with recovery. Rate limits and in-progress refreshes retain credentials; saved rotation results can be committed by a subsequent request. An unconfirmed external rotation cannot safely be replayed and may require reconnecting. The original instance's deployment identifiers, live credentials, and runtime data are excluded. A GitHub push and a cloud deployment are separate operations.

This project is open source under the [MIT License](LICENSE), allowing use, modification, distribution, and commercial use with the copyright and license notices retained. Third-party code and generated tool definitions retain their respective licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).

This is a community-maintained integration, not an official Feishu or OpenAI plugin. Publishing the source does not open the original private instance to the public. Deploy your own service and configure your own Feishu app. Report vulnerabilities through the repository's private reporting channel; see [security guidance](SECURITY.md).
