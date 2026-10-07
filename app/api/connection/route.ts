import { z } from 'zod';
import { requireIdentity, requireSameOrigin, publicIssue } from '@/lib/feishu-core';
import { status, saveConfig, authorize, siteOrigin, disconnect } from '@/lib/feishu-service';
export const dynamic='force-dynamic';
const reply=(data:unknown,code=200)=>Response.json(data,{status:code,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request) {
  try{return reply(await status(requireIdentity(request)));}
  catch(error){const e=publicIssue(error);return reply(e,e.status);}
}
export async function POST(request:Request) {
  try {
    const user=requireIdentity(request);requireSameOrigin(request,siteOrigin());
    const raw=await request.text();if(raw.length>4096)return reply({message:'请求内容过长。'},413);
    const body=z.discriminatedUnion('action',[
      z.object({action:z.literal('configure'),app_id:z.string().trim(),app_secret:z.string().trim()}).strict(),
      z.object({action:z.literal('authorize'),profiles:z.array(z.enum(['read','documents_write','bitable_write'])).max(10).optional(),extra_scopes:z.array(z.string().max(128)).max(100).optional()}).strict(),
      z.object({action:z.literal('disconnect')}).strict(),
    ]).parse(JSON.parse(raw));
    if(body.action==='configure'){await saveConfig(user,body.app_id,body.app_secret);return reply({ok:true});}
    if(body.action==='disconnect'){await disconnect(user);return reply({ok:true});}
    return reply({url:await authorize(user,body.profiles,body.extra_scopes)});
  }catch(error){if(error instanceof z.ZodError || error instanceof SyntaxError)return reply({message:'输入格式不正确。'},400);const e=publicIssue(error);return reply(e,e.status);}
}
