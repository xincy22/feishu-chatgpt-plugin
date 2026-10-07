import { PublicError, SCOPES } from './feishu-core';
export const AUTHORIZATION_PROFILES = {
  read: {label:'基础读取',scopes:SCOPES},
  documents_write: {label:'文档和知识库：创建与编辑',scopes:['docx:document:create','docx:document:write_only','wiki:node:create']},
  bitable_write: {label:'多维表格任务：新增与更新记录',scopes:['base:record:create','base:record:update']},
} as const;
export type AuthorizationProfile=keyof typeof AUTHORIZATION_PROFILES;
export function authorizationScopes(profiles:AuthorizationProfile[]=['read'],extra:string[]=[]){
  if(profiles.length>10||extra.length>100)throw new PublicError('invalid_scopes','请求的权限过多。');
  for(const p of profiles)if(!Object.hasOwn(AUTHORIZATION_PROFILES,p))throw new PublicError('invalid_scopes','未知的授权功能。');
  for(const s of extra)if(!/^[a-z][a-z0-9_.]*(?::[a-z][a-z0-9_.]*){1,4}$/.test(s)||s.length>128)throw new PublicError('invalid_scopes','额外权限名称无效。');
  return [...new Set([...SCOPES,...profiles.flatMap(p=>[...AUTHORIZATION_PROFILES[p].scopes]),...extra])];
}
