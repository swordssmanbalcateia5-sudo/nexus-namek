// Adaptador com a mesma interface do Cloudflare D1 usada pelo public/_worker.js,
// implementado sobre o SQLite embutido no Node.js (node:sqlite).
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

const toSqlite=value=>value===undefined?null:typeof value==='boolean'?Number(value):value;

class BoundStatement{
  constructor(database,sql,params=[]){this.database=database;this.sql=sql;this.params=params;}
  bind(...params){return new BoundStatement(this.database,this.sql,params.map(toSqlite));}
  #statement(){return this.database.statement(this.sql);}
  // Executa e devolve no formato de D1Result.
  execute(){
    const statement=this.#statement();
    const started=performance.now();
    const results=statement.columns().length?statement.all(...this.params):[];
    let changes=0,lastRowId=0;
    if(!results.length&&!statement.columns().length){
      const info=statement.run(...this.params);
      changes=Number(info.changes);lastRowId=Number(info.lastInsertRowid);
    }else{
      // SELECT ou ... RETURNING: as alterações já aconteceram no primeiro passo.
      changes=this.database.changes();
    }
    return {success:true,results,meta:{changes,last_row_id:lastRowId,duration:performance.now()-started}};
  }
  async first(column){
    const statement=this.#statement();
    let row;
    if(statement.columns().length){
      row=statement.get(...this.params);
    }else{
      statement.run(...this.params);
      row=undefined;
    }
    if(row===undefined)return null;
    return column===undefined?row:row[column]??null;
  }
  async all(){return this.execute();}
  async run(){return this.execute();}
  async raw(){
    const statement=this.#statement();
    statement.setReturnArrays?.(true);
    try{return statement.all(...this.params);}finally{statement.setReturnArrays?.(false);}
  }
}

export class D1Sqlite{
  constructor(path){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    // Mesmo comportamento padrão do D1 (chaves estrangeiras ativas) e ajustes de servidor.
    this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;PRAGMA temp_store=MEMORY;PRAGMA cache_size=-65536;`);
    this.cache=new Map();
    this.changesStatement=this.db.prepare('SELECT changes() AS n');
  }
  statement(sql){
    let statement=this.cache.get(sql);
    if(!statement){
      statement=this.db.prepare(sql);
      if(this.cache.size>500)this.cache.clear();
      this.cache.set(sql,statement);
    }
    return statement;
  }
  changes(){return Number(this.changesStatement.get().n);}
  prepare(sql){return new BoundStatement(this,sql);}
  // D1 executa o batch como uma transação: tudo ou nada.
  async batch(statements){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const results=statements.map(statement=>statement.execute());
      this.db.exec('COMMIT');
      return results;
    }catch(error){
      if(this.db.isTransaction)this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async exec(sql){this.db.exec(sql);return {count:0,duration:0};}
  close(){this.db.close();}
}
