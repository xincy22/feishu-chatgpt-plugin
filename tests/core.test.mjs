import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
const source=transformSync(readFileSync(new URL('../lib/feishu-core.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'}).code;
const {seal,openVault,documentReference,pkce,requireIdentity,requireSameOrigin,publicIssue}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const key=Buffer.alloc(32,7).toString('base64');
test('vault preserves credentials and binds ciphertext to user and purpose',async()=>{
 const c=await seal(key,'alice:config',{appSecret:'sensitive'});
 assert.deepEqual(await openVault(key,'alice:config',c),{appSecret:'sensitive'});
 assert(!c.includes('sensitive'));
 await assert.rejects(()=>openVault(key,'bob:config',c));
 await assert.rejects(()=>openVault(key,'alice:tokens',c));
 await assert.rejects(()=>openVault(Buffer.alloc(32,8).toString('base64'),'alice:config',c));
});
test('vault rejects tampering and uses fresh IV',async()=>{
 const a=await seal(key,'a',123),b=await seal(key,'a',123);assert.notEqual(a,b);
 const p=a.split('.');p[2]=(p[2][0]==='A'?'B':'A')+p[2].slice(1);
 await assert.rejects(()=>openVault(key,'a',p.join('.')));
});
test('PKCE matches RFC7636 vector',async()=>assert.equal(await pkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'));
test('references reject external hosts, credentials and alternate resource types',()=>{
 assert.equal(documentReference('https://tenant.feishu.cn/wiki/abcdefghijkl').kind,'wiki');
 for(const u of ['https://feishu.cn.evil.test/docx/abcdefghijkl','http://tenant.feishu.cn/docx/abcdefghijkl','https://secret@feishu.cn/docx/abcdefghijkl','https://feishu.cn/sheets/abcdefghijkl','https://feishu.cn:8443/docx/abcdefghijkl'])assert.throws(()=>documentReference(u));
});
test('missing identity and cross-origin writes fail closed',()=>{
 assert.throws(()=>requireIdentity(new Request('https://site.test')));
 assert.throws(()=>requireSameOrigin(new Request('https://site.test',{headers:{origin:'https://evil.test'}}),'https://site.test'));
 assert.equal(requireIdentity(new Request('https://site.test',{headers:{'oai-authenticated-user-id':'alice'}})),'alice');
 assert.equal(publicIssue(new Error('secret')).message,'服务暂时不可用，请稍后重试。');
});
