import assert from 'node:assert/strict';
import test from 'node:test';
import {CHARACTERS,fresh,makeBattle,advance,buyUpgrade,recruitRates,rollRecruit,waitFor} from '../public/game.js';

test('Ritmo mantém uma espera mínima de oito segundos com todos os upgrades',()=>{
  const state=fresh(1000,7);
  assert.equal(waitFor(state),15000);
  state.upgrades.ritmo=10;
  assert.equal(waitFor(state),8000);
  const battle=makeBattle(state,1000);
  state.pending=battle;
  advance(state,battle.end);
  assert.equal(state.nextAt,battle.end+8000);
});

test('raridade máxima depende do Rastreio e do excedente de Sorte',()=>{
  assert.deepEqual(recruitRates(10,16),{encounter:10,rare:16});
  assert.deepEqual(recruitRates(100,36),{encounter:50,rare:54});
  const tier=(draw,luck,rare)=>{
    const rolls=[0,draw,0,.99,.99];
    return CHARACTERS[rollRecruit(()=>rolls.shift(),luck,'Dragon Ball',rare).id].tier;
  };
  assert.equal(tier(.8399,.1,16),2);
  assert.equal(tier(.8401,.1,16),3);
  assert.equal(tier(.4599,1,36),2);
  assert.equal(tier(.4601,1,36),3);
  assert.equal(tier(.999939,.1,16),7);
  assert.equal(tier(.999941,.1,16),8);
  assert.equal(tier(.999797,1,36),7);
  assert.equal(tier(.999798,1,36),8);
  assert.equal(tier(.999989,.1,16),8);
  assert.equal(tier(.999991,.1,16),9);
  assert.equal(tier(.999967,1,36),9);
});

test('Ritmo exige ouro e mundo desbloqueado em cada etapa',()=>{
  const state=fresh(1000,7);
  const levels=[
    [1,180,14],[2,1000,13],[3,3500,13],[4,9000,12],[5,20000,12],
    [6,40000,11],[7,70000,11],[8,160000,10],[9,400000,9],[10,1000000,8]
  ];
  for(const [world,price,seconds] of levels){
    state.unlocked=world-1;
    state.gold=price-1;
    assert.equal(buyUpgrade(state,'ritmo'),false);
    state.gold=price;
    if(world>1){
      state.unlocked--;
      assert.equal(buyUpgrade(state,'ritmo'),false);
      state.unlocked++;
    }
    assert.equal(buyUpgrade(state,'ritmo'),true);
    assert.equal(state.gold,0);
    assert.equal(waitFor(state),seconds*1000);
  }
  state.gold=1000000;
  state.unlocked=11;
  assert.equal(buyUpgrade(state,'ritmo'),false);
  assert.equal(waitFor(state),8000);
});

test('níveis que mantêm a espera aumentam o ouro dos encontros comuns',()=>{
  const state=fresh(1000,7);
  state.world=9;
  for(const level of [3,5,7]){
    const before=structuredClone(state);
    const after=structuredClone(state);
    before.upgrades.ritmo=level-1;
    after.upgrades.ritmo=level;
    assert.equal(waitFor(before),waitFor(after));
    assert.ok(makeBattle(after,1000).goldReward>makeBattle(before,1000).goldReward);
    assert.equal(makeBattle(after,1000,true).goldReward,makeBattle(before,1000,true).goldReward);
  }
});

test('a chance de encontrar um recruta não entra na raridade registrada',()=>{
  const recruit=(luck,encounter)=>{
    const rolls=[encounter,.995,0,.01,.99];
    return rollRecruit(()=>rolls.shift(),luck);
  };
  assert.equal(recruit(.1,.3),null);
  assert.ok(recruit(.5,.3));
  const low=recruit(.1,0);
  assert.equal(low.oddsBasis,'recruitable');
  assert.deepEqual(recruit(.5,0),low);
  assert.ok(recruit(1,0).odds<low.odds);
});

test('XP cresce com o encontro e mantém os níveis e limites existentes',()=>{
  const experience=(level,{elite=false,boss=false,xp=0}={})=>{
    const state=fresh(1000,7);
    state.unlocked=9;
    state.collection[0].xp=xp;
    const battle=makeBattle(state,1000);
    Object.assign(battle,{level,elite,boss,recruit:null,xpBonus:.8,result:{winner:0,reason:'eliminação',events:[]}});
    state.pending=battle;
    return advance(state,battle.end)[0];
  };
  assert.equal(experience(10).xp,83);
  assert.equal(experience(50).xp,652);
  assert.equal(experience(99).xp,2055);
  assert.equal(experience(50,{elite:true}).xp,1303);
  assert.equal(experience(50,{boss:true}).xp,1955);
  const capped=fresh(1000,7);
  capped.collection[0].xp=10000000;
  capped.pending=makeBattle(capped,1000);
  capped.pending.result={winner:0,reason:'eliminação',events:[]};
  advance(capped,capped.pending.end);
  assert.equal(capped.collection[0].xp,10000000);
});
