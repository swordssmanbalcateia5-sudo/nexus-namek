function hasTrait(unit,name){return unit.traits?.includes(name)||unit.trait===name;}
const DEFAULT_LIMIT = 60000;
const SAMPLE_STEP = 100;
const HP_EPSILON = 1e-8;
const sum = values => values.reduce((a, b) => a + b, 0);
const COLORS = ['Vermelho','Laranja','Amarelo','Verde','Turquesa','Azul','Roxo','Rosa'];
export function affinity(a, b) {
  if (!a || !b) return 1;
  if (a === 'Dourado') return b === a ? 2 : 1.5;
  if ((a === 'Branco' || a === 'Preto') && a === b) return 1.5;
  const position = COLORS.indexOf(a);
  if (position < 0) return 1;
  return b === COLORS[(position + 1) % 8] ? 1.5 : b === COLORS[(position + 7) % 8] ? .75 : 1;
}
const distance = (a, b) => Math.hypot((a.x ?? a.slot * 20) - (b.x ?? b.slot * 20), (a.y ?? 50) - (b.y ?? 50));
const MAIN_SKILLS = new Set(['piccolo','yamcha','kuririn','bulma','freeza-boss','ginyu','beam','rush','ward','heal']);

function applyStun(unit,until){
  if(unit.ccImmune){unit.ccImmune=false;return;}
  unit.stunUntil=Math.max(unit.stunUntil??0,until);
}

