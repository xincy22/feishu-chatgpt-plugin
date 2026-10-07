import { PublicError,random,digest,seal,openVault } from './feishu-core';
import { tokenExchange,OAuthFailure,type Tokens,type AppConfig } from './oauth-client';
export type ConnectionRow={user_id:string;revision:string;app_id:string;config_cipher:string;tokens_cipher:string|null;updated_at:number;authorization_nonce?:string|null};
type Lease={user_id:string;revision:string;token_hash:string;owner:string;phase:string;expires_at:number;retry_at:number;pending_cipher:string|null;error_kind:string|null};
const LEASE_MS=30000,WAIT_MS=28000,POLL_MS=100;
const now=()=>Math.floor(Date.now()/1000);
export async function connectionRow(db:D1Database,user:string){return db.prepare('SELECT * FROM connections WHERE user_id = ?').bind(user).first<ConnectionRow>();}
const temporary=()=>new PublicError('refresh_in_progress','授权正在续期，请稍后重试。无需重新授权。',503,{category:'refresh_in_progress',reauthorization_required:false,retry_after_ms:1000});
export async function currentUserToken(db:D1Database,key:string,user:string):Promise<string>{
  const deadline=Date.now()+WAIT_MS;
  while(Date.now()<deadline){
    const r=await connectionRow(db,user);
    if(!r?.tokens_cipher)throw new PublicError('connect_feishu','请先打开连接页面并授权飞书。',401);
    const t=await openVault<Tokens>(key,user+':tokens',r.tokens_cipher);
    if(t.expiresAt>now()+120)return t.accessToken;
    if(!t.refreshToken||(t.refreshExpiresAt!==undefined&&t.refreshExpiresAt<=now())){
      if(t.expiresAt>now()+30)return t.accessToken;
      throw new PublicError('reconnect_feishu','授权凭据已过期，请重新连接飞书。',401,{category:'authentication_invalid',reauthorization_required:true});
    }
    const hash=await digest(r.tokens_cipher),owner=random(),at=Date.now();
    const claimed=await db.prepare(`INSERT INTO refresh_leases (user_id,revision,token_hash,owner,phase,expires_at,retry_at,pending_cipher,error_kind) VALUES (?,?,?,?,'claimed',?,0,NULL,NULL)
      ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,token_hash=excluded.token_hash,owner=excluded.owner,phase='claimed',expires_at=excluded.expires_at,retry_at=0,pending_cipher=NULL,error_kind=NULL
      WHERE refresh_leases.revision<>excluded.revision OR refresh_leases.token_hash<>excluded.token_hash OR (refresh_leases.phase='claimed' AND refresh_leases.expires_at<=?) OR (refresh_leases.phase='retryable' AND refresh_leases.retry_at<=?)`)
      .bind(user,r.revision,hash,owner,at+LEASE_MS,at,at).run();
    if(claimed.meta.changes===1)return refreshOwner(db,key,r,t,hash,owner);
    const lease=await db.prepare('SELECT * FROM refresh_leases WHERE user_id = ?').bind(user).first<Lease>();
    if(!lease)continue;
    if(lease.revision!==r.revision||lease.token_hash!==hash)continue;
    if(lease.phase==='ready'&&lease.pending_cipher){
      if(await commitPending(db,r,lease.owner,lease.pending_cipher))return (await openVault<Tokens>(key,user+':tokens',lease.pending_cipher)).accessToken;
      continue;
    }
    if(lease.phase==='requesting'&&lease.expires_at<=Date.now()){
      // A crashed outbound request may have rotated the refresh token. Never blindly replay it.
      await db.prepare("UPDATE refresh_leases SET phase='uncertain' WHERE user_id=? AND owner=? AND phase='requesting' AND expires_at<=?").bind(user,lease.owner,Date.now()).run();
      continue;
    }
    if(t.expiresAt>now()+30)return t.accessToken; // valid access still works while a refresh is pending
    if(lease.phase==='retryable')throw new OAuthFailure('retryable',Math.max(1000,lease.retry_at-Date.now()));
    if(lease.phase==='blocked')throw new OAuthFailure('configuration');
    if(lease.phase==='uncertain')throw new PublicError('refresh_uncertain','续期响应未确认，不能安全重放旧 refresh token。请重新连接以恢复，现有凭据未被删除。',503,{category:'refresh_uncertain',reauthorization_required:true});
    await new Promise(resolve=>setTimeout(resolve,POLL_MS));
  }
  throw temporary();
}
async function commitPending(db:D1Database,r:ConnectionRow,owner:string,cipher:string){
  const saved=await db.prepare('UPDATE connections SET tokens_cipher=?,updated_at=? WHERE user_id=? AND revision=? AND tokens_cipher=?')
    .bind(cipher,now(),r.user_id,r.revision,r.tokens_cipher).run();
  if(saved.meta.changes===1){await db.prepare('DELETE FROM refresh_leases WHERE user_id=? AND owner=?').bind(r.user_id,owner).run();return true;}
  const current=await connectionRow(db,r.user_id);
  if(current?.tokens_cipher===cipher){await db.prepare('DELETE FROM refresh_leases WHERE user_id=? AND owner=?').bind(r.user_id,owner).run();return true;}
  return false;
}
async function retryDatabase<T>(run:()=>Promise<T>){
  let failure:unknown;
  for(let i=0;i<4;i++){try{return await run();}catch(e){failure=e;await new Promise(r=>setTimeout(r,100*(i+1)));}}
  throw failure;
}
async function refreshOwner(db:D1Database,key:string,r:ConnectionRow,t:Tokens,hash:string,owner:string){
  // Load/verify the app before recording an outbound request; a stale claimed lease can recover.
  const c=await openVault<AppConfig>(key,r.user_id+':config',r.config_cipher);
  const marked=await db.prepare("UPDATE refresh_leases SET phase='requesting' WHERE user_id=? AND owner=? AND phase='claimed' AND expires_at>? AND EXISTS (SELECT 1 FROM connections WHERE user_id=? AND revision=? AND tokens_cipher=?)")
    .bind(r.user_id,owner,Date.now(),r.user_id,r.revision,r.tokens_cipher).run();
  if(marked.meta.changes!==1)throw temporary();
  let next:Tokens;
  try{next=await tokenExchange(c,{grant_type:'refresh_token',refresh_token:t.refreshToken!});}
  catch(error){
    const kind=error instanceof OAuthFailure?error.kind:'uncertain';
    if(kind==='invalid_grant'){
      const invalidated=await db.prepare('UPDATE connections SET tokens_cipher=NULL WHERE user_id=? AND revision=? AND tokens_cipher=?').bind(r.user_id,r.revision,r.tokens_cipher).run();
      if(invalidated.meta.changes!==1)throw new PublicError('connection_changed','较新的连接已经取代此请求，请刷新状态后重试。',409,{reauthorization_required:false});
      await db.prepare('DELETE FROM refresh_leases WHERE user_id=? AND owner=?').bind(r.user_id,owner).run();
    }else{
      const phase=kind==='retryable'?'retryable':kind==='configuration'?'blocked':'uncertain';
      const after=error instanceof OAuthFailure?error.retryAfterMs:2000;
      await retryDatabase(()=>db.prepare('UPDATE refresh_leases SET phase=?,retry_at=?,error_kind=? WHERE user_id=? AND owner=?')
        .bind(phase,Date.now()+after,kind,r.user_id,owner).run());
      if(t.expiresAt>now()+30)return t.accessToken;
    }
    throw error;
  }
  if(!next.refreshToken){next.refreshToken=t.refreshToken;next.refreshExpiresAt=next.refreshExpiresAt??t.refreshExpiresAt;}next.name=t.name;next.grantedScopes=next.grantedScopes??t.grantedScopes;
  const cipher=await seal(key,r.user_id+':tokens',next);
  // Persist the rotated token before applying it. Followers can finish a saved result after a crash.
  const pending=await retryDatabase(()=>db.prepare("UPDATE refresh_leases SET phase='ready',pending_cipher=? WHERE user_id=? AND owner=? AND token_hash=?")
    .bind(cipher,r.user_id,owner,hash).run());
  if(pending.meta.changes!==1)throw new PublicError('connection_changed','连接已改变，请重试。',409);
  if(!await retryDatabase(()=>commitPending(db,r,owner,cipher)))throw new PublicError('connection_changed','连接已改变，请重试。',409);
  return next.accessToken;
}
