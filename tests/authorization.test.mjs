import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const b=await build({entryPoints:['lib/authorization-report.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {scopeReport,failureReport}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
test('default requested permissions do not imply read-only authorization',()=>{
 const s=scopeReport();assert.equal(s.scopes,null);assert.equal(s.scopes_known,false);assert(s.authorization_request_scopes.includes('docx:document:readonly'));
 const known=scopeReport(['docx:document:create']);assert.deepEqual(known.scopes,['docx:document:create']);assert(known.scopes_known);
});
test('130102 is resource denial, not a request to reauthorize',()=>{
 const e=failureReport({code:130102},400,'/open-apis/wiki/v2/spaces/123/nodes?parent_node_token=nodeABC','GET');
 assert.equal(e.details.category,'resource_access_denied');assert.equal(e.details.reauthorization_required,null);assert.equal(e.details.target.parent_node_token,'nodeABC');
});
test('scope alternatives are preserved without leaking upstream messages',()=>{
 const e=failureReport({code:99991679,msg:'secret-token; one scope required: base:record:retrieve bitable:app:readonly'},400,'/open-apis/bitable/v1/apps/appABC/tables/tblABC/records/search','POST');
 assert.deepEqual(e.details.scope_options,['base:record:retrieve','bitable:app:readonly']);assert.equal(e.details.reauthorization_required,true);assert(!JSON.stringify(e).includes('secret-token'));
});
test('unknown and invalid-resource errors do not demand authorization',()=>{
 for(const code of [131005,999999])assert.equal(failureReport({code},400,'/open-apis/x','GET').details.reauthorization_required,null);
});

test('131002 is a parameter error and must never request reauthorization',()=>{
 const e=failureReport({code:131002},400,'/open-apis/wiki/v2/spaces/my_library/nodes?page_size=100','GET');
 assert.equal(e.details.category,'invalid_api_parameters');assert.equal(e.details.reauthorization_required,false);
});
