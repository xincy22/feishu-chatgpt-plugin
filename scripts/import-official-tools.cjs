// Import a pinned, locally unpacked official MCP release. No user credentials.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {z}=require('zod');const {zodToJsonSchema}=require('zod-to-json-schema');
const root=process.argv[2];if(!root)throw Error('Pass unpacked official package directory');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const catalogue=[];const seen=new Set();
for(const file of fs.readdirSync(path.join(root,'dist/mcp-tool/tools/zh/gen-tools/zod')).filter(f=>f.endsWith('.js'))){
 const exports={};vm.runInNewContext(fs.readFileSync(path.join(root,'dist/mcp-tool/tools/zh/gen-tools/zod',file),'utf8'),{exports,require:n=>{if(n==='zod')return {z};throw Error(n)}});
 for(const tool of Object.values(exports)){
  if(!tool?.name||!tool.accessTokens?.includes('user')||seen.has(tool.name))continue;
  if(!/^\/open-apis\//.test(tool.path)||!['GET','POST','PUT','PATCH','DELETE'].includes(tool.httpMethod))continue;
  seen.add(tool.name);
  const shape={...tool.schema};delete shape.useUAT;
  const inputSchema=zodToJsonSchema(z.object(shape).strict(),{$refStrategy:'none'});
  delete inputSchema.$schema;
  const readOnly=tool.httpMethod==='GET'; // conservatively classify POST searches as writes
  catalogue.push({name:tool.name,project:tool.project,description:tool.description,path:tool.path,method:tool.httpMethod,readOnly,inputSchema});
 }
}
catalogue.sort((a,b)=>a.name.localeCompare(b.name));
fs.writeFileSync('lib/generated/official-tools.json',JSON.stringify(catalogue));
fs.copyFileSync(path.join(root,'LICENSE'),'lib/generated/OFFICIAL-MCP-LICENSE');
const meta={package:'@larksuiteoapi/lark-mcp',version,source:'https://github.com/larksuite/lark-openapi-mcp',tools:catalogue.length,projects:[...new Set(catalogue.map(t=>t.project))]};
fs.writeFileSync('lib/generated/provenance.json',JSON.stringify(meta,null,2)+'\n');console.log(JSON.stringify(meta));
