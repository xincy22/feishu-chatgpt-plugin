import { env } from 'cloudflare:workers';
import { scopeReport, failureReport } from './authorization-report';
import { PublicError, SCOPES, random, digest, pkce, seal, openVault, documentReference } from './feishu-core';

type Row = { user_id:string; revision:string; app_id:string; config_cipher:string; tokens_cipher:string|null; updated_at:number };
type AppConfig = { appId:string; appSecret:string };
type Tokens = { accessToken:string; refreshToken?:string; expiresAt:number; name?:string; grantedScopes?:string[] };
type State = { state_hash:string; user_id:string; revision:string; verifier_cipher:string; expires_at:number };
const API='https://open.feishu.cn';
const now=()=>Math.floor(Date.now()/1000);
export function database():D1Database { if(!env.DB)throw new PublicError('storage_not_ready','云端存储尚未就绪。',503);return env.DB; }
function secret() { if(!env.FEISHU_VAULT_KEY)throw new PublicError('storage_not_ready','云端凭据存储尚未就绪。',503);return env.FEISHU_VAULT_KEY; }
export function siteOrigin() { if(!env.SITE_ORIGIN)throw new PublicError('site_not_ready','连接页面地址尚未就绪。',503);return new URL(env.SITE_ORIGIN).origin; }
export const callbackUrl=()=>siteOrigin()+'/oauth/feishu/callback';
async function row(user:string) { return database().prepare('SELECT * FROM connections WHERE user_id = ?').bind(user).first<Row>(); }
async function config(r:Row) { return openVault<AppConfig>(secret(),r.user_id+':config',r.config_cipher); }
export async function status(user:string) {
  const r=await row(user);let t:Tokens|null=null;
  if(r?.tokens_cipher)t=await openVault<Tokens>(secret(),user+':tokens',r.tokens_cipher);
  return {configured:!!r,connected:!!t && (t.expiresAt>now() || !!t.refreshToken),
    app_id:r?.app_id ?? null,feishu_name:t?.name ?? null,expires_at:t?.expiresAt ?? null,
    callback_url:callbackUrl(),...scopeReport(t?.grantedScopes),connection_ref:await digest(user+':'+(r?.app_id??'')).then(v=>v.slice(0,12)),server_version:'0.2.4',connect_url:siteOrigin()};
}
export async function saveConfig(user:string, appId:string, appSecret:string) {
  if(!/^cli_[A-Za-z0-9]{6,128}$/.test(appId)||appSecret.length<10||appSecret.length>512||/[\r\n]/.test(appSecret))
    throw new PublicError('invalid_config','请检查 App ID 和 App Secret。');
  const cipher=await seal(secret(),user+':config',{appId,appSecret});
  await database().prepare('INSERT INTO connections (user_id,revision,app_id,config_cipher,tokens_cipher,updated_at) VALUES (?,?,?,?,NULL,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,app_id=excluded.app_id,config_cipher=excluded.config_cipher,tokens_cipher=NULL,updated_at=excluded.updated_at')
    .bind(user,random(),appId,cipher,now()).run();
}
async function tokenExchange(c:AppConfig, args:Record<string,string>):Promise<Tokens> {
  const response=await fetch(API+'/open-apis/authen/v2/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...args,client_id:c.appId,client_secret:c.appSecret}),signal:AbortSignal.timeout(15000)});
  const data=await response.json() as {code?:number;access_token?:string;refresh_token?:string;expires_in?:number;scope?:string};
  if(!response.ok || (data.code!==undefined && data.code!==0) || !data.access_token || !(Number(data.expires_in)>0))
    throw new PublicError('feishu_authorization_failed','飞书授权未完成，请检查应用凭据、重定向 URL 和用户权限。',401);
  return {accessToken:data.access_token,refreshToken:data.refresh_token,expiresAt:now()+Number(data.expires_in),...(typeof data.scope==='string'?{grantedScopes:data.scope.split(/\s+/).filter(Boolean)}:{})};
}
export async function authorize(user:string) {
  const r=await row(user);if(!r)throw new PublicError('configure_first','请先填写飞书应用凭据。');
  const state=random(),verifier=random();
  await database().batch([
    database().prepare('DELETE FROM oauth_states WHERE user_id = ? AND expires_at < ?').bind(user,now()),
    database().prepare('INSERT INTO oauth_states (state_hash,user_id,revision,verifier_cipher,expires_at) VALUES (?,?,?,?,?)')
      .bind(await digest(state),user,r.revision,await seal(secret(),user+':verifier',verifier),now()+600),
  ]);
  const url=new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  url.search=new URLSearchParams({client_id:r.app_id,response_type:'code',redirect_uri:callbackUrl(),scope:SCOPES.join(' '),state,
    code_challenge:await pkce(verifier),code_challenge_method:'S256'}).toString();
  return url.toString();
}
export async function finishAuthorization(user:string, state:string, code:string|null, denied:boolean) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(state))throw new PublicError('invalid_state','授权请求无效，请重新连接。');
  const tx=await database().prepare('DELETE FROM oauth_states WHERE state_hash = ? AND user_id = ? AND expires_at >= ? RETURNING *')
    .bind(await digest(state),user,now()).first<State>();
  if(!tx)throw new PublicError('invalid_state','授权请求已过期或已使用，请重新连接。');
  if(denied)throw new PublicError('authorization_denied','你已取消飞书授权。');
  if(!code || code.length>4096)throw new PublicError('missing_code','飞书未返回授权码，请重试。');
  const r=await row(user);
  if(!r || r.revision!==tx.revision)throw new PublicError('config_changed','应用配置已改变，请重新授权。');
  const verifier=await openVault<string>(secret(),user+':verifier',tx.verifier_cipher);
  const tokens=await tokenExchange(await config(r),{grant_type:'authorization_code',code,redirect_uri:callbackUrl(),code_verifier:verifier});
  // A display name is optional. Never retain phone, email, or the full profile.
  try {
    const info=await api(tokens.accessToken,'/open-apis/authen/v1/user_info');
    if(typeof info.name==='string')tokens.name=info.name.slice(0,100);
  } catch {}
  const update=await database().prepare('UPDATE connections SET tokens_cipher = ?,updated_at = ? WHERE user_id = ? AND revision = ?')
    .bind(await seal(secret(),user+':tokens',tokens),now(),user,r.revision).run();
  if(update.meta.changes!==1)throw new PublicError('config_changed','应用配置已改变，请重新授权。');
}
export async function currentToken(user:string):Promise<string> {
  const r=await row(user);
  if(!r?.tokens_cipher)throw new PublicError('connect_feishu','请先打开连接页面并授权飞书。',401);
  const t=await openVault<Tokens>(secret(),user+':tokens',r.tokens_cipher);
  if(t.expiresAt>now()+120)return t.accessToken;
  if(!t.refreshToken)throw new PublicError('reconnect_feishu','飞书授权已过期，请重新连接。',401);
  const claim=user+':'+await digest(t.refreshToken);
  const claimed=await database().prepare('INSERT OR IGNORE INTO refresh_claims (claim,user_id,created_at) VALUES (?,?,?)').bind(claim,user,now()).run();
  if(claimed.meta.changes!==1) {
    for(let i=0;i<6;i++) {
      await new Promise(resolve=>setTimeout(resolve,250));
      const updated=await row(user);
      if(updated?.tokens_cipher && updated.tokens_cipher!==r.tokens_cipher) {
        const n=await openVault<Tokens>(secret(),user+':tokens',updated.tokens_cipher);
        if(n.expiresAt>now()+120)return n.accessToken;
      }
    }
    throw new PublicError('reconnect_feishu','授权更新尚未完成；稍后重试，若仍失败请重新连接飞书。',401);
  }
  try {
    const next=await tokenExchange(await config(r),{grant_type:'refresh_token',refresh_token:t.refreshToken});
    next.refreshToken=next.refreshToken || t.refreshToken;next.name=t.name;next.grantedScopes=next.grantedScopes??t.grantedScopes;
    const saved=await database().prepare('UPDATE connections SET tokens_cipher = ?,updated_at = ? WHERE user_id = ? AND revision = ? AND tokens_cipher = ?')
      .bind(await seal(secret(),user+':tokens',next),now(),user,r.revision,r.tokens_cipher).run();
    if(saved.meta.changes!==1)throw new PublicError('config_changed','连接已改变，请重试。',409);
    return next.accessToken;
  } catch(error) {
    // Never retry a possibly consumed refresh token after an ambiguous failure.
    await database().prepare('UPDATE connections SET tokens_cipher = NULL WHERE user_id = ? AND revision = ? AND tokens_cipher = ?')
      .bind(user,r.revision,r.tokens_cipher).run();
    throw error;
  }
}
export async function api(token:string,path:string,body?:unknown,method?:string):Promise<Record<string,unknown>> {
  const response=await fetch(API+path,{redirect:'manual',method:method??(body===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  if(!response.headers.get('content-type')?.includes('json'))throw new PublicError('unsupported_response','此工具返回了非 JSON 内容；当前转接层不支持二进制文件传输。',502);
  const payload=await response.json() as {code?:number;data?:Record<string,unknown>;msg?:string;error?:{permission_violations?:{subject?:string}[]}};
  if(!response.ok || payload.code!==0) {
    const code=typeof payload.code==='number'?String(payload.code):String(response.status);
    const issue=failureReport(payload,response.status,path,method??(body===undefined?'GET':'POST'));
    throw new PublicError('feishu_api_'+code,issue.message,502,issue.details);
  }
  return payload.data ?? {};
}
export async function searchDocuments(user:string,query:string,limit:number,offset:number) {
  const token=await currentToken(user);
  const data=await api(token,'/open-apis/suite/docs-api/search/object',{search_key:query,count:limit,offset});
  const items=Array.isArray(data.docs_entities)?data.docs_entities as Record<string,unknown>[]:[];
  const results=items.map(d=>({id:String(d.docs_token??''),title:String(d.title??''),type:String(d.docs_type??''),url:null as string|null}));
  let linksAvailable=true;
  if(results.length)try {
    const meta=await api(token,'/open-apis/drive/v1/metas/batch_query',{request_docs:results.map(d=>({doc_token:d.id,doc_type:d.type})),with_url:true});
    for(const m of (Array.isArray(meta.metas)?meta.metas:[]) as Record<string,unknown>[]) {
      const item=results.find(d=>d.id===m.doc_token);if(item && typeof m.url==='string')item.url=m.url;
    }
  } catch {linksAvailable=false;}
  const next=offset+results.length;
  return {results,has_more:!!data.has_more && next<199 && results.length>0,next_offset:!!data.has_more&&next<199&&results.length>0?next:null,
    search_limit_reached:!!data.has_more&&next>=199,links_available:linksAvailable,
    notice:'这是当前用户可见的云文档搜索结果；不代表已经遍历全部知识库。'};
}
export async function readDocument(user:string,reference:string,offset:number,maxChars:number,expectedHash?:string) {
  const ref=documentReference(reference),token=await currentToken(user);let documentId=ref.token;
  if(ref.kind==='wiki') {
    const data=await api(token,'/open-apis/wiki/v2/spaces/get_node?token='+encodeURIComponent(ref.token));
    const node=data.node as Record<string,unknown>|undefined;
    if(node?.obj_type!=='docx' || typeof node.obj_token!=='string')throw new PublicError('unsupported_document','此知识库节点不是新版文档，暂不支持读取。');
    documentId=node.obj_token;
  }
  const data=await api(token,'/open-apis/docx/v1/documents/'+encodeURIComponent(documentId)+'/raw_content');
  if(typeof data.content!=='string')throw new PublicError('unexpected_response','飞书未返回文档正文。',502);
  const hash=await digest(data.content);
  if(expectedHash && expectedHash!==hash)throw new PublicError('document_changed','文档在分段读取期间发生变化，请从头读取。',409);
  const chars=Array.from(data.content),end=Math.min(chars.length,offset+maxChars);
  return {document_id:documentId,url:ref.url??null,content:chars.slice(offset,end).join(''),content_hash:hash,total_chars:chars.length,
    next_offset:end<chars.length?end:null,truncated:end<chars.length,format:'plain_text'};
}
