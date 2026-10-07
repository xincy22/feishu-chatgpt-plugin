import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const sql=new DatabaseSync(':memory:');
for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8').replaceAll('--> statement-breakpoint',''));
let failureHook=null;
const DB={prepare(text){return{bind(...args){return{
 async first(){return sql.prepare(text).get(...args)??null},
 async run(){if(failureHook)failureHook(text);const r=sql.prepare(text).run(...args);return{meta:{changes:Number(r.changes)}}},
}}}},async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
globalThis.__serviceEnv={DB,FEISHU_VAULT_KEY:Buffer.alloc(32,7).toString('base64'),SITE_ORIGIN:'https://service.test'};
async function load(file){const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'service-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__serviceEnv',loader:'js'}))}}]});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'))}
const service=await load('lib/feishu-service.ts'),core=await load('lib/feishu-core.ts');
const nativeFetch=globalThis.fetch;
async function seed(user='alice',expiresAt=Math.floor(Date.now()/1000)-1){
 for(const table of ['connections','oauth_states','refresh_leases','refresh_claims'])sql.exec('DELETE FROM '+table);
 failureHook=null;
 await service.saveConfig(user,'cli_test123','dummy-app-secret');
 const tokens={accessToken:'old-access',refreshToken:'old-refresh',expiresAt};
 const cipher=await core.seal(__serviceEnv.FEISHU_VAULT_KEY,user+':tokens',tokens);
 sql.prepare('UPDATE connections SET tokens_cipher=? WHERE user_id=?').run(cipher,user);
 return {user,cipher,row:sql.prepare('SELECT * FROM connections WHERE user_id=?').get(user)};
}
const success=()=>Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:7200,scope:'offline_access docx:document:readonly'});
const stored=()=>sql.prepare('SELECT tokens_cipher FROM connections WHERE user_id=?').get('alice')?.tokens_cipher;

