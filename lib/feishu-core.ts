export class PublicError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: Record<string,unknown>) { super(message); }
}
export const SCOPES = ['offline_access', 'search:docs:read', 'docx:document:readonly', 'wiki:node:read', 'wiki:node:retrieve', 'wiki:space:read', 'wiki:space:retrieve', 'drive:drive.metadata:readonly', 'base:app:read', 'base:table:read', 'base:field:read', 'base:record:retrieve'];
export const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));
export const unb64 = (v: string) => Uint8Array.from(atob(v), c => c.charCodeAt(0));
export const random = () => b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2,'0')).join('');
}
export async function pkce(value: string) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
async function key(secret: string) {
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = unb64(secret); } catch { throw new PublicError('storage_not_ready','云端凭据存储尚未就绪。',503); }
  if (raw.length !== 32) throw new PublicError('storage_not_ready','云端凭据存储尚未就绪。',503);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function seal(secret: string, context: string, data: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)}, await key(secret), new TextEncoder().encode(JSON.stringify(data)));
  return 'v1.' + b64(iv) + '.' + b64(new Uint8Array(encrypted));
}
export async function openVault<T>(secret: string, context: string, cipher: string): Promise<T> {
  const [version,iv,data,...rest]=cipher.split('.');
  if(version!=='v1'||!iv||!data||rest.length)throw new PublicError('storage_error','凭据读取失败，请重新连接。',503);
  try {
    const value=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:new TextEncoder().encode(context)},await key(secret),unb64(data));
    return JSON.parse(new TextDecoder().decode(value));
  } catch { throw new PublicError('storage_error','凭据读取失败，请重新连接。',503); }
}
export function documentReference(value: string): {kind:'docx'|'wiki';token:string;url?:string} {
  if(/^[A-Za-z0-9_-]{10,256}$/.test(value))return {kind:'docx',token:value};
  let u:URL;try{u=new URL(value);}catch{throw new PublicError('invalid_reference','请填写飞书新版文档或知识库链接。');}
  const m=/^\/(docx|wiki)\/([A-Za-z0-9_-]{10,256})\/?$/.exec(u.pathname);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/.test(u.hostname)||!m)
    throw new PublicError('invalid_reference','仅支持飞书新版文档和知识库链接。');
  return {kind:m[1] as 'docx'|'wiki',token:m[2],url:u.origin+u.pathname};
}
export function requireIdentity(request: Request): string {
  // Sites removes untrusted identity headers and injects these after authenticating.
  const id=request.headers.get('oai-authenticated-user-id');
  if(!id)throw new PublicError('sign_in_required','请先使用 ChatGPT 账号登录此连接页面。',401);
  return id;
}
export function requireSameOrigin(request:Request, origin:string) {
  if(request.headers.get('origin')!==origin)throw new PublicError('invalid_origin','请求来源不匹配，请从连接页面重试。',403);
}
export function publicIssue(error:unknown) {
  return error instanceof PublicError ? {code:error.code,message:error.message,status:error.status,...(error.details?{details:error.details}:{})} : {code:'temporarily_unavailable',message:'服务暂时不可用，请稍后重试。',status:503};
}
