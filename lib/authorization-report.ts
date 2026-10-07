import { SCOPES } from './feishu-core';
export function scopeReport(grantedScopes?:string[]) {
  return {scopes:grantedScopes??null,scopes_known:grantedScopes!==undefined,
    scopes_source:grantedScopes!==undefined?'feishu_token_response':'unknown_for_existing_token',
    authorization_request_scopes:SCOPES,
    authorization_notice:'authorization_request_scopes 是登录时的默认请求列表，不代表当前 token 的完整授权。scopes=null 表示未知，不代表只读或没有权限。确认能力应调用用户要求的具体操作；只有明确的 OAuth 缺失或授权失效才要求重新授权。'};
}
export type FeishuFailurePayload={code?:number;msg?:string;error?:{permission_violations?:{subject?:string}[]}};
export function failureReport(payload:FeishuFailurePayload,status:number,path:string,method:string){
 const code=payload.code??status;
 const options=[...new Set([...(payload.error?.permission_violations??[]).map(v=>v.subject??''),...(payload.msg??'').matchAll(/\b(?:base|bitable|wiki|drive|docx|docs|contact|im|task|calendar):[a-z_][a-z0-9_.]*(?::[a-z_][a-z0-9_.]*)*\b/g)].map(v=>typeof v==='string'?v:v[0]).filter(v=>/^[a-z_]+:[a-z0-9_.:]+$/.test(v)))];
 let category='upstream_error',reauthorization:boolean|null=null;
 let guidance='请保留失败的工具名称和目标参数继续排查，不能仅凭此错误断言需要重新授权。';
 if(code===99991679||options.length){category='missing_oauth_scope';reauthorization=true;guidance='飞书明确返回缺少 OAuth 权限。请核对列出的权限选项，开通并授权所需的一项；不能把所有备选权限都当作必需。';}
 else if(code===131002){category='invalid_api_parameters';reauthorization=false;guidance='知识库请求参数不符合要求，请先核对 page_size（最多50）、分页标记和节点参数。不要将此错误解释成缺少 OAuth 权限，也不要要求重新授权。';}
 else if(code===130102){category='resource_access_denied';guidance='飞书拒绝访问目标知识空间或节点。先核对 space_id、parent_node_token 和当前账号的资源权限；这不是 OAuth 权限缺失的直接证据，请勿直接要求重新授权。';}
 else if(code===131005){category='resource_or_parameter_error';guidance='先核对节点 token 和空间 ID。my_library 是空间别名，不能作为 parent_node_token；根目录应省略 parent_node_token。请勿直接要求重新授权。';}
 else if(code===99991663||status===401){category='authentication_invalid';reauthorization=true;guidance='飞书返回认证凭据无效；确认自动续期是否失败后，才需要重新连接。';}
 const parsed=new URL(path,'https://open.feishu.cn');
 const target:Record<string,string>={};for(const k of ['parent_node_token','token']){const v=parsed.searchParams.get(k);if(v&&/^[A-Za-z0-9_-]{1,256}$/.test(v))target[k]=v;}
 return {message:'飞书请求失败（'+code+'）。'+guidance,
   details:{category,reauthorization_required:reauthorization,scope_options:options,api_path:parsed.pathname,api_method:method,target}};
}
