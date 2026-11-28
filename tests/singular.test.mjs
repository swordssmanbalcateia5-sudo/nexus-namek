import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import worker from '../public/_worker.js';
import {createDuel,stepDuel} from '../public/duel.js';
import {CHARACTERS,fighter,fresh,makeBattle,spriteFor} from '../public/game.js';

const ids=['dio-over-heaven','goku-xeno-limite-rompido','saitama-eco-do-futuro'];
test('os três Singulares entram na Arena com arte e habilidades de campo e banco',()=>{
  const unit=id=>fighter({uid:id,id,xp:0});
  for(const id of ids){
    assert.equal(CHARACTERS[id].tier,9);
    for(const shiny of [true,false]){
      const path=new URL('../public/art/'+spriteFor({id,shiny})+'.png',import.meta.url);
      assert.equal(readFileSync(path).subarray(1,4).toString(),'PNG');
    }
    const tank={...unit('piccolo'),kind:'tanker-test',hp:500000};
    for(const reserve of [false,true]){
      const lineup=reserve?[tank,unit(id)]:[unit(id)];
      const match=createDuel(lineup,[tank],20,123);
      for(let i=0;i<260;i++)stepDuel(match);
      assert.ok(match.skills.some(s=>s.side===0&&s.slot===Number(reserve)&&s.role===(reserve?'reserva':'principal')));
      assert.ok(match.combat.log.every(e=>e.hp===undefined||Number.isFinite(e.hp)));
    }
  }
});

test('uma derrota mantém o segredo e a primeira captura revela a raridade para todos',async()=>{
  const conn=new DatabaseSync(':memory:');
  const statement=(sql,params=[])=>({
    bind:(...params)=>statement(sql,params),
    first:async()=>conn.prepare(sql).get(...params)??null,
    run:async()=>({meta:conn.prepare(sql).run(...params)}),
    all:async()=>({results:conn.prepare(sql).all(...params)}),
  });
  const env={NEXUS_DB:{prepare:statement,async batch(statements){
    conn.exec('BEGIN');
    try{const responses=[];for(const s of statements)responses.push(await s.all());conn.exec('COMMIT');return responses;}
    catch(error){conn.exec('ROLLBACK');throw error;}
  }}};
  const request=async(path,body,token)=>{
    const res=await worker.fetch(new Request('https://alca.test'+path,body===undefined?{}:{
      method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)
    }),env);
    return [res.status,await res.json()];
  };
  assert.deepEqual(await request('/api/discoveries'),[200,{singular:false}]);
  const [registered,account]=await request('/api/community/account',{name:'Teste Singular'});
  assert.equal(registered,201);
  const now=Date.now();
  const state=fresh(now-500,7);
  state.pending=makeBattle(state,now-200);
  state.pending.end=now-1;
  state.pending.recruit={id:ids[0],shiny:false,trait:null,oddsBasis:'recruitable',odds:100000};
  state.pending.result={winner:1,reason:'eliminação',events:[]};
  const seedBattle=()=>conn.prepare('UPDATE nexus_players SET game=? WHERE id=?').run(JSON.stringify(state),account.player.id);
  seedBattle();
  assert.equal((await request('/api/game',{},account.token))[0],200);
  assert.deepEqual(await request('/api/discoveries'),[200,{singular:false}]);
  state.pending.result.winner=0;
  seedBattle();
  const [status,synced]=await request('/api/game',{},account.token);
  assert.equal(status,200);
  assert.ok(synced.state.collection.some(unit=>unit.id===ids[0]));
  assert.deepEqual(await request('/api/discoveries'),[200,{singular:true}]);
  const [sold]=await request('/api/game',{action:{type:'sell',uid:synced.state.collection.find(unit=>unit.id===ids[0]).uid}},account.token);
  assert.equal(sold,200);
  assert.deepEqual(await request('/api/discoveries'),[200,{singular:true}]);
});
