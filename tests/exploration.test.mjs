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
  assert.equal(tier(.99996,.1,16),7);
  assert.equal(tier(.99998,.1,16),8);
});

test('Ritmo exige ouro e mundo desbloqueado em cada etapa',()=>{
  const state=fresh(1000,7);
  const levels=[
    [1,180,14.5],[2,1000,14],[3,3500,13.5],[4,9000,13],[5,20000,12.5],
    [6,40000,12],[7,70000,11],[8,120000,10],[9,200000,9],[10,350000,8]
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
