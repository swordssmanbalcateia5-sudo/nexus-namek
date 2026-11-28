function hasTrait(unit,name){return unit.traits?.includes(name)||unit.trait===name;}
const DEFAULT_LIMIT = 60000;
const SAMPLE_STEP = 100;
const HP_EPSILON = 1e-8;
const sum = values => values.reduce((a, b) => a + b, 0);
const COLORS = ['Vermelho','Laranja','Amarelo','Verde','Turquesa','Azul','Roxo','Rosa'];
function affinity(a, b) {
  if (!a || !b) return 1;
  if (a === 'Dourado') return b === a ? 2 : 1.5;
  if ((a === 'Branco' || a === 'Preto') && a === b) return 1.5;
  const position = COLORS.indexOf(a);
  if (position < 0) return 1;
  return b === COLORS[(position + 1) % 8] ? 1.5 : b === COLORS[(position + 7) % 8] ? .75 : 1;
}
const distance = (a, b) => Math.hypot((a.x ?? a.slot * 20) - (b.x ?? b.slot * 20), (a.y ?? 50) - (b.y ?? 50));
const MAIN_SKILLS = new Set(['piccolo','yamcha','kuririn','bulma','freeza-boss','ginyu','beam','rush','ward','heal']);

const FIFTH_BALANCE={magicReflectionBonus:.40,predationReturn:.90,predationShield:.80,cosmicMain:1,cosmicBench:.80};
const combatOf=new WeakMap();
class Combate {
  constructor(rosters, { mode = 'duelo', limit = DEFAULT_LIMIT } = {}) {
    if (!['duelo', 'equipe'].includes(mode) || !Number.isInteger(limit) || limit < SAMPLE_STEP || limit > DEFAULT_LIMIT || rosters.length !== 2 || rosters.some(team => !team.length || team.length > 4)) {
      throw new RangeError('Configuração de combate inválida.');
    }
    this.mode = mode;
    this.limit = limit;
    this.time = 0;
    this.teams = rosters.map((team, side) => team.map((spec, slot) => ({
      ...spec, side, slot, id: `${side}:${slot}`, name: spec.name ?? `${side}:${slot}`,
      hp: spec.hp ?? 1000, maxHp: spec.hp ?? 1000, attack: spec.attack ?? 100, magic: spec.magic ?? 100,
      defense: spec.defense ?? 0, resistance: spec.resistance ?? 0, shield: spec.shield ?? 0,
      interval: Math.max(SAMPLE_STEP, spec.interval ?? 3000), nextBasic: Math.max(SAMPLE_STEP, spec.interval ?? 3000),
      nextAssist: 5000, evade: spec.evade ?? 0, intercept: spec.intercept ?? 0, survive: spec.survive ?? 0, protectUntil: spec.intercept ? Infinity : 0,
      revive: spec.revive ?? 0, vector: spec.kind === 'accelerator' ? 2 : 0, vectorReady: 0,
      uses: 0, skillReady: 0, actions: 0, seenId: null, seenActions: 0, graceUntil: 0,
      weakenUntil: 0, powerUntil: 0, resistedUntil: 0,
    })));
    for(const team of this.teams)for(const unit of team)combatOf.set(unit,this);
    this.log = [];
    this.hasteUntil=[0,0];
    for(const team of this.teams){
      const king=team.find(u=>hasTrait(u,'Haki do Rei'));
      if(king)for(const foe of this.teams[1-king.side]){
        applyNegative(foe,'stunUntil',2000);applyNegative(foe,'exposedUntil',2000);
      }
    }
  }

  record(type, actor, target, data = {}) {
    if(actor&&['esquiva','instintiva','portal'].includes(type))actor.gumDodges=(actor.gumDodges??0)+1;
    this.log.push({ time: this.time, type, actor: actor?.id, target: target?.id, ...data });
  }

  alive(u) { return u.hp > HP_EPSILON; }
  active(side) { return this.teams[side].find(u => this.alive(u)); }
  present(u) { return this.alive(u) && (this.mode === 'equipe' || this.active(u.side) === u); }

  blocked(u){return u.stunUntil>this.time||(this.freezeUntil>this.time&&this.freezeOwner!==u);}
  pace(u){
    if(u.hasteUntil>this.time)return .2;
    return this.hasteUntil[u.side]>this.time?.6:1;
  }
  beginAttack(u){
    if(!hasTrait(u,'Made in Heaven')||u.heavenUsed)return;
    const team=this.teams[u.side],before=team.map(f=>this.pace(f));
    u.heavenUsed=true;u.hasteUntil=this.time+5000;this.hasteUntil[u.side]=this.time+5000;
    team.forEach((f,i)=>{
      const ratio=this.pace(f)/before[i];
      if(f.nextBasic>this.time)f.nextBasic=this.time+(f.nextBasic-this.time)*ratio;
      if(f.ready>this.time/1000)f.ready=this.time/1000+(f.ready-this.time/1000)*ratio;
    });
    this.record('aceleração',u);
  }
  outgoingPower(source,damage,basic=false){
    const trait=Math.max(1,(hasTrait(source,'Made in Heaven')?4:0)+(source.nen?4:0));
    const rage=basic&&source.rageUntil>this.time?1+.08*source.rageBonus:1;
    return damage*trait*rage*pucciMultiplier(source,this.time)*(basic&&source.invertedAttackUntil>this.time?1.35:1)*(basic&&source.weakenUntil>this.time?.65:1);
  }

  hit(source, target, attack = {}) {
    const { damage = source.attack, magic = false, skill = true, area = false, reflected = false,
      removeShield = false, shieldMultiplier = 1, ignoreDefense = 0, blockRevive = false, delayOnBreak = 0 } = attack;
    if (!this.alive(source) || !this.present(target) || source.side === target.side) return false;
    if (!Number.isFinite(damage) || damage < 0 || !Number.isFinite(shieldMultiplier) || shieldMultiplier < 1) throw new RangeError('Dano ou multiplicador inválido.');
    standActivity(this,source);standActivity(this,target);
    if(!reflected)this.beginAttack(source);
    let victim = target,interceptFactor=1;
    if(!area&&!reflected&&!attack.ignoreIntercept&&!attack.skipIntercept){
      const guard=this.teams[target.side].find(u=>u!==target&&hasTrait(u,'Restrição Celestial')&&!this.blocked(u)&&this.alive(u)&&(u.guardUses??0)<2&&(this.mode==='duelo'||distance(u,target)<=30));
      if(guard){guard.guardUses=(guard.guardUses??0)+1;victim=guard;interceptFactor=.5;this.record('intercepta',guard,target);}
    }
    if (victim===target && !area && !reflected && !attack.ignoreIntercept && !attack.skipIntercept && this.mode === 'equipe') {
      const guard = this.teams[target.side].find(u => u !== target && !this.blocked(u) && this.alive(u) && u.intercept > 0 && u.protectUntil >= this.time && distance(u,target) <= 30);
      if (guard) {
        guard.intercept--;
        victim = guard;
        this.record('intercepta', guard, target);
      }
    }
    if(this.arena&&divineIntercept(this.arena,source,victim,attack))return false;
    if(this.arena&&!area&&thirdIntercept(this.arena,source,victim,attack))return false;
    if(skill&&!reflected&&!attack.echo){
      source.m3LastCast={damage,magic};
      if(victim.kind==='m3_chrollo'&&!victim.stolen)victim.stolen={damage,magic};
    }
    if(attack.inverted&&victim.shield<=0){
      if(victim.waterGuard?.end>=this.time)delete victim.waterGuard;
      else if(victim.adaptiveUntil>this.time)victim.adaptiveUntil=0;
      else if(victim.moonGuard)victim.moonGuard=false;
      else if(victim.moonShield>0)victim.moonShield=0;
      else if(victim.portalDodge)victim.portalDodge=false;
      else if(victim.kind==='dominio'&&(victim.infinityReady??0)<=this.time)victim.infinityReady=this.time+12000;
    }
    if(!area&&!reflected&&!attack.counter&&victim.waterGuard?.end>=this.time){
      const {f,bench}=victim.waterGuard;delete victim.waterGuard;
      const m=this.arena,s=m.sides[victim.side],o=m.sides[source.side];
      mythFx(m,'agua',s,17);this.record('desvio',victim,source);
      waterRun(m,f,source,bench,true);
      if(!bench)return false;interceptFactor*=.5;
    }
    if(this.arena&&area&&victim.blastPortalUntil>this.time){
      victim.blastPortalUntil=0;
      const m=this.arena,pos=m.sides[victim.side];
      m.flashes.push({art:'blast_impacto',x:pos.x,y:pos.y,time:m.t});
      this.record('área desviada',victim,source);
      return false;
    }
    if(!area&&(victim.illusionUntil>this.time||(victim.illusionBench&&skill))){
      const main=victim.illusionUntil>this.time,owner=main?victim:victim.illusionBench;
      if(main){victim.illusionUntil=0;victim.skillReady=Math.max(this.time,victim.skillReady-3000)}
      else victim.illusionBench=false;
      this.record('hipnose',victim,source);
      if(this.arena){
        const m=this.arena,pos=m.sides[victim.side];
        m.flashes.push({art:'aizen_estilhacos',x:pos.x,y:pos.y,time:m.t});
        spawnMirage(m,owner,pos,main?1.60:1.00,main?victim.illusionCast:++m.secretSeq);
      }
      return false;
    }
    if(!area && victim.portalDodge){
      victim.portalDodge=false;this.record('portal',victim,source);return false;
    }
    if(!area&&victim.assistInfinity){victim.assistInfinity=false;this.record('ilimitado',victim,source);return false}
    if(!area&&victim.assistInstinct){this.record('instintiva',victim,source,{power:victim.assistInstinct});victim.assistInstinct=0;return false}
    if(!area && victim.kind==='dominio' && (victim.infinityReady??0)<=this.time){
      victim.infinityReady=this.time+12000;this.record('ilimitado',victim,source);return false;
    }
    if(!area && victim.kind==='instinto' && victim.stanceUntil>this.time){
      this.record('instintiva',victim,source);return false;
    }
    if (!area && !reflected && victim.evade > 0) {
      victim.evade--;
      this.record('esquiva', victim, source);
      if(attack.petals)this.hit(source,victim,{magic:true,area:true,damage:damage*.35});
      if(this.arena&&victim.petalTrap?.end>=this.time){
        const trap=victim.petalTrap;delete victim.petalTrap;
        mythStrike(this.arena,trap.f,victim,{area:true,magic:true,damage:trap.f.magic*.65},this.arena.sides[victim.side]);
      }
      if(hasTrait(victim,'Instinto Superior')&&!attack.counter&&!this.blocked(victim)&&this.present(source))this.hit(victim,source,{skill:false,counter:true,magic:!!victim.magicBasic,damage:victim.magicBasic?victim.magic:victim.attack});
      return true;
    }
    if(!area&&!reflected&&skill&&hasTrait(victim,'Haki da Observação')&&(victim.observeUses??0)<2&&!this.blocked(victim)&&this.present(source)){
      victim.observeUses=(victim.observeUses??0)+1;
      this.hit(victim,source,{skill:false,counter:true,damage:2*(victim.magicBasic?victim.magic:victim.attack),magic:!!victim.magicBasic});
      if(!this.alive(source))return true;
    }
    if(skill&&!reflected&&!attack.echo){
      const snapshot={...attack,damage,magic,area};
      victim.lastOffense=snapshot;
      if(magic && ((victim.kind==='rimuru'&&!victim.storedMagic&&(victim.predationReady??0)<=this.time)||(victim.slimeGuard&&attack.projectile))){
        if(victim.kind==='rimuru'&&!victim.storedMagic&&(victim.predationReady??0)<=this.time){
          victim.predationReady=this.time+8000;victim.storedMagic=snapshot;
        }else{victim.slimeGuard=false;grantShield(victim,damage*FIFTH_BALANCE.predationShield)}
        this.record('predacao',victim,source);return false;
      }
      if(victim.kind==='garou'&&!victim.cosmicCopy)victim.cosmicCopy=snapshot;
    }
    if (!area && !reflected && skill) {
      const mirror=magic&&this.teams[victim.side].find(u=>hasTrait(u,'Full Counter')&&!u.mirrorUsed&&this.alive(u)&&!this.blocked(u)&&(u===victim||this.mode==='duelo'||distance(u,victim)<=30));
      if(mirror){
        mirror.mirrorUsed=true;this.record('reflete',mirror,source);
        this.hit(mirror,this.present(source)?source:this.active(source.side),{...attack,damage:damage*2,reflected:true});
        return true;
      }
      const ward=this.vectorPool??=[{ready:0},{ready:0}];
      const shared=ward[victim.side];
      const vector = victim.vectorAssist??this.teams[victim.side].find(u => this.alive(u) && u.kind==='accelerator' && u.vectorReady <= this.time && (this.mode === 'duelo' || Math.abs(u.slot - victim.slot) <= 1));
      if (vector && this.alive(vector)&&shared.ready<=this.time) {
        shared.ready=this.time+8000;
        vector.vectorReady = this.time + 8000;
        this.record('especial',vector,source,{name:vector.skill??'Controle Vetorial',role:'reação'});
        this.record('reflete', vector, source, { readyAt: shared.ready });
        const returnTarget = this.present(source) ? source : this.active(source.side);
        if(returnTarget){
          const payload={...attack,damage,reflected:true};
          if(magic){
            const empowered=source.powerUntil>this.time;
            payload.vectorPower=this.outgoingPower(source,damage,false)*(empowered?1.3:1);
            if(empowered)source.powerUntil=0;
          }
          if(this.enqueueReflection)this.enqueueReflection(vector,payload);
          else this.hit(vector,returnTarget,payload);
        }
        return true;
      }
    }
    const truth=victim.truthOrbs;
    if(this.arena&&!area&&!reflected&&attack.projectile&&truth?.count>0&&truth.until>this.time&&this.alive(truth.f)){
      const m=this.arena,{x,y}=m.sides[victim.side];
      truth.count--;
      m.elasticReturns.push({f:truth.f,x,y,art:'madara_disparo',
        attack:{damage:damage*(truth.bench?.65:.75),magic,reflected:true,secretCast:truth.castId}});
      m.flashes.push({art:'madara_impacto',x,y,time:m.t});
      this.record('esfera interceptou',victim,source);
      return false;
    }
    const elastic=victim.elasticGuard;
    const elasticSave=this.arena&&!area&&!reflected&&attack.projectile&&elastic?.until>this.time&&this.alive(elastic.f);
    if(elasticSave){
      victim.elasticGuard=null;
      const m=this.arena,{x,y}=m.sides[victim.side];
      m.elasticReturns.push({f:elastic.f,x,y,attack:{damage:damage*elastic.ratio,magic,reflected:true,elasticBurst:!elastic.bench,secretCast:elastic.castId}});
      this.record('projétil rebatido',victim,source);
      if(!elastic.bench)return false;
    }
    const openPower = skill && !reflected && source.powerUntil > this.time;
    if (openPower) source.powerUntil = 0;
    if(attack.breakBuff){
      const buff=['royalWardUntil','invertedExposureUntil','adaptiveUntil','powerUntil','hasteUntil'].find(k=>victim[k]>this.time);
      if(buff){
        victim[buff]=0;
        if(this.arena)queueGround(this.arena,source,this.arena.sides[victim.side],'anos_marca',.27,attack.secretCast);
        this.record('bônus removido',source,victim);
      }
      if(attack.sealHeal){
        victim.healSealUntil=this.time+6000;
        this.record('cura selada',source,victim);
      }
    }
    if(attack.antiMagic){
      const shielded=victim.shield>0||victim.moonShield>0;
      const defense=['royalWardUntil','invertedExposureUntil','adaptiveUntil'].find(key=>victim[key]>this.time);
      if(defense)victim[defense]=0;
      victim.moonShield=0;
      if(shielded&&this.arena){
        const point=this.arena.sides[victim.side];
        queueGround(this.arena,source,point,'asta_estilhaco',.26,attack.secretCast,attack.antiMagic);
        this.arena.flashes.push({art:'asta_estilhaco',x:point.x,y:point.y,time:this.arena.t});
      }
    }
    const charge=attack.interruptCharge&&this.arena?.secretCharges.find(e=>e.carrier===victim&&!e.bench&&!e.cancelled);
    const mitigation = (magic ? victim.resistance : victim.defense) * (1 - ignoreDefense);
    let value = (attack.vectorPower??this.outgoingPower(source,damage,!skill)) * interceptFactor * (victim.exposedUntil>this.time?1.3:1) * affinity(source.color,victim.color) * (openPower ? 1.3 : 1) * 40 / (40 + mitigation/(source.scale || 1));
    if(elasticSave)value*=1-elastic.ratio;
    if(charge){
      charge.cancelled=true;
      if(victim.dragonCharge===charge)victim.dragonCharge=null;
      value*=1.3;
      this.record('carga interrompida',source,victim);
      note(this.arena,'Corte do Imperador · carga interrompida');
    }
    if(!magic && attack.vectorPower===undefined)value*=(source.attackDownUntil>this.time?.65:1)*(source.royalAttackUntil>this.time?1.35:1);
    if(victim.royalWardUntil>this.time)value*=.75;
    if(victim.invertedExposureUntil>this.time)value*=.70;
    const element=magic?'magico':'fisico';
    source.lastDamageType=element;
    if(victim.kind==='meruem_rei'){
      const learned=victim.learned??=new Set();
      if(learned.has(element))value*=.72;
      else learned.add(element);
      this.record('carapaca',victim,source);
    }
    if(victim.adaptiveUntil>this.time&&victim.adaptiveType===element)value*=.72;
    if(reflected&&magic&&attack.vectorPower!==undefined)value*=1+FIFTH_BALANCE.magicReflectionBonus;
    if(magic&&skill&&victim.moonGuard){
      victim.moonGuard=false;this.record('lunar',victim,source);return false;
    }
    if(magic && victim.moonShield>0){
      const spent=Math.min(victim.moonShield,value);victim.moonShield-=spent;value-=spent;
      this.record('lunar',victim,source);
    }
    const barrierBefore=victim.divineShield?.amount??0;
    if(this.arena)value=divineMitigation(this.arena,source,victim,attack,value);
    const available=removeShield||attack.antiMagic||attack.pierceFirst?0:victim.shield/shieldMultiplier;
    if(skill && value-available>=victim.hp && (victim.zeroGuard||this.active(victim.side)?.kind==='giorno') && !this.zeroUsed?.[victim.side]){
      const main=this.active(victim.side)?.kind==='giorno';
      (this.zeroUsed??={})[victim.side]=true;victim.zeroGuard=false;
      if(main){this.heal(victim,victim.maxHp*.25);source.loseAction=true}
      this.record('zero',victim,source,{main});return false;
    }
    if(source.disarmed>this.time){source.disarmed=0;value*=.65}
    const dragon=victim.dragonCharge;
    if(dragon&&!this.blocked(victim)){
      const prevented=value*.35;
      value-=prevented;dragon.absorbed+=prevented;
    }
    const priorShield = victim.shield;
    if (removeShield||attack.antiMagic) victim.shield = 0;
    const absorbed = attack.pierceFirst ? 0 : Math.min(victim.shield, value * shieldMultiplier*(attack.partialPierce?.5:1));
    victim.shield -= absorbed;
    if(priorShield>victim.shield)victim.mythLoss={time:this.time,amount:priorShield-victim.shield};
    value -= absorbed / shieldMultiplier;
    if (priorShield > 0 && victim.shield <= HP_EPSILON) {
      victim.shield = 0;
      victim.nextBasic += delayOnBreak;
      this.record('escudo rompe', source, victim);
      const support=victim.dragonSupport;
      if(this.arena&&support?.until>this.time&&this.alive(support.f)){
        const m=this.arena,{x,y}=m.sides[victim.side];
        victim.dragonSupport=null;
        m.secretCharges.push({f:support.f,carrier:victim,bench:true,art:'kaido_carga',shot:'kaido_sopro',origin:{x,y},born:m.t,delay:.22,damage:support.f.attack*1.25,castId:support.castId});
      }
    }
    const actual = Math.min(victim.hp, value);
    victim.hp = Math.max(0, victim.hp - value);
    if(actual>0){
      if(victim.kind==='broly_furia'&&!attack.periodic)victim.rageStacks=Math.min(4,(victim.rageStacks??0)+1);
      if(victim.kind==='meliodas_v')victim.demonCharge=(victim.demonCharge??0)+actual;
      victim.recentImpact=(victim.recentImpact??[]).filter(e=>this.time-e.t<=4000);
      victim.recentImpact.push({t:this.time,n:actual});
      if(attack.crack)applyNegative(victim,'crackedShield',true);
    }
    if(victim.kind==='m3_bat'&&!area&&!attack.periodic&&(actual>0||absorbed>0))victim.rage=Math.min(5,(victim.rage??0)+1);
    if(this.arena)divineContact(this.arena,source,victim,attack,actual,absorbed+Math.max(0,barrierBefore-(victim.divineShield?.amount??0)));
    this.record('dano', source, victim, { hp: actual, reflected, remaining: victim.hp, skill });
    if(!this.alive(victim)&&victim.timeMark?.until>this.time){
      const mark=victim.timeMark;victim.timeMark=null;victim.hp=mark.hp;
      if(mark.main){victim.skillReady=this.time;victim.ready=this.time/1000;mark.owner.timeReady=this.time+20000}
      this.record('reverte',victim,source);return true;
    }
    if(!this.alive(victim)){
      const main=!!(victim.kind==='yhwach'&&(victim.almightyReady??0)<=this.time);
      if(main||victim.futureUntil>this.time){
        victim.futureUntil=0;victim.hp=victim.maxHp*(main?.35:.20);
        if(main){victim.almightyReady=this.time+24000;victim.skillReady=this.time;victim.ready=this.time/1000}
        this.record('futuro',victim,source);return true;
      }
      const madoka=this.teams[victim.side].find(u=>u.kind==='madoka' && (u===victim||this.present(u)));
      if(!blockRevive && madoka && (madoka.cycleReady??0)<=this.time && negativeKeys(victim,this.time).length){
        madoka.cycleReady=this.time+24000;cleanse(victim,this.time,false);victim.hp=victim.maxHp*.35;
        this.record('ciclos',victim,source);return true;
      }
    }
    if(this.arena && this.alive(victim) && actual>0 && !attack.periodic){
      const m=this.arena,from=m.sides[source.side],to=m.sides[victim.side];
      if(victim.heatUntil>this.time && Math.hypot(from.x-to.x,from.y-to.y)<=13)
        applyDot(m,victim,source,'yamamoto_brasas',victim.magic*.12,.55,5);
      const spin=victim.dots?.get('johnny_rotacao');
      if(spin&&skill&&spin.lastCast!==(attack.secretCast??attack)){
        spin.lastCast=attack.secretCast??attack;spin.level=Math.min(4,(spin.level??1)+1);spin.damage=spin.source.magic*.09*spin.level;
      }
      if(from.nailSupport){applyDot(m,from.nailSupport,victim,'johnny_rotacao',from.nailSupport.magic*.09,.6,8);from.nailSupport=null}
    }
    if (!this.alive(victim)) this.defeat(victim, source, blockRevive);
    return true;
  }