export class Combate {
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
    this.log = [];
    this.hasteUntil=[0,0];
    for(const team of this.teams){
      for(const u of team){
        if(hasTrait(u,'Kaidō'))u.shield+=u.maxHp*.18;
        if(hasTrait(u,'Domínio Absoluto')){u.shield+=u.maxHp*.25;u.domainWard=true;u.ccImmune=true;}
      }
    }
    for(const team of this.teams){
      const king=team.find(u=>hasTrait(u,'Haki do Rei'));
      if(king)for(const foe of this.teams[1-king.side]){
        applyStun(foe,1500);
        foe.exposedUntil=1500;
      }
    }
  }

  record(type, actor, target, data = {}) {
    this.log.push({ time: this.time, type, actor: actor?.id, target: target?.id, ...data });
  }

  alive(u) { return u.hp > HP_EPSILON; }
  active(side) { return this.teams[side].find(u => this.alive(u)); }
  present(u) { return this.alive(u) && (this.mode === 'equipe' || this.active(u.side) === u); }

  blocked(u){return u.stunUntil>this.time||(this.freezeUntil>this.time&&this.freezeOwner!==u);}
  pace(u){
    if(u.hasteUntil>this.time)return .65;
    return this.hasteUntil[u.side]>this.time?.8:1;
  }
  beginAttack(u){
    if(!hasTrait(u,'Made in Heaven')||u.heavenUsed)return;
    const team=this.teams[u.side],before=team.map(f=>this.pace(f));
    u.heavenUsed=true;u.hasteUntil=this.time+4000;this.hasteUntil[u.side]=this.time+4000;
    team.forEach((f,i)=>{
      const ratio=this.pace(f)/before[i];
      if(f.nextBasic>this.time)f.nextBasic=this.time+(f.nextBasic-this.time)*ratio;
      if(f.ready>this.time/1000)f.ready=this.time/1000+(f.ready-this.time/1000)*ratio;
    });
    this.record('aceleração',u);
  }
  outgoingPower(source,damage,basic=false){
    const heaven=hasTrait(source,'Made in Heaven')?1.25:1;
    const nen=hasTrait(source,'Voto de Nen')?(source.nen?1.7:1.2):1;
    return damage*heaven*nen*(basic&&source.weakenUntil>this.time?.65:1);
  }

  hit(source, target, attack = {}) {
    const { damage = source.attack, magic = false, skill = true, area = false, reflected = false,
      removeShield = false, shieldMultiplier = 1, ignoreDefense = 0, blockRevive = false, delayOnBreak = 0 } = attack;
    if (!this.alive(source) || !this.present(target) || source.side === target.side) return false;
    if (!Number.isFinite(damage) || damage < 0 || !Number.isFinite(shieldMultiplier) || shieldMultiplier < 1) throw new RangeError('Dano ou multiplicador inválido.');
    if(!reflected)this.beginAttack(source);
    let victim = target,interceptFactor=1;
    if(!area&&!reflected){
      const guard=this.teams[target.side].find(u=>u!==target&&hasTrait(u,'Restrição Celestial')&&!this.blocked(u)&&this.alive(u)&&(u.guardUses??0)<2&&(this.mode==='duelo'||distance(u,target)<=30));
      if(guard){guard.guardUses=(guard.guardUses??0)+1;victim=guard;interceptFactor=.6;this.record('intercepta',guard,target);}
    }
    if (victim===target && !area && !reflected && this.mode === 'equipe') {
      const guard = this.teams[target.side].find(u => u !== target && !this.blocked(u) && this.alive(u) && u.intercept > 0 && u.protectUntil >= this.time && distance(u,target) <= 30);
      if (guard) {
        guard.intercept--;
        victim = guard;
        this.record('intercepta', guard, target);
      }
    }
    if (!area && !reflected && victim.evade > 0) {
      victim.evade--;
      this.record('esquiva', victim, source);
      if(hasTrait(victim,'Instinto Superior')&&!attack.counter&&!this.blocked(victim)&&this.present(source))this.hit(victim,source,{skill:false,counter:true,magic:!!victim.magicBasic,damage:victim.magicBasic?victim.magic:victim.attack});
      return true;
    }
    if(!area&&!reflected&&skill&&hasTrait(victim,'Haki da Observação')&&(victim.observeUses??0)<2&&!this.blocked(victim)&&this.present(source)){
      victim.observeUses=(victim.observeUses??0)+1;
      this.hit(victim,source,{skill:false,counter:true,damage:2*(victim.magicBasic?victim.magic:victim.attack),magic:!!victim.magicBasic});
      if(!this.alive(source))return true;
    }
    if (!area && !reflected && skill) {
      const mirror=magic&&this.teams[victim.side].find(u=>hasTrait(u,'Full Counter')&&!u.mirrorUsed&&this.alive(u)&&!this.blocked(u)&&(u===victim||this.mode==='duelo'||distance(u,victim)<=30));
      if(mirror){
        mirror.mirrorUsed=true;this.record('reflete',mirror,source);
        this.hit(mirror,this.present(source)?source:this.active(source.side),{...attack,damage:damage*1.5,reflected:true});
        return true;
      }
      const vector = this.teams[victim.side].find(u => this.alive(u) && u.vector > 0 && u.vectorReady <= this.time && (this.mode === 'duelo' || Math.abs(u.slot - victim.slot) <= 1));
      if (vector) {
        vector.vector--;
        vector.vectorReady = this.time + 8000;
        this.record('especial',vector,source,{name:vector.skill??'Controle Vetorial',role:'reação'});
        this.record('reflete', vector, source, { remaining: vector.vector });
        const returnTarget = this.present(source) ? source : this.active(source.side);
        if (returnTarget) this.hit(vector, returnTarget, { ...attack, damage, reflected: true });
        return true;
      }
    }
    const openPower = skill && !reflected && source.powerUntil > this.time;
    if (openPower) source.powerUntil = 0;
    const mitigation = (magic ? victim.resistance : victim.defense) * (1 - ignoreDefense);
    let value = this.outgoingPower(source,damage,!skill) * interceptFactor * (victim.domainWard?.85:1) * (victim.exposedUntil>this.time?1.15:1) * affinity(source.color,victim.color) * (openPower ? 1.3 : 1) * 40 / (40 + mitigation/(source.scale || 1));
    if(source.kotoUntil>this.time && (skill || false)){
      source.kotoUntil=0;
      value*=.65;
    }
    if(attack.koto)victim.kotoUntil=Infinity;
    const priorShield = victim.shield;
    if (removeShield) victim.shield = 0;
    const absorbed = Math.min(victim.shield, value * shieldMultiplier);
    victim.shield -= absorbed;
    value -= absorbed / shieldMultiplier;
    if (priorShield > 0 && victim.shield <= HP_EPSILON) {
      victim.shield = 0;
      victim.nextBasic += delayOnBreak;
      this.record('escudo rompe', source, victim);
    }
    if(victim.kind==='fiction'&&!victim.fictionSpent&&value>=victim.hp){
      victim.fictionSpent=true;this.record('apaga',victim,source);return true;
    }
    const actual = Math.min(victim.hp, value);
    victim.hp = Math.max(0, victim.hp - value);
    this.record('dano', source, victim, { hp: actual, reflected, remaining: victim.hp, skill });
    if (!this.alive(victim)) this.defeat(victim, source, blockRevive);
    return true;
  }

  defeat(victim, source, blockRevive) {
    if (victim.survive > 0) {
      victim.survive--;
      if(hasTrait(victim,"Zenkai")){victim.attack*=1.25;victim.magic*=1.25;}
      victim.hp = victim.maxHp * .3;
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
      if (successor) {
        successor.nextBasic = this.time + successor.interval;
        successor.graceUntil = this.time + SAMPLE_STEP;
        this.record('entra', successor);
      }
    }
  }

  heal(unit, amount) {
    if (!this.alive(unit)) return;
    unit.hp = Math.min(unit.maxHp, unit.hp + amount);
    this.record('cura', unit, undefined, { remaining: unit.hp });
  }

  use(actor,target,type,role='principal',launch){
    const used=this.cast(actor,target,type,role,launch);
    if(used&&actor.skill)this.record('especial',actor,target,{name:actor.skill,role});
    if(used&&role==='principal'&&hasTrait(actor,'The World')&&!actor.worldUsed){
      actor.worldUsed=true;this.freezeOwner=actor;this.freezeUntil=this.time+2000;
      actor.skillReady=this.time+Math.max(0,actor.skillReady-this.time)*.5;
      actor.nextBasic=Math.min(actor.nextBasic,this.time+SAMPLE_STEP);
      actor.ready=Math.min(actor.ready,actor.skillReady/1000);this.record('tempo parado',actor);
    }
    return used;
  }
  cast(actor, target, type, role = 'principal', launch) {
    if (!this.alive(actor) || !this.present(target)) return false;
    const deliver = launch ?? ((victim,options)=>this.hit(actor,victim,options));
    const strike = options => deliver(target,options);
    switch (type) {
      case 'singular_dio':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+10000;
        strike({damage:actor.attack*2.10,removeShield:true});
        for(let i=0;i<4&&this.present(target);i++)strike({damage:actor.attack*.25});
        if(this.present(target))strike({damage:actor.magic*.80,magic:true,area:true});
        return true;
      case 'singular_xeno':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+12000;
        strike({damage:actor.magic*2.15,magic:true});
        for(let i=0;i<2&&this.present(target);i++)strike({damage:actor.magic*.55,magic:true});
        return true;
      case 'singular_saitama':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        strike({damage:actor.attack*1.90});
        if(this.present(target))strike({damage:actor.attack*1.30});
        return true;
      case 'koto':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+8000;
        return strike({magic:true,koto:true,damage:actor.magic*1.5});
      case 'demonSword':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+7000;
        for(let i=0;i<3&&this.alive(actor)&&this.present(target);i++)
          strike({damage:actor.attack*.65,ignoreDefense:i===2?.5:0});
        return true;
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
        ally.shield=Math.max(ally.shield,2.2*actor.magic);
        this.record('protege',actor,ally);
        return strike({magic:true,damage:1.05*actor.magic});
      }
      case 'barreira':
        if(actor.skillReady>this.time)return false;
        actor.skillReady=this.time+9000;
        for(const ally of this.teams[actor.side].filter(u=>this.present(u))){
          ally.shield=Math.max(ally.shield,actor.defense*(ally===actor?1.8:1));
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
      case 'instinto':
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
          if(domain&&!launch)applyStun(foe,this.time+1500);
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
        if(actor.uses===0&&ally.hp<=ally.maxHp*.4){
          actor.uses++;
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
        if(!launch)target.weakenUntil=Math.max(target.weakenUntil,this.time+4000);
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
        actor.shield = Math.max(actor.shield,actor.magic * 1.1);
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
        else { ally.shield=Math.max(ally.shield,actor.magic*2);this.record('protege',actor,ally); }
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
        if (actor.uses >= 2 || actor.skillReady > this.time) return false;
        actor.uses++;
        actor.skillReady = this.time + 12000;
        this.teams[target.side].filter(u=>this.alive(u)).forEach(u=>{u.weakenUntil = this.time + 4000;});
        this.teams[actor.side].filter(u=>this.alive(u)).forEach(u=>{u.powerUntil = this.time + 4000;});
        this.record('dimensão', actor, target);
        return true;
      }
      case 'saitama': {
        if (actor.uses >= 2 || actor.skillReady > this.time || target.actions - (actor.seenId === target.id ? actor.seenActions : 0) < 3) return false;
        actor.uses++;
        actor.skillReady = this.time + 10000;
        actor.seenId = target.id;
        actor.seenActions = target.actions;
        return strike({ damage: actor.attack * 2.8, removeShield: true, ignoreDefense: .5 });
      }
      default: return false;
    }
  }

  nextSample() {
    let next = this.limit + SAMPLE_STEP;
    for (const team of this.teams) {
      const active = this.mode === 'duelo' ? this.active(team[0].side) : null;
      for (const unit of team) {
        if (!this.alive(unit)) continue;
        const reserve = active && unit !== active;
        const ready = reserve ? unit.nextAssist : Math.max(unit.nextBasic, unit.graceUntil);
        const unfrozen = this.freezeOwner === unit ? 0 : (this.freezeUntil ?? 0);
        next = Math.min(next, Math.max(ready, unit.stunUntil ?? 0, unfrozen));
      }
    }
    // Keep the existing 100 ms event grid and never revisit a processed tick.
    return Math.max(this.time + SAMPLE_STEP, Math.ceil(next / SAMPLE_STEP) * SAMPLE_STEP);
  }

  run() {
    for (this.time = SAMPLE_STEP; this.time <= this.limit; this.time = this.nextSample()) {
      if (!this.active(0) || !this.active(1)) break;
      const order = (this.time / SAMPLE_STEP) % 2 ? [0, 1] : [1, 0];
      for (const side of order) {
        const own = this.active(side);
        if (!own) continue;
        for (const actor of this.mode === 'duelo' ? [own] : this.teams[side]) {
          if (actor.nextBasic > this.time || actor.graceUntil > this.time || !this.present(actor) || this.blocked(actor)) continue;
          let target = this.active(1-side);
          if (this.mode === 'equipe' && target) {
            for (const enemy of this.teams[1-side])
              if (this.alive(enemy) && (enemy.x ?? -enemy.slot) > (target.x ?? -target.slot)) target = enemy;
          }
          if (!target) continue;
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

