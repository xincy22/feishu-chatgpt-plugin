import { requireIdentity, publicIssue } from '@/lib/feishu-core';
import { finishAuthorization, siteOrigin } from '@/lib/feishu-service';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const url=new URL(request.url);
  try {
    await finishAuthorization(requireIdentity(request),url.searchParams.get('state')??'',url.searchParams.get('code'),url.searchParams.has('error'));
    return Response.redirect(siteOrigin()+'/?result=connected',303);
  } catch(error) {
    const e=publicIssue(error);
    return Response.redirect(siteOrigin()+'/?result=error&reason='+encodeURIComponent(e.message),303);
  }
}
