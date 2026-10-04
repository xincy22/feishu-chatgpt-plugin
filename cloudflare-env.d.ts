declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    FEISHU_VAULT_KEY?: string;
    SITE_ORIGIN?: string;
  }
}
