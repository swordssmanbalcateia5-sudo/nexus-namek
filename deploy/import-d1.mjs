// Importa o dump do D1 (wrangler d1 export) para o SQLite da VM.
// Uso: node deploy/import-d1.mjs nexus.sql /var/lib/alca-rng/nexus.sqlite
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync} from 'node:fs';

const [dump,target]=process.argv.slice(2);
if(!dump||!target){console.error('Uso: node deploy/import-d1.mjs <dump.sql> <banco.sqlite>');process.exit(1);}
if(existsSync(target)){console.error(`${target} já existe. Apague ou escolha outro caminho.`);process.exit(1);}
const db=new DatabaseSync(target);
db.exec('PRAGMA foreign_keys=OFF;');
db.exec('BEGIN;'+readFileSync(dump,'utf8').replace(/^\s*(BEGIN TRANSACTION|COMMIT|PRAGMA[^;]*);/gim,'')+';COMMIT;');
db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;');
const problems=db.prepare('PRAGMA foreign_key_check').all();
const count=table=>{try{return db.prepare(`SELECT count(*) n FROM ${table}`).get().n;}catch{return 'ausente';}};
console.log({jogadores:count('nexus_players'),amizades:count('nexus_friends'),sessoes:count('nexus_sessions'),
  serial:db.prepare('SELECT revision FROM nexus_serials WHERE id=1').get()?.revision,
  schema:db.prepare('SELECT version FROM nexus_schema_version WHERE id=1').get()?.version,
  integridade:db.prepare('PRAGMA integrity_check').get().integrity_check,chavesQuebradas:problems.length});
db.close();
