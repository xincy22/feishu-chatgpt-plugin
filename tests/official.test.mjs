import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/official-catalog.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {findOfficialTools,describeOfficialTool,prepareOfficialCall,officialProvenance}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('official catalogue includes user document, wiki, bitable, calendar and tasks',()=>{
 assert.equal(officialProvenance.tools,501);
 for(const project of ['docx','wiki','bitable','calendar','task','im'])assert(findOfficialTools('',project).total>0);
});
test('lookup preserves official input definitions',()=>{
 const t=describeOfficialTool('docx.v1.document.create');assert(t.inputSchema.properties.data);assert.equal(t.execute_with,'feishu_call_write_tool');
 assert.throws(()=>describeOfficialTool('invented.tool'));
});
test('read channel rejects writes before network dispatch',()=>{
 assert.throws(()=>prepareOfficialCall('docx.v1.document.create',{data:{title:'Example'}},false),/入口/);
 const c=prepareOfficialCall('docx.v1.document.create',{data:{title:'Example'}},true);assert.equal(c.method,'POST');assert.deepEqual(c.body,{title:'Example'});
});
test('identity override and caller-selected hosts are rejected',()=>{
 assert.throws(()=>prepareOfficialCall('docx.v1.document.create',{data:{title:'Example'},useUAT:false},true));
 assert.throws(()=>prepareOfficialCall('docx.v1.document.create',{url:'https://evil.example',data:{title:'Example'}},true));
 for(const id of ['..','a/b','a?b','a%2fb'])assert.throws(()=>prepareOfficialCall('docx.v1.document.get',{path:{document_id:id}},false));
});
test('required path and parameters are validated',()=>{
 assert.throws(()=>prepareOfficialCall('docx.v1.document.get',{},false));
 assert.throws(()=>prepareOfficialCall('docx.v1.document.create',{data:{title:22}},true));
 const c=prepareOfficialCall('docx.v1.document.get',{path:{document_id:'safe_doc_id'}},false);assert.equal(c.path,'/open-apis/docx/v1/documents/safe_doc_id');
});
test('wiki creation and table updates preserve method and body',()=>{
 const c=prepareOfficialCall('wiki.v2.spaceNode.create',{path:{space_id:'12345'},data:{obj_type:'docx',node_type:'origin',title:'Sample'}},true);assert.equal(c.method,'POST');assert.equal(c.path,'/open-apis/wiki/v2/spaces/12345/nodes');
 const b=prepareOfficialCall('bitable.v1.appTableRecord.update',{path:{app_token:'appABC',table_id:'tblABC',record_id:'recABC'},data:{fields:{Name:'Updated'}}},true);assert.equal(b.method,'PUT');assert.equal(b.body.fields.Name,'Updated');
});
test('personal library is exposed separately from team spaces',()=>{
 const t=describeOfficialTool('feishu.library.list');assert.equal(t.read_only,true);
 const c=prepareOfficialCall('feishu.library.list',{params:{page_size:30}},false);assert.equal(c.path,'/open-apis/wiki/v2/spaces/my_library/nodes?page_size=30');
 assert(findOfficialTools('文档库').tools.some(t=>t.name==='feishu.library.list'));
});
test('record search is a read action even with POST transport',()=>{
 assert.equal(describeOfficialTool('bitable.v1.appTableRecord.search').execute_with,'feishu_call_read_tool');
 const c=prepareOfficialCall('bitable.v1.appTableRecord.search',{path:{app_token:'appABC',table_id:'tblABC'},params:{page_size:3},data:{}},false);
 assert.equal(c.method,'POST');assert.equal(c.path,'/open-apis/bitable/v1/apps/appABC/tables/tblABC/records/search?page_size=3');
 assert.throws(()=>prepareOfficialCall('bitable.v1.appTableRecord.update',{path:{app_token:'appABC',table_id:'tblABC',record_id:'recABC'},data:{fields:{Name:'x'}}},false));
});