test('first grant can explicitly request document/wiki and Bitable writes',async()=>{
 await seed();const url=new URL(await service.authorize('alice',['documents_write','bitable_write'],['calendar:calendar:read']));
 const scopes=url.searchParams.get('scope').split(' ');
 for(const scope of ['docx:document:create','docx:document:write_only','wiki:node:create','base:record:update','calendar:calendar:read'])assert(scopes.includes(scope));
 assert.equal(scopes.length,new Set(scopes).size);
 await assert.rejects(()=>service.authorize('alice',['invalid']),/未知/);
 await assert.rejects(()=>service.authorize('alice',['read'],['bad scope&state=attack']),/无效/);
});
test('callback state belongs to its user and is single-use',async()=>{
 await seed();const state=new URL(await service.authorize('alice')).searchParams.get('state');let exchanges=0;
 globalThis.fetch=async url=>{if(String(url).includes('/oauth/token')){exchanges++;return success()}return Response.json({code:0,data:{name:'Alice'}})};
 await assert.rejects(()=>service.finishAuthorization('bob',state,'code',false),/过期或已使用/);
 await service.finishAuthorization('alice',state,'code',false);
 await assert.rejects(()=>service.finishAuthorization('alice',state,'code',false),/过期或已使用/);
 assert.equal(exchanges,1);
});
test('a later authorization request invalidates an older pending state',async()=>{
 await seed();const old=new URL(await service.authorize('alice')).searchParams.get('state');const latest=new URL(await service.authorize('alice')).searchParams.get('state');
 globalThis.fetch=async url=>String(url).includes('/oauth/token')?success():Response.json({code:0,data:{}});
 await assert.rejects(()=>service.finishAuthorization('alice',old,'code',false));
 await service.finishAuthorization('alice',latest,'code',false);
});
test('429 preserves tokens and a later refresh can recover',async()=>{
 const {cipher}=await seed();let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'1'}})};
 await assert.rejects(()=>service.currentToken('alice'),e=>e.code==='oauth_retryable'&&e.status===503);
 assert.equal(stored(),cipher);assert.equal((await service.status('alice')).connected,true);
 await assert.rejects(()=>service.currentToken('alice'),e=>e.code==='oauth_retryable');assert.equal(calls,1);
 sql.exec('UPDATE refresh_leases SET retry_at=0');globalThis.fetch=async()=>success();assert.equal(await service.currentToken('alice'),'new-access');
});
test('confirmed server error preserves authorization',async()=>{
 const {cipher}=await seed();globalThis.fetch=async()=>new Response('<html>unavailable</html>',{status:503});
 await assert.rejects(()=>service.currentToken('alice'),e=>e.code==='oauth_retryable');assert.equal(stored(),cipher);
});
test('valid access token remains usable during temporary refresh failure',async()=>{
 await seed('alice',Math.floor(Date.now()/1000)+60);globalThis.fetch=async()=>new Response('',{status:429});
 assert.equal(await service.currentToken('alice'),'old-access');
});
test('parallel expired-token calls share one slow successful rotation',async()=>{
 await seed();let started;const beginning=new Promise(r=>started=r);let calls=0;
 globalThis.fetch=async()=>{calls++;started();await new Promise(r=>setTimeout(r,2100));return success()};
 const first=service.currentToken('alice');await beginning;const second=service.currentToken('alice');
 assert.deepEqual(await Promise.all([first,second]),['new-access','new-access']);assert.equal(calls,1);
});
test('a claimed lease abandoned before sending can be taken over',async()=>{
 const {row,cipher}=await seed();sql.prepare('INSERT INTO refresh_leases VALUES (?,?,?,?,?,?,?,?,?)').run('alice',row.revision,await core.digest(cipher),'abandoned','claimed',0,0,null,null);
 let calls=0;globalThis.fetch=async()=>{calls++;return success()};assert.equal(await service.currentToken('alice'),'new-access');assert.equal(calls,1);
});
test('a saved rotated token is committed without repeating OAuth',async()=>{
 const {row,cipher}=await seed();const pending=await core.seal(__serviceEnv.FEISHU_VAULT_KEY,'alice:tokens',{accessToken:'saved-access',refreshToken:'saved-refresh',expiresAt:Math.floor(Date.now()/1000)+7200});
 sql.prepare('INSERT INTO refresh_leases VALUES (?,?,?,?,?,?,?,?,?)').run('alice',row.revision,await core.digest(cipher),'abandoned','ready',0,0,pending,null);
 globalThis.fetch=async()=>{throw Error('must not call OAuth again')};assert.equal(await service.currentToken('alice'),'saved-access');
});
test('transient database failure after rotation retries only persistence',async()=>{
 await seed();let writes=0,calls=0;failureHook=text=>{if(text.startsWith('UPDATE connections SET tokens_cipher=?')&&writes++===0)throw Error('temporary D1 failure')};
 globalThis.fetch=async()=>{calls++;return success()};assert.equal(await service.currentToken('alice'),'new-access');assert.equal(calls,1);failureHook=null;
});
test('network ambiguity preserves credentials and prevents blind refresh replay',async()=>{
 const {cipher}=await seed();let calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('network failed')};
 await assert.rejects(()=>service.currentToken('alice'),e=>e.code==='oauth_uncertain');assert.equal(stored(),cipher);
 await assert.rejects(()=>service.currentToken('alice'),e=>e.code==='refresh_uncertain');assert.equal(calls,1);
});
test('only a confirmed invalid_grant clears unusable token credentials',async()=>{
 await seed();globalThis.fetch=async()=>new Response(JSON.stringify({error:'invalid_grant'}),{status:400,headers:{'content-type':'application/json'}});
 await assert.rejects(()=>service.currentToken('alice'),e=>e.code==='oauth_invalid_grant');assert.equal(stored(),null);
});
test('a fresh configuration cannot be overwritten by an old refresh result',async()=>{
 await seed();let resolve;const waiting=new Promise(r=>resolve=r);let begun;const started=new Promise(r=>begun=r);
 globalThis.fetch=async()=>{begun();await waiting;return success()};const refresh=service.currentToken('alice');await started;
 await service.saveConfig('alice','cli_newapp123','new-dummy-secret');resolve();await assert.rejects(()=>refresh,e=>e.code==='connection_changed');
 assert.equal(stored(),null);assert.equal(sql.prepare('SELECT app_id FROM connections').get().app_id,'cli_newapp123');
});
test('disconnect removes only the current user connection and coordination state',async()=>{
 await seed();await service.saveConfig('bob','cli_bob123','dummy-bob-secret');await service.authorize('alice');await service.disconnect('alice');
 assert.equal((await service.status('alice')).configured,false);assert.equal((await service.status('bob')).configured,true);
 assert.equal(sql.prepare('SELECT count(*) n FROM oauth_states WHERE user_id=?').get('alice').n,0);
});
test('expired in-flight rotation is marked uncertain instead of replayed',async()=>{
 const {row,cipher}=await seed();sql.prepare('INSERT INTO refresh_leases VALUES (?,?,?,?,?,?,?,?,?)').run('alice',row.revision,await core.digest(cipher),'crashed','requesting',0,0,null,null);
 let calls=0;globalThis.fetch=async()=>{calls++;return success()};
 await assert.rejects(()=>service.currentToken('alice'),e=>e.code==='refresh_uncertain');assert.equal(calls,0);assert.equal(stored(),cipher);
});
test('persisted rotation survives repeated connection-write failures',async()=>{
 await seed();let calls=0;globalThis.fetch=async()=>{calls++;return success()};
 failureHook=text=>{if(text.startsWith('UPDATE connections SET tokens_cipher=?'))throw Error('D1 unavailable')};
 await assert.rejects(()=>service.currentToken('alice'));assert(sql.prepare('SELECT pending_cipher FROM refresh_leases').get().pending_cipher);
 failureHook=null;assert.equal(await service.currentToken('alice'),'new-access');assert.equal(calls,1);
});
test('malformed token response is preserved as uncertain, not stored as a token',async()=>{
 const {cipher}=await seed();globalThis.fetch=async()=>Response.json({access_token:42,expires_in:7200});
 await assert.rejects(()=>service.currentToken('alice'),e=>e.code==='oauth_uncertain');assert.equal(stored(),cipher);
});
test('Feishu rate-limit code on HTTP 400 is retryable',async()=>{
 const {cipher}=await seed();globalThis.fetch=async()=>new Response(JSON.stringify({code:99991400}),{status:400,headers:{'content-type':'application/json'}});
 await assert.rejects(()=>service.currentToken('alice'),e=>e.code==='oauth_retryable');assert.equal(stored(),cipher);
});
test('later authorization prevents an earlier in-flight callback from binding',async()=>{
 await seed();const old=new URL(await service.authorize('alice')).searchParams.get('state');let begun,release;
 const started=new Promise(r=>begun=r),held=new Promise(r=>release=r);
 globalThis.fetch=async url=>{if(String(url).includes('/oauth/token')){begun();await held;return success()}return Response.json({code:0,data:{}})};
 const callback=service.finishAuthorization('alice',old,'code',false);await started;await service.authorize('alice');release();
 await assert.rejects(()=>callback,e=>e.code==='authorization_superseded');
});
test('invalid_grant from an old refresh cannot erase or misreport a newer connection',async()=>{
 await seed();let begun,release;const started=new Promise(r=>begun=r),held=new Promise(r=>release=r);
 globalThis.fetch=async()=>{begun();await held;return new Response(JSON.stringify({error:'invalid_grant'}),{status:400,headers:{'content-type':'application/json'}})};
 const refresh=service.currentToken('alice');await started;await service.saveConfig('alice','cli_newapp123','new-dummy-secret');release();
 await assert.rejects(()=>refresh,e=>e.code==='connection_changed'&&e.details.reauthorization_required===false);
 assert.equal(sql.prepare('SELECT app_id FROM connections').get().app_id,'cli_newapp123');
});
test.after(()=>{globalThis.fetch=nativeFetch;sql.close()});
