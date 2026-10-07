import { PublicError } from './feishu-core';
export type Tokens={accessToken:string;refreshToken?:string;expiresAt:number;refreshExpiresAt?:number;name?:string;grantedScopes?:string[]};
export type AppConfig={appId:string;appSecret:string};
export class OAuthFailure extends PublicError {
  constructor(public kind:'retryable'|'invalid_grant'|'configuration'|'uncertain',public retryAfterMs=2000){
    const messages={retryable:'飞书授权服务暂时不可用，请稍后重试。现有连接已保留。',invalid_grant:'飞书已确认授权凭据失效，请重新连接。',configuration:'飞书拒绝应用凭据或请求配置，请检查应用配置。',uncertain:'授权续期结果未确认，已有连接数据已保留。请稍后核查连接状态。'};
    super('oauth_'+kind,messages[kind],kind==='invalid_grant'?401:503,{category:'oauth_'+kind,reauthorization_required:kind==='invalid_grant',retry_after_ms:retryAfterMs});
  }
}
export const OAUTH_TIMEOUT_MS=15000;
export async function tokenExchange(c:AppConfig,args:Record<string,string>):Promise<Tokens>{
  let response:Response;
  try{response=await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token',{redirect:'manual',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...args,client_id:c.appId,client_secret:c.appSecret}),signal:AbortSignal.timeout(OAUTH_TIMEOUT_MS)});}
  catch{throw new OAuthFailure('uncertain');}
  // A rate-limit or a confirmed server error is retryable; do not erase credentials.
  if(response.status===429||response.status>=500){
    const seconds=Number(response.headers.get('retry-after'));
    throw new OAuthFailure('retryable',Number.isFinite(seconds)&&seconds>0?Math.min(seconds*1000,60000):2000);
  }
  let data:{code?:number;error?:string;access_token?:string;refresh_token?:string;expires_in?:number;refresh_token_expires_in?:number;scope?:string};
  try{data=await response.json();}catch{throw new OAuthFailure('uncertain');}
  const validToken=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=16384&&!/[\s\x00-\x1f\x7f]/.test(v);
  const lifetime=Number(data.expires_in);
  if(!response.ok||(data.code!==undefined&&data.code!==0)||!validToken(data.access_token)||!Number.isSafeInteger(lifetime)||lifetime<=0||(data.refresh_token!==undefined&&!validToken(data.refresh_token))){
    if(data.error==='temporarily_unavailable'||data.error==='server_error'||data.code===99991400)throw new OAuthFailure('retryable');
    if(data.error==='invalid_grant')throw new OAuthFailure('invalid_grant');
    if(response.status===400||response.status===403||response.status===401)throw new OAuthFailure('configuration');
    throw new OAuthFailure('uncertain');
  }
  const now=Math.floor(Date.now()/1000);
  return {accessToken:data.access_token,refreshToken:data.refresh_token,expiresAt:now+Number(data.expires_in),...(Number(data.refresh_token_expires_in)>0?{refreshExpiresAt:now+Number(data.refresh_token_expires_in)}:{}),...(typeof data.scope==='string'?{grantedScopes:data.scope.split(/\s+/).filter(Boolean)}:{})};
}
