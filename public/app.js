import {unitLabel} from './unit-label.js';
import * as rebalanceDuel from './duel-v5.js';
import {affinity} from "./engine.js";
import {ARENA_SHOP,GOLD_SHOP,weeklyCycle,arenaLeague} from './community-rules.js';
import {MAX_STARS,TRAIT_PITY_LIMIT,PRESET_SLOTS,PRESET_LABELS,RAID_MILESTONES,raidClaims,WEEKLY_TOWER_FLOORS,awakenCost,dexMastery,towerAffix,weeklyTowerToday,weeklyTowerEnemies,goldShopPrice,autoFormation,dexSummary,duplicateSellCandidates,loadoutChance,slotTraits,raidToday,towerEnemies,saleSettings,describeAutoSell,canSellUnit,formationCost,leaderApplies,RECOVERY_MS,SALE_PRICES,readyAt,formationSlots,spriteFor,recruitRates,formationPower,projectedPower,unitPower,WORLDS,worldOf,levelCap,CHARACTERS,COLORS,SKILL_EFFECTS,TIERS,TRAITS,UPGRADES,AWAY_THRESHOLD,AFK_ENCOUNTER_LIMIT,advanceWithPresence,advance,applyGameAction,fighter,fresh,levelAt,maxLevel,readyForBoss,upgradeLevel,waitFor,xpProgress} from './game.js';
import * as previousDuel from './duel-v2.js';
import * as build57Duel from './duel-v4.js';
import * as frozenDuel from './duel-v3.js';
import {paintTranscendentes} from './arena-fx.js';
import * as legacyDuel from './duel-v1.js';
import {finishDuel,collisionBonus,collisionPower,createDuel,stepDuel,bossKits,BOSS_FINISH_FX} from './duel.js';
import {createCommunity} from './community.js';

import {isUnreadableCampaign,saveKey,readCampaign,writeCampaign,packCampaign,unpackCampaign} from './save.js';
const $ = selector=>document.querySelector(selector);
const int = new Intl.NumberFormat('pt-BR');
const validTabs=['exploracao','formacao','colecao','configuracoes','upgrades','comunidade','arena','modos','itens','indice','guia'];
const time = milliseconds=>{const sec=Math.max(0,Math.ceil(milliseconds/1000));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;};
const copy=id=>state.collection.find(c=>c.uid===id);
const card=id=>CHARACTERS[copy(id).id];
const isPaused=()=>Boolean(state.paused??!state.running);
let preferences={motion:true,numbers:true};
try{preferences={...preferences,...JSON.parse(localStorage.getItem('nexus.display')||'{}')};}catch{}
document.documentElement.dataset.motion=preferences.motion?'on':'off';

const spriteURL = name => `art/${name}.png`;
const img=(sprite,alt='')=>`<img src="${spriteURL(sprite)}" alt="${alt}">`;
const note = text=> { const box=$('#notice');box.textContent=text;box.hidden=!text; };

