import { z } from 'zod';
import { PLUGIN_INSTRUCTIONS } from '@/lib/plugin-instructions';
import { findOfficialTools,describeOfficialTool,prepareOfficialCall } from '@/lib/official-catalog';
import { requireIdentity,publicIssue } from '@/lib/feishu-core';
import { status,searchDocuments,readDocument,siteOrigin,currentToken,api } from '@/lib/feishu-service';
export const dynamic='force-dynamic';
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const tools=[
  {name:"feishu_find_tools",description:"查找飞书官方工具。支持文档 docx、知识库 wiki、多维表格 bitable、消息 im、日历 calendar、任务 task 等；可用英文动作如 create/list/update 或中文关键词搜索。先查找，再用 describe 获取参数。",inputSchema:{type:"object",properties:{query:{type:"string",default:""},project:{type:"string"},offset:{type:"integer",minimum:0,default:0},limit:{type:"integer",minimum:1,maximum:30,default:12}},additionalProperties:false},annotations},
  {name:"feishu_describe_tool",description:"返回指定官方工具的完整参数定义及读写调用入口。使用前先检查定义；不要猜测资源 ID。",inputSchema:{type:"object",properties:{name:{type:"string"}},required:["name"],additionalProperties:false},annotations},
  ...[false,true].map(write=>({name:write?"feishu_call_write_tool":"feishu_call_read_tool",description:write?"以当前飞书用户身份执行官方写工具。必须先 describe 检查参数，且仅在用户要求具体写入时调用。行间公式使用独立公式段落并居中（text.style.align=2），行内公式保持正文对齐。消息、评论发送需要明确指示；删除、权限、成员变更需明确目标和授权。先读目标；超时或错误后先核查结果，不可盲目重试。":"以当前飞书用户身份执行官方只读工具（包括已核对的 POST 查询）。先 describe 获取参数，不能调用写接口。多维表格记录用 bitable.v1.appTableRecord.search，不要优先使用旧版 list。",inputSchema:{type:"object",properties:{name:{type:"string"},arguments:{type:"object",additionalProperties:true}},required:["name","arguments"],additionalProperties:false},annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:!write,openWorldHint:true}})),
  {name:'feishu_connection_status',title:'检查飞书连接',description:'检查当前用户的连接状态。scopes=null 表示实际授权未知；authorization_request_scopes 仅为默认请求列表，不能据此判断只有只读权限。错误 130102 应先检查目标空间和节点，不可直接要求重新授权。尚未连接时打开返回的 connect_url 完成配置和授权。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations},
  {name:'feishu_search_documents',title:'搜索飞书云文档',description:'按关键词搜索当前用户可见的飞书云文档，返回标题、资源 ID 和链接。支持分页；部分文档链接可能因权限不足而缺失。不是全部知识库的穷尽搜索。',inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:200},limit:{type:'integer',minimum:1,maximum:20,default:10},offset:{type:'integer',minimum:0,maximum:198,default:0}},required:['query'],additionalProperties:false},annotations},
  {name:'feishu_read_document',title:'读取飞书文档',description:'读取指定 docx 文档或 wiki 文档节点的纯文本，不包含图片或表格文件内部数据。truncated=true 时使用 next_offset 继续，并传回 content_hash 作为 expected_hash 避免混合版本。',inputSchema:{type:'object',properties:{reference:{type:'string',minLength:1,maxLength:2048},offset:{type:'integer',minimum:0,default:0},max_chars:{type:'integer',minimum:100,maximum:20000,default:12000},expected_hash:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['reference'],additionalProperties:false},annotations},
];
const respond=(v:unknown,code=200)=>Response.json(v,{status:code,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request) {
  if(!request.headers.get('content-type')?.includes('application/json'))return respond({error:'application/json required'},415);
  let body:Record<string,unknown>;
  try{const raw=await request.text();if(raw.length>250000)return respond({error:'request too large'},413);body=JSON.parse(raw);}
  catch{return respond({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},400);}
  if(!body || Array.isArray(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string')return respond({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}},400);
  if(!('id' in body))return new Response(null,{status:202});
  const id=body.id;
  if(typeof id!=='string'&&typeof id!=='number')return respond({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid id'}},400);
  const result=(data:unknown)=>respond({jsonrpc:'2.0',id,result:data});
  const error=(code:number,message:string)=>respond({jsonrpc:'2.0',id,error:{code,message}});
  if(body.method==='initialize') {
    const requested=(body.params as {protocolVersion?:string}|undefined)?.protocolVersion;
    return result({protocolVersion:['2024-11-05','2025-03-26','2025-06-18'].includes(requested??'')?requested:'2025-06-18',
      capabilities:{tools:{}},serverInfo:{name:'feishu-personal-cloud',version:'0.3.1'},
      instructions:PLUGIN_INSTRUCTIONS});
  }
  if(body.method==='ping')return result({});
  if(body.method==='tools/list')return result({tools});
  if(body.method!=='tools/call')return error(-32601,'Method not found');
  try {
    const user=requireIdentity(request);
    const params=z.object({name:z.string(),arguments:z.record(z.unknown()).optional()}).passthrough().parse(body.params);
    const args=params.arguments??{};let data:unknown;
    if(params.name==='feishu_find_tools'){
      const a=z.object({query:z.string().max(200).default(''),project:z.string().max(50).optional(),offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(30).default(12)}).strict().parse(args);
      data=findOfficialTools(a.query,a.project,a.offset,a.limit);
    } else if(params.name==='feishu_describe_tool'){
      const a=z.object({name:z.string().max(200)}).strict().parse(args);data=describeOfficialTool(a.name);
    } else if(params.name==='feishu_call_read_tool'||params.name==='feishu_call_write_tool'){
      const a=z.object({name:z.string().max(200),arguments:z.record(z.unknown())}).strict().parse(args);
      const call=prepareOfficialCall(a.name,a.arguments,params.name==='feishu_call_write_tool');
      data=await api(await currentToken(user),call.path,call.body,call.method);
    } else if(params.name==='feishu_connection_status'){z.object({}).strict().parse(args);data=await status(user);}
    else if(params.name==='feishu_search_documents'){
      const a=z.object({query:z.string().trim().min(1).max(200),limit:z.number().int().min(1).max(20).default(10),offset:z.number().int().min(0).max(198).default(0)}).strict().parse(args);
      data=await searchDocuments(user,a.query,Math.min(a.limit,199-a.offset),a.offset);
    } else if(params.name==='feishu_read_document'){
      const a=z.object({reference:z.string().min(1).max(2048),offset:z.number().int().min(0).max(10000000).default(0),max_chars:z.number().int().min(100).max(20000).default(12000),expected_hash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().parse(args);
      data=await readDocument(user,a.reference,a.offset,a.max_chars,a.expected_hash);
    } else return error(-32602,'Unknown tool');
    return result({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
  }catch(e){
    if(e instanceof z.ZodError)return error(-32602,'Invalid tool arguments');
    if(!(e instanceof Error && 'code' in e))console.error('MCP internal failure',e instanceof Error?e.name:typeof e,e instanceof Error?e.stack?.split('\n').slice(1,4).join('\n'):'');
    const issue=publicIssue(e);let connectUrl:string|undefined;try{connectUrl=siteOrigin();}catch{}
    if(issue.code==='sign_in_required')return respond({jsonrpc:'2.0',id,error:{code:-32001,message:issue.message}},401);
    return result({isError:true,content:[{type:'text',text:JSON.stringify({code:issue.code,message:issue.message,...('details' in issue?{details:issue.details}:{}),connect_url:connectUrl})}]});
  }
}
