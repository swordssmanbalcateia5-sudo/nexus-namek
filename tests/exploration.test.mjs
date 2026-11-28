import assert from 'node:assert/strict';
import test from 'node:test';
import {CHARACTERS,fresh,makeBattle,advance,recruitRates,rollRecruit,waitFor} from '../public/game.js';

test('Ritmo mantém uma espera mínima de dez segundos com todos os upgrades',()=>{
  const state=fresh(1000,7);
  assert.equal(waitFor(state),16000);
  state.upgrades.ritmo=6;
  assert.equal(waitFor(state),10000);
  const battle=makeBattle(state,1000);
  state.pending=battle;
  advance(state,battle.end);
  assert.equal(state.nextAt,battle.end+10000);
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