let storageIssue='';
let blockedCampaign=false;
let storageFailed=false;
function load(){
  try { const value=readCampaign(localStorage);storageIssue='';blockedCampaign=false;return value; }
  catch(error){
    blockedCampaign=isUnreadableCampaign(error);
    storageIssue=blockedCampaign?error.message:'O navegador bloqueou o armazenamento. Exporte seu progresso em Configurações.';
    return null;
  }
}
const initialSave=document.documentElement.classList.contains('connecting-account')?null:load();
let state=initialSave??fresh(Date.now(),crypto.getRandomValues(new Uint32Array(1))[0]);
let selected=state.team[0];
let pickSlot=null;
let tab=validTabs.includes(location.hash.slice(1))?location.hash.slice(1):'exploracao';
let replay=null, finishedBattle=null, eventCursor=0, stageKey='', busy=false, drag=null, installPrompt=null;
let transactionQueue=Promise.resolve();
let queuedSync=null;
const ONLINE_SYNC_MIN_MS=8000;
const ONLINE_HEARTBEAT_MS=24000+Math.random()*1000;
let lastOnlineSyncAt=-Infinity;
let publicUnit=null, profileUid=null, profileOpener=null, profileContent='';
let serverOffset=0;
const gameNow=()=>Date.now()+serverOffset;
let duel=null,rival=null,frameTime=0,carry=0;
function loadArenaRecovery(){
  try{return JSON.parse(localStorage.getItem('nexus.arena.recovery.'+state.created))??{};}catch{return {};}
}
let arenaRecovery=loadArenaRecovery();
function arenaReadyAt(uid){return Math.max(arenaRecovery[uid]??0,arenaRecovery.all??0);}
function arenaWait(){return Math.min(...state.team.map(arenaReadyAt))-gameNow();}
function playerSquad(){
  const leader=CHARACTERS[copy(state.leader)?.id];
  return state.team.filter(uid=>arenaReadyAt(uid)<=gameNow()).map(uid=>fighter(copy(uid),undefined,arenaReadyAt(state.leader)<=gameNow()?leader:null));
}
let opponentRequest=0;
async function listOpponents(){
  const list=$('#arena-opponents'),request=++opponentRequest;
  list.textContent='Buscando formações…';
  try{
    const {opponents,own}=await community.arenaOpponents();
    if(request!==opponentRequest||!list.isConnected||!community.ready())return;
    list.replaceChildren();
    if(!opponents.length)list.textContent='Ainda não há outro jogador cadastrado com formação.';
    for(const p of opponents){
      const button=document.createElement('button');
      const delta=own?Math.round((p.power/own-1)*100):null;
      button.textContent=p.name+' · '+int.format(p.power)+' de força'+(delta===null?'':` (${delta>0?'+':''}${delta}%)`);
      button.title=p.team.map(u=>u.name).join(' → ');
      button.onclick=()=>{
        if(rankedBusy||duel && duel.result===null)return;
        rival={name:p.name,team:p.team.map(u=>fighter(u,undefined,CHARACTERS[p.leaderId]))};
        duel=null;viewingRun=null;list.replaceChildren();renderPanel();
      };
      list.append(button);
    }
  }catch(error){if(request===opponentRequest)list.textContent=error.message;}
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let viewingRun=null,requestingRun=false,raidClock=null;
let rankedMessage='';
let rankedState=null,rankedFetch=null,rankedBusy=false,rankedRetry=0;
let arenaLogData=null,arenaLogUntil=0,worldBossData=null,worldBossUntil=0;
const boards=new Map();
let buyingToken=false,shopMessage='';
function competitionKind(){return tab==='arena'?'arena':tab==='modos'?'tower':null;}
function drawCompetition(){
  const kind=competitionKind(),side=$('#competition-side');
  side.hidden=!kind;if(!kind)return;
  const player=community.playerId(),isArena=kind==='arena';
  $('#board-title').textContent=isArena?'Top 10 · Arena (Temporada)':'Top 10 · Torre infinita';
  $('#arena-market').hidden=!isArena;
  const balance=state.arenaTrophies??0;
  $('#trophy-balance').textContent=int.format(balance)+(balance===1?' troféu':' troféus');
  const shopList=$('#arena-shop-list');
  if(shopList){
    shopList.innerHTML=ARENA_SHOP.map(item=>`<div class="arena-shop-item"><div><h4>${item.name}</h4><small>${item.desc} · ${item.cost} troféus</small></div><button class="primary" data-arena-buy="${item.id}" ${!player||buyingToken||balance<item.cost?'disabled':''}>${item.cost} ★</button></div>`).join('');
  }
  $('#shop-message').textContent=shopMessage;
  const key=player+'/'+kind;
  const record=boards.get(key)??{until:0};
  if(player&&Date.now()>=record.until){
    record.until=Infinity;boards.set(key,record);
    community.topBoard(kind).then(data=>{record.rows=data.rows;record.error='';})
      .catch(()=>{record.error='Não foi possível atualizar a classificação.';})
      .finally(()=>{
        record.until=Date.now()+(record.error?10000:45000);
        if(competitionKind()===kind&&community.playerId()===player&&boards.get(key)===record)drawCompetition();
      });
  }
  $('#board-message').textContent=!player?'Entre na Comunidade para ver o ranking.':
    record.error||(record.rows?(record.rows.length?'':'Ainda não há jogadores classificados.'):'Carregando classificação…');
  const list=$('#board-list'),rows=record.rows;
  if(list.entries===rows&&list.boardKey===key)return;
  list.entries=rows;list.boardKey=key;list.replaceChildren();
  for(const [index,row] of (rows??[]).entries()){
    const li=document.createElement('li'),pos=document.createElement('small'),name=document.createElement('span'),score=document.createElement('strong');
    pos.textContent=String(index+1).padStart(2,'0');
    name.textContent=isArena?`${row.name} (${arenaLeague(row.score).name})`:row.name;
    score.textContent=(isArena?'':'Andar ')+int.format(row.score)+(isArena?' pts':'');
    li.classList.toggle('own-rank',row.id===player);li.append(pos,name,score);list.append(li);
  }
}
async function buyArenaShopItem(itemId='token'){
  const player=community.playerId();
  const item=ARENA_SHOP.find(x=>x.id===itemId);
  if(!player||!item||buyingToken||tab!=='arena'||(state.arenaTrophies??0)<item.cost)return;
  buyingToken=true;shopMessage='';drawCompetition();
  try{
    const ok=await transaction({type:'arenaShop',itemId:item.id,purchase:state.arenaPurchases??0});
    if(player===community.playerId())shopMessage=ok?`${item.name} adicionado aos Itens.`:'Confira o saldo e o inventário antes de tentar novamente.';
  }finally{buyingToken=false;drawCompetition();}
}
function refreshArenaLog(){
  const id=community.playerId();
  if(!id||Date.now()<arenaLogUntil)return;
  arenaLogUntil=Infinity;
  const generation=community.generation();
  community.arenaLog().then(data=>{if(community.generation()!==generation)return;arenaLogData=data;arenaLogUntil=Date.now()+30000;if(tab==='arena')renderArenaHistory();})
    .catch(()=>{if(community.generation()===generation)arenaLogUntil=Date.now()+15000;});
}
function refreshWorldBoss(){
  const id=community.playerId();
  if(!id||Date.now()<worldBossUntil)return;
  worldBossUntil=Infinity;
  const generation=community.generation();
  community.worldBoss().then(data=>{if(community.generation()!==generation)return;worldBossData=data;worldBossUntil=Date.now()+30000;if(tab==='modos'&&mode==='raid')renderModes($('#panel'));})
    .catch(()=>{if(community.generation()===generation)worldBossUntil=Date.now()+15000;});
}
function renderArenaHistory(){
  const box=$('#arena-history');if(!box)return;
  if(!community.ready()){box.hidden=true;return;}
  box.hidden=false;
  if(!arenaLogData){box.innerHTML='<h3>Histórico de batalhas e defesas</h3><p class="caption">Carregando histórico…</p>';return;}
  const fmtAtk=arenaLogData.attacks.length?arenaLogData.attacks.map(a=>`<li><span>vs <b>${esc(a.rivalName)}</b> · ${a.day}</span><strong class="${a.result==='Vitória'?'win':a.result==='Derrota'?'loss':''}">${a.result} (${a.delta>=0?'+':''}${a.delta} pts${a.trophies?` · +${a.trophies}★`:''})</strong></li>`).join(''):'<li><span>Nenhum ataque recente.</span></li>';
  const fmtDef=arenaLogData.defenses.length?arenaLogData.defenses.map(d=>`<li><span>de <b>${esc(d.attackerName)}</b> · ${d.day}</span><strong class="${d.defended?'win':'loss'}">${d.defended?'Defesa vencida':'Derrota na defesa'}</strong></li>`).join(''):'<li><span>Nenhuma defesa registrada ainda.</span></li>';
  box.innerHTML=`<h3>Histórico de batalhas e defesas</h3><div class="history-cols"><div><small>Seus ataques</small><ul class="history-list">${fmtAtk}</ul></div><div><small>Defesas recebidas</small><ul class="history-list">${fmtDef}</ul></div></div>`;
}
function refreshRanked(){
  const id=community.playerId();
  if(!id||rankedFetch||Date.now()<rankedRetry)return;
  rankedFetch=community.ranked().then(data=>{
    if(community.playerId()===id){rankedState=data;if(rankedRetry){rankedMessage='';rankedRetry=0;}if(tab==='arena')updateDuelButton();}
  }).catch(error=>{if(community.playerId()===id){rankedRetry=Date.now()+10000;rankedMessage=error.message;note(error.message);}}).finally(()=>{rankedFetch=null;});
}
async function enterRanked(){
  if(rankedBusy||requestingRun||duel?.result===null||!rankedState||rankedState.used>=5)return;
  const id=community.playerId();
  rankedBusy=true;rankedMessage='Buscando adversário equilibrado…';updateDuelButton();
  try{
    const {run,status}=await community.ranked({day:rankedState.day,attempt:rankedState.used+1});
    if(id!==community.playerId())return;
    rankedMessage='';rankedState=status;boards.delete(id+'/arena');arenaLogUntil=0;
    void transaction(null).then(drawCompetition);
    if(tab==='arena')watchRun(run);
    else note(run.result+' na Arena · '+run.delta+' pontos');
  }catch(error){if(id===community.playerId()){rankedMessage=error.message;rankedState=null;}}
  finally{rankedBusy=false;if(tab==='arena')updateDuelButton();}
}
function raidInfo(){
  const now=gameNow();
  if(!raidClock||now>=raidClock.nextAt)raidClock=raidToday(now);
  return raidClock;
}
let modeTickKey='',mode='raid', fightContext='arena', floorPage=null;
let autoTower=false,liveTowerSequence=null,towerAdvanceAt=0;
function towerVictory(){
  return fightContext==='tower' && duel?.result==='Vitória' && viewingRun?.result==='Vitória' &&
    liveTowerSequence!==null && viewingRun.sequence===liveTowerSequence &&
    viewingRun.sequence===state.ballSequence && viewingRun.floor===state.towerCleared;
}
function updateTowerAdvance(now){
  if(!autoTower||!towerVictory()||tab!=='modos'||mode!=='tower'||document.hidden||requestingRun)return;
  if(!towerAdvanceAt)towerAdvanceAt=now+2000;
  if(now<towerAdvanceAt||!state.team.length||!state.team.every(uid=>readyAt(state,uid)<=now))return;
  void enterChallenge('tower');
}
function finishTowerPlayback(){
  if(fightContext!=='tower'||liveTowerSequence===null||viewingRun?.sequence!==liveTowerSequence)return;
  if(viewingRun.result!=='Vitória'||duel.result!=='Vitória'){
    loginRequired=false;
  const restoreForm=$('#account-restore');
  restoreForm.reset();restoreForm.hidden=true;
  autoTower=false;liveTowerSequence=null;
  }
  towerAdvanceAt=0;
}
const savedFights=new Map();
function switchFight(key){
  if(key===fightContext)return;
  savedFights.set(fightContext,{duel,rival,viewingRun});
  ({duel=null,rival=null,viewingRun=null}=savedFights.get(key)??{});
  fightContext=key;frameTime=0;carry=0;
}
const arenaReplay={6:{createDuel,stepDuel,finishDuel},5:rebalanceDuel,4:build57Duel,3:frozenDuel,2:previousDuel};
function replayRules(run){return arenaReplay[run.physics]??legacyDuel}
function watchRun(run){
  if(!run.ranked)mode=run.raid?'raid':run.weekly?'weeklyTower':'tower';
  tab=run.ranked?'arena':'modos';
  switchFight(run.ranked?'arena':mode);
  viewingRun=run;rival=null;
  duel=replayRules(run).createDuel(run.left,run.right,run.limit,run.launchSeed);
  frameTime=0;carry=0;
  history.replaceState(null,'','#'+tab);renderPanel();
  if(!run.ranked)$('#mode-fight')?.scrollIntoView({block:'start'});
}
async function enterChallenge(type){
  if(requestingRun||duel?.result===null){note('Conclua o combate em andamento.');return;}
  requestingRun=true;
  try{
    const sequence=state.ballSequence??0;
    const account=state.created;
    const wt=weeklyTowerToday(gameNow());
    const weeklyFloor=(state.weeklyTower?.week===wt.week?state.weeklyTower.cleared:0)+1;
    const payload=type==='weeklyTower'
      ?{type,sequence,week:wt.week,floor:weeklyFloor}
      :{type,sequence,day:raidInfo().day,floor:(state.towerCleared??0)+1};
    const ok=await transaction(payload);
    if(state.created!==account)return;
    if(ok&&state.ballRun?.sequence===sequence+1){
      if(type==='tower'&&state.ballRun.result==='Vitória')boards.delete(community.playerId()+'/tower');
      if(type==='raid')worldBossUntil=0;
      if(type==='tower'){liveTowerSequence=sequence+1;towerAdvanceAt=0;floorPage=null;}
      watchRun(state.ballRun);
    }else{
      if(type==='tower'){autoTower=false;liveTowerSequence=null;}
      note('Desafio indisponível. Confira as tentativas, a regra semanal, o acesso à Torre e a recuperação do time.');
    }
  }finally{requestingRun=false;if(tab==='modos')renderPanel();}
}
function startDuel(){
  viewingRun=null;
  const team=playerSquad();
  if(community?.active()&&!rival)return;
  if(!team.length||rival?.team.length===0){renderPanel();note('As duas equipes precisam ter pelo menos um personagem.');return;}
  const ids=['yamcha','kuririn','bulma','piccolo'];
  const opponent=rival?.team??team.map((u,i)=>fighter({id:ids[i],xp:copy(u.uid).xp},undefined,CHARACTERS.yamcha));
  duel=createDuel(team,opponent);
  frameTime=0;carry=0;
  renderPanel();
}
function duelPanel(panel,challenge=false){
  if(!panel.querySelector('#duel-field')){
    panel.innerHTML='<article class="card duel-card">'+(challenge?'':'<h2>Arena das bolas</h2><p class="caption">As bolas saem em direções sorteadas e ricocheteiam nas paredes. Especiais ofensivos precisam alcançar o adversário. Cada acerto por colisão soma 12 pontos percentuais ao bônus de dano da próxima colisão, até +40%. As reservas ajudam conforme a recarga de cada habilidade e entram na ordem da formação. Aos dois minutos, vence a equipe com mais PV proporcionais restantes.</p><section id="ranked-section" class="challenge-picker"><h3>Arena ranqueada · Temporada semanal</h3><p class="caption">Matchmaking por faixa de força (±25%). Temporadas renovam toda segunda às 12h de Brasília com recompensas por Liga.</p><div id="season-banner" class="season-banner" hidden></div><p id="ranked-info"></p><button class="primary" id="arena-ranked">Sortear adversário equilibrado e lutar</button></section><button class="ghost" id="arena-find">Escolher amistoso · sem pontos</button><div id="arena-opponents" aria-live="polite"></div>')+'<strong id="duel-rival"></strong><h3 id="duel-outcome" role="status" hidden></h3><div id="skill-banner" aria-live="polite"></div><div id="duel-field"><i></i><i></i><span class="arena-call" hidden></span><span class="arena-call foe-call" hidden></span><canvas class="arena-vfx" width="800" height="400" aria-hidden="true"></canvas><div class="damage-popups" aria-hidden="true"></div></div><div id="duel-teams"></div><p role="status" id="duel-status"></p><div id="duel-log"></div><ul id="damage-feed" aria-label="Últimos golpes"></ul><button class="primary" id="duel-skip">Pular para o resultado</button> <button class="primary" id="duel-start"></button> <button class="ghost" id="duel-train">Voltar ao treino</button>'+(challenge?'':'<section id="arena-history" class="arena-history" hidden></section>')+'</article>';
  }
  if(challenge){
    $('#duel-start').hidden=true;$('#duel-train').hidden=true;
    $('#duel-skip').hidden=duel?.result!==null;
    $('#duel-rival').textContent=(viewingRun.raid?'Raid':viewingRun.weekly?'Torre semanal · Andar '+viewingRun.floor:'Andar '+viewingRun.floor)+(viewingRun.affix?' · '+viewingRun.affix:'')+' · '+viewingRun.right[0].name;
    paintDuel();return;
  }
  $('#arena-find').hidden=!community?.ready();
  $('#arena-find').disabled=!!duel&&duel.result===null;
  $('#duel-rival').textContent=viewingRun?.ranked?'Ranqueada · '+viewingRun.rivalName:viewingRun?(viewingRun.raid?'Chefe do dia':'Torre · andar '+viewingRun.floor)+' · '+viewingRun.right[0].name:rival?'Amistoso contra '+rival.name:community?.ready()?'Arena de jogadores':'Treino solo · Equipe de Namek. Entre na Comunidade para desafiar jogadores.';
  updateDuelButton();
  if(community?.ready()){refreshArenaLog();renderArenaHistory();}
  paintDuel();
}
function updateDuelButton(){
  const btn=$('#duel-start');if(!btn)return;
  const playing=duel?.result===null,info=raidInfo();
  $('#ranked-section').hidden=!community.ready();
  if(community.ready()){
    if(!rankedState||rankedState.day!==info.day)refreshRanked();
    const league=rankedState?.league??arenaLeague(rankedState?.points??0);
    const sb=$('#season-banner');
    if(sb&&rankedState){
      sb.hidden=false;
      const prevBtn=rankedState.prevSeason?`<button type="button" class="primary" id="claim-arena-season">Resgatar Liga ${rankedState.prevSeason.league.name} (${rankedState.prevSeason.season})</button>`:'';
      sb.innerHTML=`<span>Liga atual: <b class="league-tag" style="--league-color:${league.color}">${league.name}</b> · Temporada ${rankedState.season??''} · Prêmio ao final: +${league.reward.trophies}★, +${league.reward.tokens} tokens, +${league.reward.essence} essências</span>${prevBtn}`;
    }
    $('#ranked-info').textContent=rankedMessage||(rankedState?rankedState.points+' pontos na temporada · '+(5-rankedState.used)+'/5 tentativas até as 12h de Brasília.':'Consultando classificação…');
    $('#arena-ranked').disabled=rankedBusy||requestingRun||playing||!state.team.length||!rankedState||rankedState.day!==info.day||rankedState.used>=5;
  }
  $('#duel-skip').hidden=!playing;
  $('#duel-train').hidden=(!rival&&!viewingRun)||!!duel&&duel.result===null;
  $('#duel-train').textContent='Escolher outro adversário';
  btn.hidden=!!viewingRun;
  btn.disabled=rankedBusy||(community?.active()&&!rival)||arenaWait()>0||!state.team.length||rival?.team.length===0||!!duel&&duel.result===null;
  btn.textContent=duel&&duel.result===null?'Duelo em andamento':state.team.length&&arenaWait()>0?'Recuperação · '+Math.ceil(arenaWait()/1000)+' s':duel?'Jogar novamente':'Começar duelo';
}
const damageNumber=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
function damageText(n){return n>0&&n<.1?'<0,1':damageNumber.format(n);}
function drawDamage(field){
  const list=$('#damage-feed'),layer=field.querySelector('.damage-popups');
  const latest=duel.damageFeed[0]?.seq??-1;
  if(layer.match===duel&&layer.seen===latest)return;
  const seen=layer.match===duel?layer.seen:-1;
  if(layer.match!==duel){layer.replaceChildren();layer.match=duel;}
  layer.seen=latest;
  list.replaceChildren(...duel.damageFeed.slice(0,5).map(hit=>{
    const li=document.createElement('li');li.dataset.side=hit.side;
    li.textContent=`${hit.side?'Inimigo':'Você'} · ${hit.source} → ${hit.target} · −${damageText(hit.amount)} PV`;
    return li;
  }));
  if(!preferences.numbers)return;
  for(const hit of duel.damageFeed.filter(h=>h.seq>seen).reverse()){
    const pop=document.createElement('span');pop.dataset.side=hit.side;
    pop.textContent=`${hit.source} −${damageText(hit.amount)}`;
    layer.append(pop);
    const group=layer.querySelectorAll(`[data-side="${hit.side}"]`);
    if(group.length>3)group[0].remove();
    setTimeout(()=>pop.remove(),1500);
  }
}
function paintAttacks(canvas,m,balls){
  if(!viewingRun||viewingRun.physics>=3){
    const finishAge=m.bossEndAt===undefined?0:Math.max(0,(performance.now()-m.bossEndAt)/1000);
    return paintTranscendentes(canvas,m,preferences.motion,balls,finishAge);
  }
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  ctx.setTransform(8,0,0,8,0,0);ctx.clearRect(0,0,100,50);
  ctx.lineCap='round';
  for(const s of m.shots??[]){
    const age=m.t-s.born,zone=s.kind==='room'||s.kind==='zone';
    ctx.strokeStyle=s.side?'#ffa5b5':'#86fcff';
    ctx.fillStyle=s.side?'rgba(255,120,150,.12)':'rgba(60,225,255,.12)';
    ctx.lineWidth=.4;
    if(zone){
      const r=s.radius*Math.min(1,age/.3);
      ctx.beginPath();ctx.arc(s.x,s.y,r,0,2*Math.PI);ctx.fill();ctx.stroke();
    }else{
      ctx.beginPath();ctx.arc(s.x,s.y,s.radius,0,2*Math.PI);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.x-4*Math.cos(s.angle),s.y-4*Math.sin(s.angle));ctx.stroke();
    }
  }
  for(const e of (preferences.motion?m.flashes:[])??[]){
    ctx.strokeStyle=e.side?'#ffb4bb':'#bcffff';ctx.lineWidth=.65;
    ctx.beginPath();
    if(e.kind==='room'){ctx.moveTo(e.fromX,e.fromY);ctx.quadraticCurveTo((e.x+e.fromX)/2,e.y-3,e.x,e.y);}
    else{ctx.moveTo(e.x-2,e.y+2);ctx.lineTo(e.x+2,e.y-2);}
    ctx.stroke();
  }
}
function paintDuel(){
  const field=$('#duel-field');if(!field)return;
  const outcome=$('#duel-outcome');
  outcome.hidden=!duel?.result;
  outcome.textContent=duel?.result?(viewingRun?.result??duel.result):'';
  const banner=$('#skill-banner');
  if(banner){
    const recent=duel?.skills.filter(e=>duel.t-e.time<=2.5)??[];
    const label=recent.slice(0,2).reverse().map(e=>(e.side?'Adversário':'Você')+' · '+e.text).join('  /  ');
    if(banner.textContent!==label)banner.textContent=label;
    banner.hidden=!label;
  }
  if(!duel){
    field.hidden=true;$('#damage-feed').replaceChildren();$('#duel-status').textContent=state.team.length?'Sua formação está pronta.':'Escolha um personagem na coleção para começar.';
    $('#duel-teams').textContent=playerSquad().map(u=>u.name).join(' → ');$('#duel-log').textContent='';return;
  }
  field.hidden=false;
  const animated=paintAttacks(field.querySelector('.arena-vfx'),duel,[field.children[0],field.children[1]]);
  drawDamage(field);
  const rows=duel.sides.map((s,i)=>{
    const f=s.team[s.slot],ball=field.children[i];
    ball.hidden=!f;
    if(f){
      const x=s.x,y=s.y;
      ball.style.left=x+'%';ball.style.top=2*y+'%';
      ball.style.backgroundColor=COLORS[f.color];const image=animated?.[i]?'none':'url("'+spriteURL(f.sprite)+'")';
      if(ball.dataset.sprite!==image){ball.dataset.sprite=image;ball.style.backgroundImage=image;}
    }
    const call=field.children[i+2];
    const events=duel.skills.filter(e=>e.side===i && duel.t-e.time<1.55 && e.role!=='passiva' &&
      (e.slot===s.slot||e.role==='reserva'||e.role==='reação'));
    call.hidden=!f||!events.length||!!duel.result;
    if(!call.hidden){
      const lines=[...new Set(events.map(e=>e.slot===s.slot?e.name:e.text))];
      const label=lines.join('\n');
      if(call.textContent!==label)call.textContent=label;
      call.style.setProperty('--pos-x',ball.style.left);
      call.style.setProperty('--pos-y',ball.style.top);
      const rivalBall=duel.sides[1-i];
      const nearRival=preferences.motion&&Math.abs(s.x-rivalBall.x)<24&&Math.abs(s.y-rivalBall.y)<9;
      call.classList.toggle('at-top',parseFloat(ball.style.top)<32||(i===1&&nearRival&&s.y<34));
    }
    return '<section><small>'+(i?'ADVERSÁRIO':'SUA FORMAÇÃO')+'</small><strong>'+(f?.name??'Equipe eliminada')+'</strong>'+(f?'<progress max="'+f.maxHp+'" value="'+Math.ceil(f.hp)+'"></progress><small>'+Math.ceil(f.hp)+'/'+f.maxHp+' PV'+((f.divineShield?.until>duel.t?f.divineShield.amount:0)+f.shield>0?' · '+Math.ceil((f.divineShield?.until>duel.t?f.divineShield.amount:0)+f.shield)+' de escudo':'')+'</small><b class="collision-power">Dano de colisão · '+damageText(collisionPower(duel,f))+'</b><small>+'+collisionBonus(f.hits)+'% por colisões · antes da defesa e da afinidade</small>':'')+'<small>Reserva · '+(s.team.slice(s.slot+1).map(u=>u.name).join(', ')||'—')+'</small></section>';
  }).join('');
  if($('#duel-teams').innerHTML!==rows)$('#duel-teams').innerHTML=rows;
  $('#duel-status').textContent=duel.result&&viewingRun?.ranked?
    viewingRun.result+' · '+(viewingRun.delta>0?'+':'')+viewingRun.delta+' pontos'+(viewingRun.trophies?' · +'+viewingRun.trophies+(viewingRun.trophies===1?' troféu':' troféus'):''):duel.result&&viewingRun?
    (viewingRun.result??duel.result)+' · '+int.format(viewingRun.damage)+' dano'+(viewingRun.items?' · +'+viewingRun.items+(viewingRun.items===1?' token de reroll':' tokens de reroll'):'')+(viewingRun.reward?' · +'+int.format(viewingRun.reward)+' ouro':''):
    duel.result??('Em combate · '+Math.floor(duel.t)+' s');
  $('#duel-log').textContent=duel.events.slice(0,3).join('  •  ');
}
function duelFrame(now){
  if((tab==='arena'||tab==='modos')&&!document.hidden&&duel&&duel.result===null){
    carry+=frameTime?Math.min(.15,(now-frameTime)/1000):0;frameTime=now;
    while(carry>=1/60&&duel.result===null){
      if(viewingRun)replayRules(viewingRun).stepDuel(duel);else advanceFriendlyDuel();
      carry-=1/60;
    }
    if(duel.result!==null){
      if(duel.bossFx?.length)duel.bossEndAt=now;
      finishTowerPlayback();renderPanel();
    }else paintDuel();
  }else{
    frameTime=0;
    if((tab==='arena'||tab==='modos')&&!document.hidden&&duel?.bossEndAt!==undefined){
      if((now-duel.bossEndAt)/1000>=BOSS_FINISH_FX)delete duel.bossFx;
      paintDuel();
      if(!duel.bossFx)delete duel.bossEndAt;
    }
  }
  requestAnimationFrame(duelFrame);
}
function advanceFriendlyDuel(){
    const home=duel.sides[0],previousSlot=home.slot;
    stepDuel(duel);
    if(previousSlot!==home.slot){
      const until=gameNow()+RECOVERY_MS;
      for(const f of home.team.slice(previousSlot,home.slot))arenaRecovery[f.uid]=until;
      if(home.slot===home.team.length)arenaRecovery.all=until;
      try{localStorage.setItem('nexus.arena.recovery.'+state.created,JSON.stringify(arenaRecovery));}catch{}
    }

}
requestAnimationFrame(duelFrame);

const community=createCommunity({spriteURL,onChallenge(profile){
  switchFight('arena');rival={name:profile.name,team:profile.team.map(u=>fighter(u,undefined,CHARACTERS[profile.leaderId]))};
  duel=null;tab='arena';history.replaceState(null,'','#arena');startDuel();
},onSession(data){
  loginRequired=false;
  const restoreForm=$('#account-restore');
  restoreForm.reset();restoreForm.hidden=true;
  autoTower=false;liveTowerSequence=null;towerAdvanceAt=0;
  arenaLogData=null;arenaLogUntil=0;worldBossData=null;worldBossUntil=0;
  boards.clear();shopMessage='';savedFights.clear();floorPage=null;rankedMessage='';rankedRetry=0;rankedState=null;duel=null;rival=null;viewingRun=null;raidClock=null;opponentRequest++;$('#arena-opponents')?.replaceChildren();
  state=data?.state??load()??fresh(Date.now(),crypto.getRandomValues(new Uint32Array(1))[0]);
  arenaRecovery=loadArenaRecovery();
  serverOffset=data?data.now-Date.now():0;
  saveTick=Date.now();
  stageKey='';finishedBattle=null;
  selected=state.team[0];pickSlot=null;
  renderPanel();
  drawScene(gameNow());
}});

