import { Validator, type Schema } from '@cfworker/json-schema';
import catalogue from './generated/official-tools.json';
import provenance from './generated/provenance.json';
import { PublicError } from './feishu-core';
export type OfficialTool={name:string;project:string;description:string;path:string;method:string;readOnly:boolean;inputSchema:Schema};
const officialEntries=catalogue as unknown as OfficialTool[];
const readonlyPost=new Set(['bitable.v1.appTableRecord.search','wiki.v1.node.search']);
const entries:OfficialTool[]=officialEntries.map(t=>({...t,readOnly:t.readOnly||readonlyPost.has(t.name)}));
for(const [name,path,description,source] of [
  ['feishu.library.list','/open-apis/wiki/v2/spaces/my_library/nodes','我的文档库：列出个人文档库根节点或指定父节点的子节点。不是云盘根目录，也不在团队知识空间列表中。支持分页。','wiki.v2.spaceNode.list'],
  ['feishu.library.get','/open-apis/wiki/v2/spaces/my_library','获取我的文档库信息和真实 space_id。','wiki.v2.space.get'],
]){
 const origin=officialEntries.find(t=>t.name===source)!;
 const schema=structuredClone(origin.inputSchema) as Schema & {properties:Record<string,unknown>;required?:string[]};
 delete schema.properties.path;schema.required=schema.required?.filter(k=>k!=='path');
 entries.push({name,project:'wiki',description,path,method:'GET',readOnly:true,inputSchema:schema});
}
const registry=new Map(entries.map(t=>[t.name,t]));
export const officialProvenance=provenance;
export function findOfficialTools(query:string,project?:string,offset=0,limit=12){
 const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 const found=entries.filter(t=>(!project||t.project===project)&&terms.every(q=>(t.name+' '+t.description).toLowerCase().includes(q)));
 return {source:provenance.source,version:provenance.version,total:found.length,projects:provenance.projects,
 tools:found.slice(offset,offset+limit).map(t=>({name:t.name,project:t.project,description:t.description,read_only:t.readOnly})),next_offset:offset+limit<found.length?offset+limit:null};
}
export function officialTool(name:string){const t=registry.get(name);if(!t)throw new PublicError('unknown_tool','官方工具名称不存在，请先查找工具。');return t;}
export function describeOfficialTool(name:string){const t=officialTool(name);return {name:t.name,description:t.description,inputSchema:t.inputSchema,read_only:t.readOnly,execute_with:t.readOnly?'feishu_call_read_tool':'feishu_call_write_tool',identity:'current_user',notice:(name==='bitable.v1.appTableRecord.list'?'此为旧版记录列表，优先使用 bitable.v1.appTableRecord.search（只读查询）读取字段值。':'')+(name==='wiki.v2.space.list'?'此列表不含“我的文档库”，请使用 feishu.library.list/get。':'')+'使用官方参数结构（path、params、data）。无需传递凭据或 useUAT。写入前应先读取目标；写入失败不得假定未生效或自动重试。二进制上传下载不支持。'};}
export function prepareOfficialCall(name:string,args:unknown,write:boolean){
 const t=officialTool(name);if(t.readOnly===write)throw new PublicError('wrong_execution_channel','请按工具说明选择读或写调用入口。');
 const checked=new Validator(t.inputSchema,'7',false).validate(args);
 if(!checked.valid)throw new PublicError('invalid_arguments','参数不符合官方工具定义：'+checked.errors.slice(0,3).map(e=>e.instanceLocation+' '+e.keyword).join('; '));
 const a=args as {path?:Record<string,unknown>;params?:Record<string,unknown>;data?:unknown};
 const pathname=t.path.replace(/:([A-Za-z0-9_]+)/g,(_,key)=>{
  const v=a.path?.[key];if(typeof v!=='string'||!v||v==='.'||v==='..'||v.length>512||/[\/?#%\\\x00-\x20]/.test(v))throw new PublicError('invalid_path','缺少或无效的目标资源 ID：'+key);
  return encodeURIComponent(v);
 });
 if(!pathname.startsWith('/open-apis/')||pathname.includes('://'))throw new PublicError('invalid_path','目标 API 路径无效。');
 const query=new URLSearchParams();
 const append=(key:string,value:unknown):void=>{
  if(value===undefined||value===null)return;
  if(Array.isArray(value)){for(const item of value)append(key,item);return;}
  if(typeof value==='object'){for(const [k,v] of Object.entries(value))append(key+'['+k+']',v);return;}
  query.append(key,String(value));
 };
 for(const [k,v]of Object.entries(a.params??{}))append(k,v);
 return {path:pathname+(query.size?'?'+query.toString():''),method:t.method,body:a.data};
}