  defeat(victim, source, blockRevive) {
    if (victim.survive > 0) {
      victim.survive--;
      if(hasTrait(victim,"Zenkai")){victim.attack*=1.75;victim.magic*=1.75;}
      victim.hp = victim.maxHp * .4;
      this.record('sobrevive', victim, source, { remaining: victim.hp });
    } else if (victim.revive > 0 && !blockRevive) {
      victim.revive--;
      victim.hp = victim.maxHp * .7;
      this.record('ressurge', victim, source, { remaining: victim.hp });
    } else {
      victim.hp = 0;
      victim.shield = 0;
      const successor = this.mode === 'duelo' ? this.active(victim.side) : null;
      this.record('cai', victim, source);
      if(source?.kind==='rei'&&(source.kingReady??0)<=this.time){
        source.kingReady=this.time+8000;
        source.skillReady=Math.max(this.time,source.skillReady-3000);
        source.ready=Math.min(source.ready,source.skillReady/1000);
      }
      if (successor) {
        successor.nextBasic = this.time + successor.interval;
        successor.graceUntil = this.time + SAMPLE_STEP;
        this.record('entra', successor);
      }
    }
  }

  heal(unit, amount) {
    if (!this.alive(unit)) return;
    if(amount>0&&unit.hp<unit.maxHp&&unit.healSealUntil>this.time){
      unit.healSealUntil=0;
      this.record('cura bloqueada',unit);
      return;
    }
    if(unit.sageBless || (unit.reserveHeal&&this.reserveHealing)){
      amount*=1.5;
      if(unit.sageBless)unit.sageBless=false;else unit.reserveHeal=false;
      this.record('seis',unit);
    }
    if(unit.soulWound>this.time){unit.soulWound=0;amount*=.5}
    const prev=unit.hp;
    unit.hp = Math.min(unit.maxHp, unit.hp + amount);
    const link=unit.sageLink;
    if(link&&link.until>this.time&&this.alive(link.other)&&unit.hp>prev){
      link.other.hp=Math.min(link.other.maxHp,link.other.hp+(unit.hp-prev)*.5);
      this.record('seis',link.other);
    }
    this.record('cura', unit, undefined, { remaining: unit.hp });
  }