const serial=unit=>`#${String(unit.serial).padStart(3,'0')}`;
const statLabels={hp:'PV',attack:'Ataque',magic:'Magia',defense:'Defesa',resistance:'Resistência',speed:'Velocidade'};
function store(){
  if(storageIssue){note(storageIssue);return false;}
  try {writeCampaign(localStorage,state);storageFailed=false;return true;}
  catch{storageFailed=true;note('Não foi possível salvar neste navegador. Exporte seu progresso em Configurações.');return false;}
}
async function exportCampaign(){
  await transaction(null);
  if(community?.active())return;
  const url=URL.createObjectURL(new Blob([packCampaign(state)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;link.download='alca-rng-progresso-'+new Date().toISOString().slice(0,10)+'.json';
  link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function importCampaign(file){
  if(!file||community?.active())return;
  try{
    const candidate=unpackCampaign(await file.text(),CHARACTERS,WORLDS);
    const message=`Restaurar a campanha com ${int.format(candidate.gold)} ouro e ${candidate.collection.length} personagens? Isso substituirá o progresso solo aberto neste navegador.`;
    if(!confirm(message))return;
    const restore=()=>{
      if(community?.active())return;
      writeCampaign(localStorage,candidate);
      location.reload();
    };
    transactionQueue=transactionQueue.then(()=>navigator.locks?navigator.locks.request(saveKey,restore):restore()).catch(()=>note('O navegador não conseguiu gravar o backup.'));
    await transactionQueue;
  }catch{note('Não foi possível ler este backup do Alca RNG. A campanha atual foi preservada.');}
}
function receive(entries,offline=false){
  if(!entries.length)return;
  if(state.awayReports?.length)return;
  if(offline){
    const wins=entries.filter(e=>e.won).length;
    const recruits=entries.filter(e=>e.recruit).map(e=>CHARACTERS[e.recruit.id].name);
    const gold=entries.reduce((a,e)=>a+e.gold,0);
    note(`Progresso AFK · ${wins} vitórias em ${entries.length} lutas · +${int.format(gold)} ouro${recruits.length?` · ${recruits.length} recrutados (${recruits.slice(0,3).join(', ')}${recruits.length>3?'…':''})`:''}.`);
    return;
  }
  const last=entries.at(-1);
  if(last.sold)note(`Cópia de ${CHARACTERS[last.sold.id].name} vendida por ${int.format(last.saleGold)} ouro.`);
  else if(last.recruit){const r=last.recruit;note(`${CHARACTERS[r.id].name}${r.shiny?' Shiny':''} #${String(r.serial).padStart(3,'0')} entrou para a coleção${r.trait?` · ${r.trait}`:''}.`);}
  else if(last.boss)note(last.won?`Vitória sobre ${last.label}! Confira os destinos da campanha.`:`Derrota contra ${last.label}. Ajuste a formação para a próxima tentativa.`);
}

let lastObservation=document.hidden?null:Date.now();
let sentObservation=null;
let renderedReport='';
function showAway(){
  if(connecting())return;
  const dialog=$('#away-dialog'),r=state.awayReports?.[0];
  if(!r){if(dialog.open)dialog.close();renderedReport='';return;}
  if(document.hidden||!document.hasFocus())return;
  if(renderedReport!==String(r.start)+'/'+r.end){
    renderedReport=String(r.start)+'/'+r.end;
    const minutes=Math.floor((r.end-r.start)/60000);
    const limit=r.encounterLimitReached
      ?' · limite de '+int.format(AFK_ENCOUNTER_LIMIT)+' encontros AFK atingido'
      :r.end-r.start>12*3600000?' · limite de exploração de 12 h':'';
    $('#away-time').textContent=(minutes>=60?Math.floor(minutes/60)+' h ':'')+(minutes%60)+' min de ausência'+limit;
    const byUid=new Map(state.collection.map(u=>[u.uid,u]));
    const recruits=Array.isArray(r.recruitUids)?r.recruitUids.map(uid=>byUid.get(uid)).filter(Boolean):state.collection.slice(r.firstRecruit,r.lastRecruit);
    $('#away-stats').innerHTML=[[r.encounters,'Encontros'],[r.wins,'Vitórias'],[recruits.length,'Mantidos na coleção'],[r.sold??0,'Cópias vendidas'],[r.saleGold??0,'Ouro de vendas (incluído no total)'],[r.gold,'Ouro'],[r.teamXp,'XP dos titulares'],[r.reserveXp,'XP dos reservas']].map(([v,label])=>`<div><strong>${int.format(v)}</strong><small>${label}</small></div>`).join('');
    $('#away-recruits').innerHTML=recruits.length?recruits.map(u=>{
      const c=CHARACTERS[u.id];return `<li style="--tone:${COLORS[c.color]}">${img(spriteFor(u))}<strong>${unitLabel(u)}</strong><small>${TIERS[c.tier-1]} · ${serial(u)}</small></li>`;
    }).join(''):'<li>Nenhum personagem recrutado neste período.</li>';
  }
  if(!dialog.open)dialog.showModal();
}
let loginRequired=false;
function connecting(){return community?.active()&&(!community.ready()||loginRequired);}
function transaction(action,offline=false){
  const generation=community?.generation();
  if(loginRequired||(action&&connecting()))return Promise.resolve(false);
  if(!action&&queuedSync&&queuedSync.generation===generation)return queuedSync.promise;
  if(!action&&community?.active()&&!community.syncAvailable())return Promise.resolve(false);
  let ok=false;
  function commit(){
    if(community?.active()||generation!==community?.generation())return;
    if(!storageFailed)state=load()??state;
    if(blockedCampaign){note(storageIssue);return;}
    const now=Date.now();
    const previousBattle=state.pending;
    const entries=advanceWithPresence(state,now,lastObservation);
    const lastEntry=entries.at(-1);
    if(previousBattle&&lastEntry?.end===previousBattle.end)finishedBattle={battle:previousBattle,entry:lastEntry};
    const actionChanged=action?applyGameAction(state,action,now):false;
    const changed=actionChanged||entries.length;
    if(action)entries.push(...advance(state,now));
    const saved=store();
    ok=saved&&(action?Boolean(actionChanged):true);
    if(changed&&!drag)renderPanel();
    if(profileUid)renderProfile();
    if(saved)receive(entries,offline);
  }
  const next=transactionQueue.then(async()=>{
    if(generation!==community?.generation())return;
    busy=true;
    try{
      if(community?.active()){
        const firstConnection=!community.ready();
        const previous=state;
        const observed=lastObservation;
        const age=observed===null||observed===sentObservation?null:Math.max(0,Date.now()-observed);
        let onlineAction=action;
        if(action?.type==='autoFormation'){
          const draft={...state,positions:{...state.positions}};
          if(!autoFormation(draft,action.mode,gameNow()))return;
          onlineAction={...action,team:draft.team,leader:draft.leader};
        }
        lastOnlineSyncAt=performance.now();
        const data=await community.game(onlineAction,age);
        if(!data)return;
        sentObservation=observed;
        serverOffset=data.now-Date.now();
        state=data.state;
        ok=action?Boolean(data.changed):true;
        if(firstConnection){arenaRecovery=loadArenaRecovery();finishedBattle=null;stageKey='';}
        if(data.finished)finishedBattle=data.finished;
        if((firstConnection||data.changed||data.entries.length||previous.gold!==state.gold||previous.traitItems!==state.traitItems||previous.arenaTrophies!==state.arenaTrophies)&&!drag)renderPanel();
        if(firstConnection&&tab==='comunidade')community.mount();
        if(profileUid)renderProfile();
        if(!state.awayReports?.length&&data.offline.total>25){
          const {total,wins,gold,recruits}=data.offline;
          note(`Progresso AFK · ${wins} vitórias em ${total} lutas · +${int.format(gold)} ouro · ${recruits} recrutados.`);
        }else receive(data.entries,offline);
      }else if(navigator.locks)await navigator.locks.request(saveKey,commit);
      else commit();
    } finally{busy=false;showAway();}
  });
  transactionQueue=next.catch(error=>{
    ok=false;
    if(generation!==community?.generation())return;
    if(error.status===401&&community?.active())loginRequired=true;
    if(connecting()){
      renderPanel();
      $('#account-message').textContent=loginRequired?'A sessão expirou. Entre novamente para recuperar sua campanha online.':error.message||'Aguardando conexão com sua campanha online.';
      $('#account-retry').hidden=loginRequired;
      $('#account-login').hidden=false;
    }
    note(error.message||'Não foi possível atualizar o progresso.');
  });
  const result=transactionQueue.then(()=>ok);
  if(!action){
    const sync={generation,promise:result};
    queuedSync=sync;
    void result.finally(()=>{if(queuedSync===sync)queuedSync=null;});
  }
  return result;
}

let bulkCommon=false;
function lockButton(u){return `<button class="ghost" data-lock-copy="${u.uid}" aria-pressed="${!!u.locked}">${u.locked?'Destrancar':'Trancar'}</button>`;}
let singularKnown=false,singularCheckAt=0;
const rarityTabs=['indice','configuracoes','colecao','guia'];
function singularRevealed(){
  return singularKnown||Boolean(state.singularDiscovered&&(community?.ready()||location.protocol==='file:'));
}
function visibleRarities(){
  return singularRevealed()?TIERS:TIERS.slice(0,-1);
}
async function refreshSingularDiscovery(){
  if(singularKnown||location.protocol==='file:'||Date.now()<singularCheckAt)return;
  singularCheckAt=Date.now()+30000;
  try{
    const response=await fetch('/api/discoveries');
    if(!response.ok)return;
    const {singular}=await response.json();
    if(singular===true){
      singularKnown=true;
      if(rarityTabs.includes(tab))renderPanel();
    }
  }catch{/* A consulta será repetida enquanto o Índice estiver aberto. */}
}
function renderDex(panel){
  const {characters,traits,totals}=dexSummary(state);
  const mastery=dexMastery(state);
  const owned=characters.filter(c=>c.count).length;
  const masteryCard=`<article class="card mastery-card"><h2>Maestria de Conta</h2><p class="caption">Descobrir personagens e variantes Shiny fortalece toda a sua conta permanentemente.</p>
    <div class="mastery-stats">
      <span class="stat-pill">Atributos globais <strong>+${Math.round(mastery.allBonus*100)}%</strong> <small>(${totals.seenChars%15}/15 próx.)</small></span>
      <span class="stat-pill">Ouro bônus <strong>+${Math.round(mastery.goldBonus*100)}%</strong></span>
      <span class="stat-pill">PV/Ataque/Magia (Shinies) <strong>+${Math.round(mastery.offenseBonus*100)}%</strong> <small>(${totals.shinyChars%10}/10 próx.)</small></span>
      <span class="stat-pill">Universos completos (+5% uni.) <strong>${mastery.completedUniverses.length}/${mastery.universes.length}</strong></span>
    </div>
    <div class="mastery-grid">${mastery.universes.map(u=>{
      const pct=Math.round(100*u.seen/Math.max(1,u.total)),done=u.seen===u.total;
      return `<div class="mastery-uni ${done?'complete':''}"><header><strong>${esc(u.universe)}</strong><span>${u.seen}/${u.total}${done?' · +5%':''}</span></header><div class="meter"><i style="width:${pct}%"></i></div></div>`;
    }).join('')}</div></article>`;
  const groups=TIERS.map((tier,i)=>{
    const list=characters.filter(c=>c.tier===i+1);
    const cards=list.map(c=>{
      if(!c.count)return `<div class="dex-card missing"><img class="silhouette" src="${spriteURL(spriteFor(c))}" alt=""><strong>???</strong><small>${c.seen?'Já descoberto · 0 cópias':'Não descoberto'}</small></div>`;
      const u=state.collection.find(u=>u.id===c.id);
      return `<button class="dex-card" data-profile="${u.uid}">${img(spriteFor(u))}<strong>${unitLabel(u)}</strong><small>${c.count} na coleção · ${c.normal?'Normal':''}${c.normal&&c.shiny?' / ':''}${c.shiny?'Shiny':''}</small><small>${c.worlds.length?'Chance dobrada em '+c.worlds.join(', '):'Mesma chance em todos os mundos'}</small></button>`;
    }).join('');
    const reveal=i!==8||singularRevealed();
    return `<section class="card dex-group" data-dex-tier="${i+1}"><h3 class="${reveal?`rar-name rarity-${i+1}`:''}">${reveal?tier:'???'} <small>${list.filter(c=>c.count).length}/${list.length}</small></h3><div class="dex-grid">${cards}</div></section>`;
  }).join('');
  panel.innerHTML=`${masteryCard}<article class="card"><h2>Índice de personagens</h2><p>Todos os ${totals.totalChars} personagens podem aparecer em encontros comuns de qualquer mundo. Dentro da mesma raridade, cada personagem do universo local tem o dobro da chance de um visitante.</p><p>${owned}/${totals.totalChars} na coleção · ${totals.seenChars} descobertos · ${totals.shinyChars} variantes Shiny descobertas</p></article>${groups}<details class="card"><summary>Traits descobertas · ${totals.seenTraits}/${totals.totalTraits}</summary><p>${traits.filter(t=>t.seen).map(t=>t.name).join(' · ')||'Nenhuma trait descoberta.'}</p></details>`;
}
async function reviewBatch(){
  const units=duplicateSellCandidates(state,{includeCommonTraits:bulkCommon}).slice(0,200);
  if(!units.length){note('Nenhuma duplicata disponível para este lote.');return;}
  const gold=units.reduce((sum,u)=>sum+SALE_PRICES[CHARACTERS[u.id].tier-1],0);
  const counts=new Map();
  for(const u of units)counts.set(u.id,(counts.get(u.id)??0)+1);
  const summary=[...counts].map(([id,n])=>CHARACTERS[id].name+' ×'+n).join(', ');
  if(!confirm('Vender '+units.length+' cópia(s) por '+int.format(gold)+' ouro?\n\n'+summary))return;
  const ok=await transaction({type:'sellBatch',uids:units.map(u=>u.uid),includeCommonTraits:bulkCommon});
  note(ok?'Lote vendido · +'+int.format(gold)+' ouro.':'O lote mudou. Revise as duplicatas novamente.');
}
function unitSummary(unit){
  const c=CHARACTERS[unit.id];
  return `<span class="member">${img(spriteFor(unit))}<span class="unit-summary"><strong>${unitLabel(unit)}</strong><small>${TIERS[c.tier-1]} · ${c.color} · Nv. ${levelAt(unit.xp)} · ${serial(unit)}</small></span></span>`;
}

let chartColor='Vermelho',chartMode='ataque';
function colorChart(){
  const colors=Object.keys(COLORS);
  const symbols={Vermelho:'◆',Laranja:'▲',Amarelo:'✦',Verde:'✿',Turquesa:'≈',Azul:'●',Roxo:'☾',Rosa:'♥',Branco:'○',Preto:'■',Dourado:'✹'};
  const attack=chartMode==='ataque';
  const mult=c=>attack?affinity(chartColor,c):affinity(c,chartColor);
  const ring=['Vermelho','Laranja','Amarelo','Verde','Turquesa','Azul','Roxo','Rosa'];
  const point=i=>{const t=i*Math.PI/4-Math.PI/2;return [160+108*Math.cos(t),134+102*Math.sin(t)];};
  const wheel=`<svg class="affinity-wheel" viewBox="0 0 320 275" role="img" aria-label="Ciclo de vantagem: Vermelho, Laranja, Amarelo, Verde, Turquesa, Azul, Roxo, Rosa e volta para Vermelho."><defs><marker id="aff-tip" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0L5 2.5L0 5Z" fill="#d6d9ec"/></marker></defs>
    ${ring.map((c,i)=>{const [x,y]=point(i),[nx,ny]=point(i+1),dx=nx-x,dy=ny-y;
      return `<line x1="${x+dx*.3}" y1="${y+dy*.3}" x2="${x+dx*.68}" y2="${y+dy*.68}" stroke="#d6d9ec" stroke-width="1.8" marker-end="url(#aff-tip)"/>`;}).join('')}
    ${ring.map((c,i)=>{const [x,y]=point(i);return `<g><circle cx="${x}" cy="${y}" r="15" fill="#232639" stroke="${COLORS[c]}" stroke-width="${chartColor===c?4:2}"/><text x="${x}" y="${y+5}" fill="${COLORS[c]}">${symbols[c]}</text><text x="${x}" y="${y+30}" class="wheel-name">${c}</text></g>`;}).join('')}
    <text x="160" y="126" class="wheel-title">1,5×</text><text x="160" y="146" class="wheel-name">no sentido da seta</text></svg>`;
  return `<section class="match-chart"><h3>Mapa de afinidades</h3>${wheel}<div class="chart-modes">${['ataque','defesa'].map(m=>`<button class="ghost" data-mode="${m}" aria-pressed="${m===chartMode}">${m==='ataque'?'Atacando':'Defendendo'}</button>`).join('')}</div>
  <p>Escolha a cor de quem ${attack?'ataca':'defende'}.</p><div class="palette">${colors.map(c=>`<button style="--hue:${COLORS[c]}" data-color="${c}" aria-pressed="${c===chartColor}"><b>${symbols[c]}</b>${c}</button>`).join('')}</div>
  <h4>${attack?chartColor+' ataca':'Dano recebido por '+chartColor}</h4><div class="match-groups">${[2,1.5,.75,1].map(n=>{
    const targets=colors.filter(c=>mult(c)===n);
    return targets.length?`<div class="match-row"><strong>${n.toLocaleString('pt-BR')}×</strong><div>${targets.map(c=>`<span style="--hue:${COLORS[c]}"><b>${symbols[c]}</b> ${c}</span>`).join('')}</div></div>`:'';
  }).join('')}</div></section>`;
}
function traitEffects(trait){
  if(!trait)return [];
  const effects=trait.buffs.flatMap((v,i)=>v?[`+${Math.round(v*100)}% ${Object.values(statLabels)[i]}`]:[]);
  if(trait.passive)effects.push(trait.passive);
  return effects;
}
function strengthLabels(power,level,projected){
  const suffix=level>=100?' · Nível máximo':'';
  const current=`<span class="power-pill">Força atual ${int.format(power)}${suffix}</span>`;
  return level>=100?current:current+` <span class="power-pill">Força no Nv. 100 · ${int.format(projected)}</span>`;
}
function renderProfile(){
  const unit=publicUnit??copy(profileUid);
  if(!unit){$('#character-profile').close();return;}
  const inTeam=state.team.includes(unit.uid);
  const mastery=publicUnit?null:dexMastery(state);
  const stats=fighter(unit,undefined,inTeam?card(state.leader):null,false,mastery);
  const base=fighter(unit,undefined,null,false,mastery);
  const xp=xpProgress(unit.xp,publicUnit?100:levelCap(state));
  const names=slotTraits(unit);
  const equipped=TRAITS.filter(t=>names.includes(t.name));
  const bonuses=equipped.flatMap(t=>traitEffects(t).map(effect=>t.name+' · '+effect));
  const trait=equipped.length===1?equipped[0]:null;
  const stars=Math.max(0,Math.min(MAX_STARS,unit.stars??0));
  const nextAwaken=publicUnit?null:awakenCost(unit);
  const duplicates=publicUnit?[]:state.collection.filter(u=>u.id===unit.id&&u.uid!==unit.uid&&!state.team.includes(u.uid)&&!u.locked);
  const essence=state.items?.essence??0;
  const xpTomes=state.items?.xpTome??0;
  const catalysts=state.items?.catalyst??0;
  const traitLocks=state.items?.traitLock??0;
  const pity=state.traitPity??0;
  const awakenHtml=!publicUnit?`<div class="awaken-box"><h3>Despertar ${stars?'★'.repeat(stars):'☆'} (${stars}/${MAX_STARS})</h3>
    <p class="caption">Cada estrela concede +4% em todos os atributos${stars>=5?' · Bônus ★5 ativo (+5% Velocidade).':' (+5% Velocidade extra em ★5).'}</p>
    ${nextAwaken?`<p class="caption">Próxima estrela (★${nextAwaken.next}): <b>${int.format(nextAwaken.gold)} ouro</b> + 1 cópia ou <b>${nextAwaken.essence} Essência(s)</b> (você tem ${essence}).</p>
      <div class="awaken-actions">
        ${duplicates.length?`<select id="awaken-dup-select">${duplicates.map(d=>`<option value="${d.uid}">${serial(d)} · Nv.${levelAt(d.xp)}${d.shiny?' Shiny':''}${d.trait?' · '+esc(d.trait):''}</option>`).join('')}</select><button type="button" class="primary" data-awaken-dup="${unit.uid}" ${state.gold<nextAwaken.gold?'disabled':''}>Despertar com cópia</button>`:'<small class="caption">Sem cópias livres para sacrificar.</small>'}
        <button type="button" class="ghost" data-awaken-essence="${unit.uid}" ${state.gold<nextAwaken.gold||essence<nextAwaken.essence?'disabled':''}>Usar ${nextAwaken.essence} Essência(s)</button>
      </div>`:'<p><strong>Despertar máximo alcançado (★★★★★)!</strong></p>'}</div>`:'';
  const content=`<header class="profile-title" style="--tone:${COLORS[stats.color]}">
    ${img(stats.sprite)}
    <div><p class="smallcaps">${stats.universe}</p><h2 id="profile-title">${unitLabel(unit)}</h2>${publicUnit?'':lockButton(unit)}
    <p>${TIERS[stats.tier-1]} · ${stats.color} · ${stats.role} · ${unit.shiny?'Shiny':'Normal'}${stars?' · '+'★'.repeat(stars):''}</p>
    <p>${strengthLabels(unitPower(unit),stats.level,projectedPower(unit))}</p><small>Força individual sem bônus de líder.</small><p><b>Serial ${publicUnit||community?.active()?'global':'local'} ${serial(unit)}</b> · ${publicUnit?'Comunidade':inTeam?'Formação principal':'Reserva'}${state.leader===unit.uid?' · Líder':''}</p></div>
  </header>
  <div class="profile-grid">
    <section class="card"><h3>Atributos</h3>${inTeam?`<p class="caption">Bônus de liderança de ${card(state.leader).name} incluído quando aplicável.</p>`:''}
      <dl class="profile-stats">${Object.entries(statLabels).map(([key,label])=>{
        const boost=stats[key]-base[key];
        return `<div><dt>${label}</dt><dd>${int.format(stats[key])}${boost?` <small>(+${int.format(boost)})</small>`:''}</dd></div>`;
      }).join('')}</dl><p><b>Avaliação por função · ${int.format(formationPower(unit))}</b></p><small>Nota para comparar personagens da função ${stats.role} no nível 100, pelos atributos.</small>
      ${awakenHtml}
    </section>
    <section class="card"><h3>Nível ${xp.level}</h3>
      ${publicUnit?'':xp.required?`<label for="profile-xp">${xp.current} / ${xp.required} XP até o próximo nível</label><progress id="profile-xp" value="${xp.current}" max="${xp.required}"></progress>`:'<p>Nível máximo</p>'}
      <p class="caption">${int.format(unit.xp)} XP total</p>
      ${!publicUnit&&xp.required?`<button type="button" class="ghost" data-use-xp-tome="${unit.uid}" ${xpTomes<1?'disabled':''}>Usar Tomo de XP (+250.000 XP) · ${xpTomes} disp.</button>`:''}
      <h3>Habilidade</h3><p><b>${stats.skill}</b><br>${SKILL_EFFECTS[stats.kind]}</p>
      ${stats.signatureAssist?'<p class="caption">Na Arena, também usa esta habilidade como assistência quando está na reserva.</p>':''}
      <h3>Efeito como líder</h3><p>${stats.leader}</p>
    </section>
    <section class="card"><h3>Trait</h3><p>${names.join(' + ')||'Sem Trait'}</p>${trait?`<p>${trait.rarity} · 1 em ${int.format(trait.odds)} recrutáveis</p>`:''}
      ${!publicUnit?`<p>Tokens de reroll · <b>${state.traitItems??0}</b> · Catalisadores · <b>${catalysts}</b> · Selos de Trava · <b>${traitLocks}</b></p>
        <div class="pity-bar"><small>Garantia (Pity) para Trait Mítica+: <b>${pity}/${TRAIT_PITY_LIMIT}</b></small><div class="meter"><i style="width:${Math.min(100,Math.round(100*pity/TRAIT_PITY_LIMIT))}%"></i></div></div>
        <div class="reroll-opts"><label><input type="checkbox" id="reroll-catalyst" ${catalysts<1?'disabled':''}> Usar Catalisador (3× multi-trait, Rara+)</label></div>
        ${[0,1].map(slot=>{
          const cur=slotTraits(unit,slot);
          return `<section class="trait-loadout"><b>Slot ${'AB'[slot]}${slot===(unit.activeSlot??0)?' · equipado':''}</b><p>${cur.join(' + ')||'Vazio'}</p>${cur.length>1?`<small>Combinação por token: ≈ 1 em ${int.format(Math.round(1/loadoutChance(cur)))}</small><br>`:''}
          ${cur.length&&traitLocks>0?`<label class="caption">Travar trait (1 Selo): <select data-lock-select="${slot}"><option value="">Não travar</option>${cur.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></label><br>`:''}
          <button data-slot-action="reroll" data-slot="${slot}" ${!(state.traitItems>0)?'disabled':''}>Rolar · 1 token</button> <button data-slot-action="equipTraitSlot" data-slot="${slot}" ${!cur.length||slot===(unit.activeSlot??0)?'disabled':''}>Equipar</button></section>`;
        }).join('')}`:''}
      ${names.includes('Made in Heaven')&&names.includes('Voto de Nen')?`<p>Combo · ${unit.nen?'+112% dano · 2 vagas':'+50% dano · 1 vaga'}</p>`:''}
      ${!publicUnit&&names.includes('Voto de Nen')?`<button class="ghost" data-nen="${unit.uid}" ${inTeam&&!unit.nen&&formationCost(state)>=4?'disabled':''}>${unit.nen?'Desativar Última Aposta':inTeam&&formationCost(state)>=4?'Libere uma vaga para ativar':'Ativar Última Aposta'}</button>`:''}
      ${bonuses.length?`<ul>${bonuses.map(bonus=>`<li>${bonus}</li>`).join('')}</ul>`:''}
    </section>
    <section class="card"><h3>Recrutamento</h3><p>${unit.odds?`1 em ${int.format(unit.odds)} ${unit.oddsBasis==='recruitable'?'recrutáveis':'encontros comuns (registro anterior)'}`:'Integrante inicial'}</p>
      ${unit.shiny?'<p class="caption">Shiny concede +12% a PV, Ataque, Magia, Defesa e Resistência.</p>':''}
    </section>
  </div>`;
  if(content===profileContent)return;
  profileContent=content;
  $('#profile-content').innerHTML=content;
}

// Keep the same form controls mounted while battles and settings requests finish.
const pendingSettings=new Map();
function settingKey(input){
  return input.id||input.dataset.autosellTier||'setting';
}
function changeSetting(input,action){
  const key=settingKey(input);
  const edit={value:input.type==='checkbox'?input.checked:input.value};
  pendingSettings.set(key,edit);
  void transaction(action).finally(()=>{
    if(pendingSettings.get(key)===edit)pendingSettings.delete(key);
    if(tab==='configuracoes')renderSettings($('#panel'));
  });
}
function renderSettings(panel){
  const mode=community?.active()?'online':'solo';
  const rarities=visibleRarities();
  const layoutKey=mode+'-'+rarities.length;
  if(panel.querySelector('.settings')?.dataset.mode!==layoutKey){
    const sortedChars=Object.values(CHARACTERS).filter(c=>c.tier<=rarities.length)
      .sort((x,y)=>y.tier-x.tier||x.name.localeCompare(y.name,'pt-BR'));
    panel.innerHTML=`<article class="card settings"><h2>Configurações</h2>
      <h3>Conta</h3><button class="ghost" data-tab="comunidade">Google, Discord e código de acesso</button><h3>Progresso da campanha</h3>${community?.active()?'<p class="caption">Sua conta salva no servidor. Vincule sua conta na Comunidade para recuperar o acesso.</p>':`<p class="caption"><span id="save-status"></span> ${location.protocol==='file:'?'Para atualizar o HTML, mantenha o mesmo nome, pasta e navegador. ':''}Use um backup para continuar em outro arquivo ou dispositivo.</p>
      <button type="button" id="export-save">Exportar backup</button> <button type="button" id="import-save">Importar backup</button>`}
      <label><input type="checkbox" id="auto-play"> Exploração automática</label><p class="caption">Parar conclui a luta em andamento e suspende os próximos encontros, inclusive AFK.</p>
      <label><input type="checkbox" id="auto-routes"> Avançar áreas e mundos automaticamente</label><p class="caption">A equipe desafia o chefe quando ele libera e viaja após vencer. Escolher uma área ou mundo manualmente fixa a rota.</p>
      <h3>Venda automática (Auto-Sell)</h3>
      <div id="autosell-legacy" hidden>
        <label><input type="checkbox" id="autosell-legacy-enabled"> Ativar as regras de venda automática anteriores</label>
        <button type="button" class="ghost" id="autosell-convert">Configurar o novo sistema</button>
      </div>
      <div class="autosell-card" id="autosell-rules">
        <label class="autosell-master"><input type="checkbox" id="autosell-enabled"> <strong>Ativar venda automática de novos recrutas</strong></label>
        <div class="autosell-summary" id="sale-status" role="status"></div>
        <div class="autosell-section">
          <span class="autosell-label">Atalhos rápidos</span>
          <div class="autosell-presets">
            <button type="button" class="ghost" data-autosell-preset="1">Só Comuns</button>
            <button type="button" class="ghost" data-autosell-preset="1,2">Até Incomuns</button>
            <button type="button" class="ghost" data-autosell-preset="1,2,3">Até Raras</button>
            <button type="button" class="ghost" data-autosell-preset="1,2,3,4">Até Épicas</button>
            <button type="button" class="ghost" data-autosell-preset="">Limpar</button>
          </div>
        </div>
        <div class="autosell-section">
          <span class="autosell-label">1. Quais raridades vender automaticamente?</span>
          <div class="tier-pills">${rarities.map((name,i)=>`<button type="button" class="tier-pill" data-autosell-tier="${i+1}" aria-pressed="false"><strong>${name}</strong><small>${int.format(SALE_PRICES[i])} ouro${i>=4?` + ${i-3} Ess.`:''}</small></button>`).join('')}</div>
        </div>
        <div class="autosell-section">
          <span class="autosell-label">2. Proteções (nunca vender)</span>
          <label><input type="checkbox" id="autosell-first-normal"> Sempre manter a 1ª cópia normal de cada personagem</label>
          <div class="autosell-grid">
            <label>Proteção de Shinies
              <select id="autosell-shiny">
                <option value="all">Sempre manter todos os Shinies</option>
                <option value="first">Manter apenas o 1º Shiny de cada personagem</option>
                <option value="none">Não proteger Shinies (vender como normal)</option>
              </select>
            </label>
            <label>Proteção por Trait
              <select id="autosell-trait-tier">
                <option value="1">Manter qualquer Trait (Comum+)</option>
                <option value="2">Manter Traits Incomum ou superior</option>
                <option value="3">Manter Traits Rara ou superior</option>
                <option value="4">Manter Traits Épica ou superior</option>
                <option value="5">Manter Traits Mítica ou superior</option>
                <option value="6">Manter Traits Divina ou superior</option>
                <option value="7">Manter Traits Secreta ou superior</option>
                <option value="8">Manter apenas Traits Transcendente</option>
                <option value="9">Não proteger por Trait (vender mesmo com Trait)</option>
              </select>
            </label>
          </div>
        </div>
        <div class="autosell-section">
          <span class="autosell-label">3. Lista VIP — Nunca vender estes personagens (ideal para Despertar ★1–★5)</span>
          <div class="vip-picker">
            <select id="autosell-vip-select" aria-label="Escolher personagem VIP"><option value="">Escolher personagem para proteger…</option>${sortedChars.map(c=>`<option value="${c.id}">${c.name} (${TIERS[c.tier-1]})</option>`).join('')}</select>
            <button type="button" class="ghost" id="autosell-vip-add">Adicionar VIP</button>
          </div>
          <div class="vip-tags" id="autosell-vip-tags"></div>
        </div>
      </div>
      <h3>Exibição neste dispositivo</h3><label><input type="checkbox" data-pref="motion"> Animações de combate</label>
      <label><input type="checkbox" data-pref="numbers"> Números de dano na arena</label></article>`;
    panel.querySelector('.settings').dataset.mode=layoutKey;
  }
  const sale=saleSettings(state.autoSell);
  // Keep saved preferences while omitting the unrevealed rarity from labels and controls.
  const visibleSale={...sale,tiers:sale.tiers.filter(tier=>tier<=rarities.length),
    keepCharacters:sale.keepCharacters.filter(id=>CHARACTERS[id].tier<=rarities.length)};
  $('#autosell-legacy').hidden=!sale.legacy;
  $('#autosell-rules').hidden=!!sale.legacy;
  const localStatus=$('#save-status');
  if(localStatus)localStatus.textContent=storageIssue||storageFailed?'Salvamento local indisponível.':'Salvamento automático neste navegador.';
  function setChecked(input,value){
    if(input)input.checked=pendingSettings.get(settingKey(input))?.value??value;
  }
  setChecked($('#auto-play'),!isPaused());
  setChecked($('#auto-routes'),!!state.autoRoutes);
  setChecked($('#autosell-enabled'),sale.enabled);
  setChecked($('#autosell-legacy-enabled'),sale.enabled);
  setChecked($('#autosell-first-normal'),sale.keepFirstNormal);
  const shinySel=$('#autosell-shiny');
  if(shinySel)shinySel.value=pendingSettings.get(settingKey(shinySel))?.value??sale.shinyRule;
  const traitSel=$('#autosell-trait-tier');
  if(traitSel)traitSel.value=String(pendingSettings.get(settingKey(traitSel))?.value??sale.minTraitTier);
  for(const btn of panel.querySelectorAll('[data-autosell-tier]')){
    const active=sale.tiers.includes(Number(btn.dataset.autosellTier));
    btn.setAttribute('aria-pressed',String(active));
    btn.classList.toggle('active',active);
  }
  const summary=$('#sale-status');
  if(summary){
    summary.textContent=describeAutoSell(visibleSale);
    summary.classList.toggle('on',visibleSale.enabled&&visibleSale.tiers.length>0);
  }
  const vipBox=$('#autosell-vip-tags');
  if(vipBox){
    vipBox.innerHTML=visibleSale.keepCharacters.length
      ?visibleSale.keepCharacters.map(id=>{
        const c=CHARACTERS[id];
        return `<span class="vip-chip">${esc(c.name)} <small>${TIERS[c.tier-1]}</small><button type="button" data-autosell-vip-remove="${id}" aria-label="Remover ${esc(c.name)} da lista VIP">×</button></span>`;
      }).join('')
      :'<small class="caption">Nenhum personagem VIP adicionado.</small>';
  }
  for(const input of panel.querySelectorAll('[data-pref]'))input.checked=preferences[input.dataset.pref];
}


function renderWorldNav(){
  const nav=$('#world-nav');
  nav.hidden=tab!=='exploracao';
  if(nav.hidden)return;
  const list=$('#world-list');
  if(!list.childElementCount){
    list.innerHTML=WORLDS.map((world,i)=>{
      const levels=world.areas;
      return `<button type="button" class="mundo-cartao" data-world="${i}"><span class="mundo-texto"><strong>${world.name}</strong><small>Nv. ${levels[0].levels[0]}–${levels.at(-1).levels[1]}</small></span><span class="world-status"></span></button>`;
    }).join('');
  }
  for(const button of list.children){
    const i=Number(button.dataset.world);
    const current=i===(state.world??0);
    const queued=i===state.destination && !current;
    button.disabled=i>(state.unlocked??0);
    button.classList.toggle('atual',current);
    button.classList.toggle('fechado',button.disabled);
    button.classList.toggle('pendente',queued);
    if(current)button.setAttribute('aria-current','location');
    else button.removeAttribute('aria-current');
    const status=queued?'Após a luta':current?'Aqui':button.disabled?'Bloqueado':'';
    if(button.lastElementChild.textContent!==status)button.lastElementChild.textContent=status;
  }
}

let autoFormMode='power';
const colFilter={search:'',sort:'potential',role:'',tier:'',shiny:false,trait:false};
const ROLE_TAG={Guardião:'GUA',Combatente:'COM',Mágico:'MAG',Suporte:'SUP'};
function countAffordableUpgrades(){
  return Object.entries(UPGRADES).filter(([id,u])=>{
    const level=upgradeLevel(state,id),price=u.costs[level],world=u.worlds[level];
    return price!==undefined&&world<=(state.unlocked??0)+1&&state.gold>=price;
  }).length;
}
function teamAffinitySummary(targetColor){
  if(!targetColor||!state.team.length)return '';
  let adv=0,dis=0;
  for(const uid of state.team){
    const m=affinity(card(uid).color,targetColor);
    if(m>1)adv++;else if(m<1)dis++;
  }
  const parts=[];
  if(adv)parts.push(`<b class="aff-good">${adv} vantagem</b>`);
  if(dis)parts.push(`<b class="aff-bad">${dis} desvantagem</b>`);
  return parts.length?parts.join(' · '):'<span>Neutro</span>';
}
function efficiencySummary(){
  const wins=state.log.filter(e=>e.won);
  if(!wins.length)return '';
  const avgGold=wins.reduce((s,e)=>s+e.gold,0)/wins.length;
  const avgXp=wins.reduce((s,e)=>s+(e.xp??0),0)/wins.length;
  const cycleSec=(waitFor(state)/1000)+5;
  const perHour=3600/cycleSec*(wins.length/state.log.length);
  return `<div class="efficiency-bar"><span>~<b>${int.format(Math.round(avgGold*perHour))}</b> ouro/h</span><span>~<b>${int.format(Math.round(avgXp*perHour))}</b> XP/h</span><span>Média <b>+${int.format(Math.round(avgGold))}</b> ouro/vitória</span></div>`;
}
function tacticalHints(){
  const pts=state.team.map(uid=>({uid,c:card(uid),u:copy(uid),p:state.positions[uid]??[50,50]}));
  let clustered=0,covered=new Set();
  for(let i=0;i<pts.length;i++){
    for(let j=i+1;j<pts.length;j++){
      const d=Math.hypot(pts[i].p[0]-pts[j].p[0],pts[i].p[1]-pts[j].p[1]);
      if(d<=28)clustered++;
    }
    const protector=pts[i].c.role==='Guardião'||slotTraits(pts[i].u).some(n=>['Restrição Celestial','Full Counter'].includes(n));
    if(protector){
      for(let j=0;j<pts.length;j++){
        if(i===j)continue;
        if(Math.hypot(pts[i].p[0]-pts[j].p[0],pts[i].p[1]-pts[j].p[1])<=30)covered.add(pts[j].uid);
      }
    }
  }
  const tags=[];
  tags.push(clustered?`<span class="hint-chip warn">${clustered} par(es) próximo(s) (≤28): risco de golpe em área</span>`:`<span class="hint-chip ok">Equipe espaçada contra golpes em área</span>`);
  if(covered.size)tags.push(`<span class="hint-chip info">Cobertura ativa em ${covered.size} aliado(s)</span>`);
  return `<div class="tactical-hints">${tags.join('')}</div>`;
}
let collectionIndex=null;
function getCollectionIndex(){
  if(collectionIndex)return collectionIndex;
  collectionIndex=state.collection.map((unit,idx)=>{
    const c=CHARACTERS[unit.id];
    return {unit,idx,c,power:unitPower(unit),potential:projectedPower(unit),level:levelAt(unit.xp),searchKey:`${c.name} ${c.universe} ${slotTraits(unit).join(' + ')}`.toLowerCase()};
  });
  return collectionIndex;
}
function filteredCollection(){
  const q=colFilter.search.trim().toLowerCase();
  const list=getCollectionIndex().filter(({unit,c,searchKey})=>{
    if(q&&!searchKey.includes(q))return false;
    if(colFilter.role&&c.role!==colFilter.role)return false;
    if(colFilter.tier&&c.tier!==Number(colFilter.tier))return false;
    if(colFilter.locked&&!unit.locked)return false;
    if(colFilter.shiny&&!unit.shiny)return false;
    if(colFilter.trait&&!slotTraits(unit,0).length&&!slotTraits(unit,1).length)return false;
    return true;
  });
  list.sort((a,b)=>{
    if(colFilter.sort==='potential')return b.potential-a.potential||b.power-a.power;
    if(colFilter.sort==='power')return b.power-a.power||b.level-a.level||b.c.tier-a.c.tier;
    if(colFilter.sort==='level')return b.level-a.level||b.power-a.power;
    if(colFilter.sort==='tier')return b.c.tier-a.c.tier||b.power-a.power;
    return b.idx-a.idx;
  });
  return list;
}
function renderCollectionGrid(){
  const grid=$('#collection-list');if(!grid)return;
  const slots=formationSlots(state);
  const index=pickSlot??(slots.includes(null)?slots.indexOf(null):3);
  const items=filteredCollection();
  const teamSet=new Set(state.team);
  const allowSell=state.collection.length>1;
  const countEl=$('#collection-filtered-count');
  if(countEl)countEl.textContent=items.length===state.collection.length?`${state.collection.length} personagens recrutados`:`Mostrando ${items.length} de ${state.collection.length} personagens`;
  grid.innerHTML=items.length?items.map(({unit,c,power,potential,level})=>{
    const inTeam=teamSet.has(unit.uid);
    const sellable=allowSell&&!inTeam&&!unit.locked;
    const price=SALE_PRICES[c.tier-1]??0;
    return `<div class="collection-card" style="--tone:${COLORS[c.color]}"><button class="character-hit" data-profile="${unit.uid}">${unitSummary(unit)}</button><p class="collection-meta"><span class="role-pill">${c.role}</span> ${strengthLabels(power,level,potential)}${unit.trait?` <span class="trait-pill">${slotTraits(unit).join(' + ')}</span>`:''}</p><p>${c.skill} · ${c.universe}</p><div class="collection-actions"><button class="ghost" data-equip="${unit.uid}" data-slot="${index}" data-occupant="${slots[index]??''}" ${inTeam?'disabled':''}>${inTeam?'Na equipe':slots[index]?'Substituir na vaga '+(index+1):'Colocar na vaga '+(index+1)}</button>${lockButton(unit)}${sellable?`<button class="ghost sell-btn" data-sell="${unit.uid}">Vender (+${int.format(price)})</button>`:''}</div></div>`;
  }).join(''):'<p class="caption">Nenhum personagem encontrado com os filtros selecionados.</p>';
}
function floatTag(target,text,cls=''){
  if(!target||!preferences.numbers)return;
  const hit=document.createElement('span');hit.className='float'+(cls?' '+cls:'');hit.textContent=text;
  target.append(hit);setTimeout(()=>hit.remove(),780);
}
function fmtMilestoneReward(m){
  const parts=[];
  if(m.gold)parts.push(`+${int.format(m.gold)} ouro`);
  if(m.traitItems)parts.push(`+${m.traitItems} token(s)`);
  if(m.items?.essence)parts.push(`+${m.items.essence} essência(s)`);
  if(m.items?.xpTome)parts.push(`+${m.items.xpTome} tomo(s) XP`);
  if(m.items?.catalyst)parts.push(`+${m.items.catalyst} catalisador(es)`);
  if(m.items?.traitLock)parts.push(`+${m.items.traitLock} selo(s) trava`);
  return parts.join(' · ');
}
function renderModes(panel){
  if(!panel.querySelector('#modes-nav')){
    panel.innerHTML='<nav id="modes-nav" class="community-tabs" aria-label="Modos de jogo"><button class="ghost" data-game-mode="raid">Raid</button><button class="ghost" data-game-mode="tower">Torre infinita</button><button class="ghost" data-game-mode="weeklyTower">Torre semanal</button></nav><div id="mode-info"></div><div id="mode-fight"></div>';
  }
  for(const button of panel.querySelectorAll('[data-game-mode]'))button.setAttribute('aria-pressed',button.dataset.gameMode===mode);
  const daily=raidInfo(),wt=weeklyTowerToday(gameNow()),next=(state.towerCleared??0)+1;
  const used=state.raid?.day===daily.day?state.raid.attempts:0;
  const bestToday=used?state.raid.bestDamage:0;
  const claimedToday=state.raid?.day===daily.day&&Array.isArray(state.raid.claimed)?raidClaims(state.raid.claimed):[];
  const ready=state.team.some(uid=>readyAt(state,uid)<=gameNow());
  const playing=duel?.result===null,locked=(state.unlocked??0)<9,weeklyLocked=(state.unlocked??0)<5;
  const dayRaid=mode==='raid',isWeekly=mode==='weeklyTower';
  const canReplay=state.ballRun&&(dayRaid?state.ballRun.raid:isWeekly?state.ballRun.weekly:(!state.ballRun.raid&&!state.ballRun.weekly))&&!playing;
  const autoControl=`<button type="button" class="ghost auto-tower" data-auto-tower aria-pressed="${autoTower}" ${locked?'disabled':''}>Avanço automático · ${autoTower?'ligado':'desligado'}</button>`;
  let content;
  if(dayRaid){
    const kit=bossKits[daily.boss.arenaKind];
    const skill=kit?` · ${kit.name} (${kit.cooldown} s)`:'';
    if(community?.ready())refreshWorldBoss();
    const milestonesHtml=`<ul class="milestone-list">${RAID_MILESTONES.map(m=>{
      const done=claimedToday.includes(m.damage)||bestToday>=m.damage;
      return `<li class="milestone-item ${done?'done':''}"><strong>${m.label} dano ${done?'✓':''}</strong><span>${fmtMilestoneReward(m)}</span></li>`;
    }).join('')}</ul>`;
    let wbHtml='';
    if(community?.ready()){
      const wb=worldBossData;
      if(wb){
        const maxDmg=wb.milestones.at(-1).damage;
        const pct=Math.min(100,Math.round(100*wb.totalDamage/maxDmg));
        const claimable=wb.myDamage>0&&wb.milestones.some(m=>wb.totalDamage>=m.damage&&!wb.claimed.includes(m.damage));
        wbHtml=`<article class="card world-boss-card"><h3>Chefe Mundial Cooperativo · Semana ${wb.week}</h3>
          <p class="caption">Todo dano na Raid Diária soma na meta coletiva da comunidade. Sua contribuição: <b>${int.format(wb.myDamage)}</b> dano.</p>
          <p><strong>${int.format(wb.totalDamage)}</strong> / ${int.format(maxDmg)} dano global</p>
          <div class="meter"><i style="width:${pct}%"></i></div>
          <ul class="milestone-list">${wb.milestones.map(m=>{
            const hit=wb.totalDamage>=m.damage,got=wb.claimed.includes(m.damage);
            return `<li class="milestone-item ${got?'done':''}"><strong>${m.label} ${got?'Resgatado ✓':hit?'Liberado!':''}</strong><span>${fmtMilestoneReward(m)}</span></li>`;
          }).join('')}</ul>
          <button type="button" class="primary" id="claim-world-boss" ${claimable?'':'disabled'}>${claimable?'Resgatar marcos globais':'Sem novos marcos para resgatar'}</button>
        </article>`;
      }else wbHtml='<article class="card world-boss-card"><h3>Chefe Mundial Cooperativo</h3><p class="caption">Carregando progresso global da comunidade…</p></article>';
    }
    content=`<article class="card"><h2>Raid diária · Nv. 90</h2><div class="floor-card raid-card" data-world="${daily.index}"><div><small>Chefe do ciclo · 10.000.000 PV</small><h3>${daily.boss.name}</h3><span>${WORLDS[daily.index].name}${skill}</span></div>${enemyPortrait('enemy-'+(daily.index+1)+'-5',daily.boss.name)}</div><p>${3-used}/3 tentativas · Melhor dano hoje: <b>${int.format(bestToday)}</b></p><p class="caption">1 token por tentativa concluída + recompensas automáticas por marcos de dano. Renova às 12h de Brasília.</p>${milestonesHtml}<button id="raid-start" class="primary" ${playing||!ready||used>=3||requestingRun?'disabled':''}>Desafiar chefe</button></article>${wbHtml}`;
  }else if(isWeekly){
    const cleared=state.weeklyTower?.week===wt.week?state.weeklyTower.cleared:0;
    const wNext=cleared+1;
    const doneAll=cleared>=WEEKLY_TOWER_FLOORS;
    const invalidUnits=state.team.map(uid=>CHARACTERS[copy(uid).id]).filter(c=>!wt.rule.allow(c));
    const teamValid=state.team.length>0&&invalidUnits.length===0;
    const rows=Array.from({length:Math.min(6,WEEKLY_TOWER_FLOORS-Math.max(1,Math.min(wNext,WEEKLY_TOWER_FLOORS-5))+1)},(_,i)=>{
      const f=Math.max(1,Math.min(wNext,WEEKLY_TOWER_FLOORS-5))+i;
      if(f>WEEKLY_TOWER_FLOORS)return '';
      const es=weeklyTowerEnemies(f,wt.index);
      const rewardText=f===15?'+1 Essência · +2 Tokens · +1 Selo de Trava':f===10?'+1 Essência · +1 Catalisador':f%3===0?'+1 Essência · +1 Token':'+1 Essência';
      return `<li class="floor-card ${f===wNext?'current':''}" data-world="${(f-1)%WORLDS.length}"><div><small>Andar ${f}/${WEEKLY_TOWER_FLOORS} · ${f<wNext?'Conquistado':f===wNext?'Atual':'A seguir'} · ${rewardText}</small><h3>${es[0].name}</h3><span>${es.length>1?'Reservas: '+es.slice(1).map(e=>e.name).join(', '):'Chefe solo'}</span></div>${enemyPortrait(es[0].sprite,es[0].name)}</li>`;
    }).join('');
    content=`<article class="card"><h2>Torre semanal · ${cleared}/${WEEKLY_TOWER_FLOORS}</h2>
      <div class="rule-banner ${teamValid?'ok':'warn'}"><strong>Regra da semana (${wt.week}): ${wt.rule.name}</strong><p class="caption">${wt.rule.desc}</p><small>${teamValid?'Sua formação atual atende à regra!':'Ajuste sua equipe na Formação — bloqueados: '+invalidUnits.map(c=>c.name).join(', ')}</small></div>
      <p class="caption">Renova toda segunda às 12h. Rende Essências de Despertar, Tokens, Catalisador (andar 10) e Selo de Trava (andar 15).</p>
      <button type="button" class="primary" data-action="weeklyTower" ${weeklyLocked||doneAll||!teamValid||playing||!ready||requestingRun?'disabled':''}>${weeklyLocked?'Libera no mundo 6':doneAll?'Torre semanal concluída!':'Desafiar andar '+wNext}</button>
      <ol class="floor-list">${rows}</ol></article>`;
  }else{
    const start=floorPage??next;
    const curAffix=towerAffix(next);
    const rows=Array.from({length:6},(_,i)=>{
      const floor=start+i,enemies=towerEnemies(floor),idx=(floor-1)%WORLDS.length,af=towerAffix(floor),isTransc=floor%10===0;
      const kit=bossKits[enemies[0].kind],skill=kit?' · '+kit.name+' ('+kit.cooldown+' s)':'';
      return `<li class="floor-card ${floor===next?'current':''}" data-world="${idx}"><div><small>Andar ${floor} · ${floor<next?'Conquistado':floor===next?'Atual':'A seguir'}${isTransc?' · ★ Chefe Transcendente (+Essência)':''} · ${af.name}</small><h3>${enemies[0].name}</h3><span>${isTransc?'Esquadrão Transcendente':WORLDS[idx].name}${enemies.length>1?' · Reservas: '+enemies.slice(1).map(e=>e.name).join(', '):''}</span></div>${enemyPortrait(enemies[0].sprite,enemies[0].name)}</li>`;
    }).join('');
    content=`<article class="card"><h2>Torre infinita</h2><p class="caption">1 token por andar (2 a cada 5 andares; 3 tokens + Essência de Despertar a cada 10 andares com Chefes Transcendentes).</p>
      <p><span class="affix-pill">Afixo do andar ${next}: <b>${curAffix.name}</b> — ${curAffix.desc}</span></p>
      <button class="primary" data-action="tower" ${locked||playing||!ready||requestingRun||state.towerQueued||state.pending?.towerFloor?'disabled':''}>${locked?'Libera no mundo 10':'Desafiar andar '+next}</button> ${autoControl}<ol class="floor-list">${rows}</ol><nav class="floor-nav" aria-label="Percorrer andares"><button class="ghost" data-floor-page="${Math.max(1,start-6)}" ${start===1?'disabled':''}>Anteriores</button><button class="ghost" data-floor-page="current">Andar atual</button><button class="ghost" data-floor-page="${start+6}">Próximos</button></nav></article>`;
  }
  if(canReplay)content+='<button id="ball-replay" class="ghost">Rever último desafio</button>';
  const info=$('#mode-info');
  if(info.lastContent!==content){info.innerHTML=content;info.lastContent=content;}
  const fight=$('#mode-fight');if(viewingRun)duelPanel(fight,true);else fight.replaceChildren();
  if(!dayRaid&&!isWeekly&&viewingRun){
    let controls=fight.querySelector('.tower-followup');
    if(!controls){controls=document.createElement('div');controls.className='tower-followup';fight.append(controls);}
    const victory=towerVictory();
    const advance= victory?`<button class="primary" id="tower-next" ${requestingRun||!ready?'disabled':''}>Ir para o próximo andar · ${next}</button>`:'';
    const status=autoTower&&victory?'Aguardando o próximo andar e a recuperação da formação.':
      duel?.result&&viewingRun.result!=='Vitória'?'Subida encerrada no andar '+viewingRun.floor+'.':'';
    const html=advance+autoControl+(status?'<p class="caption" role="status">'+status+'</p>':'');
    if(controls.lastContent!==html){controls.innerHTML=html;controls.lastContent=html;}
  }else fight.querySelector('.tower-followup')?.remove();
}
function enemyPortrait(sprite,name){return `<span class="enemy-portrait"><img src="${spriteURL(sprite)}" alt="${name}"></span>`;}
function renderPanel(){
  document.documentElement.classList.toggle('connecting-account',Boolean(connecting()));
  if(connecting())return;
  renderWorldNav();drawCompetition();
  collectionIndex=null;
  $('#gold').textContent=int.format(state.gold);
  $('#wins').textContent=int.format(state.wins);
  $('#collection-count').textContent=state.collection.length;
  const upgBadge=$('#upgrades-badge');
  if(upgBadge){const avail=countAffordableUpgrades();upgBadge.textContent=avail;upgBadge.hidden=avail===0;}
  const bossBadge=$('#boss-ready-badge');
  if(bossBadge)bossBadge.hidden=!readyForBoss(state);
  document.querySelectorAll('[data-tab]').forEach(b=>{
    if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  if(rarityTabs.includes(tab))void refreshSingularDiscovery();
  const panel=$('#panel');
  const social=tab==='comunidade';
  const communityPanel=$('#community-panel');
  panel.hidden=social;
  const arena=$('.arena');
  if(arena)arena.hidden=tab!=='exploracao';
  const sessionBadge=$('#game-mode');
  if(sessionBadge)sessionBadge.textContent=community?.ready()?'Online':community?.active()?'Conectando':'Solo';
  if(social){
    if(communityPanel?.hidden)community?.mount();
    return;
  }
  community?.hide();
  if(tab==='arena'){switchFight('arena');if(panel.querySelector('#modes-nav'))panel.replaceChildren();duelPanel(panel);return;}
  if(tab==='modos'){switchFight(mode);renderModes(panel);return;}
  if(tab==='indice'){renderDex(panel);return;}
  if(tab==='itens'){
    const it=state.items??{};
    const wk=weeklyCycle(gameNow()).week;
    const boughtMap=state.goldShop?.week===wk?(state.goldShop.bought??{}):{};
    const now=gameNow();
    const hasRec=(state.partyRecovery??0)>now||Object.values(state.recovery??{}).some(t=>t>now);
    const inv=[
      {name:'Token de reroll',qty:state.traitItems??0,desc:'Rola as traits de um slot na ficha do personagem.',action:'<button class="primary" data-tab="colecao">Abrir coleção</button>'},
      {name:'Essência de Despertar',qty:it.essence??0,desc:'Substitui cópias duplicadas para despertar personagens até ★5.',action:'<button class="ghost" data-tab="colecao">Despertar na ficha</button>'},
      {name:'Catalisador de Trait',qty:it.catalyst??0,desc:'Triplica a chance de 2–3 traits e garante raridade Rara+ no reroll.',action:''},
      {name:'Selo de Trava de Trait',qty:it.traitLock??0,desc:'Mantém 1 trait escolhida fixa durante um reroll no slot.',action:''},
      {name:'Tomo de XP',qty:it.xpTome??0,desc:'Concede +250.000 XP instantâneo na ficha de qualquer personagem.',action:'<button class="ghost" data-tab="colecao">Usar na ficha</button>'},
      {name:'Elixir de Recuperação',qty:it.elixir??0,desc:'Zera imediatamente o tempo de recuperação da equipe.',action:`<button type="button" class="primary" id="use-elixir" ${(it.elixir??0)<1||!hasRec?'disabled':''}>${hasRec?'Usar Elixir agora':'Equipe recuperada'}</button>`},
    ];
    panel.innerHTML=`<article class="card"><h2>Inventário de Itens</h2><p class="caption">Itens consumíveis usados na ficha do personagem ou para acelerar o endgame.</p>
      <div class="items-grid">${inv.map(x=>`<div class="item-box"><header><h3>${x.name}</h3><span class="item-qty">×${int.format(x.qty)}</span></header><p class="caption">${x.desc}</p>${x.action}</div>`).join('')}</div></article>
      <article class="card" style="margin-top:14px"><h2>Mercado Semanal de Ouro</h2><p class="caption">Troque ouro excedente por recursos de endgame. Estoque renova toda segunda às 12h · Saldo: <b>${int.format(state.gold)} ouro</b>.</p>
      <div class="shop-grid">${GOLD_SHOP.map(item=>{
        const bought=boughtMap[item.id]??0,price=goldShopPrice(item,bought),soldOut=bought>=item.limit;
        return `<div class="shop-row"><header><h4>${item.name}</h4><small>${bought}/${item.limit} sem.</small></header><p class="caption">${item.desc}</p><button type="button" class="primary" data-gold-buy="${item.id}" ${soldOut||state.gold<price?'disabled':''}>${soldOut?'Esgotado esta semana':int.format(price)+' ouro'}</button></div>`;
      }).join('')}</div></article>`;
    return;
  }
  if(tab==='exploracao'){
    const level=maxLevel(state),world=worldOf(state),currentArea=world.areas[state.area];
    const toElite=state.area===2?(7-(state.index%7)):null;
    panel.innerHTML=`<div class="layout"><article class="card"><h2>Campanha</h2><p class="caption">${state.destination!==undefined?'Viagem após o combate atual.':`Mundo ${(state.world??0)+1} de ${WORLDS.length}`}</p>
    <div class="explore-meta"><label class="inline-toggle"><input type="checkbox" id="explore-auto-routes" ${state.autoRoutes?'checked':''}> Avançar áreas, chefes e mundos</label><span class="affinity-chip"><i class="color-dot" style="--hue:${COLORS[currentArea.color]}"></i> Contra <b>${currentArea.color}</b>: ${teamAffinitySummary(currentArea.color)}</span>${toElite!==null?`<span class="elite-chip">${toElite===1?'Próximo encontro: Elite':`Elite (${world.elite.name}) em ${toElite} lutas`}</span>`:''}</div>
    <div class="area-list">${world.areas.map((a,i)=>`<button class="area-option" type="button" data-area="${i}" ${level<a.unlock?'disabled':''} aria-pressed="${state.area===i}"><span class="index-badge">${i+1}</span><span><strong>${a.name} <i class="color-dot" style="--hue:${COLORS[a.color]}" title="Cor do inimigo: ${a.color}"></i></strong><small>${a.description}</small></span><em>${level<a.unlock?`Libera no nv. ${a.unlock}`:`Nv. ${a.levels[0]}–${a.levels[1]}`}</em></button>`).join('')}</div></article><aside><article class="card boss"><h3>Chefe · ${world.boss.name} <small>Nv. ${world.boss.level}</small></h3><p class="caption boss-aff"><i class="color-dot" style="--hue:${COLORS[world.boss.color]}"></i> ${world.boss.color} · ${teamAffinitySummary(world.boss.color)}</p><div class="meter"><i style="width:${Math.min(100,state.finalWins/(state.bossGoal??15)*100)}%"></i></div><p class="caption">${state.completed?(state.world===9?'Campanha concluída.':'Próximo mundo disponível no menu de mundos.'):`${Math.min(state.bossGoal??15,state.finalWins)} / ${state.bossGoal??15} vitórias em ${world.areas[2].name}`}</p><button class="primary" data-action="boss" ${!readyForBoss(state)||state.pending?'disabled':''}>${state.completed?'Chefe derrotado':state.pending?'Aguarde o fim da luta':'Desafiar chefe'}</button></article><article class="card"><h3>Últimos encontros</h3>${efficiencySummary()}<ul class="activity">${state.log.length?state.log.slice(0,4).map(e=>`<li><span>${e.label}${e.reserveXp?`<small>+${e.reserveXp} XP entre reservas</small>`:''}</span><b ${!e.won?'class="loss"':''}>${e.won?`+${int.format(e.gold)} ouro`:'Derrota'}</b></li>`).join(''):'<li>Seus resultados aparecem aqui.</li>'}</ul></article></aside></div>`;
  }else if(tab==='formacao'){
    if(!state.team.includes(selected))selected=state.team[0];
    const slots=formationSlots(state);
    const active=state.leader?card(state.leader):null;
    const teamPower=state.team.reduce((sum,uid)=>sum+unitPower(copy(uid),active),0);
    const reserves=state.collection.filter(u=>!state.team.includes(u.uid)).sort((a,b)=>unitPower(b)-unitPower(a));
    const currentArea=worldOf(state).areas[state.area];
    const presets=state.presets??{};
    const defPreset=state.defensePreset??'';
    const presetsBar=`<div class="presets-bar card"><div class="preset-slots">${PRESET_SLOTS.map(slot=>{
      const saved=!!presets[slot]?.team?.length;
      return `<div class="preset-slot"><strong>${PRESET_LABELS[slot]}</strong><button type="button" class="ghost" data-load-preset="${slot}" ${saved?'':'disabled'}>Usar</button><button type="button" class="ghost" data-save-preset="${slot}" ${state.team.length?'':'disabled'}>Salvar</button></div>`;
    }).join('')}</div><label class="defense-picker">Defesa da Arena <select id="defense-preset-select"><option value="" ${!defPreset?'selected':''}>Formação ativa</option>${PRESET_SLOTS.filter(s=>presets[s]?.team?.length).map(s=>`<option value="${s}" ${defPreset===s?'selected':''}>Preset · ${PRESET_LABELS[s]}</option>`).join('')}</select></label></div>`;
    panel.innerHTML=`${presetsBar}<div class="formation-toolbar card"><div class="formation-stats"><span class="stat-pill">Força total <strong>${int.format(teamPower)}</strong></span><span class="stat-pill">Vagas <strong>${formationCost(state)}/4</strong></span><span class="stat-pill"><i class="color-dot" style="--hue:${COLORS[currentArea.color]}"></i> Contra ${currentArea.color}: ${teamAffinitySummary(currentArea.color)}</span></div><div class="auto-form-controls"><label>Critério da formação <select id="auto-form-mode"><option value="power" ${autoFormMode==='power'?'selected':''}>Melhor equipe agora</option><option value="projected" ${autoFormMode==='projected'?'selected':''}>Planejar equipe no Nv. 100</option><option value="balanced" ${autoFormMode==='balanced'?'selected':''}>Equilibrada</option><option value="area" ${autoFormMode==='area'?'selected':''}>Contra área atual</option></select></label><button type="button" class="primary" id="auto-form-btn">Auto-formação</button></div></div>
      <div class="formation-layout"><article class="card formation-board"><div class="board-head"><h2>Formação de combate</h2><div class="preset-group" role="group" aria-label="Posicionamento rápido"><button type="button" class="ghost" data-preset="padrao">Padrão</button><button type="button" class="ghost" data-preset="espalhado">Espalhado</button><button type="button" class="ghost" data-preset="proteger">Proteger</button></div></div>
      <div class="field" id="field"><span class="field-label back">RETAGUARDA</span><span class="field-label">FRENTE</span>
      ${state.team.map(uid=>{const [x,y]=state.positions[uid];const c=card(uid);return `<button class="field-marker ${uid===selected?'active':''}" data-marker="${uid}" aria-label="Ficha de ${c.name} (${c.role}). Use as setas para mover." style="left:${x}%;top:${y}%;--tone:${COLORS[c.color]}"><span class="marker-role">${ROLE_TAG[c.role]??''}</span>${img(spriteFor(copy(uid)))}<small>${c.name.split(' · ')[0]}</small></button>`;}).join('')}</div>
      ${tacticalHints()}
      <p class="caption">As mudanças valem no próximo combate. Na Arena, os titulares entram da vaga 1 à 4.</p></article>
      <article class="card"><h2>Equipe principal</h2><p class="caption">${active?`Líder: ${active.name} (${active.leader})`:'Formação vazia. Use Auto-formação ou escolha na coleção.'}</p>
      <div class="members">${slots.map((uid,i)=>{
        if(!uid)return `<button class="ghost slot-empty" data-vaga="${i}">＋ Vaga ${i+1} · Escolher na coleção</button>`;
        const u=copy(uid),c=CHARACTERS[u.id],pwr=unitPower(u,active),buffed=active&&leaderApplies(active,c);
        return `<div class="member squad-row" style="--tone:${COLORS[c.color]}"><div class="squad-top"><small>Vaga ${i+1}</small><span class="role-pill">${c.role}</span><span class="power-pill">Força ${int.format(pwr)}</span>${buffed?'<span class="leader-pill">Bônus de líder</span>':''}</div><button class="character-hit" data-profile="${uid}">${unitSummary(u)}</button>
        <div class="squad-actions"><button class="ghost" data-leader="${uid}" ${uid===state.leader?'disabled':''}>${uid===state.leader?'Líder':'Liderar'}</button>
        <span data-recovery="${uid}"></span><button class="ghost" data-remove="${uid}">Remover</button></div>
        ${reserves.length?`<label>Substituir <select data-replace="${uid}"><option value="">Escolher reserva</option>${reserves.map(r=>`<option value="${r.uid}">${CHARACTERS[r.id].name} (${CHARACTERS[r.id].role}, Nv. ${levelAt(r.xp)}, Força ${int.format(unitPower(r))})</option>`).join('')}</select></label>`:''}</div>`;
      }).join('')}</div></article></div>`;
  }else if(tab==='colecao'){
    const slots=formationSlots(state);
    const index=pickSlot??(slots.includes(null)?slots.indexOf(null):3);
    const slotOptions=slots.map((uid,i)=>`<option value="${i}" ${index===i?'selected':''}>${i+1} · ${uid?card(uid).name:'Vazia'}</option>`).join('');
    const rarities=visibleRarities();
    if(panel.querySelector('.collection-filters')?.dataset.rarityCount===String(rarities.length)){
      const target=panel.querySelector('#swap-target');
      if(target){target.innerHTML=slotOptions;target.value=String(index);}
    }else{
      const searchValue=colFilter.search.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
      panel.innerHTML=`<article class="card"><div class="swap"><div><h2>Coleção</h2><p class="caption" id="collection-filtered-count"></p></div><label>Vaga de destino <select id="swap-target">${slotOptions}</select></label></div>
    <div class="collection-filters" data-rarity-count="${rarities.length}"><label class="search-field"><span>Buscar</span><input type="search" id="col-search" placeholder="Nome, universo ou trait" value="${searchValue}"></label><select id="col-sort" aria-label="Ordenar coleção"><option value="potential" ${colFilter.sort==='potential'?'selected':''}>Maior força no Nv. 100</option><option value="power" ${colFilter.sort==='power'?'selected':''}>Maior força atual</option><option value="level" ${colFilter.sort==='level'?'selected':''}>Maior nível</option><option value="tier" ${colFilter.sort==='tier'?'selected':''}>Maior raridade</option><option value="recent" ${colFilter.sort==='recent'?'selected':''}>Mais recente</option></select><select id="col-role" aria-label="Filtrar por função"><option value="">Todas funções</option>${['Guardião','Combatente','Mágico','Suporte'].map(r=>`<option value="${r}" ${colFilter.role===r?'selected':''}>${r}</option>`).join('')}</select><select id="col-tier" aria-label="Filtrar por raridade"><option value="">Todas raridades</option>${rarities.map((t,i)=>`<option value="${i+1}" ${colFilter.tier===String(i+1)?'selected':''}>${t}</option>`).join('')}</select><label class="filter-check"><input type="checkbox" id="col-shiny" ${colFilter.shiny?'checked':''}> Shiny</label><label class="filter-check"><input type="checkbox" id="col-trait" ${colFilter.trait?'checked':''}> Com Trait</label></div>
    <div class="bulk-tools"><label><input type="checkbox" id="col-locked" ${colFilter.locked?'checked':''}> Trancadas</label><label>Venda em lote <select id="bulk-mode"><option value="plain">Duplicatas sem trait</option><option value="common" ${bulkCommon?'selected':''}>Incluir trait Comum/Incomum</option></select></label><button class="ghost" id="bulk-sell">Revisar lote</button></div><p class="caption">A venda em lote considera toda a coleção, até 200 cópias por vez. A melhor cópia de cada personagem, os Shiny, os titulares e as cópias trancadas ficam protegidos.</p>
    <div class="collection-grid" id="collection-list"></div></article>`;
    }
    renderCollectionGrid();
  }else if(tab==='guia'){
    panel.innerHTML=`<article class="card guide"><h2>Guia do jogador</h2>
    <section aria-labelledby="primeiros-passos"><h3 id="primeiros-passos">Primeiros passos</h3>
    <ol class="primeiros-passos">
      <li><strong>Acompanhe sua primeira luta.</strong> Abra <b>Exploração</b>. Seu time já começa lutando em Namek. Cada vitória rende ouro e experiência (XP). Se aparecer um personagem recrutável, vença a luta para adicioná-lo à <b>Coleção</b>.</li>
      <li><strong>Escolha quem vai lutar.</strong> Na coleção, compare a força atual e a força no nível 100 com a mesma soma de atributos. A projeção mantém a variante Shiny e as traits equipadas. Na formação, “Melhor equipe agora” maximiza a força total atual com o bônus do líder. “Planejar equipe no Nv. 100” equipa o time pela força projetada. “Equilibrada” prioriza funções diferentes e “Contra área atual” considera a afinidade de cor, ambas no nível atual.</li>
      <li><strong>Use o ouro para melhorar os próximos encontros.</strong> Em <b>Upgrades</b>, <b>Sorte</b> aumenta a chance de encontrar um recruta em lutas comuns até 50%. Depois, a Sorte melhora a chance de ele ser Raro ou superior. <b>Rastreio de raros</b> aumenta a chance de esse recruta ser de raridade Rara ou superior.</li>
      <li><strong>Avance para o próximo mundo.</strong> Em <b>Exploração</b>, marque <b>Avançar áreas, chefes e mundos</b>. O time muda de área ao atingir o nível necessário. Ao alcançar a meta de vitórias comuns ou de elite na última área, ele desafia o chefe e, ao vencer, segue para o próximo mundo. Escolher uma área ou mundo manualmente desliga essa opção. Marque-a de novo quando quiser continuar a campanha.</li>
    </ol>
    <p><strong>Quando encontrar uma cópia repetida</strong>, confira a versão e a trait na ficha. Em <b>Configurações</b>, o novo <b>Auto-Sell</b> permite escolher rapidamente quais raridades vender, proteger a 1ª cópia normal, Shinies, Traits a partir da raridade desejada e manter uma Lista VIP de personagens para Despertar (★1–★5).</p>
    <p><strong>Se um inimigo estiver dando trabalho</strong>, confira a cor dele. No mapa abaixo, escolha <b>Defendendo</b> e selecione a cor do inimigo para descobrir quais cores causam mais dano contra ele.</p></section>
    ${colorChart()}
    <details><summary>Habilidades dos Transcendentes na Arena</summary>
    <p>O contato decide o acerto de socos, cortes e projéteis. Ao se aproximar, Giorno dispara seis punhos; cada acerto usa 20% do Ataque antes da defesa. Retorno a Zero tem uma ativação separada contra uma habilidade fatal.</p>
    <p>Gojo bloqueia ações dentro do domínio, enquanto o santuário de Sukuna pulsa em uma área fixa. A broca de Simon cresce com as quedas de aliados. Meruem escolhe entre corte e esfera conforme a defesa mais baixa do adversário.</p>
    <p>Sailor Moon converte cura excedente em proteção mágica. Lucius registra os PV para reverter um golpe fatal. Madoka purifica estados, Yhwach pode sobreviver ao golpe previsto e Meliodas acumula o dano recebido para devolvê-lo em um corte.</p>
    <p>Especiais de Ace aplicam fogo; os de Shinra Banshōman, chamas azuis; os de Meliodas, chamas negras; e os de Sukuna, sangramento. O estado pulsa cinco vezes, a cada 0,6 s. Reaplicar o mesmo estado renova sua duração.</p></details>
    <h3>Funções</h3><ul><li><b>Combatente</b> · Ataque elevado e golpes básicos físicos.</li><li><b>Guardião</b> · Mais PV e defesa. Seus golpes básicos são físicos.</li><li><b>Mágico</b> · Usa Magia nos golpes básicos e enfrenta a Resistência do alvo.</li><li><b>Suporte</b> · Usa Magia nos golpes básicos. Na reserva da Arena, cura o aliado ativo.</li></ul>
    <h3>Formação e liderança</h3><p>Na exploração, os titulares lutam juntos. Na Arena, entra um por vez, na ordem das vagas ocupadas. Escolha o líder na Formação e consulte a ficha para ver quem recebe o bônus.</p>
    <h3>Raridade e traits</h3><p>${visibleRarities().join(' → ')}. Na ficha, você encontra a raridade, a versão Shiny e os bônus da trait de cada cópia.</p><h3>Traits e efeitos</h3><p>A chance indica quantos personagens recrutáveis, em média, correspondem a uma ocorrência da trait.</p><div class="trait-list">${TRAITS.map(t=>`<section><header><strong>${t.name}</strong><small>${t.rarity} · 1/${int.format(t.odds)} · ${(100/t.odds).toLocaleString('pt-BR',{maximumFractionDigits:3})}%</small></header><p>${traitEffects(t).slice(0,t.buffs.filter(Boolean).length).join(' · ')}</p>${t.passive?`<p>${t.passive}</p>`:''}</section>`).join('')}</div></article>`;
  }else if(tab==='configuracoes'){
    renderSettings(panel);
  }else{
    const luck=UPGRADES.sorte.values[upgradeLevel(state,'sorte')];
    const rare=UPGRADES.rastreio.values[upgradeLevel(state,'rastreio')];
    const rates=recruitRates(luck,rare);
    const rareEncounter=(rates.encounter*rates.rare/100).toLocaleString('pt-BR',{maximumFractionDigits:2});
    panel.innerHTML=`<article class="card"><h2>Upgrades de exploração</h2><p class="caption">Encontros comuns · ${rates.encounter}% de chance de aparecer um recruta · ${rareEncounter}% de chance de aparecer um recruta de raridade Rara ou superior.</p>${Object.entries(UPGRADES).map(([id,upgrade])=>{
      const level=upgradeLevel(state,id);
      const price=upgrade.costs[level];
      const world=upgrade.worlds[level];
      const locked=world>(state.unlocked??0)+1;
      const effect=index=>id==='ritmo'
        ? `${upgrade.values[index]} s${upgrade.goldBonus[index]?` · +${upgrade.goldBonus[index]}% de ouro`:''}`
        : id==='sorte'?
        `${Math.min(50,upgrade.values[index])}% de recruta · +${Math.max(0,upgrade.values[index]-50)}% sobre a chance de Raro ou superior`:
        `${['ouro','treino','brilho','sintonia'].includes(id)?'+':''}${upgrade.values[index]}${upgrade.unit}`;
      return `<div class="upgrades-row"><div><h3>${upgrade.name} <small>Nível ${level} / ${upgrade.costs.length}</small></h3><p>${upgrade.description}</p><p class="upgrade-effect">${effect(level)}${price===undefined?'':` → ${effect(level+1)}`}</p></div><button class="primary" data-upgrade="${id}" aria-label="${upgrade.name} · ${price===undefined?'Nível máximo':`Comprar por ${int.format(price)} ouro`}" ${price===undefined||locked||state.gold<price?'disabled':''}>${price===undefined?'Nível máximo':`${int.format(price)} ouro${locked?' · Mundo '+world:''}`}</button></div>`;
    }).join('')}</article>`;
  }
}

function stageUnit(u,token,enemy=false){
  const x=enemy?79:12+u.x*.49;
  const y=enemy?62:27+u.y*.56;
  const tag=enemy?'div':'button';
  return `<${tag} ${enemy?'':`data-profile="${u.uid}" aria-label="Abrir ficha de ${u.name}"`} class="battler ${enemy?'enemy':''}" data-actor="${token}" style="--x:${x}%;--y:${y}%;--z:${Math.ceil(y)}"><span class="tag"><span class="rar-name rarity-${u.tier??0}">${u.name}</span> <small>· ${u.level}</small></span><div class="hp-track"><b></b></div><img class="sprite" src="${spriteURL(u.sprite)}" alt=""></${tag}>`;
}
function drawScene(now){
  if(connecting())return;
  const activeBattle=state.pending;
  const finish=!activeBattle&&finishedBattle&&now<finishedBattle.battle.end+1800?finishedBattle:null;
  const battle=activeBattle??finish?.battle;
  const world=WORLDS[battle?.world??state.world??0];
  const key=battle?`battle-${battle.start}-${battle.boss}`:'idle-'+state.team.filter(uid=>readyAt(state,uid)<=now).join(',')+JSON.stringify(state.positions)+state.area+state.completed+world.name;
  if(key!==stageKey){
    stageKey=key;replay=battle;eventCursor=0;
    const team=battle?.team??state.team.filter(uid=>readyAt(state,uid)<=now).map(uid=>fighter(copy(uid),state.positions[uid]));
    const foe=battle?.enemy??{name:world.areas[state.area].enemy,level:world.areas[state.area].levels[0],sprite:'soldier'};
    $('#stage').innerHTML=team.map((u,i)=>stageUnit(u,`0:${i}`)).join('')+(battle?stageUnit(foe,'1:0',true):'');
    $('#combat-note').textContent=battle?.recruit?'ENCONTRO RECRUTÁVEL':'';
  }
  const duration=battle?Math.max(1,battle.end-battle.start):1;
  const elapsed=battle?Math.max(0,Math.min(now-battle.start,duration)):0;
  const replayRate=battle?battle.result.seconds*1000/duration:1;
  const replayTime=elapsed*replayRate;
  if(replay){
    const events=replay.result.events;
    while(eventCursor<events.length&&events[eventCursor].time<=replayTime+.00001){
      const e=events[eventCursor++];
      const source=$(`[data-actor="${e.actor}"]`);
      const target=$(`[data-actor="${e.target}"]`);
      const updateHp=(node,id,current)=>{
        const max=id==='1:0'?replay.enemy.hp:replay.team[Number(id?.split(':')[1])]?.hp;
        if(node&&max) {node.querySelector('.hp-track b').style.width=`${Math.max(0,100*current/max)}%`;node.classList.toggle('ko',current<=0);}
      };
      const freshEvent=(replayTime-e.time)/replayRate<650;
      if(freshEvent&&e.type==='especial'&&source){
        let label=source.querySelector('.stage-call');
        if(!label){label=document.createElement('span');label.className='stage-call';source.append(label);}
        label.textContent=e.name;
        clearTimeout(label.fadeTimer);
        label.fadeTimer=setTimeout(()=>label.remove(),1350);
      }
      if(e.type==='dano'){
        updateHp(target,e.target,e.remaining);
        if(freshEvent&&target&&e.hp>0){
          pulse(source,'attack');pulse(target,'hit');
          floatTag(target,`−${Math.round(e.hp)}`);
        }
      }
      if(['cura','sobrevive','ressurge'].includes(e.type)){
        updateHp(source,e.actor,e.remaining);
        if(freshEvent){
          if(e.type==='cura')floatTag(source,'+Cura','heal');
          if(e.type==='sobrevive')floatTag(source,'Sobrevive','special');
          if(e.type==='ressurge')floatTag(source,'Ressurge','special');
        }
      }
      if(freshEvent){
        if(e.type==='esquiva')floatTag(source,'Esquiva','info');
        if(e.type==='intercepta')floatTag(source,'Intercepta','info');
        if(e.type==='reflete')floatTag(source,'Reflete','special');
        if(e.type==='escudo rompe')floatTag(target,'Escudo quebrado','warn');
        if(e.type==='onda')$('#combat-note').textContent='Onda de energia';
        if(e.type==='aceleração')$('#combat-note').textContent='Made in Heaven · Aceleração';
        if(e.type==='tempo parado')$('#combat-note').textContent='The World · Tempo parado';
        if(e.type==='dimensão')$('#combat-note').textContent='Dimensão alterada';
      }
    }
  }
  const recoverAt=Math.min(...state.team.map(uid=>readyAt(state,uid)));
  const recovering=!battle&&state.running&&state.team.length&&recoverAt>now;
  const waiting=state.team.length>0&&state.running&&!activeBattle;
  const confirming=activeBattle&&now>=activeBattle.end;
  const nextOnlineEncounter=confirming&&community.ready()&&state.running&&!activeBattle.boss
    ? Math.max(0,activeBattle.end+waitFor(state)-now)
    : 0;
  $('#arena-status').textContent=finish?(finish.entry.won?'VITÓRIA':'DERROTA'):confirming?'FINALIZANDO ENCONTRO':battle?.boss?'DESAFIO DE CHEFE':battle?.elite?'ENCONTRO DE ELITE':battle?'EM COMBATE':recovering?'EM RECUPERAÇÃO':waiting?'PRÓXIMO ENCONTRO':state.team.length?'EXPLORAÇÃO PARADA':'FORMAÇÃO VAZIA';
  $('#world-title').textContent=world.name;
  $('.arena').dataset.world=String(battle?.world??state.world??0);
  $('#arena-location').textContent=world.areas[battle?.area??state.area].name;
  $('#arena-time').textContent=time(confirming?nextOnlineEncounter:activeBattle?elapsed:recovering?recoverAt-now:waiting?state.nextAt-now:0);
  $('#arena-label').textContent=finish?(finish.entry.won?`+${int.format(finish.entry.gold)} ouro · +${finish.entry.xp} XP por titular${finish.entry.reserveXp?` · +${finish.entry.reserveXp} XP entre reservas`:''}`:`Derrota contra ${battle.enemy.name}`):confirming?(nextOnlineEncounter>0?'Resultado no próximo sincronismo.':'Aguardando a confirmação do resultado.'):battle?`Enfrentando ${battle.enemy.name}`:recovering?'Aguardando a recuperação da equipe.':waiting?'O time está procurando um adversário.':state.team.length?'Exploração parada. Clique em Explorar para retomar.':'Coloque um personagem na formação para explorar.';
  $('#fight-progress').style.width=`${battle?100*elapsed/duration:waiting?Math.max(0,Math.min(100,100*(1-(state.nextAt-now)/(state.waitDuration||waitFor(state))))):0}%`;
  const paused=isPaused();
  const toggle=$('#explore-toggle');
  toggle.hidden=false;
  toggle.textContent=paused?'Explorar':'Parar exploração';
  toggle.dataset.mode=paused?'resume':'pause';
  toggle.disabled=paused&&!state.team.length;
}

function openUnit(uid,button){
  if(!copy(uid))return;
  publicUnit=null;profileUid=uid;profileOpener=button;
  renderProfile();
  if(!$('#character-profile').open)$('#character-profile').showModal();
}
function pulse(node,cls){
  if(!node)return;
  node.classList.remove(cls);void node.offsetWidth;node.classList.add(cls);
  setTimeout(()=>node.classList.remove(cls),300);
}

document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.world!==undefined){
    const index=Number(b.dataset.world);
    if(!b.disabled && index!==(state.destination??state.world??0))void transaction({type:'world',index});
    return;
  }
  if(b.id==='export-save')void exportCampaign();
  if(b.id==='import-save')$('#save-file').click();
  if(b.dataset.gameMode){mode=b.dataset.gameMode;renderPanel();return;}
  if(b.dataset.floorPage){floorPage=b.dataset.floorPage==='current'?null:Number(b.dataset.floorPage);renderPanel();return;}
  if(b.dataset.tab){tab=b.dataset.tab;pickSlot=null;history.replaceState(null,'',`#${tab}`);renderPanel();return;}
  if(b.dataset.nen){const u=copy(b.dataset.nen);if(u)void transaction({type:'nen',uid:u.uid,enabled:!u.nen});}
  if(b.dataset.color||['ataque','defesa'].includes(b.dataset.mode)){
    if(b.dataset.color)chartColor=b.dataset.color;else chartMode=b.dataset.mode;
    const attribute=b.dataset.color?'color':'mode';renderPanel();document.querySelector(`[data-${attribute}="${b.dataset[attribute]}"]`)?.focus();
  }
  if(b.dataset.arenaBuy)void buyArenaShopItem(b.dataset.arenaBuy);
  if(b.dataset.goldBuy){
    const item=GOLD_SHOP.find(x=>x.id===b.dataset.goldBuy);
    if(item)void transaction({type:'goldShop',itemId:item.id}).then(ok=>{if(ok)note(`${item.name} comprado com ouro.`);});
    return;
  }
  if(b.id==='use-elixir'){void transaction({type:'useElixir'}).then(ok=>{if(ok)note('Equipe recuperada instantaneamente!');});return;}
  if(b.dataset.useXpTome){void transaction({type:'useXpTome',uid:b.dataset.useXpTome}).then(ok=>{if(ok)note('+250.000 XP aplicado!');});return;}
  if(b.id==='autosell-convert'){
    if(confirm('Substituir as regras anteriores? A venda automática ficará desligada até você configurar o novo sistema.')){
      void transaction({type:'autoSell',resetLegacy:true});
    }
    return;
  }
  if(b.dataset.autosellPreset!==undefined){
    const tiers=b.dataset.autosellPreset?b.dataset.autosellPreset.split(',').map(Number):[];
    void transaction({type:'autoSell',enabled:tiers.length>0,tiers});
    return;
  }
  if(b.dataset.autosellTier){
    void transaction({type:'autoSell',toggleTier:Number(b.dataset.autosellTier)});
    return;
  }
  if(b.id==='autosell-vip-add'){
    const sel=$('#autosell-vip-select');
    if(sel?.value){void transaction({type:'autoSell',keepChar:sel.value,keep:true});sel.value='';}
    return;
  }
  if(b.dataset.autosellVipRemove){
    void transaction({type:'autoSell',keepChar:b.dataset.autosellVipRemove,keep:false});
    return;
  }
  if(b.dataset.awakenDup){
    const sac=$('#awaken-dup-select')?.value;
    if(sac&&confirm('Sacrificar a cópia selecionada + ouro para despertar este personagem?')){
      void transaction({type:'awaken',uid:b.dataset.awakenDup,sacrificeUid:sac}).then(ok=>{if(ok)note('Personagem despertado!');});
    }
    return;
  }
  if(b.dataset.awakenEssence){
    if(confirm('Gastar Essência de Despertar + ouro para despertar este personagem?')){
      void transaction({type:'awaken',uid:b.dataset.awakenEssence,useEssence:true}).then(ok=>{if(ok)note('Personagem despertado com Essência!');});
    }
    return;
  }
  if(b.dataset.savePreset){void transaction({type:'savePreset',slot:b.dataset.savePreset}).then(ok=>{if(ok)note(`Formação salva em ${PRESET_LABELS[b.dataset.savePreset]}.`);});return;}
  if(b.dataset.loadPreset){void transaction({type:'loadPreset',slot:b.dataset.loadPreset}).then(ok=>{if(ok)note(`Preset ${PRESET_LABELS[b.dataset.loadPreset]} equipado.`);});return;}
  if(b.id==='claim-world-boss'){
    b.disabled=true;
    const generation=community.generation();
    void community.claimWorldBoss().then(res=>{if(community.generation()!==generation)return;worldBossData=res.status;note('Marcos globais resgatados: '+res.claimed.join(', '));void transaction(null);})
      .catch(err=>{if(community.generation()!==generation)return;note(err.message);worldBossUntil=0;renderPanel();});
    return;
  }
  if(b.id==='claim-arena-season'){
    b.disabled=true;
    const generation=community.generation();
    void community.claimArenaSeason().then(res=>{if(community.generation()!==generation)return;rankedState=null;note(`Prêmio da Liga ${res.league.name} resgatado!`);void transaction(null);})
      .catch(err=>{if(community.generation()!==generation)return;note(err.message);rankedState=null;updateDuelButton();});
    return;
  }
  if(b.id==='arena-ranked')void enterRanked();
  if(b.id==='arena-find')void listOpponents();
  if(b.id==='duel-start')startDuel();
  if(b.id==='duel-train'){duel=null;rival=null;viewingRun=null;renderPanel();}
  if(b.id==='explore-toggle')void transaction({type:isPaused()?'resume':'pause'});
  if(b.id==='auto-form-btn'){
    void transaction({type:'autoFormation',mode:autoFormMode}).then(ok=>{if(ok)note('Formação atualizada.');});
  }
  if(b.dataset.preset)void transaction({type:'formationPreset',preset:b.dataset.preset});
  if(b.id==='bulk-sell'){void reviewBatch();return;}
  if(b.dataset.lockCopy){void transaction({type:'lock',uid:b.dataset.lockCopy,locked:b.getAttribute('aria-pressed')!=='true'});return;}
  if(b.dataset.sell){
    const u=copy(b.dataset.sell);
    if(u&&canSellUnit(state,u.uid)){
      const c=CHARACTERS[u.id],price=SALE_PRICES[c.tier-1]??0;
      const valuable=u.shiny||!!u.trait||c.tier>=3;
      if(!valuable||confirm(`Vender ${c.name}${u.shiny?' Shiny':''}${u.trait?` (${u.trait})`:''} ${serial(u)} por ${int.format(price)} ouro?`)){
        void transaction({type:'sell',uid:u.uid}).then(ok=>{if(ok)note(`${c.name} ${serial(u)} vendido por +${int.format(price)} ouro.`);});
      }
    }
  }
  if(b.dataset.area!==undefined)void transaction({type:'area',area:Number(b.dataset.area)});
  if(b.dataset.leader)void transaction({type:'leader',uid:b.dataset.leader});
  if(b.dataset.remove)void transaction({type:'remove',uid:b.dataset.remove});
  if(b.dataset.vaga!==undefined){pickSlot=Number(b.dataset.vaga);tab='colecao';history.replaceState(null,'','#colecao');renderPanel();}
  if(b.dataset.equip){
    const uid=b.dataset.equip,slot=Number(b.dataset.slot);
    void transaction({type:'equip',uid,slot,replaced:b.dataset.occupant||null}).then(ok=>{
      if(ok&&formationSlots(state)[slot]===uid&&tab==='colecao'){pickSlot=null;tab='formacao';history.replaceState(null,'','#formacao');renderPanel();}
    });
  }
  if(b.dataset.action==='tower')void enterChallenge('tower');
  if(b.dataset.action==='weeklyTower')void enterChallenge('weeklyTower');
  if(b.id==='raid-start')void enterChallenge('raid');
  if(b.id==='ball-replay'&&state.ballRun&&duel?.result!==null){
    if(!state.ballRun.raid){autoTower=false;liveTowerSequence=null;towerAdvanceAt=0;}
    watchRun(state.ballRun);
  }
  if(b.hasAttribute('data-auto-tower')){
    autoTower=!autoTower;towerAdvanceAt=0;renderPanel();
  }
  if(b.id==='tower-next'&&towerVictory())void enterChallenge('tower');
  if(b.id==='duel-skip'&&duel?.result===null){
    if(viewingRun)replayRules(viewingRun).finishDuel(duel);
    else while(duel.result===null)advanceFriendlyDuel();
    finishTowerPlayback();renderPanel();
    $('#duel-outcome').scrollIntoView({block:'nearest'});
  }
  if(b.dataset.slotAction){
    const unit=copy(profileUid),slot=Number(b.dataset.slot);
    if(!unit||publicUnit)return;
    const type=b.dataset.slotAction,names=slotTraits(unit,slot);
    const useCatalyst=type==='reroll'&&Boolean($('#reroll-catalyst')?.checked);
    const lockTrait=type==='reroll'?($(`[data-lock-select="${slot}"]`)?.value||null):null;
    const extras=[useCatalyst?'1 Catalisador':null,lockTrait?`1 Selo travando ${lockTrait}`:null].filter(Boolean);
    if(type==='reroll'&&!confirm('Gastar 1 token'+(extras.length?' + '+extras.join(' + '):'')+' para rolar o slot '+('AB'[slot])+'? Conteúdo atual: '+(names.join(' + ')||'vazio')+'.'))return;
    void transaction({type,slot,uid:unit.uid,roll:state.traitRolls??0,useCatalyst,lockTrait});
  }
  if(b.dataset.action==='boss')void transaction({type:'boss'});
  if(b.dataset.upgrade)void transaction({type:'upgrade',id:b.dataset.upgrade});
  if(b.dataset.publicUnit){
    publicUnit=JSON.parse(b.dataset.publicUnit);profileUid=null;profileOpener=b;
    renderProfile();$('#character-profile').showModal();
  }
  if(b.dataset.profile)openUnit(b.dataset.profile,b);
  if(b.dataset.marker&&e.detail===0)openUnit(b.dataset.marker,b);
  if(b.id==='close-profile')$('#character-profile').close();
  if(b.id==='install'&&installPrompt){void installPrompt.prompt();installPrompt=null;b.hidden=true;}
});
$('#character-profile').addEventListener('close',()=>{
  const uid=profileUid;
  publicUnit=null;profileUid=null;
  if(profileOpener?.isConnected)profileOpener.focus();
  else $(`[data-profile="${uid}"]`)?.focus();
  profileOpener=null;
});
document.addEventListener('change',e=>{const target=e.target;
  if(target.id==='save-file'){void importCampaign(target.files[0]);target.value='';return;}
  if(target.id==='swap-target'){pickSlot=Number(target.value);renderPanel();}
  if(target.dataset.replace&&target.value)void transaction({type:'equip',uid:target.value,replaced:target.dataset.replace});
  if(target.id==='autosell-legacy-enabled')changeSetting(target,{type:'saleSetting',group:'enabled',checked:target.checked});
  if(target.id==='autosell-enabled')changeSetting(target,{type:'autoSell',enabled:target.checked});
  if(target.id==='autosell-first-normal')changeSetting(target,{type:'autoSell',keepFirstNormal:target.checked});
  if(target.id==='autosell-shiny')changeSetting(target,{type:'autoSell',shinyRule:target.value});
  if(target.id==='autosell-trait-tier')changeSetting(target,{type:'autoSell',minTraitTier:Number(target.value)});
  if(target.id==='auto-play')changeSetting(target,{type:target.checked?'resume':'pause'});
  if(target.id==='auto-routes')changeSetting(target,{type:'autoRoutes',enabled:target.checked});
  if(target.id==='explore-auto-routes')void transaction({type:'autoRoutes',enabled:target.checked});
  if(target.id==='auto-form-mode'){autoFormMode=target.value;return;}
  if(target.id==='defense-preset-select'){void transaction({type:'setDefensePreset',slot:target.value||null}).then(ok=>{if(ok)note('Formação de defesa da Arena atualizada.');});return;}
  if(target.id==='col-sort'){colFilter.sort=target.value;renderCollectionGrid();return;}
  if(target.id==='col-role'){colFilter.role=target.value;renderCollectionGrid();return;}
  if(target.id==='col-tier'){colFilter.tier=target.value;renderCollectionGrid();return;}
  if(target.id==='col-shiny'){colFilter.shiny=target.checked;renderCollectionGrid();return;}
  if(target.id==='bulk-mode'){bulkCommon=target.value==='common';return;}
  if(target.id==='col-locked'){colFilter.locked=target.checked;renderCollectionGrid();return;}
  if(target.id==='col-trait'){colFilter.trait=target.checked;renderCollectionGrid();return;}
  if(target.dataset.pref){
    preferences[target.dataset.pref]=target.checked;
    document.documentElement.dataset.motion=preferences.motion?'on':'off';
    try{localStorage.setItem('nexus.display',JSON.stringify(preferences));}catch{note('A preferência de exibição vale nesta sessão. O navegador não conseguiu salvá-la.');}
  }});
document.addEventListener('input',e=>{
  if(e.target.id==='col-search'){colFilter.search=e.target.value;renderCollectionGrid();}
});
document.addEventListener('keydown',e=>{
  const uid=e.target.dataset.marker;
  const direction={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,-5],ArrowDown:[0,5]}[e.key];
  if(!uid||!direction)return;
  e.preventDefault();selected=uid;
  void transaction({type:'position',uid,coords:state.positions[uid].map((v,i)=>v+direction[i])}).then(()=>$(`[data-marker="${uid}"]`)?.focus());
});
function point(e,field){const r=field.getBoundingClientRect();return [100*(e.clientX-r.left)/r.width,100*(e.clientY-r.top)/r.height].map(v=>Math.round(Math.max(8,Math.min(92,v))));}
document.addEventListener('pointerdown',e=>{
  const field=e.target.closest('#field');if(!field)return;
  const marker=e.target.closest('[data-marker]');
  if(marker){selected=marker.dataset.marker;drag={field,marker,id:e.pointerId,moved:false,x:e.clientX,y:e.clientY};field.setPointerCapture(e.pointerId);}
  else void transaction({type:'position',uid:selected,coords:point(e,field)});
});
document.addEventListener('pointermove',e=>{
  if(drag?.id!==e.pointerId)return;
  if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>3)drag.moved=true;
  if(drag.moved){const [x,y]=point(e,drag.field);drag.marker.style.left=`${x}%`;drag.marker.style.top=`${y}%`;}
});
document.addEventListener('pointerup',e=>{
  if(drag?.id!==e.pointerId)return;
  const {field,moved,marker}=drag;drag=null;
  if(moved)void transaction({type:'position',uid:selected,coords:point(e,field)});else openUnit(selected,marker);
});
document.addEventListener('pointercancel',()=>{drag=null;renderPanel();});
addEventListener('hashchange',()=>{if(validTabs.includes(location.hash.slice(1))){tab=location.hash.slice(1);renderPanel();}});
addEventListener('storage',e=>{if(e.key===saveKey&&!busy&&!community?.active()){state=load()??state;if(!drag)renderPanel();if(profileUid)renderProfile();}});
addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install').hidden=false;});
function readyForUpdate(){
  if(busy||drag||rankedBusy||requestingRun||community?.isBusy()||storageFailed||blockedCampaign)return false;
  if(duel?.result===null||state.pending||document.querySelector('dialog[open]'))return false;
  for(const [context,fight] of savedFights){
    if(context!==fightContext&&fight.duel?.result===null)return false;
  }
  return !document.activeElement?.matches('input:not([type=checkbox]),textarea,select,[contenteditable=true]');
}
if(location.protocol!=='file:')import('./updates.js')
  .then(({watchUpdates})=>watchUpdates(readyForUpdate,()=>transactionQueue))
  .catch(()=>{});

renderPanel();
let saveTick=Date.now();
$('#account-retry').onclick=()=>{if(!busy)void transaction(null);};
$('#account-login').onclick=()=>{
  const form=$('#account-restore');
  form.hidden=false;
  form.elements.access.focus();
};
$('#account-restore').addEventListener('submit',async event=>{
  event.preventDefault();
  if(busy)return;
  busy=true;
  try{
    await community.signIn(event.currentTarget.elements.access.value.trim());
  }catch(error){
    if(connecting())$('#account-message').textContent=error.message;
    else note(error.message);
  }finally{busy=false;}

});
function observe(){
  if(document.hidden)return;
  const now=Date.now(),returned=lastObservation===null||now-lastObservation>=AWAY_THRESHOLD;
  lastObservation=now;
  if(returned||state.awayReports?.length&&!$('#away-dialog').open)void transaction(null,true);
}
for(const event of ['pointerdown','keydown','pointermove','wheel'])document.addEventListener(event,observe,{passive:true});
addEventListener('focus',()=>{
  observe();
  if(!community.active())void transaction(null,true);
});
$('#away-dialog').addEventListener('cancel',event=>{event.preventDefault();$('#away-continue').click();});
$('#away-continue').addEventListener('click',()=>{const report=state.awayReports?.[0];if(report)void transaction({type:'dismissAway',end:report.end});});
if(!initialSave&&!storageIssue&&!community?.active()&&location.protocol==='file:'){
  note('Primeira campanha neste arquivo. Já jogava? Em Configurações, importe seu backup ou abra a atualização no caminho do HTML antigo.');
}
const wasAway=gameNow()-state.clock>=AWAY_THRESHOLD;
void transaction(null,wasAway).then(()=>{renderPanel();drawScene(gameNow());});
setInterval(()=>{
  if(document.hidden)return;
  const now=gameNow();
  if(connecting()){
    if(!loginRequired&&!busy&&community.syncAvailable()&&Date.now()-saveTick>=10000){saveTick=Date.now();void transaction(null);}
    return;
  }
  // For online exploration, collect the last result and start the next battle in one sync.
  const batchNextEncounter=community.ready()&&state.running&&state.pending&&!state.pending.boss;
  const encounterDue=state.pending
    ? state.pending.end+(batchNextEncounter?waitFor(state):0)<=now
    : state.team.length>0&&state.running&&Math.max(state.nextAt,Math.min(...state.team.map(uid=>readyAt(state,uid))))<=now;
  const sinceOnlineSync=performance.now()-lastOnlineSyncAt;
  const syncDue=community.ready()
    ? sinceOnlineSync>=ONLINE_SYNC_MIN_MS&&(encounterDue||sinceOnlineSync>=ONLINE_HEARTBEAT_MS)
    : encounterDue||Date.now()-saveTick>12000;
  if(!busy&&community.syncAvailable()&&syncDue){
    saveTick=Date.now();void transaction(null,now-state.clock>45000).then(()=>{
      if(tab==='exploracao'&&($('#panel [data-action="boss"]')?.disabled??true)!==(!readyForBoss(state)||!!state.pending))renderPanel();
    });
  }
  if(competitionKind()&&community.playerId()){
    const entry=boards.get(community.playerId()+'/'+competitionKind());
    if(!entry||Date.now()>=entry.until)drawCompetition();
  }
  if(rarityTabs.includes(tab))void refreshSingularDiscovery();
  if(tab==='arena')updateDuelButton();
  if(tab==='modos'){
    updateTowerAdvance(now);
    const nextKey=raidInfo().day+state.team.some(uid=>readyAt(state,uid)<=now)+requestingRun;
    if(modeTickKey!==nextKey){modeTickKey=nextKey;renderModes($('#panel'));}
  }
  if(tab==='formacao')document.querySelectorAll('[data-recovery]').forEach(el=>{
    const left=readyAt(state,el.dataset.recovery)-now;
    el.textContent=left>0?'Recupera em '+Math.ceil(left/1000)+' s':'';
  });
  if(tab==='exploracao'){
    drawScene(now);
    const boss=$('#panel [data-action="boss"]');
    if(boss)boss.disabled=!readyForBoss(state)||!!state.pending||state.team.every(uid=>readyAt(state,uid)>now);
  }
  community?.tick();
},130);

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)observe();
  saveTick=Date.now();void transaction(null,!document.hidden);
});
