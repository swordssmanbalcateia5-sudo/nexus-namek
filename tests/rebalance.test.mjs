import assert from 'node:assert/strict';
import test from 'node:test';
import {Combate} from '../public/engine.js';
import * as legacyDuel from '../public/duel-v4.js';
import * as nextDuel from '../public/duel.js';
import {applyGameAction,advance,fresh,fighter,makeBattle,raidClaims,worldBossClaims} from '../public/game.js';

test('Domínio Absoluto consome a proteção no primeiro atordoamento da campanha',()=>{
  const c=new Combate([[{}],[{traits:['Domínio Absoluto']}]]);
  const [a,b]=c.teams.map(team=>team[0]);
  c.cast(a,b,'dominio');
  assert.equal(b.ccImmune,false);
  assert.equal(b.stunUntil,undefined);
  c.time=12000;
  c.cast(a,b,'dominio');
  assert.equal(b.stunUntil,13500);
});

test('Domínio Absoluto protege na Arena e consome a proteção',()=>{
  const c=nextDuel.createDuel([{}],[{traits:['Domínio Absoluto']}],120,1).combat;
  const [a,b]=c.teams.map(team=>team[0]);
  c.cast(a,b,'dominio');
  assert.equal(b.ccImmune,false);
  assert.equal(b.stunUntil,undefined);
  c.time=12000;
  c.cast(a,b,'dominio');
  assert.equal(b.stunUntil,13500);
});

test('compatibilidade dos resgates da Build 57 e idempotência',()=>{
  assert.deepEqual(raidClaims([50000,250000,45000,10000]),[10000,25000,45000]);
  assert.deepEqual(raidClaims(raidClaims([50000,250000])),[10000,25000]);
  assert.deepEqual(worldBossClaims([500000,2000000,10000000,50000000,200000000]),[100000,400000,1000000,2500000,6000000]);
});

test('replay da Build 57 conserva resultado e tempo',()=>{
  const [a,b]=fresh(0,5).collection.map(u=>fighter(u));
  a.trait='Made in Heaven';a.traits=[a.trait];
  const replay=legacyDuel.finishDuel(legacyDuel.createDuel([a],[b],120,1));
  assert.equal(replay.result,'Vitória');
  assert.ok(Math.abs(replay.t-4.1166666667)<1e-6);
  assert.notEqual(nextDuel.finishDuel(nextDuel.createDuel([a],[b],120,1)).t,replay.t);
});

test('venda automática mantém filtro por personagem e frequência legada até a conversão',()=>{
  const s=fresh(1000,7);
  s.autoSell={enabled:true,tiers:[],characters:['yamcha'],traitRules:{1:{below:10,names:[]}}};
  const recruit=(trait,start)=>{
    const battle=makeBattle(s,start);
    battle.recruit={id:'yamcha',shiny:false,trait,odds:10};
    battle.result={winner:0,reason:'eliminação',events:[]};
    s.pending=battle;
    return advance(s,battle.end)[0];
  };
  assert.equal(recruit('Concentração Total',1000).sold.id,'yamcha');
  assert.equal(recruit('Ten',20000).recruit.id,'yamcha');
  assert.equal(applyGameAction(s,{type:'autoSell',resetLegacy:true},40000),true);
  assert.equal(s.autoSell.enabled,false);
  assert.equal(recruit(null,40000).recruit.id,'yamcha');
});
