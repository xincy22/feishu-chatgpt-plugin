import { POST as callTool } from '@/app/mcp/route';
import { requireIdentity,requireSameOrigin,publicIssue } from '@/lib/feishu-core';
import { siteOrigin } from '@/lib/feishu-service';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  try { requireIdentity(request);requireSameOrigin(request,siteOrigin());return await callTool(request); }
  catch(error){const issue=publicIssue(error);return Response.json({error:{message:issue.message}},{status:issue.status,headers:{'Cache-Control':'no-store'}});}
}
