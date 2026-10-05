# Feishu integration for ChatGPT and Codex

Cloud-hosted MCP tools that connect a user's own Feishu account to ChatGPT and Codex.

## Current capabilities

- Check the current user's connection status.
- Search visible cloud documents, with pagination and source links.
- Read docx documents and docx wiki nodes as paginated plain text.
- Configure a custom Feishu app and complete OAuth through a private connection page.

The server also exposes `feishu_find_tools`, `feishu_describe_tool`, `feishu_call_read_tool`, and `feishu_call_write_tool`. A pinned official catalogue contains 501 user-token tools from `@larksuiteoapi/lark-mcp` 0.5.1, alongside explicit personal-library helpers. It covers document, wiki, Bitable, messaging, calendar, and task APIs. Catalogue availability does not mean every API has been tested live or that the connected account has every required permission.

Discover a tool, inspect its schema, then call the appropriate read/write entry point. Write actions require a specific user instruction; sending messages and changing permissions require explicit authorization. Available scopes and resource permissions are enforced by Feishu.

## Development

Requires Node.js >=22.13.0. The stack is Vinext, Cloudflare D1, and Drizzle.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set your own freshly generated encryption key.
npm run dev
```

The development server normally starts at http://127.0.0.1:5173. Local preview uses a simulated ChatGPT identity; it does not prove real OAuth access.

```sh
node --test tests/*.test.mjs
npx tsc --noEmit --incremental false
npm run build
```

## Hosting and authentication

This integration currently relies on ChatGPT Sites for private-site access, sign-in, and MCP plugin authentication. Do not expose it on a generic public Worker while trusting client-supplied identity headers. Independent hosting requires its own authentication boundary that removes untrusted identity headers.

Create your own Sites project, add its project ID to `.openai/hosting.json`, bind `DB`, and apply the migrations under `drizzle/`. Configure these runtime values on the hosting platform:

- `FEISHU_VAULT_KEY`: your own fresh 32-byte base64 encryption key, stored as a secret.
- `SITE_ORIGIN`: your own site origin.

In your Feishu custom app, add `<SITE_ORIGIN>/oauth/feishu/callback` as a redirect URL and enable these user scopes:

- `offline_access`
- `search:docs:read`
- `docx:document:readonly`
- `wiki:node:read`
- `base:record:retrieve`

Publish the app, enter its App ID and App Secret in your private connection page, and authorize your account. This repository includes no reusable private credentials.

## Data handling

App Secret and OAuth tokens are encrypted with AES-GCM in the service database, with ciphertext bound to the user and purpose. The service also stores the site user identifier, app ID, and Feishu display name. Requested document content is returned to the client; this version does not persist a document-content cache.

Never commit live credentials, `.dev.vars`, databases, logs, authorization codes, or real account data. A connection deletion/revocation UI is not yet implemented.

## Source snapshot

Prepared from source commit `d4c81c9763b6789066874bb976ea56fd97979a94`. Private deployment identifiers and original commit history are excluded.

## License

A project license has not yet been selected. This repository is initially intended as a private source backup. Before public release, select a license and review dependency and generated-code licensing. Existing third-party notices under `build/` and `vendor/` are retained.