  use(actor,target,type,role='principal',launch){
    const used=this.cast(actor,target,type,role,launch);
    if(used&&actor.skill)this.record('especial',actor,target,{name:actor.skill,role});
    if(used&&role==='principal'&&hasTrait(actor,'The World')&&!actor.worldUsed){
      actor.worldUsed=true;this.freezeOwner=actor;this.freezeUntil=this.time+3000;
      actor.skillReady=0;actor.nextBasic=Math.min(actor.nextBasic,this.time+SAMPLE_STEP);
      actor.ready=this.time/1000;this.record('tempo parado',actor);
    }
    return used;
  }
  cast(actor, target, type, role = 'principal', launch) {
    if (!this.alive(actor) || !this.present(target)) return false;
    const deliver = launch ?? ((victim,options)=>this.hit(actor,victim,options));
    const strike = options => deliver(target,options);
    if(role==='reserva'){
      const active=this.active(actor.side);
      if(type==='dominio'){if(active.assistInfinity||actor.skillReady>this.time)return false;active.assistInfinity=true;actor.skillReady=this.time+12000;return true}
      if(type==='instinto'){if(active.assistInstinct||actor.skillReady>this.time)return false;active.assistInstinct=actor.attack;actor.skillReady=this.time+8000;return true}
      if(type==='saitama'){
        if(actor.skillReady>this.time||!this.log.some(e=>e.actor===target.id&&e.type==='especial'&&e.role==='principal'))return false;
        actor.skillReady=this.time+10000;return strike({damage:actor.attack,removeShield:true});
      }
      if(type==='rei')return strike({damage:actor.attack,partialPierce:true});
      if(type==='reescrita'){
        if(!active||active.hp>active.maxHp*.4)return false;
        this.heal(active,active.maxHp*.30);return true;
      }
      if(type==='kaguya'){
        if(!active||active.portalDodge)return false;
        active.portalDodge=true;return true;
      }
      if(type==='tremor')return strike({area:true,damage:actor.attack*1.35,removeShield:true,delayOnBreak:1000});
    }
    switch (type) {
      case 'rei':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        return strike({damage:actor.attack,magic:false,pierceFirst:true});
      case 'room':
      case 'benihime': {
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        const ally=this.teams[actor.side].filter(u=>this.present(u))
          .reduce((lowest,u)=>u.hp/u.maxHp<lowest.hp/lowest.maxHp?u:lowest);
        if(type==='room'){
          this.heal(ally,1.5*actor.magic);
          return strike({magic:true,damage:1.35*actor.magic,ignoreDefense:.4});
        }
        grantShield(ally,2.2*actor.magic);
        this.record('protege',actor,ally);
        return strike({magic:true,damage:1.05*actor.magic});
      }
      case 'barreira':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        for(const ally of this.teams[actor.side].filter(u=>this.present(u))){
          grantShield(ally,actor.defense*(ally===actor?1.8:1));
          this.record('protege',actor,ally);
        }
        return true;
      case 'death_ray':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+7000;
        return strike({magic:true,damage:actor.magic*(target.hp<target.maxHp*.35?2.35:1.75),ignoreDefense:.25});
      case 'final_flash':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        return strike({damage:actor.attack*2.15,shieldMultiplier:2});
      case 'furia':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+6000;
        return strike({damage:actor.attack*(1.65+.25*Math.min(actor.uses++,3))});
      case 'santuario':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+10000;
        return strike({area:true,magic:true,damage:actor.magic*.45,shieldMultiplier:2});
      case 'instinto':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;actor.stanceUntil=this.time+2000;
        return true;
      case 'bodisatva': {
        if(actor.skillReady>this.time)return false;
        const instinct=type==='instinto';
        actor.skillReady=this.time+(instinct?8000:7000);
        if(instinct)actor.evade=Math.max(actor.evade,1);
        for(let i=0;i<(instinct?2:3)&&this.alive(actor)&&this.present(target);i++)
          strike({damage:actor.attack*(instinct?1:.65),ignoreDefense:i===2?.5:0});
        return true;
      }
      case 'dominio':
      case 'despertar': {
        if(actor.skillReady>this.time)return false;
        const domain=type==='dominio';
        actor.skillReady=this.time+(domain?12000:9000);
        const damage=actor.magic*(domain?1.55:actor.hp<=actor.maxHp*.5?2.25:1.65);
        for(const foe of this.teams[target.side].filter(u=>this.present(u))){
          deliver(foe,{magic:true,area:true,damage});
          if(domain&&!launch)applyNegative(foe,'stunUntil',Math.max(foe.stunUntil??0,this.time+1500));
        }
        return true;
      }
      case 'reescrita':
      case 'ciclo_vital': {
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        const ally=this.teams[actor.side].filter(unit=>this.present(unit))
          .reduce((lowest,unit)=>unit.hp/unit.maxHp<lowest.hp/lowest.maxHp?unit:lowest);
        if(type==='ciclo_vital'){
          this.heal(ally,actor.magic*2);
          return strike({damage:actor.magic*1.05,magic:true});
        }
        if((actor.rewriteHealReady??0)<=this.time&&ally.hp<=ally.maxHp*.4){
          actor.rewriteHealReady=this.time+18000;
          this.heal(ally,ally.maxHp*.5);
          return true;
        }
        return strike({damage:actor.attack*1.9});
      }
      case 'nichirin': {
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+10000;
        const victims=this.teams[target.side].filter(unit=>this.present(unit)&&distance(unit,target)<=28);
        this.record('onda',actor,target,{targets:victims.map(unit=>unit.id)});
        for(const unit of victims)deliver(unit,{damage:actor.attack*(unit===target?1.8:.85),area:true});
        return true;
      }
      case 'tempestade': {
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+10000;
        const other=this.teams[target.side].find(unit=>unit!==target&&this.present(unit));
        strike({damage:actor.magic*1.85,magic:true,ignoreDefense:.3});
        if(other)deliver(other,{damage:actor.magic*.75,magic:true});
        return true;
      }
      case 'ashisogi':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        if(!launch)applyNegative(target,'weakenUntil',Math.max(target.weakenUntil,this.time+4000));
        return strike({damage:actor.magic*1.3,magic:true});
      case 'metralleta':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        for(let i=0;i<3&&this.alive(actor)&&this.present(target);i++)strike({damage:actor.magic*.6,magic:true});
        return true;
      case 'shunko':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+12000;
        actor.evade++;
        return strike({damage:actor.attack*1.4});
      case 'excalibur':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+7000;
        return strike({damage:actor.attack*1.45,ignoreDefense:.35});
      case 'piccolo':
      case 'ward': {
        if (actor.skillReady > this.time) return false;
        actor.skillReady = this.time + 10000;
        actor.intercept = 1;
        actor.protectUntil = this.time + 4500;
        grantShield(actor,actor.magic * 1.1);
        this.record('protege',actor);
        return true;
      }
      case 'bulma':
      case 'heal': {
        if (actor.skillReady > this.time) return false;
        const ally = this.teams[actor.side].filter(u=>this.present(u)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
        if (!ally || ally.hp/ally.maxHp > .95) return false;
        actor.skillReady = this.time + 7000;
        if (type === 'heal') this.heal(ally,actor.magic * 1.3);
        else { grantShield(ally,actor.magic*2);this.record('protege',actor,ally); }
        return true;
      }
      case 'yamcha':
      case 'kuririn':
      case 'rush':
      case 'beam': {
        if (actor.skillReady > this.time) return false;
        const magic = ['kuririn','beam'].includes(type);
        const victim = type === 'kuririn' ? this.teams[target.side].filter(u=>this.present(u)).sort((a,b)=>a.hp-b.hp)[0] : target;
        actor.skillReady = this.time + (magic ? 7000 : 6000);
        return deliver(victim,{ damage: magic ? actor.magic*1.65 : actor.attack*1.6, magic });
      }
      case 'freeza-boss':
      case 'ginyu': {
        if (actor.skillReady > this.time) return false;
        actor.skillReady = this.time + 12000;
        const anchor = this.teams[target.side].filter(u=>this.present(u)).sort((a,b)=>b.hp-a.hp)[0];
        const victims = this.teams[target.side].filter(u=>this.present(u)&&distance(u,anchor)<=28);
        this.record('onda',actor,anchor,{ targets: victims.map(u=>u.id) });
        for (const victim of victims) deliver(victim,{damage:actor.magic * (type === 'freeza-boss' ? .82 : .7),magic:true,area:true});
        return true;
      }
      case 'beerus': {
        if (role === 'principal' && actor.skillReady > this.time) return false;
        if (role === 'principal') actor.skillReady = this.time + 9000;
        return strike({ damage: actor.magic * (role === 'reserva' ? 1.25 : 2.4), magic: true, removeShield: true, blockRevive: role !== 'reserva' });
      }
      case 'zoro': return strike({ damage: actor.attack * 1.1, shieldMultiplier: 2 });
      case 'tremor':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        return strike({damage:actor.attack*1.35,area:true});
      case 'barba-branca': return strike({ damage: actor.attack * 1.35, removeShield: true, delayOnBreak: 1000 });
      case 'polnareff': {
        if (role === 'reserva') return strike({ damage: actor.attack, shieldMultiplier: 2 });
        for (let i=0; i<3 && this.alive(actor) && this.present(target); i++) {
          strike({ damage: actor.attack * (i === 2 && !target.shield ? .75 : .45), shieldMultiplier: i === 2 ? 2 : 1 });
        }
        return true;
      }
      case 'tetsuo': {
        const boosted = (this.active(actor.side)?.resistedUntil ?? 0) > this.time;
        return strike({ damage: actor.magic * (boosted ? 1.65 : 1.1), magic: true, removeShield: boosted });
      }
      case 'kaguya': {
        if (actor.skillReady > this.time) return false;
        actor.uses++;
        actor.skillReady = this.time + 12000;
        this.teams[target.side].filter(u=>this.alive(u)).forEach(u=>{applyNegative(u,'weakenUntil',this.time + 4000);});
        this.teams[actor.side].filter(u=>this.alive(u)).forEach(u=>{u.powerUntil = this.time + 4000;});
        this.record('dimensão', actor, target);
        return true;
      }
      case 'saitama': {
        if (actor.skillReady > this.time || target.actions - (actor.seenId === target.id ? actor.seenActions : 0) < 3) return false;
        actor.uses++;
        actor.skillReady = this.time + 10000;
        actor.seenId = target.id;
        actor.seenActions = target.actions;
        return strike({ damage: actor.attack * 2.8, removeShield: true, ignoreDefense: .5 });
      }
      default: return false;
    }
  }

  run() {
    for (this.time = SAMPLE_STEP; this.time <= this.limit; this.time += SAMPLE_STEP) {
      if (!this.active(0) || !this.active(1)) break;
      const order = [0, 1].sort((a,b) => (this.time / SAMPLE_STEP) % 2 ? a-b : b-a);
      for (const side of order) {
        const own = this.active(side);
        if (!own) continue;
        for (const actor of this.mode === 'duelo' ? [own] : this.teams[side]) {
          const target = this.mode === 'equipe' ? this.teams[1-side].filter(u=>this.present(u)).sort((a,b)=>(b.x??-b.slot)-(a.x??-a.slot))[0] : this.active(1-side);
          if (!target || !this.present(actor) || actor.nextBasic > this.time || actor.graceUntil > this.time) continue;
          if(this.blocked(actor))continue;
          this.beginAttack(actor);
          actor.nextBasic = this.time + actor.interval*this.pace(actor);
          actor.actions++;
          if (!this.use(actor, target, actor.kind) || MAIN_SKILLS.has(actor.kind) && ['piccolo','ward','bulma','heal'].includes(actor.kind)) this.hit(actor, target, { skill: false, damage: actor.magicBasic ? actor.magic : actor.attack, magic: !!actor.magicBasic });
        }
        if (this.mode === 'duelo') for (const reserve of this.teams[side]) {
          const ally = this.active(side);
          const target = this.active(1-side);
          if (!ally || !target || !this.alive(reserve) || reserve === ally || this.blocked(reserve) || reserve.nextAssist > this.time) continue;
          reserve.nextAssist = this.time + 7000;
          if (reserve.healer) this.heal(ally, reserve.healer);
          else if (reserve.assist) this.use(reserve, target, reserve.assist, 'reserva');
        }
      }
      if (!this.active(0) || !this.active(1)) break;
    }
    const live = this.teams.map(t=>t.some(u=>this.alive(u)));
    const scores = this.teams.map(t=>sum(t.map(u=>u.hp/u.maxHp))/t.length);
    const timeout = live.every(Boolean);
    const scoreDiff = scores[0]-scores[1];
    const winner = timeout ? (Math.abs(scoreDiff)<HP_EPSILON ? null : scoreDiff>0?0:1) : live[0]===live[1]?null:live[0]?0:1;
    return { winner, seconds: Math.min(this.time,this.limit)/1000, reason: timeout?'limite':'eliminação', scores, events: this.log };
  }
}



// Fixed-step simulation in a 100 × 50 arena.
const DT=1/60;
function collisionBonus(hits){return Math.min(40,12*hits);}

function rawCollision(f){
  return (f.magicBasic?f.magic:f.attack)*(1+collisionBonus(f.hits)/100);
}
function collisionPower(m,f){
  return m.combat.outgoingPower(f,rawCollision(f),true);
}
const arenaKinds={
  "sukuna-forma-original": "santuario",
  "saitama": "saitama",
  "kaguya-otsutsuki": "kaguya",
  "barba-branca-auge": "tremor",
  "gol-d-roger": "rei",
  "simon-tengen-toppa": "simon",
  "meruem-pos-rosa": "meruem_rei",
  "eternal-sailor-moon": "sailor",
  "lucius-zogratis": "lucius",
  "ultimate-madoka": "madoka",
  "yhwach": "yhwach",
  "giorno-gold-experience-requiem": "giorno",
  "meliodas-magia-verdadeira": "meliodas_v",
  "minato": "m_minato",
  "byakuya": "m_byakuya",
  "bang": "m_bang",
  "josuke-parte-4": "m_josuke",
  "frieren": "m2_frieren",
  "yami": "m2_yami",
  "toji": "m2_toji",
  "hisoka": "m2_hisoka",
  "portgas-d-ace": "m3_ace",
  "genos": "m3_genos",
  "kakashi-mangekyo": "m3_kakashi",
  "maki-desperta": "m3_maki",
  "metal-bat": "m3_bat",
  "vash": "m3_vash",
  "biscuit": "m3_biscuit",
  "flashy-flash": "m3_flash",
  "elizabeth-poderes-de-deusa": "m3_elizabeth",
  "chrollo": "m3_chrollo",
  "yamamoto": "yamamoto",
  "johnny-tusk-act-4": "johnny",
  "ichigo-bankai-verdadeiro": "ichigo",
  "aizen-hogyoku": "aizen",
  "benimaru_shinmon": "benimaru",
  "veldora": "veldora",
  "luminous": "luminous",
  "anos-voldigoad": "anos",
  "vegeta": "vegeta_blue",
  "kaido": "kaido_dragon",
  "tetsuo-shima": "tetsuo",
  "mob": "mob",
  "shanks": "shanks_imperador",
  "broly": "broly_furia",
  "blast": "blast_portais",
  "luffy-gear-5": "luffy_gear5",
  "pucci-made-in-heaven": "pucci_mih",
  "asta-devil-union": "asta_union",
  "madara-dez-caudas": "madara_jubi",
  "yuno-star-magic": "yuno_stars",
  "starrk": "metralleta",
  "rei-dos-demonios": "rei_demonios",
  "rimuru-tempest": "rimuru",
  "garou-cosmico": "garou",
  "hagoromo-otsutsuki": "hagoromo",
  "king-asas-completas": "div_king",
  "licht": "div_licht",
  "netero": "div_netero",
  "mereoleona": "div_mereoleona",
  "android17": "div_android17"
};
function arenaFighter(f){
  const kind=arenaKinds[f.id]??f.kind;
  return {...f,characterId:f.id,kind,signatureAssist:f.signatureAssist||divineIds.has(kind)||Boolean(secondKits[kind])||mythKinds.has(kind)||kind==='aizen'||kind==='luminous'};
}
function launchBall(side,index,random){
  // Sample each ball independently in the inward-facing arc.
  const angle=(random()*140-70)*Math.PI/180;
  side.vx=(index===0?1:-1)*Math.cos(angle);
  side.vy=Math.sin(angle);
}
function createDuel(left,right,limit=120,seed=crypto.getRandomValues(new Uint32Array(1))[0]){
  let cursor=seed>>>0;
  const random=()=>{
    cursor=(Math.imul(1664525,cursor)+1013904223)>>>0;
    return cursor/4294967296;
  };
  const combat=new Combate([left.map(arenaFighter),right.map(arenaFighter)]);
  const sides=combat.teams.map((team,i)=>({
    team:team.map((f,slot)=>Object.assign(f,{hits:0,ready:2+slot*1.2})),
    slot:0,x:i?80:20,y:i?30:20
  }));
  sides.forEach((side,index)=>{
    launchBall(side,index,random);
    if(side.team[0]?.kind==='pucci_mih')side.team[0].enteredAt=0;
  });
  const match={combat,sides,limit,launchSeed:seed>>>0,random,skills:[],shots:[],flashes:[],t:0,result:null,events:[],damageFeed:[],contact:0,contacts:0,reflections:[],mirages:[],secretSeq:0,groundEffects:[],secretCharges:[],psychicPulses:[],elasticReturns:[],starShots:[],orbVolleys:[]};
  combat.arena=match;
  combat.enqueueReflection=(f,attack)=>match.reflections.push({f,attack});
  return match;
}
function note(m,text){m.events.unshift(text);m.events.length=Math.min(5,m.events.length);}
function arenaUnit(side,slot){
  return side.team[slot]??Object.values(side.bench??{}).find(f=>f.slot===slot);
}
function announce(m,f,name,role){
  const text=f.name+' · '+name+(role==='reserva'?' (assistência)':'');
  m.skills.unshift({side:f.side,slot:f.slot,name,role,text,time:m.t});
  m.skills.length=Math.min(m.skills.length,12);
  note(m,text);
}
function finishDuel(match){
  while(match.result===null)stepDuel(match);
  return match;
}
const R=4, ROOM=18;
function pucciMultiplier(unit,now){
  if(unit.kind!=='pucci_mih'||unit.enteredAt===undefined)return 1;
  return 1.05**Math.floor(Math.max(0,now-unit.enteredAt)/2000);
}
function movementSpeed(unit,now){
  const base=Math.min(48,26+unit.speed*.065);
  const wall=unit.wallBoost?.until>now?unit.wallBoost.stacks*unit.wallBoost.perBounce:0;
  const assist=unit.pucciAssistUntil>now?.15:0;
  return base*pucciMultiplier(unit,now)*(1+wall+assist);
}
function move(m,s,unit,dt=DT){
  const now=m.combat.time;
  const wallBoost=unit.wallBoost?.until>now?unit.wallBoost:null;
  const speed=movementSpeed(unit,now);
  const factor=speed/(Math.hypot(s.vx,s.vy)||1);
  s.vx*=factor;s.vy*=factor;
  s.x+=s.vx*dt;s.y+=s.vy*dt;
  // Reflect the overshoot so distance is conserved at walls and corners.
  const hitX=s.x<R?0:s.x>100-R?100:null;
  const hitY=s.y<R?0:s.y>50-R?50:null;
  if(hitX!==null){s.x=2*(hitX===0?R:100-R)-s.x;s.vx*=-1;}
  if(hitY!==null){s.y=2*(hitY===0?R:50-R)-s.y;s.vy*=-1;}
  if(wallBoost&&(hitX!==null||hitY!==null)){
    wallBoost.stacks=Math.min(wallBoost.maxStacks,wallBoost.stacks+1);
    const ratio=movementSpeed(unit,now)/speed;
    s.vx*=ratio;s.vy*=ratio;
    m.flashes.push({art:wallBoost.art,x:hitX??s.x,y:hitY??s.y,time:m.t});
  }
}
const areaSkills=new Set(['dominio','despertar','nichirin','freeza-boss','ginyu']);
const meleeSkills=new Set(['furia','instinto','bodisatva','shunko','excalibur','rush','yamcha','reescrita','benihime']);
const thirdKits={
 m3_ace:{wind:.22,speed:91,range:56,radius:2.7,art:'hiken',cd:8},
 m3_genos:{wind:.36,speed:151,range:68,radius:2.2,art:'incinerador',cd:9},
 m3_kakashi:{wind:.16,speed:105,range:53,radius:1.5,art:'kamui',cd:9},
 m3_maki:{wind:.13,speed:124,range:38,radius:1.8,art:'alma',cd:8},
 m3_bat:{wind:.24,speed:99,range:39,radius:2.6,art:'taco',cd:8},
 m3_vash:{wind:.12,speed:158,range:65,radius:1,art:'desarme',cd:8},
 m3_biscuit:{wind:.16,speed:110,range:35,radius:1.8,art:'biscuit_golpe',cd:9},
 m3_flash:{wind:.11,speed:162,range:55,radius:2,art:'flash',cd:8},
 m3_elizabeth:{wind:.18,speed:105,range:42,radius:1.8,art:'luz_pulso',cd:9},
 m3_chrollo:{wind:.22,speed:109,range:57,radius:2,art:'livro',cd:8}
};
function thirdCast(m,f,v,role){
 const c=m.combat,bench=role==='reserva',a=m.sides[f.side],b=m.sides[v.side],ally=a.team[a.slot],k=thirdKits[f.kind];
 if(f.skillReady>c.time)return;
 const guard=f.kind==='m3_kakashi';
 const healer=f.kind==='m3_elizabeth'||f.kind==='m3_biscuit';
 const target=bench?ally:a.team.filter(u=>c.present(u)).sort((u,w)=>u.hp/u.maxHp-w.hp/w.maxHp)[0];
 const needsHeal=healer&&(target.hp<target.maxHp||(bench&&f.kind==='m3_elizabeth'&&negativeKeys(target,c.time).length));
 const ritual=guard||(healer&&(needsHeal||bench));
 if(healer&&bench&&!needsHeal)return;
 if(!ritual&&Math.hypot(b.x-a.x,b.y-a.y)>k.range+R)return;
 const q={f,target:v,bench,at:m.t+k.wind,seen:new Set()};
 if(guard){
   if(ally.kamuiGuard?.until>m.t)return;
   ally.kamuiGuard={owner:f,bench,until:m.t+3};
 }else if(ritual){
   if(f.kind==='m3_elizabeth'){
     if(bench)cleanse(target,c.time,false);
     c.heal(target,f.magic*(bench?.85:1.25));mythFx(m,'asas_luz',a,19,0,.56);
     if(!bench&&c.mode==='equipe')for(const u of c.teams[f.side]){
       if(u!==target&&c.present(u)&&distance(u,target)<=20)c.heal(u,f.magic*.45);
     }
   }else{
     (m.cookies??=[]).push({f,target,count:4,next:m.t+.12,power:f.magic*(bench?.21:.29)});
   }
 }else{
   if(f.kind==='m3_chrollo'){
     q.copy=bench?v.m3LastCast:f.stolen;
     if(!bench&&q.copy)delete f.stolen;
   }
   if(f.kind==='m3_bat'){q.rage=bench?Math.floor((1-ally.hp/ally.maxHp)*5):(f.rage??0);if(!bench)f.rage=0}
   (m.secondMoves??=[]).push(q);
 }
 f.skillReady=c.time+k.cd*1000;
 if(!bench)f.actions++;
 c.record('especial',f,v,{name:f.skill,role});
}
function thirdImpact(m,q,v){
 const {f,bench}=q,c=m.combat,b=m.sides[v.side],before=v.hp,shield=v.shield;
 const kind=f.kind;
 let attack;
 switch(kind){
 case 'm3_ace': attack={magic:true,damage:f.magic*(bench?.95:1.48)};break;
 case 'm3_genos': attack={magic:true,damage:f.magic*(bench?1.0:1.36)};break;
 case 'm3_kakashi': attack={magic:true,damage:f.magic*.95};break;
 case 'm3_maki': attack={damage:f.attack*(bench?.9:1.40),ignoreDefense:.40};break;
 case 'm3_bat': attack={damage:f.attack*((bench?.85:1.25)+.16*q.rage)};break;
 case 'm3_vash': attack={damage:f.attack*(bench?.65:.90),ignoreDefense:.15};break;
 case 'm3_biscuit': attack={damage:f.attack*1.15};break;
 case 'm3_flash': attack={damage:f.attack*(bench?.80:1.45),skipIntercept:!bench&&!f.flashUsed};f.flashUsed=true;break;
 case 'm3_elizabeth': attack={damage:f.magic*.80,magic:true};break;
 case 'm3_chrollo': attack=q.copy?{damage:Math.min(q.copy.damage*(bench?.60:.75),f.magic*1.75),magic:q.copy.magic,echo:true}:{damage:f.magic*.95,magic:true,echo:true};break;
 }
 const start=c.log.length;
 c.hit(f,v,{...attack,projectile:!['m3_maki','m3_flash','m3_bat','m3_biscuit'].includes(kind)});
 if(!c.log.slice(start).some(e=>e.type==='dano'&&e.actor===f.id&&e.target===v.id))return;
 if(v.shield<shield)mythFx(m,'bloqueio',b,12);
 if(v.hp<before)mythFx(m,'contato',b,8);
 if(!c.present(v))return;
 if(kind==='m3_maki')applyNegative(v,'soulWound',c.time+5000);
 if(kind==='m3_flash'){
   m.secondMoves.filter(s=>s.f===v&&s.angle==null&&s!==q).forEach(s=>{s.cancelled=true});
   delete b.ignition;
 }
 if(kind==='m3_vash'){
   if(!bench){
     m.secondMoves.filter(s=>s.f===v&&s.angle==null&&s!==q).forEach(s=>{s.cancelled=true});
     delete b.ignition;
     applyNegative(v,'disarmed',c.time+4000);
   }else if(Number.isFinite(v.ready))v.ready=Math.max(m.t,v.ready)+1;
 }
 const burns=['brasa_ace','calor_genos','dot_fogo','dot_chamas_azuis','dot_chamas_negras'];
 const burn=[...(v.dots?.values()??[])].find(s=>burns.includes(s.key));
 if(kind==='m3_ace'&&v.hp<before){
   if(burn&&!burn.rekindled){burn.count+=bench?1:2;burn.rekindled=true;burn.lastTick=m.t;}
   else if(!burn&&!bench)applyDot(m,f,v,'brasa_ace',f.magic*.11,.55,3);
 }
 if(kind==='m3_genos'&&v.hp<before){
   if(burn&&!bench){f.skillReady=Math.max(c.time,f.skillReady-2000);f.ready=Math.min(f.ready,f.skillReady/1000)}
   else if(!burn)applyDot(m,f,v,'calor_genos',f.magic*.13,.45,3);
 }
}
function thirdIntercept(m,source,victim,attack){
 const guard=victim.kamuiGuard;
 if(!attack.projectile||attack.reflected||!guard||guard.until<m.t||!m.combat.alive(guard.owner))return false;
 delete victim.kamuiGuard;
 const a=m.sides[victim.side],b=m.sides[source.side],f=guard.owner;
 mythFx(m,'kamui',a,20,0,.40);
 if(!guard.bench&&m.combat.present(source)){
   const angle=Math.atan2(b.y-a.y,b.x-a.x);
   (m.kamuiReturns??=[]).push({f,target:source,bench:false,angle,x:a.x,y:a.y,left:53,seen:new Set()});
 }
 m.combat.record('kamui',f,source);return true;
}
function thirdTicks(m){
 m.cookies=(m.cookies??[]).filter(e=>{
   if(!m.combat.present(e.target))return false;
   if(m.t<e.next-1e-8)return true;
   m.combat.heal(e.target,e.power);e.next+=.5;e.count--;
   mythFx(m,'cookie',m.sides[e.target.side],13,0,.40);
   return e.count>0;
 });
}

const secondKits={
 ...thirdKits,
 m2_frieren:{wind:.25,speed:112,range:60,radius:1.15,art:'zoltraak',factor:1.4,assist:.8,cd:9},
 m2_yami:{wind:.27,speed:94,range:68,radius:2.4,art:'fenda',factor:1.6,assist:.9,cd:9},
 m2_toji:{wind:.14,speed:118,range:46,radius:2,art:'lanca',factor:1.45,assist:.8,cd:8},
 m2_hisoka:{wind:.14,speed:96,range:50,radius:1,art:'goma',factor:.35,assist:.25,cd:8}
};
function secondCast(m,f,target,role){
 const k=secondKits[f.kind],c=m.combat,bench=role==='reserva',a=m.sides[f.side],b=m.sides[target.side];
 if(f.skillReady>c.time||Math.hypot(a.x-b.x,a.y-b.y)>k.range+R)return;
 (m.secondMoves??=[]).push({f,target,bench,at:m.t+k.wind,seen:new Set()});
 f.skillReady=c.time+k.cd*1000;if(!bench)f.actions++;
 c.record('especial',f,target,{name:f.skill,role});
}
function pullGum(m,t){
 const a=m.sides[t.f.side],b=m.sides[t.v.side],dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy);
 const n=Math.min(22,Math.max(0,d-2*R));if(d){b.x+=dx*n/d;b.y+=dy*n/d}
 mythFx(m,'goma_estalo',b,13);
 if(!t.bench)mythStrike(m,t.f,t.v,{damage:t.f.attack*.95},b);
}
function secondImpact(m,q,v){
 if(thirdKits[q.f.kind])return thirdImpact(m,q,v);
 const c=m.combat,k=secondKits[q.f.kind],f=q.f,b=m.sides[v.side],shield=v.shield,hp=v.hp,log=c.log.length;
 const magic=f.kind==='m2_frieren',factor=q.repeat?.72:q.bench?k.assist:k.factor;
 c.hit(f,v,{magic,projectile:f.kind!=='m2_toji',damage:(magic?f.magic:f.attack)*factor,shieldMultiplier:magic?2:1,
   pierceFirst:f.kind==='m2_yami',inverted:f.kind==='m2_toji',removeShield:f.kind==='m2_toji'&&shield>0});
 const landed=c.log.slice(log).some(e=>e.actor===f.id&&e.target===v.id&&e.type==='dano');
 if(!landed)return;
 if(v.shield<shield)mythFx(m,'bloqueio',b,12);
 if(v.hp<hp)mythFx(m,'contato',b,8);
 if(magic&&!q.repeat&&!q.bench){
   m.secondNext.push({f,target:v,bench:false,repeat:true,seen:new Set(),at:m.t+(shield>0&&v.shield===0 ? .12:.85)});
 }
 if(f.kind==='m2_hisoka'&&shield===0&&c.alive(v)){
  const a=m.sides[f.side],t={f,v,bench:q.bench,dist:Math.hypot(b.x-a.x,b.y-a.y),dodges:v.gumDodges||0,end:m.t+4};
  if(q.bench)pullGum(m,t);else m.gums.push(t);
 }
}
function secondStep(m,previous){
 const c=m.combat;m.secondNext=[];m.gums??=[];
 if(m.kamuiReturns?.length){(m.secondMoves??=[]).push(...m.kamuiReturns);m.kamuiReturns=[];}
 m.secondMoves=(m.secondMoves||[]).filter(q=>{
  const f=q.f,k=secondKits[f.kind],a=m.sides[f.side],b=m.sides[1-f.side],v=b.team[b.slot];
  if(q.cancelled||!c.alive(f)||!v||!c.present(v))return false;
  if(q.angle==null){
   if(c.blocked(f)||(!q.bench&&!c.present(f))||q.target!==v)return false;
   if(m.t+1e-8<q.at)return true;
   const angle=Math.atan2(b.y-a.y,b.x-a.x);
   q.angle=angle;q.x=a.x;q.y=a.y;q.left=k.range;
   standActivity(c,f);standActivity(c,v);
  }
  const ux=Math.cos(q.angle),uy=Math.sin(q.angle),dash=['m2_toji','m3_flash','m3_maki'].includes(f.kind)&&!q.bench,edge=dash?R:0;
  const n=Math.max(0,Math.min(q.left,k.speed*DT,ux>0?(100-edge-q.x)/ux:ux<0?(edge-q.x)/ux:Infinity,uy>0?(50-edge-q.y)/uy:uy<0?(edge-q.y)/uy:Infinity));
  const [ox,oy]=previous[v.side];
  const hit=!q.seen.has(v.id)&&traceHit(q.x-ox,q.y-oy,n*ux-(b.x-ox),n*uy-(b.y-oy),R+k.radius);
  q.x+=ux*n;q.y+=uy*n;q.left-=n;
  if(dash){a.x=q.x;a.y=q.y;a.vx=ux*32;a.vy=uy*32}
  if(hit){
   q.seen.add(v.id);if(dash)m.contact=Math.max(m.contact,m.t+.45);secondImpact(m,q,v);
   if(f.kind!=='m2_yami')return false;
  }
  return n>=k.speed*DT-1e-8&&q.left>1e-8;
 });
 m.secondMoves.push(...m.secondNext);
 m.gums=m.gums.filter(t=>{
  if(m.t>=t.end||!c.present(t.v)||!c.alive(t.f))return false;
  const a=m.sides[t.f.side],b=m.sides[t.v.side];
  if((t.v.gumDodges||0)>t.dodges||Math.hypot(b.x-a.x,b.y-a.y)>=t.dist+10){pullGum(m,t);return false}
  return true;
 });
}
const mythKinds=new Set(['m_minato','m_byakuya','m_bang','m_josuke']);
function standActivity(c,u){
 if(u.kind==='m_josuke'){
   u.quietUntil=c.time+5000;u.restoreLeft=0;
 }
}
function josukeStep(m,u){
 const c=m.combat,s=m.sides[u.side];
 if(c.blocked(u)){u.restoreLeft=0;return}
 if(u.quietUntil==null)u.quietUntil=c.time+5000-Math.round(DT*1000);
 if(c.time>=u.quietUntil && u.hp<u.maxHp&&!u.punchesLeft){
   u.restoreLeft=6;u.restoreNext=c.time;u.quietUntil=c.time+6000;
   announce(m,u,'Crazy Diamond · restauração','principal');
 }
 if(u.restoreLeft>0 && c.time>=u.restoreNext){
   u.standUntil=m.t+.16;c.heal(u,u.maxHp*.04);u.restoreLeft--;u.restoreNext+=90;
   mythFx(m,'punhos',s,13,(u.restoreLeft%2?1:-1)*.25,.09);
 }
}
function waterRun(m,f,v,bench,react){
 const s=m.sides[f.side];
 m.waterRuns=(m.waterRuns||[]).filter(q=>q.f!==f);
 m.waterRuns.push({f,v,bench,react,x:s.x,y:s.y,born:m.t,distance:0});
}
function waterStep(m,prev){
 m.waterRuns=(m.waterRuns||[]).filter(run=>{
   const {f,v,bench,react}=run,c=m.combat,s=m.sides[f.side],o=m.sides[v.side];
   if(!c.alive(f)||(!bench&&!c.present(f))||c.blocked(f)||!c.present(v))return false;
   if(run.angle==null){
     if(!bench){run.x=s.x;run.y=s.y}
     if(m.t-run.born<(react?.08:.2))return true;
     const dx=o.x-run.x,dy=o.y-run.y,closing=o.vx*dx+o.vy*dy;
     const gap=108*108-o.vx*o.vx-o.vy*o.vy;
     const lead=Math.min(.5,(closing+Math.sqrt(closing*closing+gap*(dx*dx+dy*dy)))/gap);
     const reflect=(n,max)=>n<R?2*R-n:n>max-R?2*(max-R)-n:n;
     run.angle=Math.atan2(reflect(o.y+lead*o.vy,50)-run.y,reflect(o.x+lead*o.vx,100)-run.x);
   }
   const x=run.x,y=run.y,dx=Math.cos(run.angle),dy=Math.sin(run.angle);
   const length=Math.min(1.8,65-run.distance,dx>0?(96-x)/dx:dx<0?(4-x)/dx:Infinity,dy>0?(46-y)/dy:dy<0?(4-y)/dy:Infinity);
   run.x+=dx*length;run.y+=dy*length;run.distance+=length;
   if(!bench){s.x=run.x;s.y=run.y;s.vx=dx*32;s.vy=dy*32}
   const [ox,oy]=prev[v.side];
   if(traceHit(x-ox,y-oy,dx*length-(o.x-ox),dy*length-(o.y-oy),2*R)){
     if(!bench)m.contact=Math.max(m.contact,m.t+.45);
     mythStrike(m,f,v,{damage:f.attack*(react?(bench?.85:1.35):1.10),counter:react},o);return false;
   }
   return length>=1.8&&run.distance<65;
 });
}

