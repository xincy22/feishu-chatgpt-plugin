import {readFile,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
export async function initializeLocalDatabase(root=process.cwd()){
  const hosting=JSON.parse(await readFile(path.join(root,'.openai/hosting.json'),'utf8'));
  if(!hosting.d1)return;
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(hosting.d1))throw new Error('Invalid local D1 binding.');
  const persistence=path.join(root,'.wrangler/state/v3/d1');await mkdir(persistence,{recursive:true});
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("local migrations")}}',compatibilityDate:'2026-05-15',d1Databases:{[hosting.d1]:'00000000-0000-4000-8000-000000000000'},d1Persist:persistence});
  try{
    const db=await mf.getD1Database(hosting.d1);
    await db.prepare('CREATE TABLE IF NOT EXISTS __feishu_local_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)').run();
    const files=(await readdir(path.join(root,'drizzle'))).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
    for(const name of files){
      const sql=await readFile(path.join(root,'drizzle',name),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
      const applied=await db.prepare('SELECT checksum FROM __feishu_local_migrations WHERE name=?').bind(name).first();
      if(applied){if(applied.checksum!==checksum)throw new Error('Applied migration changed: '+name);continue;}
      const statements=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
      await db.batch([...statements.map(s=>db.prepare(s)),db.prepare('INSERT INTO __feishu_local_migrations VALUES (?,?)').bind(name,checksum)]);
    }
    console.log('Local D1 migrations are ready.');
  }finally{await mf.dispose();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await initializeLocalDatabase();