function mythFx(m,key,pos,size,angle=0,duration=.32){
 (m.mythFx??=[]).push({key,pos,size,angle,start:m.t,duration});
}
function mythStrike(m,f,v,a,pos){
 const hp=v.hp,shield=v.shield;
 m.combat.hit(f,v,a);
 if(v.shield<shield)mythFx(m,'bloqueio',pos,12);
 if(v.hp<hp)mythFx(m,'contato',pos,9);
}
function mythCast(m,f,v,role){
 const c=m.combat,own=m.sides[f.side],other=m.sides[v.side],ally=own.team[own.slot],bench=role==='reserva';
 if(f.skillReady>c.time)return;
 const angle=Math.atan2(other.y-own.y,other.x-own.x);
 if(f.kind==='m_minato'){
   const mark=f.mark;
   if(!bench&&!mark){
     f.mark={born:m.t,fromX:own.x,fromY:own.y,x:Math.max(R,Math.min(100-R,other.x+5*Math.cos(angle))),y:Math.max(R,Math.min(50-R,other.y+5*Math.sin(angle))),target:v.id,angle};
   }else{
     const point=bench?{x:Math.max(R,Math.min(100-R,other.x+5*Math.cos(angle))),y:Math.max(R,Math.min(50-R,other.y+5*Math.sin(angle)))}:mark;
     if(!bench){mythFx(m,'salto',{x:own.x,y:own.y},13);own.x=point.x;own.y=point.y;f.mark=null}
     mythFx(m,'salto',point,14);
     if((bench||mark.target===v.id)&&Math.hypot(other.x-point.x,other.y-point.y)<=2*R)mythStrike(m,f,v,{damage:f.attack*(bench?.8:1.5)},other);
   }
 }else if(f.kind==='m_byakuya'){
   if(!bench&&Math.hypot(other.x-own.x,other.y-own.y)>32)return;
   if(bench){v.petalTrap={f,end:c.time+5000};}
   else (m.petals??=[]).push({f,v,x:other.x,y:other.y,born:m.t});
 }else if(f.kind==='m_bang'){
   if(bench&&ally.waterGuard?.end>c.time)return;
   ally.waterGuard={f,bench,end:c.time+3000};mythFx(m,'agua',own,14);
   if(!bench)waterRun(m,f,v,false,false);
 }else{
   const target=bench?ally:own.team.filter(u=>u!==f&&c.alive(u)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
   if(!target)return;
   const loss=target.mythLoss;
   const repair=loss&&c.time-loss.time<=4000?loss.amount*.5:0;
   if(target.hp>=target.maxHp&&!repair)return;
   c.heal(target,f.magic*(bench?.65:1));mythFx(m,'punhos',own,16);
   if(repair){grantShield(target,target.shield+repair);target.mythLoss=null;mythFx(m,'reparo',own,15)}
 }
 f.skillReady=c.time+(f.kind==='m_minato'&&f.mark?2000:f.kind==='m_byakuya'&&!bench?10000:8000);
 c.record('especial',f,v,{name:f.skill,role});announce(m,f,f.skill,role);if(!bench)f.actions++;
}
function mythStep(m){
 m.mythFx=(m.mythFx||[]).filter(e=>m.t-e.start<e.duration);
 m.petals=(m.petals||[]).filter(p=>{
   if(m.t-p.born<.35)return true;
   const side=m.sides[p.v.side];
   if(m.combat.present(p.v)&&Math.hypot(side.x-p.x,side.y-p.y)<=10+R)
      mythStrike(m,p.f,p.v,{damage:p.f.magic*1.45,magic:true,petals:true},side);
   return false;
 });
}

/* Nexus · regras dos Divinos. Tempo da simulação em segundos, recargas em ms. */
const divineIds = new Set(['div_king','div_licht','div_netero','div_mereoleona','div_android17']);
const divineBalance = {
  king:{cd:8000, benchCd:8000, low:.40, shield:1.35, lowShield:1.85, lance:1.50, basic:.65, assist:.90},
  licht:{cd:9000, benchCd:9000, window:3.5, absorb:.60, benchAbsorb:.45, radius:13},
  netero:{cd:7000, benchCd:8000, palm:.65, extra:2, normal:3, assist:.85},
  mereoleona:{cd:8000, benchCd:8000, heat:3, heatRange:12, punch:.55, punches:4, assist:.40},
  android17:{cd:9000, benchCd:9000, self:1.8, ally:1, breakRefund:2500, duration:5}
};
function divinePosition(m,u){
  const side=m.sides[u.side];
  if(side.team[side.slot]===u)return side;
  if(m.combat.mode==='equipe'&&Number.isFinite(u.x)&&Number.isFinite(u.y))return u;
  return null;
}
function divineFx(m,art,pos,duration=.32,size=16,angle=0,follow=null){
  const {x,y}=pos;
  (m.divineFx??=[]).push({art,x,y,born:m.t,duration,size,angle,follow});
}
function divineAim(a,b){return Math.atan2(b.y-a.y,b.x-a.x)}
function divineCover(m,owner,unit,amount){
  if(unit.divineShield?.amount>=amount&&unit.divineShield.until>m.t)return;
  if(unit.sageBless){unit.sageBless=false;amount*=1.5}
  if(unit.crackedShield){unit.crackedShield=false;amount*=.5}
  unit.divineShield={amount,until:m.t+divineBalance.android17.duration,owner};
  divineFx(m,'barreira_ativa',divinePosition(m,unit),.28,15,0,unit);
  m.combat.record('protege',owner,unit,{shield:amount});
}
function divineJob(m,job){(m.divineJobs??=[]).push(job)}
function divineRay(m,owner,origin,target,art,payload,range=45){
  const angle=divineAim(origin,target);
  (m.divineRays??=[]).push({owner,art,angle,x:origin.x,y:origin.y,left:range,attack:payload});
}
function divineCast(m,f,enemy,role){
  const c=m.combat,bench=role==='reserva',side=m.sides[f.side],ally=side.team[side.slot],other=m.sides[enemy.side];
  const key={div_king:'king',div_licht:'licht',div_netero:'netero',div_mereoleona:'mereoleona',div_android17:'android17'}[f.kind];
  const cfg=divineBalance[key],readyKey=bench?'divineBenchReady':'skillReady';
  if(f[readyKey]>c.time)return false;
  const d=Math.hypot(other.x-side.x,other.y-side.y);
  if(key==='king'){
    const nearby=side.team.filter(u=>c.present(u)&&divinePosition(m,u)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp);
    const protect=bench?ally.hp/ally.maxHp<=cfg.low:!!f.divinePlant;
    if(protect){
      const unit=bench?ally:nearby[0];
      grantShield(unit,f.magic*(unit.hp/unit.maxHp<=cfg.low?cfg.lowShield:cfg.shield));
      unit.divineGarden=true;
      divineFx(m,'jardim',divinePosition(m,unit),.64,17,0,unit);
      c.record('protege',f,unit);
    }else{
      if(d>49)return false;
      divineJob(m,{kind:'lance',f,target:enemy,at:m.t+.23,ratio:bench?cfg.assist:cfg.lance});
      divineFx(m,'invoca_lanca',side,.23,14,divineAim(side,other),ally);
    }
    if(!bench)f.divinePlant=!protect;
  }else if(key==='licht'){
    if(ally.absorbSword?.until>m.t)return false;
    ally.absorbSword={f,until:m.t+cfg.window,bench};
  }else if(key==='netero'){
    if(bench){
      if(ally.palmGuard?.until>m.t)return false;
      ally.palmGuard={f,until:m.t+3.5};
    }else{
      if(d>56)return false;
      const prayer={at:m.t+.42,kind:'prayer',f,target:enemy,pressured:false};
      f.divinePrayer=prayer;
      divineJob(m,prayer);
    }
  }else if(key==='mereoleona'){
    if(d>(bench?28:24)||(!bench&&(f.divineHeat??0)<cfg.heat))return false;
    if(!bench)f.divineHeat=0;
    const count=bench?2:cfg.punches;
    for(let i=0;i<count;i++)divineJob(m,{kind:'fire',f,target:enemy,at:m.t+.12+i*.125,ratio:bench?cfg.assist:cfg.punch,bench,first:i===0,last:i===count-1});
  }else{
    for(const u of side.team){
      const pos=divinePosition(m,u);
      if(pos&&c.present(u)&&Math.hypot(pos.x-side.x,pos.y-side.y)<=18&&(!bench||u===ally))divineCover(m,f,u,f.defense*(u===f?cfg.self:cfg.ally));
    }
  }
  f[readyKey]=c.time+(bench?cfg.benchCd:cfg.cd);
  if(!bench)f.actions++;
  c.record('especial',f,enemy,{name:f.skill,role});
  return true;
}
function divineIntercept(m,source,victim,attack){
  const guard=victim.palmGuard;
  if(!guard||guard.until<m.t||!attack.dash||attack.reflected||!m.combat.alive(guard.f))return false;
  delete victim.palmGuard;
  const origin=divinePosition(m,victim),end=divinePosition(m,source);
  divineFx(m,'palma',origin,.30,17,end?divineAim(origin,end):0);
  m.combat.record('intercepta',guard.f,source);
  if(end)mythStrike(m,guard.f,source,{damage:guard.f.attack*divineBalance.netero.assist,counter:true},end);
  return true;
}
function divineMitigation(m,source,victim,attack,value){
  const pos=divinePosition(m,victim),c=m.combat;
  if(!pos||value<=0)return value;
  const guard=victim.absorbSword;
  if(guard?.until>m.t&&c.alive(guard.f)&&attack.magic&&attack.skill!==false&&!attack.reflected&&(!guard.bench||attack.projectile)){
    delete victim.absorbSword;
    const diverted=value*(guard.bench?divineBalance.licht.benchAbsorb:divineBalance.licht.absorb);
    value-=diverted;
    const to=divinePosition(m,source)??m.sides[source.side];
    const angle=divineAim(pos,to),dist=Math.min(13,Math.hypot(to.x-pos.x,to.y-pos.y));
    const center={x:pos.x+dist*Math.cos(angle),y:pos.y+dist*Math.sin(angle)};
    divineFx(m,'selo_absorcao',pos,.24,17,angle,victim);
    divineJob(m,{kind:'cut',f:guard.f,at:m.t+.22,center,angle,damage:diverted});
    c.record('absorve',guard.f,victim,{amount:diverted});
  }
  const barrier=victim.divineShield;
  if(barrier?.until>m.t&&!attack.pierceFirst){
    const multiplier=attack.shieldMultiplier??1;
    const spent=(attack.removeShield||attack.antiMagic)?barrier.amount:Math.min(barrier.amount,value*multiplier);
    barrier.amount-=spent;
    if(!attack.removeShield&&!attack.antiMagic)value-=spent/multiplier;
    divineFx(m,'barreira_ativa',pos,.16,15,0,victim);
    if(barrier.amount<=1e-8){
      delete victim.divineShield;
      victim.skillReady=Math.max(c.time,victim.skillReady-divineBalance.android17.breakRefund);
      if(Number.isFinite(victim.ready))victim.ready=Math.max(m.t,victim.ready-divineBalance.android17.breakRefund/1000);
      divineFx(m,'barreira_rompe',pos,.36,20);
      c.record('barreira rompe',barrier.owner,victim,{refund:divineBalance.android17.breakRefund});
    }
  }
  if(victim.divinePrayer&&attack.skill!==false)victim.divinePrayer.pressured=true;
  return Math.max(0,value);
}
function divineContact(m,source,victim,attack,hp,shield){
  if(source.kind!=='div_mereoleona'||attack.skill!==false||attack.area||attack.counter)return;
  const a=divinePosition(m,source),b=divinePosition(m,victim),cfg=divineBalance.mereoleona;
  if(a&&b&&(hp>0||shield>0)&&Math.hypot(a.x-b.x,a.y-b.y)<=cfg.heatRange){
    source.divineHeat=Math.min(cfg.heat,(source.divineHeat??0)+1);
    divineFx(m,'calor',a,.32,11+source.divineHeat,0,source);
  }
}
function divineStep(m,previous){
  const c=m.combat;
  m.divineFx=(m.divineFx??[]).filter(e=>m.t-e.born<e.duration);
  const pending=m.divineJobs??=[];
  m.divineJobs=[];
  for(const job of pending){
    if(job.at>m.t+1e-8){divineJob(m,job);continue}
    const {f,target,kind}=job;
    if(!c.alive(f))continue;
    if(kind==='cut'){
      divineFx(m,'corte_absorvido',job.center,.28,30,job.angle);
      for(const v of c.teams[1-f.side]){
        const p=divinePosition(m,v);
        if(p&&c.present(v)&&Math.hypot(p.x-job.center.x,p.y-job.center.y)<=divineBalance.licht.radius+R)
          mythStrike(m,f,v,{magic:true,area:true,echo:true,damage:job.damage},p);
      }
      continue;
    }
    const a=m.sides[f.side],b=target&&divinePosition(m,target);
    if(kind==='prayer')f.divinePrayer=null;
    if(!b||!c.present(target)||c.blocked(f))continue;
    if(kind==='lance'){
      divineRay(m,f,a,b,'chastiefol',{magic:true,damage:f.magic*job.ratio});
    }else if(kind==='prayer'){
      const cfg=divineBalance.netero,n=cfg.normal+(job.pressured?cfg.extra:0);
      for(let i=0;i<n;i++){
        const center={x:Math.max(R,Math.min(100-R,b.x+b.vx*.10)),y:Math.max(R,Math.min(50-R,b.y+b.vy*.10))};
        divineJob(m,{kind:'palm',f,target,center,at:m.t+.10+i*.14,i});
      }
    }else if(kind==='palm'){
      const angle=divineAim(a,job.center)+(job.i%2?.38:-.34);
      divineFx(m,'palma',job.center,.25,18,angle);
      if(Math.hypot(b.x-job.center.x,b.y-job.center.y)<=10+R)
        mythStrike(m,f,target,{damage:f.attack*divineBalance.netero.palm,ignoreDefense:job.i===2?.5:0},b);
    }else if(kind==='fire'){
      const angle=divineAim(a,b),reach=job.bench?26:22;
      divineFx(m,'calidus',{x:a.x+7*Math.cos(angle),y:a.y+7*Math.sin(angle)},.20,18,angle);
      if(Math.hypot(b.x-a.x,b.y-a.y)>reach)continue;
      const start=c.log.length;
      mythStrike(m,f,target,{damage:f.attack*job.ratio},b);
      if(!c.log.slice(start).some(e=>e.type==='dano'&&e.actor===f.id&&e.target===target.id&&e.hp>0))continue;
      if(job.bench&&job.first){
        const burn=[...(target.dots?.values()??[])].find(e=>['calidus_brasa','dot_fogo','dot_chamas_negras','dot_chamas_azuis'].includes(e.key));
        if(burn){burn.count++;burn.lastTick=m.t}
      }else if(!job.bench&&job.last)applyDot(m,f,target,'calidus_brasa',f.attack*.10,.50,3);
    }
  }
  m.divineRays=(m.divineRays??[]).filter(q=>{
    if(!c.alive(q.owner))return false;
    const side=m.sides[1-q.owner.side],target=side.team[side.slot];
    if(!target||!c.present(target))return false;
    const ux=Math.cos(q.angle),uy=Math.sin(q.angle);
    const wallX=ux>0?(100-q.x)/ux:ux<0?-q.x/ux:Infinity;
    const wallY=uy>0?(50-q.y)/uy:uy<0?-q.y/uy:Infinity;
    const length=Math.min(q.left,wallX,wallY,105*DT),[ox,oy]=previous[target.side];
    if(traceHit(q.x-ox,q.y-oy,length*ux-(side.x-ox),length*uy-(side.y-oy),R+1.2)){
      mythStrike(m,q.owner,target,{...q.attack,projectile:true},side);
      return false;
    }
    q.x+=length*ux;q.y+=length*uy;q.left-=length;
    return length>=105*DT-1e-8&&q.left>1e-8;
  });
}

const bossKits={
  boss_freeza:{name:'Raio da Morte',wind:.32,cooldown:12,speed:158,range:88,radius:1.1,ratio:.82},
  boss_arlong:{name:'Shark on Darts',wind:.24,cooldown:6,ratio:1.60},
  boss_gaara:{name:'Funeral do Deserto',wind:.72,cooldown:10,radius:13,ratio:1.20},
  boss_byakuya:{name:'Senbonzakura',wind:.45,cooldown:7,speed:94,range:62,radius:2.15,ratio:.55,shots:3,gap:.12}
};
const BOSS_FINISH_FX=.33;

function queueBossMove(m,f,enemy,role){
  if(role!=='principal')return;
  const kit=bossKits[f.kind],origin=m.sides[f.side],target=m.sides[enemy.side];
  const move={f,born:m.t,at:m.t+kit.wind,angle:Math.atan2(target.y-origin.y,target.x-origin.x),index:0};
  if(f.kind==='boss_gaara')move.zone={x:target.x,y:target.y,radius:kit.radius};
  (m.bossMoves??=[]).push(move);
  f.ready=m.t+kit.cooldown;
  f.skillReady=m.combat.time+kit.cooldown*1000;
  f.actions++;
  m.combat.record('especial',f,enemy,{name:kit.name,role});
}

function bossEffect(m,art,x,y,angle=0,radius){
  (m.bossFx??=[]).push({art,x,y,angle,radius,born:m.t});
}

function bossHit(m,f,target,attack,point,angle){
  const c=m.combat,first=c.log.length;
  c.hit(f,target,attack);
  if(c.log.slice(first).some(e=>e.type==='dano'&&e.actor===f.id&&e.target===target.id))
    bossEffect(m,f.kind+'_impact',point.x,point.y,angle);
}

function stepBossMoves(m){
  if(m.bossFx)m.bossFx=m.bossFx.filter(e=>m.t-e.born<BOSS_FINISH_FX);
  if(!m.bossMoves?.length)return;
  const c=m.combat;
  m.bossMoves=m.bossMoves.filter(move=>{
    const {f,zone}=move;
    if(!c.present(f)||c.blocked(f))return false;
    if(m.t+1e-8<move.at)return true;
    const origin=m.sides[f.side],other=m.sides[1-f.side],target=other.team[other.slot];
    if(!target||!c.present(target))return false;
    const kit=bossKits[f.kind];
    const angle=Math.atan2(other.y-origin.y,other.x-origin.x);
    if(f.kind==='boss_arlong'){
      origin.dash={art:'boss_arlong_dash',born:m.t,angle,attack:{damage:f.attack*kit.ratio}};
      return false;
    }
    if(zone){
      bossEffect(m,'boss_gaara_burst',zone.x,zone.y,0,zone.radius);
      if(Math.hypot(other.x-zone.x,other.y-zone.y)<=zone.radius+R)
        bossHit(m,f,target,{damage:f.magic*kit.ratio,magic:true,area:true},other,0);
      else note(m,kit.name+' · errou');
      return false;
    }
    const heading=angle+(kit.shots?(move.index-1)*Math.PI/24:0);
    const attack={damage:f.magic*kit.ratio,magic:true,projectile:true};
    target.lastOffense={...attack};
    m.shots.push({kind:'bossShot',f,side:f.side,born:m.t,angle:heading,x:origin.x+R*Math.cos(heading),
      y:origin.y+R*Math.sin(heading),left:kit.range,speed:kit.speed,radius:kit.radius,attack});
    if(++move.index>=(kit.shots??1))return false;
    move.at+=kit.gap;
    return true;
  });
}

function stepBossShot(m,s,target,other,previous){
  const ux=Math.cos(s.angle),uy=Math.sin(s.angle);
  if(s.x<0||s.x>100||s.y<0||s.y>50)return false;
  const wallX=ux>0?(100-s.x)/ux:ux<0?-s.x/ux:Infinity;
  const wallY=uy>0?(50-s.y)/uy:uy<0?-s.y/uy:Infinity;
  const distance=Math.min(s.left,s.speed*DT,wallX,wallY);
  const fraction=distance/(s.speed*DT);
  const [ox,oy]=previous[1-s.side],vx=(other.x-ox)*fraction,vy=(other.y-oy)*fraction;
  const rx=s.x-ox,ry=s.y-oy,dx=ux*distance-vx,dy=uy*distance-vy;
  const a=dx*dx+dy*dy,b=rx*dx+ry*dy,c=rx*rx+ry*ry-(R+s.radius)**2,disc=b*b-a*c;
  const t=c<=0?0:a>0&&disc>=0?(-b-Math.sqrt(disc))/a:Infinity;
  if(t>=0&&t<=1){
    const nx=rx+t*dx,ny=ry+t*dy,len=Math.hypot(nx,ny)||1;
    bossHit(m,s.f,target,s.attack,{x:ox+t*vx+R*nx/len,y:oy+t*vy+R*ny/len},s.angle);
    return false;
  }
  s.x+=distance*ux;s.y+=distance*uy;s.left-=distance;
  if(distance>=s.speed*DT-1e-8&&s.left>1e-8)return true;
  note(m,s.f.skill+' · errou');
  return false;
}

function arenaCast(m,f,enemy,role){
  if(bossKits[f.kind])return queueBossMove(m,f,enemy,role);
  if(divineIds.has(f.kind))return divineCast(m,f,enemy,role);
  if(thirdKits[f.kind])return thirdCast(m,f,enemy,role);
  if(secondKits[f.kind])return secondCast(m,f,enemy,role);
  if(mythKinds.has(f.kind))return mythCast(m,f,enemy,role);
  const origin=m.sides[f.side],other=m.sides[1-f.side];
  const actionId=(m.secretSeq=(m.secretSeq??0)+1);
  let shot, ceroIndex=0;
  const launch=(target,attack)=>{
    standActivity(m.combat,f);standActivity(m.combat,target);
    if(attack.skill!==false)attack.secretCast??=actionId;
    if(attack.skill!==false)target.lastOffense={...attack,damage:attack.damage??f.attack};
    if(attack.skill!==false && ['santuario','dominio'].includes(f.kind)){
      if(!shot){
        shot={kind:f.kind,f,side:f.side,born:m.t,x:origin.x,y:origin.y,radius:f.kind==='dominio'?25.5:22,attack,pulse:0};
        if(f.kind==='santuario'&&role==='reserva'){shot.x=other.x;shot.y=other.y;shot.radius=14;shot.short=true}
        m.shots.push(shot);
      }
      return true;
    }
    if(f.kind==='reescrita'&&attack.skill!==false){
      origin.ignition={born:m.t,attack};return true;
    }
    if(attack.skill!==false && f.kind==='beerus'){
      fireBatch(m,f,'beerus_hakai',attack,110,65);
      return true;
    }
    if(f.kind==='tremor'&&attack.area){
      const angle=Math.atan2(other.y-origin.y,other.x-origin.x);
      const q={kind:'tremor',f,side:f.side,x:origin.x+R*Math.cos(angle),y:origin.y+R*Math.sin(angle),born:m.t,angle,attack,struck:new Set(),support:role==='reserva'};
      m.shots.push(q);

      return true;
    }
    if(f.kind==='saitama' && attack.skill!==false){
      fireBatch(m,f,'saitama_soco',attack,30,108);return true;
    }
    if(f.kind==='rei'&&attack.partialPierce){fireBatch(m,f,'roger_corte_apoio',attack,30,90);return true}
    if(f.kind==='rei' && attack.pierceFirst){
      origin.dash={angle:Math.atan2(other.y-origin.y,other.x-origin.x),born:m.t,attack};
      return true;
    }
    if(f.kind==='metralleta' && attack.skill!==false){
      const spread=[-3,0,3][ceroIndex++]*Math.PI/180;
      const angle=Math.atan2(other.y-origin.y,other.x-origin.x)+spread;
      m.shots.push({kind:'cero',f,side:f.side,x:origin.x+R*Math.cos(angle),
        y:origin.y+R*Math.sin(angle),angle,born:m.t,attacks:[attack],radius:.32,range:120,speed:78});
      return true;
    }
    if(!shot){
      const kind=f.kind==='room'?'room':areaSkills.has(f.kind)?'zone':meleeSkills.has(f.kind)?'blade':'bolt';
      const angle=Math.atan2(other.y-origin.y,other.x-origin.x);
      shot={kind,f,side:f.side,x:origin.x,y:origin.y,angle,born:m.t,attacks:[],
        radius:kind==='room'?ROOM:kind==='zone'?23:kind==='blade'?3:2,
        range:kind==='blade'?25:110,speed:kind==='blade'?90:78};
      m.shots.push(shot);
    }
    shot.attacks.push(attack);
    return true;
  };
  const logStart=m.combat.log.length;
  const fromThird=['simon','meruem_rei','sailor','lucius'].includes(f.kind);
  const fourth=['madoka','yhwach','giorno','meliodas_v'].includes(f.kind);
  const secret=['yamamoto','johnny','ichigo','aizen','benimaru','veldora','luminous','anos','vegeta_blue','kaido_dragon','tetsuo','mob','shanks_imperador','broly_furia','blast_portais','luffy_gear5','pucci_mih','asta_union','madara_jubi','yuno_stars'].includes(f.kind);
  const fifth=['rei_demonios','rimuru','garou','accelerator','hagoromo'].includes(f.kind);
  m.combat.reserveHealing=role==='reserva';
  const used=secret?castSecret(m,f,role):fifth?castFifth(m,f,enemy,role):fourth?castFourth(m,f,enemy,role):fromThird?castThird(m,f,enemy,role):m.combat.use(f,enemy,f.kind,role,launch);
  m.combat.reserveHealing=false;
  if((secret||fromThird||fourth||fifth) && used)m.combat.record('especial',f,enemy,{name:f.skill,role});
  if(used && f.kind==='kaguya')m.flashes.push({art:'kaguya_fenda',x:origin.x,y:origin.y,time:m.t});
  if(used && f.kind==='reescrita' && m.combat.log.slice(logStart).some(e=>e.type==='cura')){
    const event=m.combat.log.slice(logStart).find(e=>e.type==='cura');
    const side=Number(event.actor.split(':')[0]);
    m.flashes.push({art:'shinra_cura',follow:side,time:m.t});
  }
  if(used && role==='principal'){
    f.actions++;
    if(origin.slashSupport){fireBatch(m,origin.slashSupport,'ichigo_segunda',{damage:origin.slashSupport.attack},65,94);origin.slashSupport=null}
  }
  if(!used&&role==='principal'&&!fromThird&&!fourth&&!fifth&&!secret&&m.combat.pace(f)<1){
    // Accelerated basic attacks also need a spatial hit.
    launch(enemy,{skill:false,magic:f.magicBasic,damage:f.magicBasic?f.magic:f.attack});
    shot.kind=f.magicBasic?'bolt':'blade';shot.radius=f.magicBasic?2:3;
    shot.speed=f.magicBasic?78:90;shot.range=f.magicBasic?110:25;shot.basic=true;
  }
}
function negativeKeys(unit,time){
  return [...(unit.dots?.keys()??[]),...['attackDownUntil','weakenUntil','stunUntil','exposedUntil','disarmed','soulWound'].filter(k=>unit[k]>time),...(unit.crackedShield?['crackedShield']:[])];
}
function interceptNegative(unit,key){
  if(!unit.cleanSeal?.has(key))return false;
  unit.cleanSeal=null;return true;
}
function applyNegative(unit,key,value){
  const c=combatOf.get(unit),t=c?.time??0;
  const stunned=key==='stunUntil';
  if(interceptNegative(unit,key)||(stunned&&unit.freedomUntil>t)){
    if(stunned)unit.controlResistedAt=t;
    return;
  }
  if(stunned&&c&&c.present(unit)){
    if(unit.kind==='tetsuo'&&(unit.controlGuardReady??0)<=t){
      unit.controlGuardReady=t+5000;
      unit.psychicStacks=Math.min(3,(unit.psychicStacks??0)+1);
      unit.controlResistedAt=t;
      c.record('pressão psíquica',unit);
      return;
    }
    if(unit.mobWardUntil>t){
      unit.mobWardUntil=0;unit.controlResistedAt=t;
      c.record('controle repelido',unit);return;
    }
  }
  const primary=unit.kind==='rei_demonios'&&(unit.rulerReady??0)<=t;
  const support=unit.rulerSupport&&['attackDownUntil','weakenUntil'].includes(key);
  if(c&&(primary||support)&&['attackDownUntil','weakenUntil','stunUntil','exposedUntil','crackedShield'].includes(key)){
    if(key==='weakenUntil')unit.invertedAttackUntil=value;
    if(key==='attackDownUntil')unit.royalAttackUntil=value;
    if(key==='exposedUntil')unit.invertedExposureUntil=value;
    if(key==='stunUntil'){unit.freedomUntil=value;unit.controlResistedAt=t;}
    if(key==='crackedShield')unit.invertedShield=true;
    unit.inversionAt=t;
    if(primary){
      unit.rulerReady=t+12000;
      for(const ally of c.teams[unit.side])if(c.present(ally)&&(ally===unit||distance(ally,unit)<=18))ally.royalWardUntil=t+4000;
    }else unit.rulerSupport=false;
    c.record('inverte',unit,undefined,{key});return;
  }
  unit[key]=value;
}
function cleanse(unit,time,seal){
  const keys=negativeKeys(unit,time);
  for(const k of keys){if(unit.dots?.has(k))unit.dots.delete(k);else unit[k]=0}
  if(seal&&keys.length)unit.cleanSeal=new Set(keys);
  return keys.length;
}
function grantShield(unit,amount){
  if(unit.sageBless){unit.sageBless=false;amount*=1.5}
  if(unit.invertedShield){unit.invertedShield=false;amount*=1.5}
  if(unit.crackedShield){amount*=.5;unit.crackedShield=false}
  unit.shield=Math.max(unit.shield,amount);
}
function spendLostAction(m,f){
  if(!f.loseAction)return false;
  f.loseAction=false;note(m,f.name+' · ação anulada');return true;
}
function castSecret(m,f,role){
  const side=m.sides[f.side],ally=side.team[side.slot],now=m.combat.time,bench=role==='reserva';
  if((bench?f.secretBenchReady:f.skillReady)>now)return false;
  if(secretSecondCooldowns[f.kind])
    return castSecretSecond(m,f,ally,bench);
  if(bench){
    if(f.kind==='yamamoto'){side.burnBoost=true;m.flashes.push({art:'yamamoto_calor',follow:f.side,time:m.t})}
    if(f.kind==='johnny')side.nailSupport=f;
    if(f.kind==='ichigo')side.slashSupport=f;
    if(f.kind==='aizen')ally.illusionBench=f;
    f.secretBenchReady=now+8000;return true;
  }
  const castId=(m.secretSeq=(m.secretSeq??0)+1);
  if(f.kind==='yamamoto'){f.heatUntil=now+1200;f.heatCast=castId}
  if(f.kind==='johnny')fireBatch(m,f,'johnny_disparo',{damage:f.magic*.85,magic:true,nail:true,secretCast:castId},100,90);
  if(f.kind==='ichigo'){
    const pair={broken:null};fireBatch(m,f,'ichigo_primeira',{damage:f.attack,first:pair,secretCast:castId},85,100);
    f.nextWave={at:now+180,pair,id:castId};
  }
  if(f.kind==='aizen'){
    f.illusionUntil=now+4000;
    spawnMirage(m,f,side,1.20,castId);
    f.illusionCast=castId;
  }
  f.skillReady=now+8000;return true;
}
function castFifth(m,f,enemy,role){
  const c=m.combat,side=m.sides[f.side],ally=side.team[side.slot],bench=role==='reserva';
  if(f.kind==='rei_demonios'){
    if(bench){if(ally.rulerSupport||(f.benchRulerReady??0)>c.time)return false;ally.rulerSupport=true;f.benchRulerReady=c.time+12000}
    else if((f.rulerReady??0)>c.time)return false;
    return true;
  }
  if(f.kind==='accelerator'){
    const pool=c.vectorPool?.[f.side];if(pool&&pool.ready>c.time)return false;
    if(bench)ally.vectorAssist=f;
    m.flashes.push({art:'accelerator_campo',follow:f.side,time:m.t});return true;
  }
  if(f.kind==='hagoromo'){
    if(bench)ally.sageBless=true;
    else if(c.mode==='duelo')ally.reserveHeal=true;
    else{
      const pair=c.teams[f.side].filter(u=>c.alive(u)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp).slice(0,2);
      if(pair.length<2)return false;
      for(const u of c.teams[f.side])u.sageLink=null;
      pair.forEach((u,i)=>u.sageLink={other:pair[1-i],until:c.time+5000});
    }
    m.flashes.push({art:'hagoromo_cura',follow:f.side,time:m.t});return true;
  }
  if(f.kind==='rimuru'&&bench){ally.slimeGuard=true;return true}
  const rimuru=f.kind==='rimuru',captured=rimuru?f.storedMagic:bench?ally.lastOffense:f.cosmicCopy;
  if(!captured)return false;
  if(rimuru)f.storedMagic=null;else if(!bench)f.cosmicCopy=null;
  const art=rimuru?'rimuru_retorno':'garou_copia';
  const attack={...captured,damage:captured.damage*(rimuru?FIFTH_BALANCE.predationReturn:bench?FIFTH_BALANCE.cosmicBench:FIFTH_BALANCE.cosmicMain),skill:true,echo:true};
  if(attack.area){
    m.shots.push({kind:'echoArea',f,side:f.side,x:side.x,y:side.y,born:m.t,art,radius:20,attack});
  }else fireBatch(m,f,art,attack,100,87);
  return true;
}
function castFourth(m,f,enemy,role){
  const c=m.combat,bench=role==='reserva',active=c.active(f.side),t=c.time;
  if(!active||(!bench&&f.skillReady>t))return false;
  const flash=(art)=>m.flashes.push({art,follow:f.side,time:m.t});
  if(f.kind==='madoka'){
    if(bench){if(!cleanse(active,t,true))return false}
    else for(const ally of c.teams[f.side])if(c.alive(ally))cleanse(ally,t,false);
    flash('madoka_purifica');
  }else if(f.kind==='yhwach'){
    if(bench){if((f.benchFutureReady??0)>t)return false;f.benchFutureReady=t+16000;active.futureUntil=t+4000}
    else if((f.almightyReady??0)>t)return false;
    flash('yhwach_visao');
  }else if(f.kind==='giorno'){
    if(c.zeroUsed?.[f.side]||active.zeroGuard)return false;
    if(bench)active.zeroGuard=true;
    flash('giorno_selo');
  }else{
    const energy=bench?(active.recentImpact??[]).filter(e=>t-e.t<=4000).reduce((n,e)=>n+e.n,0):(f.demonCharge??0);
    if(!energy)return false;
    fireBatch(m,f,'meliodas_corte',{damage:energy,crack:!bench},60,97);
    if(!bench)f.demonCharge=0;
    flash('meliodas_reserva');
  }
  if(!bench)f.skillReady=t+8000;
  return true;
}
function castThird(m,f,enemy,role){
  const combat=m.combat,t=combat.time,side=m.sides[f.side],ally=side.team[side.slot],bench=role==='reserva';
  if(!bench && f.skillReady>t)return false;
  const flash=(art,follow=f.side)=>m.flashes.push({art,follow,time:m.t});
  if(f.kind==='simon'){
    const events=combat.log.filter(e=>bench?e.type==='entra'&&e.actor.startsWith(f.side+':'):e.type==='cai'&&e.actor.startsWith(f.side+':')&&e.actor!==f.id);
    const stacks=bench?events.length:new Set(events.map(e=>e.actor)).size;
    const factor=1+.25*stacks;
    fireBatch(m,f,'simon_broca',{damage:f.attack*1.5*factor},110,90);
    const drill=m.shots.at(-1);drill.size=21+Math.min(stacks,8)*2;drill.radius=drill.size*.12;
    flash('simon_espiral');
  }else if(f.kind==='meruem_rei'){
    if(bench){
      if(!enemy.lastDamageType)return false;
      ally.adaptiveType=enemy.lastDamageType;ally.adaptiveUntil=t+4000;flash('meruem_carapaca');
    }else{
      const magic=enemy.resistance<enemy.defense;
      fireBatch(m,f,magic?'meruem_esfera':'meruem_lamina',{damage:f.attack*1.5,magic},65,92);
    }
  }else if(f.kind==='sailor'){
    const team=bench?[ally]:side.team.filter(u=>combat.alive(u));
    let excess=0;
    for(const u of team){
      const heal=f.magic*(bench?.8:1.25);excess+=Math.max(0,heal-(u.maxHp-u.hp));combat.heal(u,heal);
    }
    if(bench)ally.moonGuard=true;
    else for(const u of team)u.moonShield=(u.moonShield??0)+excess/team.length;
    if(!bench)m.flashes.push({art:'sailor_onda',x:side.x,y:side.y,time:m.t});
    flash('sailor_cura');
  }else{
    if((!bench&&(f.timeReady??0)>t)||ally.timeMark?.until>t)return false;
    ally.timeMark={hp:ally.hp,until:bench?t+5000:Infinity,main:!bench,owner:f};
  }
  if(!bench)f.skillReady=t+8000;
  return true;
}
const secretSecondCooldowns={benimaru:[10,10],veldora:[10,10],luminous:[9,18],anos:[10,10],vegeta_blue:[12,16],kaido_dragon:[12,16],tetsuo:[10,14],mob:[14,18],shanks_imperador:[10,14],broly_furia:[12,18],blast_portais:[12,16],luffy_gear5:[11,16],pucci_mih:[null,17],asta_union:[10,14],madara_jubi:[13,16],yuno_stars:[12,15]};
function castSecretSecond(m,f,ally,bench){
  const enemy=m.sides[1-f.side], now=m.combat.time;
  const castId=++m.secretSeq, damage=ratio=>({damage:f.magic*ratio,magic:true,secretCast:castId});
  if(f.kind==='mob'&&(bench?ally:f).hp>(bench?ally:f).maxHp*.5)return false;
  if(f.kind==='broly_furia'&&bench&&ally.hp>ally.maxHp*.35)return false;
  switch(f.kind){
    case 'pucci_mih':
      if(!bench)return false;
      ally.pucciAssistUntil=now+5000;
      if(ally.nextBasic>now)ally.nextBasic=now+(ally.nextBasic-now)*.75;
      if(ally.contactReady>m.t)ally.contactReady=m.t+(ally.contactReady-m.t)*.75;
      break;
    case 'asta_union':
      fireBatch(m,f,'asta_corte',{damage:f.attack*(bench?1.15:1.65),antiMagic:bench?.60:.85,secretCast:castId},85,110);
      break;
    case 'madara_jubi':
      ally.truthOrbs={f,count:bench?1:3,until:now+4000,bench,castId};
      break;
    case 'yuno_stars': {
      const origin=m.sides[f.side],angle=Math.atan2(enemy.y-origin.y,enemy.x-origin.x);
      for(const [index,offset] of (bench?[0]:[1.18,-1.18]).entries()){
        const heading=angle+offset;
        m.starShots.push({f,x:Math.max(R,Math.min(100-R,enemy.x+14*Math.cos(heading))),
          y:Math.max(R,Math.min(50-R,enemy.y+14*Math.sin(heading))),born:m.t,
          delay:bench?.30:.28+index*.34,ratio:bench?1.10:.95,bench,first:!bench&&!index,castId});
      }
      break;
    }
    case 'shanks_imperador':
      fireBatch(m,f,'shanks_corte',{damage:f.attack*(bench?1.25:1.75),interruptCharge:true,secretCast:castId},95,125);
      break;
    case 'broly_furia': {
      if(bench){
        fireBatch(m,f,'broly_onda',{damage:f.attack*1.45,secretCast:castId},95,96);
        break;
      }
      const rage=f.rageStacks??0;
      f.rageStacks=0;f.rageBonus=rage;f.rageUntil=now+5000;
      addPsychic(m,f,m.sides[f.side],'broly_explosao',.26,24,0,castId,{damage:f.attack*(1.3+.2*rage),magic:false});
      break;
    }
    case 'blast_portais':
      ally.blastPortalUntil=now+4000;
      queueGround(m,f,m.sides[f.side],'blast_portal',.38,castId,bench?.85:1.30);
      break;
    case 'luffy_gear5':
      ally.elasticGuard={f,until:now+(bench?4000:3000),ratio:bench?.60:1,bench,castId};
      if(!bench){
        f.wallBoost={until:now+4000,stacks:0,perBounce:.08,maxStacks:3,art:'luffy_impacto'};
        fireBatch(m,f,'luffy_chicote',{damage:f.attack*1.35,secretCast:castId},66,104);
      }
      break;
    case 'vegeta_blue':
      m.secretCharges.push({f,carrier:ally,bench,art:'vegeta_carga',shot:'vegeta_feixe',born:m.t,delay:bench?.60:.85,damage:f.attack*(bench?1.5:2.2),castId});
      break;
    case 'kaido_dragon':
      if(bench){ally.dragonSupport={f,castId,until:now+12000};break}
      f.dragonCharge={f,carrier:f,art:'kaido_carga',shot:'kaido_sopro',born:m.t,delay:.95,damage:f.attack*1.6,absorbed:0,castId};
      m.secretCharges.push(f.dragonCharge);
      break;
    case 'tetsuo': {
      const enhanced=bench&&ally.controlResistedAt>=now-4000;
      const ratio=bench?(enhanced?1.65:1.10):1.35+.25*(f.psychicStacks??0);
      if(!bench)f.psychicStacks=0;
      addPsychic(m,f,m.sides[f.side],'tetsuo_onda',.35,20,ratio,castId,{removeShield:enhanced});
      break;
    }
    case 'mob': {
      const origin=m.sides[f.side];
      if(bench){
        addPsychic(m,f,origin,'mob_onda',.20,22,.95,castId,{push:true});
        break;
      }
      f.mobWardUntil=now+3000;
      grantShield(f,f.maxHp*.18);
      const pulses={connected:false};
      addPsychic(m,f,origin,'mob_onda',.20,22,.75,castId,{push:true},pulses);
      addPsychic(m,f,origin,'mob_onda',.68,22,.75,castId,{},pulses,true);
      break;
    }
    case 'benimaru':
      if(bench)queueGround(m,f,enemy,'benimaru_anel',.38,castId);
      else fireBatch(m,f,'benimaru_corte',{damage:f.attack*1.8,secretCast:castId},65,98);
      break;
    case 'veldora':
      fireBatch(m,f,'veldora_raio',{...damage(bench?1.35:1.85),ignoreDefense:.30},105,148);
      break;
    case 'luminous':
      m.combat.heal(bench?ally:f,f.magic*(bench?1.40:2));
      m.flashes.push({art:'luminous_cura',follow:f.side,time:m.t});
      if(!bench)fireBatch(m,f,'luminous_lanca',damage(1.05),95,90);
      break;
    case 'anos':
      fireBatch(m,f,'anos_fonte',{...damage(bench?1.15:1.70),breakBuff:true,sealHeal:!bench},96,90);
      break;
  }
  const cooldown=secretSecondCooldowns[f.kind][bench?1:0];
  f[bench?'secretBenchReady':'skillReady']=now+cooldown*1000;
  f.ready=(now+cooldown*1000)/1000;
  return true;
}
function addPsychic(m,f,point,art,delay,radius,ratio,castId,options,sequence,final=false){
  m.psychicPulses.push({f,x:point.x,y:point.y,art,born:m.t,delay,radius,sequence,final,attack:{damage:f.magic*ratio,magic:true,area:true,secretCast:castId,...options}});
}
function stepSecretThird(m){
  const c=m.combat;
  m.secretCharges=m.secretCharges.filter(e=>{
    if(e.cancelled||!c.alive(e.f)||!c.present(e.carrier)||(!e.bench&&c.blocked(e.f))){
      if(e.f.dragonCharge===e)e.f.dragonCharge=null;
      note(m,e.f.name+' · carga interrompida');
      return false;
    }
    if(m.t-e.born<e.delay)return true;
    if(e.f.dragonCharge===e)e.f.dragonCharge=null;
    const damage=e.damage+Math.min(e.absorbed??0,e.f.attack*.8);
    fireBatch(m,e.f,e.shot,{damage,secretCast:e.castId},110,135,e.origin);
    return false;
  });
  m.psychicPulses=m.psychicPulses.filter(e=>{
    if(!c.alive(e.f))return false;
    if(m.t-e.born<e.delay)return true;
    const foe=m.sides[1-e.f.side],unit=foe.team[foe.slot];
    m.flashes.push({art:e.art,x:e.x,y:e.y,time:m.t,radius:e.radius});
    if(!unit||!c.present(unit))return false;
    const inside=Math.hypot(foe.x-e.x,foe.y-e.y)<=e.radius;
    const connected=inside&&c.hit(e.f,unit,e.attack);
    if(e.sequence&&connected)e.sequence.connected=true;
    if(e.final&&!e.sequence.connected){
      const attack={damage:e.f.magic,magic:true,secretCast:e.attack.secretCast};
      fireBatch(m,e.f,'mob_descarga',attack,100,95,e);
      note(m,'Despertar Psíquico · descarga de longo alcance');
    }
    if(connected&&e.attack.push){
      const angle=Math.atan2(foe.y-e.y,foe.x-e.x);
      foe.vx=Math.cos(angle)*35;foe.vy=Math.sin(angle)*35;
    }
    return false;
  });
}
function queueGround(m,f,point,art,delay,castId,ratio){
  m.groundEffects.push({f,x:point.x,y:point.y,art,born:m.t,delay,castId,ratio});
}
function stepGround(m){
  m.groundEffects=m.groundEffects.filter(e=>{
    if(m.t-e.born<e.delay)return true;
    if(!m.combat.alive(e.f))return false;
    const foe=m.sides[1-e.f.side], target=foe.team[foe.slot];
    if(!target||!m.combat.present(target))return false;
    if(e.art==='benimaru_anel'){
      const contact=Math.hypot(foe.x-e.x,foe.y-e.y)<=28;
      const hit=contact&&m.combat.hit(e.f,target,{damage:e.f.attack*.85,area:true,secretCast:e.castId});
      m.flashes.push({...e,time:m.t});
      if(hit)m.flashes.push({art:'benimaru_impacto',x:foe.x,y:foe.y,time:m.t});
      else note(m,'Nichirin · errou');
    }else if(e.art==='asta_estilhaco'){
      fireBatch(m,e.f,'asta_retorno',{damage:e.f.attack*e.ratio,secretCast:e.castId},72,105,e);
    }else if(e.art==='blast_portal'){
      fireBatch(m,e.f,'blast_disparo',{damage:e.f.magic*e.ratio,magic:true,secretCast:e.castId},100,100,e);
    }else{
      fireBatch(m,e.f,'anos_retorno',{damage:e.f.magic*.55,magic:true,secretCast:e.castId},70,80,e);
    }
    return false;
  });
}
function spawnMirage(m,owner,position,ratio,castId){
  m.mirages.push({owner,x:position.x,y:position.y,born:m.t,ratio,castId});
}
function basicAcceleration(m,unit){
  const now=m.combat.time;
  return unit.pucciAssistUntil>now?.75:1;
}
function stepConstellations(m){
  const c=m.combat;
  m.starShots=m.starShots.filter(e=>{
    if(!c.alive(e.f)||(!e.bench&&!c.present(e.f)))return false;
    if(m.t-e.born<e.delay)return true;
    const from=m.sides[e.f.side],to=m.sides[1-e.f.side];
    if(!e.bench&&Math.hypot(e.x-to.x,e.y-to.y)>2*R){
      from.x=e.x;from.y=e.y;
      const angle=Math.atan2(to.y-from.y,to.x-from.x);
      from.vx=Math.cos(angle);from.vy=Math.sin(angle);
    }
    fireBatch(m,e.f,'yuno_disparo',{damage:e.f.magic*e.ratio,magic:true,ignoreIntercept:e.first,secretCast:e.castId},82,120,e);
    return false;
  });
  for(const side of m.sides){
    const unit=side.team[side.slot],orbs=unit?.truthOrbs;
    if(!orbs||orbs.until>c.time)continue;
    unit.truthOrbs=null;
    if(!c.present(unit)||!c.alive(orbs.f))continue;
    for(let i=0;i<orbs.count;i++)
      m.orbVolleys.push({...orbs,carrier:unit,at:m.t+i*.14});
  }
  m.orbVolleys=m.orbVolleys.filter(e=>{
    if(!c.present(e.carrier)||!c.alive(e.f))return false;
    if(m.t<e.at)return true;
    fireBatch(m,e.f,'madara_disparo',{damage:e.f.magic*(e.bench?.45:.60),magic:true,secretCast:e.castId},100,100);
    return false;
  });
}
function stepMirages(m){
  m.mirages=m.mirages.filter(e=>{
    if(!m.combat.alive(e.owner))return false;
    if(m.t-e.born<.32)return true;
    const foe=m.sides[1-e.owner.side];
    if(m.combat.present(foe.team[foe.slot]))
      fireBatch(m,e.owner,'aizen_estilhacos',{damage:e.owner.magic*e.ratio,magic:true,secretCast:e.castId},108,90,e);
    return false;
  });
}
function fireBatch(m,f,art,attack,range,speed,origin){
  const from=origin??m.sides[f.side],to=m.sides[1-f.side],angle=Math.atan2(to.y-from.y,to.x-from.x);
  if(attack.skill!==false&&!attack.echo&&!attack.reflected){
    const target=to.team[to.slot];if(target)target.lastOffense={...attack,projectile:true,damage:attack.damage??f.attack};
  }
  m.shots.push({kind:'batch',basic:attack.skill===false,art,angle,side:f.side,f,born:m.t,speed,range,radius:projectileRadius[art]??(art==='saitama_soco'?3.2:1),
    x:from.x+(origin?0:R)*Math.cos(angle),y:from.y+(origin?0:R)*Math.sin(angle),attacks:[attack]});
}
const mageShots={div_king:'chastiefol_basico',m3_ace:'basico_ace',m3_genos:'basico_genos',m3_kakashi:'basico_kakashi',m3_chrollo:'basico_chrollo',m2_frieren:'centelha',m_byakuya:'lamina',madara_jubi:'madara_disparo',yuno_stars:'yuno_basico',tetsuo:'tetsuo_basico',mob:'mob_basico',veldora:'veldora_basico',anos:'anos_basico',yamamoto:'yamamoto_basico',johnny:'johnny_basico',dominio:'gojo_basico',santuario:'sukuna_basico',beerus:'beerus_basico',kaguya:'kaguya_basico'};
const projectileRadius={asta_corte:2.6,asta_retorno:2,madara_disparo:2,yuno_disparo:1.8,shanks_corte:2.6,broly_onda:2.4,blast_disparo:2,luffy_chicote:2.6,mob_descarga:2.4,vegeta_feixe:2.4,kaido_sopro:3.0,benimaru_corte:2.7,veldora_raio:1.8,luminous_lanca:1.8,anos_fonte:2.1,meliodas_corte:3,meruem_esfera:2.4,meruem_lamina:2,beerus_hakai:5.2,beerus_basico:1.1,kaguya_basico:1.0,shinra_golpe:2.3};
function quakeRadius(age){return [3,8,14,18][Math.min(3,Math.floor(Math.max(0,age)/.06))]}
function quakeContact(m,q,victim,position){
  if(q.struck.has(victim.id))return;
  q.struck.add(victim.id);
  if(m.combat.hit(q.f,victim,q.attack))m.flashes.push({art:'barba_fratura',x:position.x,y:position.y,time:m.t});
}
function traceHit(x,y,dx,dy,radius){
  const len=dx*dx+dy*dy;
  const u=len?Math.max(0,Math.min(1,-(x*dx+y*dy)/len)):0;
  return Math.hypot(x+u*dx,y+u*dy)<=radius;
}
const ceroMaxLength=26;
const ceroProfile=[1,3,5,7,11,13,15,16,16,15,13,11,9,7,4,1];
function ceroLength(age,speed){return Math.min(ceroMaxLength,Math.max(.6,age*speed));}
function resolveShots(m,previous){
  m.flashes=m.flashes.filter(e=>m.t-e.time<(['luminous_cura','benimaru_anel','tetsuo_onda','mob_onda','broly_explosao','luffy_onda'].includes(e.art)?.32:e.art==='shinra_fratura'?.28:e.art==='saitama_onda'?.32:e.art?.16:(e.kind==='cero'||e.kind==='rei')?.16:.23));
  m.shots=m.shots.filter(s=>{
    const caster=m.sides[s.side],other=m.sides[1-s.side],victim=other.team[other.slot];
    if(!m.combat.alive(s.f)||!victim||!m.combat.present(victim))return false;
    if(s.kind==='bossShot')return stepBossShot(m,s,victim,other,previous);
    if(s.kind==='echoArea'){
      const age=m.t-s.born;if(age<.16)return true;
      if(Math.hypot(other.x-s.x,other.y-s.y)<=s.radius+R && m.combat.hit(s.f,victim,s.attack))
        m.flashes.push({art:s.art==='garou_copia'?'garou_nova':'rimuru_contato',x:other.x,y:other.y,time:m.t});
      return false;
    }
    if(s.kind==='muda'){
      const ux=Math.cos(s.angle),uy=Math.sin(s.angle),remaining=s.range-(s.traveled??0);
      const distance=Math.min(remaining,s.speed*DT);
      const [ox,oy]=previous[1-s.side],rx=s.x-ox,ry=s.y-oy;
      const dx=ux*distance-(other.x-ox),dy=uy*distance-(other.y-oy);
      const a=dx*dx+dy*dy,b=rx*dx+ry*dy,c=rx*rx+ry*ry-(R+s.radius)**2;
      const disc=b*b-a*c,t=c<=0?0:a>0&&disc>=0?(-b-Math.sqrt(disc))/a:Infinity;
      if(t>=0&&t<=1){
        const nx=rx+t*dx,ny=ry+t*dy,len=Math.hypot(nx,ny)||1;
        const before=m.combat.log.length;
        m.combat.hit(s.f,victim,{skill:true,magic:false,damage:s.f.attack*MUDA_HIT_RATIO});
        const landed=m.combat.log.slice(before).some(e=>e.type==='dano'&&e.actor===s.f.id&&e.target===victim.id);
        if(landed)m.flashes.push({art:s.f.kind==='m_josuke'?'contato':'giorno_impacto',x:ox+(other.x-ox)*t+R*nx/len,y:oy+(other.y-oy)*t+R*ny/len,time:m.t});
        return false;
      }
      s.x+=ux*distance;s.y+=uy*distance;s.traveled=(s.traveled??0)+distance;
      return s.traveled<s.range&&s.x>=0&&s.x<=100&&s.y>=0&&s.y<=50;
    }
    const age=m.t-s.born,zone=s.kind==='room'||s.kind==='zone';
    if(s.kind==='tremor'){
      if(age<.24){
        if(!s.support&&Math.hypot(other.x-s.x,other.y-s.y)<=quakeRadius(age)+R)quakeContact(m,s,victim,other);
        return true;
      }
      const ux=Math.cos(s.angle),uy=Math.sin(s.angle);
      const start=s.support?0:18;
      const front=start+84*(age-.24),oldFront=Math.max(start,front-84*DT);
      const [ox,oy]=previous[1-s.side];
      const oldAlong=(ox-s.x)*ux+(oy-s.y)*uy-oldFront;
      const along=(other.x-s.x)*ux+(other.y-s.y)*uy-front;
      const lateral=Math.abs(-(other.x-s.x)*uy+(other.y-s.y)*ux);
      if(Math.min(oldAlong,along)<=R+1 && Math.max(oldAlong,along)>=-R-1 && lateral<=R+10)
        quakeContact(m,s,victim,other);
      const cx=s.x+ux*front,cy=s.y+uy*front;
      return cx>=-12&&cx<=112&&cy>=-12&&cy<=62;
    }
    if(s.kind==='dominio'||s.kind==='santuario'){
      const gojo=s.kind==='dominio',charge=gojo?.36:0;
      if(gojo && age<charge){s.x=caster.x;s.y=caster.y;return true}
      if(gojo&&!s.open){s.x=caster.x;s.y=caster.y;s.open=true}
      const end=charge+(gojo?1.5:s.short?.8:1.6);
      if(age>=end)return false;
      const inside=Math.hypot(other.x-s.x,other.y-s.y)<=R+s.radius;
      if(gojo){
        if(inside){applyNegative(victim,'stunUntil',Math.max(victim.stunUntil??0,m.combat.time+18));
          if(!s.applied){m.combat.hit(s.f,victim,s.attack);s.applied=true}}
      }else if(age>=s.pulse*.4){
        s.pulse++;
        if(inside){m.combat.hit(s.f,victim,s.attack);m.flashes.push({art:'sukuna_corte',x:other.x,y:other.y,time:m.t})}
      }
      return true;
    }
    let hit=false;
    if(zone){
      // Activate after the ring has opened. ROOM remains armed for one cut.
      if(age<.3)return true;
      hit=Math.hypot(other.x-s.x,other.y-s.y)<=s.radius+R;
      if(!hit && age<(s.kind==='room'?1.5:.45))return true;
    }else{
      const [ox,oy]=previous[1-s.side],vx=Math.cos(s.angle)*s.speed*DT,vy=Math.sin(s.angle)*s.speed*DT;
      if(s.kind==='cero'){
        const before=ceroLength(age-DT,s.speed),after=ceroLength(age,s.speed);
        const ux=Math.cos(s.angle),uy=Math.sin(s.angle);
        let first=Infinity;
        for(let i=0;i<ceroProfile.length;i++){
          const offset=i*5/80,radius=after*ceroProfile[i]/160;
          const rx=s.x-before*offset*ux-ox,ry=s.y-before*offset*uy-oy;
          const dx=vx-(after-before)*offset*ux-(other.x-ox);
          const dy=vy-(after-before)*offset*uy-(other.y-oy);
          const a=dx*dx+dy*dy,b=rx*dx+ry*dy,c=rx*rx+ry*ry-(radius+R)**2;
          const disc=b*b-a*c;
          const t=c<=0?0:a>0&&disc>=0?(-b-Math.sqrt(disc))/a:Infinity;
          if(t<0||t>1||t>=first)continue;
          const x=s.x+t*vx,y=s.y+t*vy;
          if(x<0||x>100||y<0||y>50)continue;
          first=t;hit=true;
          const nx=rx+t*dx,ny=ry+t*dy,len=Math.hypot(nx,ny)||1;
          s.contactX=ox+t*(other.x-ox)+R*nx/len;
          s.contactY=oy+t*(other.y-oy)+R*ny/len;
        }
      }else hit=traceHit(s.x-ox,s.y-oy,vx-(other.x-ox),vy-(other.y-oy),s.radius+R);
      s.x+=vx;s.y+=vy;
      if(!hit&&age*s.speed<s.range&&s.x>=0&&s.x<=100&&s.y>=0&&s.y<=50)return true;
    }
    if(s.art==='saitama_soco'){
      const direction=Math.atan2(s.y-other.y,s.x-other.x);
      const x=hit?other.x+R*Math.cos(direction):s.x;
      const y=hit?other.y+R*Math.sin(direction):s.y;
      m.flashes.push({art:'saitama_onda',x,y,angle:s.angle,time:m.t+.045});
    }
    if(!hit){note(m,(s.basic?'Ataque básico':s.f.skill)+' · errou');return false;}
    if(s.kind==='batch'){
      const last=m.combat.log.length;
      const attack={...s.attacks[0],projectile:true},shield=victim.shield;
      if(attack.second?.broken===victim.id&&victim.shield<=0)attack.damage*=1.5;
      const burn=victim.dots?.get('yamamoto_brasas');
      if(attack.consume&&burn)attack.damage+=burn.damage*burn.count;
      const resolved=m.combat.hit(s.f,victim,attack);
      if(resolved && m.combat.log.slice(last).some(e=>e.type==='dano'&&e.actor===s.f.id&&e.target===victim.id)){
        if(attack.consume&&burn){
          victim.dots.delete('yamamoto_brasas');
          note(m,'Zanka no Tachi · queimadura consumida');
        }else if((s.art==='yamamoto_basico'||s.art==='yamamoto_corte')&&m.combat.alive(victim)){
          applyDot(m,s.f,victim,'yamamoto_brasas',s.f.magic*.12,.55,5);
        }
        if(attack.elasticBurst)
          addPsychic(m,s.f,other,'luffy_onda',.18,16,0,attack.secretCast,{damage:s.f.attack*.65,magic:false});
        if(attack.nail&&m.combat.alive(victim))applyDot(m,s.f,victim,'johnny_rotacao',s.f.magic*.09,.6,8);
        if(attack.first&&shield>0&&victim.shield<=0){attack.first.broken=victim.id;m.flashes.push({art:'ichigo_quebra',follow:victim.side,time:m.t})}
        const a=Math.atan2(s.y-other.y,s.x-other.x);
        m.flashes.push({art:({asta_corte:'asta_estilhaco',asta_retorno:'asta_estilhaco',madara_disparo:'madara_impacto',yuno_disparo:'yuno_impacto',yuno_basico:'yuno_impacto',shanks_corte:'shanks_impacto',broly_onda:'broly_impacto',blast_disparo:'blast_impacto',luffy_chicote:'luffy_impacto',vegeta_feixe:'vegeta_impacto',kaido_sopro:'kaido_impacto',tetsuo_basico:'tetsuo_impacto',mob_descarga:'mob_impacto',mob_basico:'mob_impacto',benimaru_corte:'benimaru_impacto',veldora_raio:'veldora_impacto',veldora_basico:'veldora_impacto',luminous_lanca:'luminous_impacto',anos_fonte:'anos_impacto',anos_basico:'anos_impacto',anos_retorno:'anos_impacto',aizen_estilhacos:'aizen_estilhacos',yamamoto_corte:'yamamoto_contato',yamamoto_basico:'yamamoto_contato',johnny_disparo:'johnny_ruptura',johnny_basico:'johnny_ruptura',ichigo_primeira:'ichigo_contato',ichigo_segunda:'ichigo_contato',roger_corte_apoio:'roger_contato_apoio',rimuru_retorno:'rimuru_contato',accelerator_reflexo:'accelerator_contato',garou_copia:'garou_nova',meliodas_corte:'meliodas_contato',simon_broca:'simon_impacto',meruem_esfera:'meruem_impacto',meruem_lamina:'meruem_impacto',beerus_hakai:'beerus_dissipacao',beerus_basico:'beerus_dissipacao',kaguya_basico:'kaguya_fragmentos',shinra_golpe:'contato_dourado'})[s.art]??(s.art==='saitama_soco'?'saitama_impacto':s.art==='sukuna_basico'?'sukuna_corte':'contato_azul'),x:other.x+R*Math.cos(a),y:other.y+R*Math.sin(a),time:m.t});
      }
      return false;
    }
    m.flashes.push({kind:s.kind,side:s.side,x:s.contactX??other.x,y:s.contactY??other.y,fromX:caster.x,fromY:caster.y,time:m.t});
    for(const attack of s.attacks){
      if(!m.combat.alive(s.f)||!m.combat.present(victim))break;
      if(!s.basic&&s.f.kind==='ashisogi')applyNegative(victim,'weakenUntil',Math.max(victim.weakenUntil,m.combat.time+4000));
      m.combat.hit(s.f,victim,{...attack,projectile:s.kind==='bolt'||s.kind==='cero'});
      if(!s.basic&&s.f.kind==='dominio')applyNegative(victim,'stunUntil',Math.max(victim.stunUntil??0,m.combat.time+1500));
    }
    return false;
  });
}
const passiveEvents={'aceleração':'Made in Heaven · Aceleração do Tempo','tempo parado':'The World','ressurge':'Ressurgimento'};
function applyDot(m,source,target,key,damage,period,count){
  if(interceptNegative(target,key))return;
  const side=m.sides[source.side];
  if(side.burnBoost&&['yamamoto_brasas','dot_fogo','dot_chamas_negras','dot_chamas_azuis'].includes(key)){damage*=1.5;side.burnBoost=false}
  const states=target.dots??=new Map();
  if(key==='yamamoto_brasas')note(m,'Burn · queimadura em '+target.name);
  states.set(key,{key,source,damage,period,count,start:m.t,next:m.t+period,lastTick:null});
}
function stepDots(m,target){
  for(const [key,state] of target.dots??[]){
    if(!m.combat.present(target)||!m.combat.alive(state.source)){target.dots.delete(key);continue}
    if(m.t+1e-8<state.next)continue;
    m.combat.hit(state.source,target,{area:true,skill:false,periodic:true,magic:key!=='dot_sangramento',damage:state.damage});
    state.lastTick=m.t;state.next+=state.period;
    if(--state.count===0||!m.combat.present(target))target.dots.delete(key);
  }
}
const MUDA_HIT_RATIO=0.20;
function updateBarrage(m,f){
  const josuke=f.kind==='m_josuke';if(f.kind!=='giorno'&&!josuke)return;
  const side=m.sides[f.side],other=m.sides[1-f.side];
  const d=Math.hypot(other.x-side.x,other.y-side.y);
  if(d>22)f.barrageInside=false;
  if(!m.combat.present(f)||m.combat.blocked(f)||!m.combat.present(other.team[other.slot])){
    f.punchesLeft=0;return;
  }
  if(!f.barrageInside&&d<=18&&!f.punchesLeft){
    f.barrageInside=true;f.punchesLeft=6;f.nextPunch=m.t;
    note(m,josuke?'Crazy Diamond · Dora Barrage':'Gold Experience Requiem · Muda Barrage');
  }
  if(!f.punchesLeft||m.t+1e-8<f.nextPunch)return;
  if(josuke){standActivity(m.combat,f);f.standUntil=m.t+.16;}
  const index=6-f.punchesLeft,angle=Math.atan2(other.y-side.y,other.x-side.x);
  const ux=Math.cos(angle),uy=Math.sin(angle),offset=[-2.4,1.8,-1,2.6,-2,0][index];
  m.shots.push({kind:'muda',f,side:f.side,angle,born:m.t,x:side.x+3.3*ux-offset*uy,
    y:side.y+3.3*uy+offset*ux,speed:97,range:17,radius:1.1});
  f.punchesLeft--;f.nextPunch+=.075;
}
function markBasic(m,unit,enemy){
  unit.visualBasicStart=m.t;
  unit.visualFacing=enemy.x>=m.sides[unit.side].x?1:-1;
}
function separateBalls(a,b){
  const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
  if(d<=2*R){
    const nx=d?dx/d:1,ny=d?dy/d:0,push=(2*R-d)/2;
    a.x=Math.max(R,Math.min(100-R,a.x-nx*push));a.y=Math.max(R,Math.min(50-R,a.y-ny*push));
    b.x=Math.max(R,Math.min(100-R,b.x+nx*push));b.y=Math.max(R,Math.min(50-R,b.y+ny*push));
    const closing=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;
    if(closing>0){a.vx-=closing*nx;a.vy-=closing*ny;b.vx+=closing*nx;b.vy+=closing*ny;}
  }
  return d<=2*R;
}
function stepDuel(m){
  if(m.result!==null)return;
  m.t+=DT;
  const combat=m.combat;
  const firstEvent=combat.log.length;
  combat.time=Math.round(m.t*1000);
  const [a,b]=m.sides, active=m.sides.map(s=>s.team[s.slot]);
  const previous=m.sides.map(s=>[s.x,s.y]);
  m.sides.forEach((s,i)=>{
    if(!s.ignition)return;
    if(!combat.present(active[i])||combat.blocked(active[i])){delete s.ignition;return}
    if(m.t-s.ignition.born<.20)return;
    const target=m.sides[1-i];
    s.dash={art:'shinra_golpe',born:m.t,angle:Math.atan2(target.y-s.y,target.x-s.x),attack:s.ignition.attack};
    delete s.ignition;
  });
  const charging=m.sides.map(s=>s.dash);
  const fast=active.some(f=>f.kind==='pucci_mih')&&!charging.some(Boolean);
  const speed=fast?active.reduce((sum,f)=>sum+(combat.present(f)&&!combat.blocked(f)?movementSpeed(f,combat.time):0),0):0;
  const substeps=Math.max(1,Math.ceil(speed*DT/2));
  let contact=false;
  if(substeps>1){
    for(let n=0;n<substeps;n++){
      m.sides.forEach((s,i)=>{
        if(combat.present(active[i])&&!combat.blocked(active[i]))move(m,s,active[i],DT/substeps);
      });
      if(separateBalls(a,b))contact=true;
    }
  }else m.sides.forEach((s,i)=>{
    if(!combat.present(active[i])||combat.blocked(active[i])){delete s.dash;return}
    if(!s.dash){move(m,s,active[i]);return}
    const ux=Math.cos(s.dash.angle),uy=Math.sin(s.dash.angle);
    const wallX=ux>0?(100-R-s.x)/ux:ux<0?(R-s.x)/ux:Infinity;
    const wallY=uy>0?(50-R-s.y)/uy:uy<0?(R-s.y)/uy:Infinity;
    const dist=Math.min(110*DT,wallX,wallY);
    s.x+=dist*ux;s.y+=dist*uy;
    if(dist<110*DT||m.t-s.dash.born>=.4)delete s.dash;
  });
  secondStep(m,previous);waterStep(m,previous);
  charging.forEach((dash,i)=>{
    if(!dash||!combat.present(active[i])||combat.blocked(active[i]))return;
    const enemy=active[1-i],s=m.sides[i],o=m.sides[1-i];
    const [x,y]=previous[i],[ox,oy]=previous[1-i];
    const rx=x-ox,ry=y-oy,dx=s.x-x-(o.x-ox),dy=s.y-y-(o.y-oy);
    const a=dx*dx+dy*dy,b=rx*dx+ry*dy,c=rx*rx+ry*ry-4*R*R;
    const d=b*b-a*c,t=c<=0?0:a&&d>=0?(-b-Math.sqrt(d))/a:Infinity;
    if(t<0||t>1||!combat.present(enemy))return;
    s.x=x+t*(s.x-x);s.y=y+t*(s.y-y);
    delete s.dash;
    const flash={kind:'rei',x:(s.x+ox+t*(o.x-ox))/2,y:(s.y+oy+t*(o.y-oy))/2,time:m.t,angle:dash.angle};
    if(dash.art==='boss_arlong_dash')bossHit(m,active[i],enemy,{...dash.attack,dash:true},flash,dash.angle);
    else{
      const start=combat.log.length;
      combat.hit(active[i],enemy,{...dash.attack,dash:true});
      if(!dash.art)m.flashes.push(flash);
      else if(combat.log.slice(start).some(e=>e.type==='dano'&&e.target===enemy.id))
        m.flashes.push({...flash,art:'shinra_fratura',kind:'fratura'});
    }
    m.contact=Math.max(m.contact,m.t+.45);
  });
  contact=contact||separateBalls(a,b);
  if(contact&&(m.t>=m.contact||active.some(f=>basicAcceleration(m,f)<1&&(f.contactReady??0)<=m.t))){
    // Alternate initiative on contact. A defeated or stunned fighter cannot counter.
    const order=m.contacts%2===1?[1,0]:[0,1];
    m.contacts++;
    for(const i of order){
      const f=active[i],g=active[1-i];
      if(!combat.present(f)||!combat.present(g)||combat.blocked(f))continue;
      if(mageShots[f.kind]||f.kind==='m_josuke')continue;
      const speed=basicAcceleration(m,f);
      if((speed===1?m.contact:f.contactReady??0)>m.t)continue;
      f.contactReady=m.t+.45*speed;
      if(spendLostAction(m,f))continue;
      f.actions++;
      if(f.kind==='rimuru'&&f.storedMagic){arenaCast(m,f,g,'principal');continue}
      markBasic(m,f,m.sides[1-i]);
      if(combat.hit(f,g,{damage:rawCollision(f),skill:false,magic:!!f.magicBasic})){
        f.hits++;
        f.contactReady=m.t+.45*basicAcceleration(m,f);
      }
    }
    note(m,'Colisão · '+active.map(f=>f.name).join(' × '));if(m.t>=m.contact)m.contact=m.t+.45;
  }
  for(const f of active){
    if(!combat.present(f)||combat.blocked(f)||!mageShots[f.kind]||f.nextBasic>combat.time)continue;
    const range=f.kind==='div_king'||f.kind==='m_byakuya'?36:f.kind==='m2_frieren'?40:thirdKits[f.kind]?38:110;
    if(range<110&&Math.hypot(a.x-b.x,a.y-b.y)>range)continue;
    f.nextBasic=combat.time+f.interval*basicAcceleration(m,f);
    if(spendLostAction(m,f))continue;
    f.actions++;
    markBasic(m,f,m.sides[1-f.side]);
    fireBatch(m,f,mageShots[f.kind],{magic:true,skill:false,damage:f.magic*(f.kind==='div_king'?divineBalance.king.basic:1)},range,78);
  }
  for(const f of active){
    if(!combat.present(f))continue;
    if(f.heatUntil&&f.heatUntil<=combat.time){f.heatUntil=0;if(!combat.blocked(f))fireBatch(m,f,'yamamoto_corte',{damage:f.magic*1.5,magic:true,consume:true,secretCast:f.heatCast},33,100)}
    if(f.nextWave&&f.nextWave.at<=combat.time){const w=f.nextWave;f.nextWave=null;if(!combat.blocked(f))fireBatch(m,f,'ichigo_segunda',{damage:f.attack,second:w.pair,secretCast:w.id},85,100)}
  }
  for(const unit of active)stepDots(m,unit);
  stepSecretThird(m);
  stepMirages(m);
  stepGround(m);
  mythStep(m);thirdTicks(m);divineStep(m,previous);
  resolveShots(m,previous);
  stepBossMoves(m);
  stepConstellations(m);
  for(const e of m.elasticReturns.splice(0))fireBatch(m,e.f,e.art??'luffy_chicote',e.attack,105,112,e);
  for(const {f,attack} of m.reflections.splice(0))fireBatch(m,f,'accelerator_reflexo',attack,110,110);
  for(const f of active)updateBarrage(m,f);
  m.sides.forEach((side,i)=>{
    const ally=active[i],enemy=active[1-i];
    for(const f of side.team.slice(side.slot)){
      if(f.ready>m.t||!combat.present(ally)||!combat.present(enemy)||combat.blocked(f))continue;
      const reserve=f!==ally;
      if(!reserve&&f.kind==='pucci_mih')continue;
      if(!reserve)combat.beginAttack(f);
      f.ready=m.t+(reserve?8:2)*combat.pace(f);
      if(spendLostAction(m,f))continue;
      if(reserve && f.role==='Suporte' && !f.signatureAssist){
        combat.heal(ally,Math.round(f.magic*.8));announce(m,f,'Cura de apoio','reserva');
      }else{
        arenaCast(m,f,enemy,reserve?'reserva':'principal');

      }
    }
  });
  m.sides.forEach((side,i)=>{
    if(!combat.alive(active[i])){
      side.slot++;
      if(side.slot<side.team.length){
        side.x=i?80:20;side.y=i?30:20;
        launchBall(side,i,m.random);
        const entering=side.team[side.slot];
        if(entering.kind==='pucci_mih')entering.enteredAt=combat.time;
        entering.ready=m.t+2;
        note(m,entering.name+' entra na arena.');
      }
    }
  });
  for(let i=firstEvent;i<combat.log.length;i++){
    const e=combat.log[i];
    if(['carapaca','lunar','reverte'].includes(e.type)){
      const side=Number(e.actor.split(':')[0]);m.flashes.push({art:{carapaca:'meruem_carapaca',lunar:'sailor_barreira',reverte:'lucius_reversao'}[e.type],follow:side,time:m.t});
    }
    if(['zero','futuro','ciclos'].includes(e.type)){
      const side=Number(e.actor.split(':')[0]);m.flashes.push({art:{zero:'giorno_zero',futuro:'yhwach_futuro',ciclos:'madoka_retorno'}[e.type],follow:side,time:m.t});
      if(e.type==='zero'&&e.main)m.flashes.push({art:'giorno_acao',follow:1-side,time:m.t});
    }
    if(e.type==='predacao'||e.type==='seis'||e.type==='reflete'){
      const side=Number(e.actor.split(':')[0]);m.flashes.push({art:{predacao:'rimuru_predacao',seis:'hagoromo_cura',reflete:'accelerator_campo'}[e.type],follow:side,time:m.t});
    }
    if(e.type==='portal'){
      const side=Number(e.actor.split(':')[0]);
      m.flashes.push({art:'kaguya_fenda',follow:side,time:m.t});
    }
    if(e.type==='instintiva'||e.type==='ilimitado'){
      const [side,slot]=e.actor.split(':').map(Number),s=m.sides[side],f=s.team[slot];
      if(e.type==='instintiva')fireBatch(m,f,'goku_contra',{damage:e.power??f.attack,skill:false,counter:true},110,125);
      else m.flashes.push({art:'gojo_ilimitado',follow:side,x:s.x,y:s.y,time:m.t});
      note(m,f.name+(e.type==='instintiva'?' · esquiva e contra-ataca':' · Ilimitado'));
    }
    if(e.type==='especial'){
      const [side,slot]=e.actor.split(':').map(Number);
      const actor=arenaUnit(m.sides[side],slot);
      if(actor&&e.role==='principal'&&actor.characterId==='dio'){
        actor.visualSpecialStart=m.t;
        actor.visualFacing=m.sides[1-side].x>=m.sides[side].x?1:-1;
      }
      announce(m,actor,e.name,e.role);
    }
    if(passiveEvents[e.type] && e.actor){
      const [side,slot]=e.actor.split(':').map(Number);
      const actor=m.sides[side].team[slot];
      const combo=e.type==='aceleração'&&actor.nen?' · Última Aposta 8×':'';
      announce(m,actor,passiveEvents[e.type]+combo,'passiva');
    }
    if(e.type!=='dano'||e.hp<=0)continue;
    const [side,slot]=e.actor.split(':').map(Number);
    const [other,targetSlot]=e.target.split(':').map(Number);
    m.damageFeed.unshift({seq:i,side,source:arenaUnit(m.sides[side],slot).name,target:m.sides[other].team[targetSlot].name,amount:e.hp});
  }
  if(m.damageFeed.length>12)m.damageFeed.length=12;
  for(const s of m.sides){const u=s.team[s.slot];if(u?.kind==='m_josuke'&&combat.present(u))josukeStep(m,u)}
  const out=m.sides.map(s=>s.slot===s.team.length);
  if(out.some(Boolean))m.result=out[0]===out[1]?'Empate':out[0]?'Derrota':'Vitória';
  else if(m.t+1e-8>=m.limit){
    const score=m.sides.map(s=>s.team.reduce((n,f)=>n+f.hp/f.maxHp,0)/s.team.length);
    m.result= Math.abs(score[0]-score[1])<.00001?'Empate':score[0]>score[1]?'Vitória':'Derrota';
    note(m,'Tempo esgotado · decisão pela média das frações de PV restantes.');
  }
}
export {collisionBonus,collisionPower,createDuel,finishDuel,stepDuel,pucciMultiplier,bossKits,BOSS_FINISH_FX};
