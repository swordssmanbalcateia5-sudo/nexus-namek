const serials=(()=>{


// Reserve the old per-account numbering ranges once, including gaps left by sales.
function serialSchema(players,hasRanks){
  const kind="json_extract(u.value,'$.id') || CASE WHEN json_extract(u.value,'$.shiny') THEN '-shiny' ELSE '' END";
  const base=(value)=>`coalesce((SELECT offset FROM nexus_legacy_ranges WHERE owner=p.id AND kind=json_extract(${value},'$.id') || CASE WHEN json_extract(${value},'$.shiny') THEN '-shiny' ELSE '' END),0)`;
  const mapped=(value)=>`json_set(${value},'$.serial',json_extract(${value},'$.serial')+${base(value)})`;
  const array=(source)=>`(SELECT json_group_array(json(${mapped('u.value')})) FROM json_each(${source}) u)`;
  let entry='u.value';
  for(const field of ['recruit','sold']){
    const obj=`json_extract(u.value,'$.${field}')`;
    entry=`json_set(${entry},'$.${field}',json(CASE WHEN json_type(u.value,'$.${field}')='object' THEN ${mapped(obj)} ELSE NULL END))`;
  }
  return [
    'CREATE TABLE IF NOT EXISTS nexus_serials(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, counts TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS nexus_legacy_ranges(owner TEXT,kind TEXT,offset INTEGER,amount INTEGER,PRIMARY KEY(owner,kind))',
    `INSERT INTO nexus_legacy_ranges
     WITH source AS (
       SELECT p.id owner,${kind} kind,json_extract(u.value,'$.serial') n,json_extract(p.game,'$.created') created FROM ${players} p,json_each(p.game,'$.collection') u WHERE NOT EXISTS(SELECT 1 FROM nexus_serials)
       UNION ALL SELECT p.id,u.key,u.value,json_extract(p.game,'$.created') FROM ${players} p,json_each(p.game,'$.serials') u WHERE NOT EXISTS(SELECT 1 FROM nexus_serials)
     ), limits AS (SELECT owner,kind,max(n) amount,created FROM source GROUP BY owner,kind)
     SELECT owner,kind,coalesce(sum(amount) OVER(PARTITION BY kind ORDER BY created,owner ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0),amount FROM limits`,
    `UPDATE ${players} AS p SET game=json_set(game,'$.collection',json(${array("p.game,'$.collection'")}),'$.log',json((SELECT json_group_array(json(${entry})) FROM json_each(p.game,'$.log') u)))${hasRanks?`,top_units=${array('p.top_units')},rare_units=${array('p.rare_units')}`:''} WHERE NOT EXISTS(SELECT 1 FROM nexus_serials)`,
    "INSERT OR IGNORE INTO nexus_serials SELECT 1,0,json_group_object(kind,n) FROM (SELECT kind,sum(amount) n FROM nexus_legacy_ranges GROUP BY kind)",
    ...['INSERT','UPDATE OF game'].map((event,i)=>`CREATE TRIGGER IF NOT EXISTS nexus_issue_${i} AFTER ${event} ON ${players}
      WHEN json_extract(NEW.game,'$.issuance.revision')=(SELECT revision+1 FROM nexus_serials WHERE id=1)
      BEGIN UPDATE nexus_serials SET revision=revision+1,counts=json_patch(counts,json_extract(NEW.game,'$.issuance.counts')) WHERE id=1; END`)
  ];
}
function issueSerials(state,units,counter){
  delete state.issuance;
  if(!units.length)return;
  const previous=JSON.parse(counter.counts),counts={};
  for(const unit of units){
    const key=unit.id+(unit.shiny?'-shiny':'');
    unit.serial=counts[key]=(counts[key]??previous[key]??0)+1;
  }
  state.issuance={revision:counter.revision+1,counts};
}


return {serialSchema,issueSerials};
})();
const engine=(()=>{
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

function applyStun(unit,until){
  if(unit.ccImmune){unit.ccImmune=false;return;}
  unit.stunUntil=Math.max(unit.stunUntil??0,until);
}

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
return {affinity,Combate};
})();
const communityRules=(()=>{
// A daily period is keyed by the local calendar date on which its noon began.
const DAILY_ZONE='America/Sao_Paulo';
const GIFT_GOLD=10;
const PROFILE_OPTIONS={
  background:{hoova:'Hoova · Floresta do Susanoo',zawa:'Zawa · Pátio do Demônio Celestial',careca:'Careca · Página apagada',namek:'Namek · Dragon Ball',arlong:'Arlong Park · One Piece',konoha:'Konoha · Naruto',
    seireitei:'Seireitei · Bleach',shibuya:'Shibuya · Jujutsu Kaisen',clover:'Reino Clover · Black Clover',
    britannia:'Britannia · Nanatsu no Taizai',morioh:'Morioh · JoJo',heavens:'Heavens Arena · Hunter × Hunter',
    cidadez:'Cidade Z · One Punch Man',noite:'Noite violeta',aurora:'Aurora turquesa'},
  icon:{estrela:'Estrela',cometa:'Cometa',escudo:'Escudo'},
  border:{menta:'Menta',violeta:'Violeta',ouro:'Ouro'},
};
const DEFAULT_PROFILE={background:'namek',icon:'estrela',border:'menta'};
const PROFILE_WORLDS={namek:0,arlong:1,konoha:2,seireitei:3,shibuya:4,clover:5,britannia:6,morioh:7,heavens:8,cidadez:9};
const AVATAR_SIZE=128;
const PROFILE_BODY_LIMIT=100*1024;

// The browser sends only its square canvas export, never a remote image URL.
function validAvatar(value){
  const prefix='data:image/png;base64,';
  if(typeof value!=='string'||value.length>98000||!value.startsWith(prefix))return false;
  const encoded=value.slice(prefix.length);
  if(encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return false;
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const signature=[137,80,78,71,13,10,26,10];
  if(bytes.length<57||!signature.every((b,i)=>bytes[i]===b))return false;
  const view=new DataView(bytes.buffer);
  let hasData=false;
  for(let pos=8;pos+12<=bytes.length;){
    const length=view.getUint32(pos);
    const kind=String.fromCharCode(...bytes.subarray(pos+4,pos+8));
    const end=pos+12+length;
    if(end>bytes.length)return false;
    if(pos===8){
      if(kind!=='IHDR'||length!==13||view.getUint32(16)!==AVATAR_SIZE||view.getUint32(20)!==AVATAR_SIZE||
          bytes[24]!==8||![2,6].includes(bytes[25])||bytes[26]||bytes[27]||bytes[28])return false;
    }else if(kind==='IDAT')hasData ||= length>0;
    else if(kind==='IEND')return hasData&&length===0&&end===bytes.length;
    else if(!['sRGB','pHYs','cHRM','gAMA','iCCP','sBIT','cICP'].includes(kind))return false;
    pos=end;
  }
  return false;
}
function canEquipBackground(key,code){
  const owners={hoova:'0DA6605BD4',zawa:'89B75CB773',careca:'4A6913795B'};
  return !Object.hasOwn(owners,key)||owners[key]===code;
}
function appearancePatch(input,code){
  if(!canEquipBackground(input?.background,code))throw Error('Este fundo pertence a outro jogador.');
  const patch={};
  for(const key of Object.keys(DEFAULT_PROFILE)){
    if(typeof input?.[key]!=='string'||!Object.hasOwn(PROFILE_OPTIONS[key],input[key]))throw Error('Escolha as opções de aparência do perfil.');
    patch[key]=input[key];
  }
  if(Object.hasOwn(input,'avatar')){
    if(input.avatar!==null&&!validAvatar(input.avatar))throw Error('A foto precisa ser uma imagem válida. Escolha o arquivo novamente.');
    patch.avatar=input.avatar;
  }
  return patch;
}
const localParts=new Intl.DateTimeFormat('en-GB',{
  timeZone:DAILY_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
  minute:'2-digit',second:'2-digit',hourCycle:'h23',
});
function localFields(time){
  return Object.fromEntries(localParts.formatToParts(time).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
function localNoon(plainDate){
  const desired=plainDate+12*3600000;
  let time=desired;
  for(let attempt=0;attempt<3;attempt++){
    const f=localFields(time);
    const actual=Date.UTC(f.year,f.month-1,f.day,f.hour,f.minute,f.second);
    if(actual===desired)return time;
    time+=desired-actual;
  }
  return time;
}
function dailyCycle(now=Date.now()){
  const f=localFields(now);
  const today=Date.UTC(f.year,f.month-1,f.day);
  const startDate=today-(f.hour<12?86400000:0);
  return {day:new Date(startDate).toISOString().slice(0,10),nextAt:localNoon(startDate+86400000)};
}

// Weekly cycle resets every Monday at 12:00 America/Sao_Paulo.
function weeklyCycle(now=Date.now()){
  const {day}=dailyCycle(now);
  const d=Date.parse(day+'T00:00:00Z');
  const dow=(new Date(d).getUTCDay()+6)%7; // 0 = Monday .. 6 = Sunday
  const monday=d-dow*86400000;
  const prevMonday=monday-7*86400000;
  return {
    week:new Date(monday).toISOString().slice(0,10),
    prevWeek:new Date(prevMonday).toISOString().slice(0,10),
    nextAt:localNoon(monday+7*86400000),
    index:Math.floor(monday/(7*86400000))
  };
}

const ARENA_LEAGUES=[
  {id:'bronze',name:'Bronze',min:0,color:'#cd9b6a',reward:{trophies:3,tokens:1,essence:1}},
  {id:'prata',name:'Prata',min:100,color:'#c9d4e4',reward:{trophies:6,tokens:2,essence:2}},
  {id:'ouro',name:'Ouro',min:200,color:'#f5d66c',reward:{trophies:10,tokens:3,essence:3}},
  {id:'platina',name:'Platina',min:320,color:'#7ce7df',reward:{trophies:15,tokens:5,essence:5}},
  {id:'diamante',name:'Diamante',min:450,color:'#98b8ff',reward:{trophies:22,tokens:7,essence:7}},
  {id:'transcendente',name:'Transcendente',min:600,color:'#ff9cf2',reward:{trophies:30,tokens:10,essence:10}},
];
function arenaLeague(points=0){
  let current=ARENA_LEAGUES[0];
  for(const l of ARENA_LEAGUES){if(points>=l.min)current=l;}
  return current;
}

const ARENA_SHOP=[
  {id:'token',name:'Token de reroll',desc:'Rola as traits de um slot.',cost:5,grant:{traitItems:1}},
  {id:'xpTome',name:'Tomo de XP',desc:'+250.000 XP instantâneo para um personagem.',cost:6,grant:{xpTome:1}},
  {id:'essence2',name:'Essência de Despertar ×2',desc:'Substitui duplicatas no Despertar (★1–★5).',cost:8,grant:{essence:2}},
  {id:'catalyst',name:'Catalisador de Trait',desc:'Triplica chance de 2–3 traits e garante Rara+.',cost:15,grant:{catalyst:1}},
  {id:'traitLock',name:'Selo de Trava de Trait',desc:'Trava 1 trait atual durante o reroll.',cost:20,grant:{traitLock:1}},
];

const GOLD_SHOP=[
  {id:'token',name:'Token de reroll',desc:'Preço sobe a cada compra na semana.',base:150000,step:75000,limit:10,grant:{traitItems:1}},
  {id:'essence',name:'Essência de Despertar',desc:'Desperta personagens sem precisar de cópia.',base:120000,step:40000,limit:10,grant:{essence:1}},
  {id:'xpTome',name:'Tomo de XP',desc:'+250.000 XP instantâneo em qualquer unidade.',base:100000,step:25000,limit:5,grant:{xpTome:1}},
  {id:'elixir',name:'Elixir de Recuperação',desc:'Zera imediatamente a recuperação da equipe.',base:25000,step:5000,limit:10,grant:{elixir:1}},
  {id:'catalyst',name:'Catalisador de Trait',desc:'3× chance de 2–3 traits e mínimo Rara+.',base:350000,step:150000,limit:3,grant:{catalyst:1}},
  {id:'traitLock',name:'Selo de Trava de Trait',desc:'Mantém 1 trait escolhida ao rolar o slot.',base:500000,step:250000,limit:2,grant:{traitLock:1}},
];

function rarityLabel(odds){
  const format=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
  for(const [divisor,suffix] of [[1e9,'B'],[1e6,'M'],[1e3,' mil']]){
    if(odds>=divisor)return '1/'+format.format(odds/divisor)+suffix;
  }
  return '1/'+format.format(odds);
}
return {DAILY_ZONE,GIFT_GOLD,PROFILE_OPTIONS,DEFAULT_PROFILE,PROFILE_WORLDS,AVATAR_SIZE,PROFILE_BODY_LIMIT,canEquipBackground,appearancePatch,dailyCycle,weeklyCycle,ARENA_LEAGUES,arenaLeague,ARENA_SHOP,GOLD_SHOP,rarityLabel};
})();
const duelEngine=(()=>{
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
      for(const u of team){
        if(hasTrait(u,'Kaidō'))u.shield+=u.maxHp*.18;
        if(hasTrait(u,'Domínio Absoluto')){u.shield+=u.maxHp*.25;u.domainWard=true;u.ccImmune=true;}
      }
    }
    for(const team of this.teams){
      const king=team.find(u=>hasTrait(u,'Haki do Rei'));
      if(king)for(const foe of this.teams[1-king.side]){
        applyNegative(foe,'stunUntil',1500);
        applyNegative(foe,'exposedUntil',1500);
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
    const rage=basic&&source.rageUntil>this.time?1+.08*source.rageBonus:1;
    return damage*heaven*nen*rage*pucciMultiplier(source,this.time)*(basic&&source.invertedAttackUntil>this.time?1.35:1)*(basic&&source.weakenUntil>this.time?.65:1);
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
      if(guard){guard.guardUses=(guard.guardUses??0)+1;victim=guard;interceptFactor=.6;this.record('intercepta',guard,target);}
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
        this.hit(mirror,this.present(source)?source:this.active(source.side),{...attack,damage:damage*1.5,reflected:true});
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
    let value = (attack.vectorPower??this.outgoingPower(source,damage,!skill)) * interceptFactor * (victim.domainWard?.85:1) * (victim.exposedUntil>this.time?1.15:1) * affinity(source.color,victim.color) * (openPower ? 1.3 : 1) * 40 / (40 + mitigation/(source.scale || 1));
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
  if(stunned&&unit.ccImmune){
    unit.ccImmune=false;
    unit.controlResistedAt=t;
    return;
  }
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
return {collisionBonus,collisionPower,createDuel,finishDuel,stepDuel,pucciMultiplier,bossKits,BOSS_FINISH_FX};
})();
const game=(()=>{
const {Combate,affinity}=engine;
const {createDuel,finishDuel,bossKits}=duelEngine;
const {dailyCycle,weeklyCycle,ARENA_SHOP,GOLD_SHOP}=communityRules;

const AREAS = [
  { id:'entrada', name:'Costa de Namek', description:'Patrulhas do império rondam o litoral.', levels:[1,3], unlock:1, enemy:'Soldado da Tropa Freeza', base:[150,18,9,9], color:'Roxo' },
  { id:'meio', name:'Planícies Verdes', description:'O terreno aberto favorece as tropas de elite.', levels:[4,6], unlock:4, enemy:'Veterano da Tropa Freeza', base:[220,23,12,12], color:'Amarelo' },
  { id:'final', name:'Base de Freeza', description:'Vença 15 encontros nesta área para liberar Freeza.', levels:[7,10], unlock:7, enemy:'Oficial da Tropa Freeza', base:[300,28,14,14], color:'Vermelho' },
];
const BOSS = {name:'Freeza · Forma Final',base:[520,38,18,18], color:'Roxo'};
const WORLDS = [
  {
    name:"Namek", universe:"Dragon Ball",
    areas:AREAS,
    elite:{"name": "Capitão Ginyu", "level": 11, "base": [380, 33, 16, 16]},
    boss:{"name": "Freeza · forma final", "arenaKind": "boss_freeza", "level": 12, "base": [520, 38, 18, 18], "kind": "freeza-boss", "color": "Roxo"},
  },
  {
    name:"Arlong Park", universe:"One Piece",
    areas:[
      {"name": "Costa de Cocoyasi", "enemy": "Vigia dos Piratas Arlong", "levels": [11, 13], "unlock": 1, "base": [150, 18, 9, 9], "color": "Amarelo", "description": "Vigia dos Piratas Arlong"},
      {"name": "Vila de Cocoyasi", "enemy": "Homem-peixe dos Piratas Arlong", "levels": [14, 16], "unlock": 14, "base": [220, 23, 12, 12], "color": "Vermelho", "description": "Homem-peixe dos Piratas Arlong"},
      {"name": "Fortaleza de Arlong", "enemy": "Veterano dos Piratas Arlong", "levels": [17, 20], "unlock": 17, "base": [300, 28, 14, 14], "color": "Azul", "description": "Veterano dos Piratas Arlong"}
    ],
    elite:{"name": "Kuroobi", "level": 21, "base": [385, 33, 16, 16]},
    boss:{"name": "Arlong", "arenaKind": "boss_arlong", "level": 22, "base": [532, 38, 18, 18], "kind": "rush", "color": "Azul"},
  },
  {
    name:"Exames Chūnin", universe:"Naruto",
    areas:[
      {"name": "Portões da Folha", "enemy": "Genin rival", "levels": [21, 23], "unlock": 1, "base": [150, 18, 9, 9], "color": "Vermelho", "description": "Genin rival"},
      {"name": "Floresta da Morte", "enemy": "Genin da Vila do Som", "levels": [24, 26], "unlock": 24, "base": [220, 23, 12, 12], "color": "Azul", "description": "Genin da Vila do Som"},
      {"name": "Arena dos Exames", "enemy": "Genin da Vila da Areia", "levels": [27, 30], "unlock": 27, "base": [300, 28, 14, 14], "color": "Verde", "description": "Genin da Vila da Areia"}
    ],
    elite:{"name": "Neji Hyūga", "level": 31, "base": [390, 33, 16, 16]},
    boss:{"name": "Gaara · transformação parcial", "arenaKind": "boss_gaara", "level": 32, "base": [544, 38, 18, 18], "kind": "ward", "color": "Laranja"},
  },
  {
    name:"Soul Society", universe:"Bleach",
    areas:[
      {"name": "Rukongai", "enemy": "Shinigami em patrulha", "levels": [31, 33], "unlock": 1, "base": [150, 18, 9, 9], "color": "Azul", "description": "Shinigami em patrulha"},
      {"name": "Muralhas do Seireitei", "enemy": "Soldado da guarda do Seireitei", "levels": [34, 36], "unlock": 34, "base": [220, 23, 12, 12], "color": "Verde", "description": "Soldado da guarda do Seireitei"},
      {"name": "Colina de Sōkyoku", "enemy": "Oficial de esquadrão", "levels": [37, 40], "unlock": 37, "base": [300, 28, 14, 14], "color": "Turquesa", "description": "Oficial de esquadrão"}
    ],
    elite:{"name": "Renji Abarai", "level": 41, "base": [395, 33, 16, 16]},
    boss:{"name": "Byakuya Kuchiki", "arenaKind": "boss_byakuya", "level": 42, "base": [556, 38, 18, 18], "kind": "beam", "color": "Rosa"},
  },
  {
    name:"Jujutsu Kaisen", universe:"Jujutsu Kaisen",
    areas:[
      {"name": "Escola de Jujutsu", "enemy": "Maldição menor", "levels": [41, 43], "unlock": 1, "base": [150, 18, 9, 9], "color": "Verde", "description": "Maldição menor"},
      {"name": "Distrito amaldiçoado", "enemy": "Maldição de distrito", "levels": [44, 46], "unlock": 44, "base": [220, 23, 12, 12], "color": "Turquesa", "description": "Maldição de distrito"},
      {"name": "Domínio vulcânico", "enemy": "Maldição de grau 2", "levels": [47, 50], "unlock": 47, "base": [300, 28, 14, 14], "color": "Rosa", "description": "Maldição de grau 2"}
    ],
    elite:{"name": "Portador de Dedo", "level": 51, "base": [400, 33, 16, 16]},
    boss:{"name": "Jogo", "level": 52, "base": [568, 38, 18, 18], "kind": "ginyu", "color": "Vermelho"},
  },
  {
    name:"Black Clover", universe:"Black Clover",
    areas:[
      {"name": "Vila de Hage", "enemy": "Recruta do Olho do Sol da Meia-Noite", "levels": [51, 53], "unlock": 1, "base": [150, 18, 9, 9], "color": "Turquesa", "description": "Recruta do Olho do Sol da Meia-Noite"},
      {"name": "Floresta encantada", "enemy": "Mago do Olho do Sol da Meia-Noite", "levels": [54, 56], "unlock": 54, "base": [220, 23, 12, 12], "color": "Rosa", "description": "Mago do Olho do Sol da Meia-Noite"},
      {"name": "Templo submerso", "enemy": "Veterano do Olho do Sol da Meia-Noite", "levels": [57, 60], "unlock": 57, "base": [300, 28, 14, 14], "color": "Laranja", "description": "Veterano do Olho do Sol da Meia-Noite"}
    ],
    elite:{"name": "Fana", "level": 61, "base": [405, 33, 16, 16]},
    boss:{"name": "Vetto", "level": 62, "base": [580, 38, 18, 18], "kind": "rush", "color": "Verde"},
  },
  {
    name:"Nanatsu no Taizai", universe:"Nanatsu no Taizai",
    areas:[
      {"name": "Arredores de Liones", "enemy": "Recruta de Liones", "levels": [61, 63], "unlock": 1, "base": [150, 18, 9, 9], "color": "Rosa", "description": "Recruta de Liones"},
      {"name": "Cidade de Liones", "enemy": "Cavaleiro de Liones", "levels": [64, 66], "unlock": 64, "base": [220, 23, 12, 12], "color": "Laranja", "description": "Cavaleiro de Liones"},
      {"name": "Castelo real", "enemy": "Cavaleiro Sagrado", "levels": [67, 70], "unlock": 67, "base": [300, 28, 14, 14], "color": "Roxo", "description": "Cavaleiro Sagrado"}
    ],
    elite:{"name": "Dreyfus", "level": 71, "base": [410, 33, 16, 16]},
    boss:{"name": "Hendrickson · forma demoníaca", "level": 72, "base": [592, 38, 18, 18], "kind": "beam", "color": "Preto"},
  },
  {
    name:"JoJo", universe:"JoJo",
    areas:[
      {"name": "Ruas do Cairo", "enemy": "Capanga de DIO", "levels": [71, 73], "unlock": 1, "base": [150, 18, 9, 9], "color": "Laranja", "description": "Capanga de DIO"},
      {"name": "Distrito antigo", "enemy": "Usuário de Stand a serviço de DIO", "levels": [74, 76], "unlock": 74, "base": [220, 23, 12, 12], "color": "Roxo", "description": "Usuário de Stand a serviço de DIO"},
      {"name": "Mansão de DIO", "enemy": "Usuário de Stand veterano", "levels": [77, 80], "unlock": 77, "base": [300, 28, 14, 14], "color": "Amarelo", "description": "Usuário de Stand veterano"}
    ],
    elite:{"name": "Vanilla Ice", "level": 81, "base": [415, 33, 16, 16]},
    boss:{"name": "DIO · The World", "level": 82, "base": [604, 38, 18, 18], "kind": "rush", "color": "Amarelo"},
  },
  {
    name:"Hunter × Hunter", universe:"Hunter × Hunter",
    areas:[
      {"name": "Fronteira de NGL", "enemy": "Formiga Quimera operária", "levels": [81, 83], "unlock": 1, "base": [150, 18, 9, 9], "color": "Roxo", "description": "Formiga Quimera operária"},
      {"name": "Território das formigas", "enemy": "Formiga Quimera soldado", "levels": [84, 86], "unlock": 84, "base": [220, 23, 12, 12], "color": "Amarelo", "description": "Formiga Quimera soldado"},
      {"name": "Palácio Real", "enemy": "Formiga Quimera capitã", "levels": [87, 90], "unlock": 87, "base": [300, 28, 14, 14], "color": "Vermelho", "description": "Formiga Quimera capitã"}
    ],
    elite:{"name": "Neferpitou", "level": 91, "base": [420, 33, 16, 16]},
    boss:{"name": "Meruem", "level": 92, "base": [616, 38, 18, 18], "kind": "rush", "color": "Verde"},
  },
  {
    name:"One Punch Man", universe:"One Punch Man",
    areas:[
      {"name": "Periferia da Cidade Z", "enemy": "Monstro nível Lobo", "levels": [91, 93], "unlock": 1, "base": [150, 18, 9, 9], "color": "Amarelo", "description": "Monstro nível Lobo"},
      {"name": "Zona evacuada", "enemy": "Monstro nível Tigre", "levels": [94, 96], "unlock": 94, "base": [220, 23, 12, 12], "color": "Vermelho", "description": "Monstro nível Tigre"},
      {"name": "Covil dos monstros", "enemy": "Monstro nível Demônio", "levels": [97, 100], "unlock": 97, "base": [300, 28, 14, 14], "color": "Azul", "description": "Monstro nível Demônio"}
    ],
    elite:{"name": "Rei do Mar Profundo", "level": 101, "base": [425, 33, 16, 16]},
    boss:{"name": "Boros", "level": 102, "base": [628, 38, 18, 18], "kind": "freeza-boss", "color": "Vermelho"},
  }
];
const worldOf = state=>WORLDS[state.world??0];
const levelCap = state=>10*(1+(state.unlocked??0));
const COLORS = {Verde:'#71dd9f',Laranja:'#ffab68',Amarelo:'#f5d66c',Azul:'#83baff',Branco:'#ecebff',Roxo:'#cc95ff',Rosa:'#f592bc',Preto:'#a8a2be',Vermelho:'#ff8290',Turquesa:'#70e1da',Dourado:'#ffe28a'};
const TIERS = ['Comum','Incomum','Rara','Épica','Mítica','Divina','Secreta','Transcendente'];
// PV, ataque, magia, defesa, resistência e velocidade no nível 1, antes da função.
// Degrau de +22% a +30% por raridade, garantindo Tier N Normal < Tier N Shiny (+12%) < Tier N+1 Normal.
const baseStats = [
  [100, 20, 20, 12, 12, 100],
  [122, 24, 24, 15, 15, 102],
  [150, 30, 30, 18, 18, 104],
  [185, 37, 37, 22, 22, 106],
  [230, 46, 46, 28, 28, 109],
  [290, 58, 58, 35, 35, 112],
  [370, 74, 74, 44, 44, 116],
  [480, 96, 96, 58, 58, 120]
];
const roles = {Combatente:[.10,.25,-.15,0,0,0],Guardião:[.25,-.10,0,.25,.15,0],Mágico:[-.15,0,.30,0,.10,0],Suporte:[0,-.15,.15,0,.15,.05]};
const roster = [
  ["hoova-shisui","Hoova · Shisui Uchiha",6,"Verde","Mágico","koto","Kotoamatsukami",["Verde",{magic:15,speed:8}],"ap-hoova-shisui","Naruto"],
  ["zawa-cheon","Zawa · Cheon Yeo Woon",7,"Roxo","Combatente","demonSword","Espada do Demônio Celestial",["Roxo",{attack:20,speed:8}],"ap-zawa-cheon","Nano Machine"],
  ["careca-kumagawa","Careca · Kumagawa Misogi",8,"Preto","Suporte","fiction","All Fiction",["Equipe",{magic:18,resistance:10}],"ap-careca-kumagawa","Medaka Box"],
  ["shinra_banshoman", "Shinra Banshōman", 8, "Dourado", "Combatente", "reescrita", "Reescrita da Realidade", ["Equipe", {"hp": 12, "attack": 14}], "fighter", "Fire Force"],
  ["benimaru_shinmon", "Benimaru Shinmon", 7, "Vermelho", "Combatente", "nichirin", "Nichirin", ["Fire Force", {"attack": 20, "magic": 8}], "fighter", "Fire Force"],
  ["luminous", "Luminous Valentine", 7, "Rosa", "Suporte", "ciclo_vital", "Ciclo de Vida e Morte", ["Equipe", {"hp": 12, "resistance": 6}], "support", "Tensei Shitara Slime Datta Ken"],
  ["veldora", "Veldora Tempest", 7, "Turquesa", "Mágico", "tempestade", "Tempestade do Dragão", ["Turquesa", {"magic": 22, "speed": 8}], "freeza", "Tensei Shitara Slime Datta Ken"],

  ["mayuri", "Mayuri Kurotsuchi", 5, "Roxo", "Mágico", "ashisogi", "Ashisogi Jizō", ["Mágico", {"magic": 15}], "support", "Bleach"],
  ["starrk", "Coyote Starrk", 6, "Azul", "Mágico", "metralleta", "Cero Metralleta", ["Mágico", {"magic": 13, "speed": 6}], "fighter", "Bleach"],
  ["yoruichi", "Yoruichi Shihōin", 5, "Amarelo", "Combatente", "shunko", "Shunkō", ["Combatente", {"attack": 10, "speed": 8}], "fighter", "Bleach"],
  ["urahara", "Kisuke Urahara", 6, "Verde", "Suporte", "benihime", "Benihime · Escudo de Sangue", ["Suporte", {"magic": 17, "resistance": 10}], "support", "Bleach"],
  ["shinra", "Shinra Kusakabe", 4, "Vermelho", "Combatente", "rush", "Chute de Ignição", ["Vermelho", {"attack": 12}], "fighter", "Fire Force"],
  ["arthur", "Arthur Boyle", 4, "Azul", "Combatente", "excalibur", "Excalibur", ["Azul", {"attack": 12}], "fighter", "Fire Force"],
  ["maki_oze", "Maki Oze", 3, "Laranja", "Guardião", "ward", "Guarda das Chamas", ["Laranja", {"hp": 10}], "namek", "Fire Force"],
  ["iris", "Iris", 2, "Branco", "Suporte", "heal", "Prece da Companhia 8", ["Branco", {"hp": 10}], "support", "Fire Force"],
  ["piccolo", "Piccolo", 4, "Verde", "Guardião", "piccolo", "Proteção Namekuseijin", ["Dragon Ball", {"defense": 12, "resistance": 12}], "namek"],
  ["yamcha", "Yamcha", 1, "Laranja", "Combatente", "yamcha", "Punho do Lobo", ["Combatente", {"attack": 8}], "fighter"],
  ["kuririn", "Kuririn", 2, "Amarelo", "Mágico", "kuririn", "Disco Cortante", ["Amarelo", {"magic": 10}], "monk"],
  ["bulma", "Bulma", 1, "Azul", "Suporte", "bulma", "Cápsula de Proteção", ["Azul", {"hp": 8}], "support"],
  ["tenshinhan", "Tenshinhan", 3, "Branco", "Suporte", "ward", "Taiyōken", ["Branco", {"speed": 10}], "monk"],
  ["gohan", "Gohan · Namek", 4, "Amarelo", "Combatente", "rush", "Explosão de Raiva", ["Amarelo", {"attack": 10}], "fighter"],
  ["freeza", "Freeza · Forma Final", 5, "Roxo", "Mágico", "death_ray", "Raio da Morte", ["Roxo", {"magic": 17}], "freeza"],
  ["android17", "Android 17", 6, "Verde", "Guardião", "barreira", "Barreira Contínua", ["Equipe", {"defense": 10, "resistance": 10}], "fighter"],
  ["vegeta", "Vegeta · Blue", 7, "Azul", "Combatente", "final_flash", "Final Flash", ["Dragon Ball", {"attack": 18, "magic": 8}], "fighter"],
  ["broly", "Broly · Super", 7, "Verde", "Combatente", "furia", "Fúria Crescente", ["Combatente", {"attack": 18, "hp": 8}], "namek"],
  ["goku", "Goku · Instinto Superior", 8, "Branco", "Combatente", "instinto", "Resposta Instintiva", ["Equipe", {"attack": 14, "speed": 8}], "fighter"],
  ["beerus", "Beerus", 8, "Roxo", "Mágico", "beerus", "Hakai", ["Mágico", {"magic": 22}], "freeza"],
  ["usopp", "Usopp", 1, "Amarelo", "Suporte", "heal", "Estilingue", ["Amarelo", {"hp": 8}], "support", "One Piece"],
  ["nami", "Nami", 2, "Turquesa", "Mágico", "beam", "Nuvem de Tempestade", ["Turquesa", {"magic": 10}], "support", "One Piece"],
  ["rocklee", "Rock Lee", 3, "Verde", "Combatente", "rush", "Lótus Primária", ["Verde", {"speed": 10}], "fighter", "Naruto"],
  ["zoro", "Zoro", 4, "Verde", "Combatente", "rush", "Santōryū", ["Verde", {"attack": 12}], "fighter", "One Piece"],
  ["law", "Trafalgar Law", 5, "Azul", "Suporte", "room", "ROOM", ["Equipe", {"hp": 8, "magic": 8}], "support", "One Piece"],
  ["gojo", "Gojo", 8, "Azul", "Mágico", "dominio", "Vazio Ilimitado", ["Equipe", {"magic": 15, "resistance": 8}], "fighter", "Jujutsu Kaisen"],
  ["netero", "Netero", 6, "Dourado", "Combatente", "bodisatva", "Mãos do Bodisatva", ["Combatente", {"attack": 12, "speed": 8}], "monk", "Hunter × Hunter"],
  ["mob", "Mob · ???%", 7, "Preto", "Mágico", "despertar", "Despertar Psíquico", ["Mágico", {"hp": 12, "magic": 16}], "support", "Mob Psycho 100"],
  ["accelerator", "Accelerator", 8, "Branco", "Guardião", "accelerator", "Controle Vetorial", ["Guardião", {"defense": 20, "resistance": 20}], "fighter", "Toaru"],
  ["sukuna-forma-original", "Sukuna · forma original", 8, "Vermelho", "Mágico", "beam", "Santuário Malevolente", ["Mágico", {"magic": 8}], "ap-sukuna-forma-original", "Jujutsu Kaisen"],
  ["nanami", "Nanami", 4, "Amarelo", "Combatente", "rush", "Proporção 7:3", ["Combatente", {"attack": 8}], "ap-nanami", "Jujutsu Kaisen"],
  ["maki-desperta", "Maki · desperta", 5, "Verde", "Combatente", "rush", "Corte da Alma", ["Combatente", {"attack": 8}], "ap-maki-desperta", "Jujutsu Kaisen"],
  ["aoi-todo", "Aoi Todo", 4, "Turquesa", "Suporte", "ward", "Boogie Woogie", ["Suporte", {"hp": 8}], "ap-aoi-todo", "Jujutsu Kaisen"],
  ["kasumi-miwa", "Kasumi Miwa", 1, "Azul", "Guardião", "ward", "Domínio Simples", ["Azul", {"resistance": 8}], "ap-kasumi-miwa", "Jujutsu Kaisen"],
  ["kenjaku", "Kenjaku", 6, "Roxo", "Mágico", "beam", "Espíritos em Cadeia", ["Mágico", {"magic": 8}], "ap-kenjaku", "Jujutsu Kaisen"],
  ["nobara", "Nobara", 3, "Rosa", "Mágico", "beam", "Ressonância", ["Mágico", {"magic": 8}], "ap-nobara", "Jujutsu Kaisen"],
  ["mahoraga", "Mahoraga", 6, "Branco", "Guardião", "ward", "Roda da Adaptação", ["Guardião", {"defense": 8}], "ap-mahoraga", "Jujutsu Kaisen"],
  ["yuta", "Yuta", 6, "Branco", "Mágico", "beam", "Rika", ["Mágico", {"magic": 8}], "ap-yuta", "Jujutsu Kaisen"],
  ["panda", "Panda", 2, "Branco", "Guardião", "ward", "Modo Gorila", ["Guardião", {"hp": 10}], "ap-panda", "Jujutsu Kaisen"],
  ["toji", "Toji", 5, "Preto", "Combatente", "rush", "Lança Invertida", ["Combatente", {"attack": 8}], "ap-toji", "Jujutsu Kaisen"],
  ["yamamoto", "Yamamoto", 7, "Vermelho", "Mágico", "beam", "Zanka no Tachi", ["Mágico", {"magic": 8}], "ap-yamamoto", "Bleach"],
  ["renji", "Renji", 3, "Vermelho", "Combatente", "rush", "Zabimaru", ["Combatente", {"attack": 8}], "ap-renji", "Bleach"],
  ["ikkaku", "Ikkaku", 2, "Vermelho", "Combatente", "rush", "Hōzukimaru", ["Vermelho", {"attack": 10}], "ap-ikkaku", "Bleach"],
  ["orihime", "Orihime", 3, "Laranja", "Suporte", "heal", "Escudo Triplo", ["Laranja", {"hp": 10}], "ap-orihime", "Bleach"],
  ["grimmjow", "Grimmjow", 4, "Turquesa", "Combatente", "rush", "Garra de Pantera", ["Combatente", {"attack": 8}], "ap-grimmjow", "Bleach"],
  ["uryu-thousand-year-blood-war", "Uryū · Thousand-Year Blood War", 6, "Azul", "Mágico", "beam", "Antítese", ["Mágico", {"magic": 8}], "ap-uryu-thousand-year-blood-war", "Bleach"],
  ["aizen-hogyoku", "Aizen · Hōgyoku", 7, "Roxo", "Suporte", "ward", "Hipnose Completa", ["Suporte", {"hp": 8}], "ap-aizen-hogyoku", "Bleach"],
  ["byakuya", "Byakuya", 5, "Rosa", "Mágico", "beam", "Senbonzakura", ["Mágico", {"magic": 8}], "ap-byakuya", "Bleach"],
  ["rukia", "Rukia", 4, "Branco", "Mágico", "beam", "Dança da Lua Branca", ["Mágico", {"magic": 8}], "ap-rukia", "Bleach"],
  ["yhwach", "Yhwach", 8, "Preto", "Suporte", "ward", "The Almighty", ["Suporte", {"hp": 8}], "ap-yhwach", "Bleach"],
  ["ichigo-bankai-verdadeiro", "Ichigo · Bankai verdadeiro", 7, "Preto", "Combatente", "rush", "Getsuga Duplo", ["Combatente", {"attack": 8}], "ap-ichigo-bankai-verdadeiro", "Bleach"],
  ["kenpachi", "Kenpachi", 6, "Preto", "Combatente", "rush", "Corte do Desafio", ["Combatente", {"attack": 8}], "ap-kenpachi", "Bleach"],
  ["shanks", "Shanks", 7, "Vermelho", "Combatente", "rush", "Corte do Imperador", ["Combatente", {"attack": 8}], "ap-shanks", "One Piece"],
  ["portgas-d-ace", "Portgas D. Ace", 5, "Vermelho", "Mágico", "beam", "Hiken", ["Mágico", {"magic": 8}], "ap-portgas-d-ace", "One Piece"],
  ["sanji", "Sanji", 4, "Laranja", "Combatente", "rush", "Diable Jambe", ["Combatente", {"attack": 8}], "ap-sanji", "One Piece"],
  ["kaido", "Kaido", 7, "Azul", "Guardião", "ward", "Sopro do Dragão", ["Guardião", {"defense": 8}], "ap-kaido", "One Piece"],
  ["chopper", "Chopper", 2, "Rosa", "Suporte", "heal", "Primeiros Socorros", ["Suporte", {"magic": 10}], "ap-chopper", "One Piece"],
  ["barba-branca-auge", "Barba Branca · auge", 8, "Branco", "Combatente", "rush", "Tremor do Mar", ["Combatente", {"attack": 8}], "ap-barba-branca-auge", "One Piece"],
  ["luffy-gear-5", "Luffy · Gear 5", 7, "Branco", "Combatente", "rush", "Ricochete", ["Combatente", {"attack": 8}], "ap-luffy-gear-5", "One Piece"],
  ["gol-d-roger", "Gol D. Roger", 8, "Dourado", "Combatente", "rush", "Investida do Rei", ["Combatente", {"attack": 8}], "ap-gol-d-roger", "One Piece"],
  ["alucard", "Alucard", 6, "Vermelho", "Combatente", "rush", "Regeneração Sombria", ["Combatente", {"attack": 8}], "ap-alucard", "Hellsing"],
  ["ban-pos-purgatorio", "Ban · pós-Purgatório", 6, "Vermelho", "Combatente", "rush", "Snatch", ["Combatente", {"attack": 8}], "ap-ban-pos-purgatorio", "Nanatsu no Taizai"],
  ["diane", "Diane", 4, "Laranja", "Guardião", "ward", "Muralha de Gideon", ["Guardião", {"defense": 8}], "ap-diane", "Nanatsu no Taizai"],
  ["gilthunder", "Gilthunder", 3, "Amarelo", "Combatente", "rush", "Lâmina de Raio", ["Amarelo", {"attack": 10}], "ap-gilthunder", "Nanatsu no Taizai"],
  ["king-asas-completas", "King · asas completas", 6, "Verde", "Mágico", "beam", "Chastiefol", ["Mágico", {"magic": 8}], "ap-king-asas-completas", "Nanatsu no Taizai"],
  ["howzer", "Howzer", 2, "Turquesa", "Mágico", "beam", "Rajada Giratória", ["Turquesa", {"magic": 10}], "ap-howzer", "Nanatsu no Taizai"],
  ["merlin", "Merlin", 6, "Roxo", "Suporte", "ward", "Infinity", ["Suporte", {"hp": 8}], "ap-merlin", "Nanatsu no Taizai"],
  ["gowther", "Gowther", 4, "Rosa", "Suporte", "ward", "Invasão", ["Suporte", {"hp": 8}], "ap-gowther", "Nanatsu no Taizai"],
  ["hawk", "Hawk", 1, "Rosa", "Suporte", "heal", "Resgate do Capitão", ["Rosa", {"hp": 8}], "ap-hawk", "Nanatsu no Taizai"],
  ["elizabeth-poderes-de-deusa", "Elizabeth · poderes de Deusa", 5, "Branco", "Suporte", "heal", "Luz Restauradora", ["Suporte", {"hp": 8}], "ap-elizabeth-poderes-de-deusa", "Nanatsu no Taizai"],
  ["meliodas-magia-verdadeira", "Meliodas · magia verdadeira", 8, "Preto", "Combatente", "rush", "Destruição Demoníaca", ["Combatente", {"attack": 8}], "ap-meliodas-magia-verdadeira", "Nanatsu no Taizai"],
  ["rei-dos-demonios", "Rei dos Demônios", 8, "Preto", "Guardião", "ward", "O Governante", ["Guardião", {"defense": 8}], "ap-rei-dos-demonios", "Nanatsu no Taizai"],
  ["escanor-the-one-ultimate", "Escanor · The One Ultimate", 7, "Dourado", "Combatente", "rush", "Sol Definitivo", ["Combatente", {"attack": 8}], "ap-escanor-the-one-ultimate", "Nanatsu no Taizai"],
  ["metal-bat", "Metal Bat", 5, "Vermelho", "Combatente", "rush", "Espírito de Luta", ["Combatente", {"attack": 8}], "ap-metal-bat", "One Punch Man"],
  ["genos", "Genos", 5, "Laranja", "Mágico", "beam", "Canhão Incinerador", ["Mágico", {"magic": 8}], "ap-genos", "One Punch Man"],
  ["saitama", "Saitama", 8, "Amarelo", "Combatente", "rush", "Soco Sério", ["Combatente", {"attack": 8}], "ap-saitama", "One Punch Man"],
  ["snek", "Snek", 2, "Amarelo", "Combatente", "rush", "Punho da Cobra", ["Amarelo", {"attack": 10}], "ap-snek", "One Punch Man"],
  ["tatsumaki", "Tatsumaki", 6, "Verde", "Mágico", "beam", "Tornado Psíquico", ["Mágico", {"magic": 8}], "ap-tatsumaki", "One Punch Man"],
  ["fubuki", "Fubuki", 4, "Verde", "Suporte", "beam", "Barreira Psíquica", ["Suporte", {"hp": 8}], "ap-fubuki", "One Punch Man"],
  ["mumen-rider", "Mumen Rider", 1, "Verde", "Guardião", "ward", "Investida da Justiça", ["Verde", {"hp": 8}], "ap-mumen-rider", "One Punch Man"],
  ["bang", "Bang", 5, "Azul", "Guardião", "ward", "Punho da Água Corrente", ["Guardião", {"defense": 8}], "ap-bang", "One Punch Man"],
  ["tanktop-master", "Tanktop Master", 3, "Azul", "Guardião", "ward", "Arremesso Tanktop", ["Guardião", {"defense": 8}], "ap-tanktop-master", "One Punch Man"],
  ["blast", "Blast", 7, "Roxo", "Guardião", "ward", "Portais Dimensionais", ["Guardião", {"defense": 8}], "ap-blast", "One Punch Man"],
  ["flashy-flash", "Flashy Flash", 5, "Branco", "Combatente", "rush", "Corte Instantâneo", ["Combatente", {"attack": 8}], "ap-flashy-flash", "One Punch Man"],
  ["garou-cosmico", "Garou Cósmico", 8, "Preto", "Combatente", "rush", "Cópia Cósmica", ["Combatente", {"attack": 8}], "ap-garou-cosmico", "One Punch Man"],
  ["vash", "Vash", 5, "Vermelho", "Suporte", "beam", "Disparo de Desarme", ["Suporte", {"hp": 8}], "ap-vash", "Trigun"],
  ["kurapika", "Kurapika", 4, "Vermelho", "Guardião", "ward", "Corrente Restritiva", ["Guardião", {"defense": 8}], "ap-kurapika", "Hunter × Hunter"],
  ["knuckle", "Knuckle", 3, "Laranja", "Combatente", "rush", "Hakoware", ["Combatente", {"attack": 8}], "ap-knuckle", "Hunter × Hunter"],
  ["meruem-pos-rosa", "Meruem · pós-Rosa", 8, "Verde", "Combatente", "rush", "Evolução do Rei", ["Combatente", {"attack": 8}], "ap-meruem-pos-rosa", "Hunter × Hunter"],
  ["killua", "Killua", 4, "Turquesa", "Combatente", "rush", "Godspeed", ["Combatente", {"attack": 8}], "ap-killua", "Hunter × Hunter"],
  ["leorio", "Leorio", 2, "Azul", "Suporte", "heal", "Atendimento Rápido", ["Suporte", {"magic": 10}], "ap-leorio", "Hunter × Hunter"],
  ["zushi", "Zushi", 1, "Azul", "Guardião", "ward", "Ten", ["Azul", {"resistance": 8}], "ap-zushi", "Hunter × Hunter"],
  ["hisoka", "Hisoka", 5, "Roxo", "Combatente", "rush", "Bungee Gum", ["Combatente", {"attack": 8}], "ap-hisoka", "Hunter × Hunter"],
  ["neferpitou", "Neferpitou", 6, "Rosa", "Combatente", "rush", "Terpsichora", ["Combatente", {"attack": 8}], "ap-neferpitou", "Hunter × Hunter"],
  ["biscuit", "Biscuit", 5, "Rosa", "Suporte", "beam", "Cookie", ["Suporte", {"hp": 8}], "ap-biscuit", "Hunter × Hunter"],
  ["chrollo", "Chrollo", 5, "Preto", "Mágico", "beam", "Skill Hunter", ["Mágico", {"magic": 8}], "ap-chrollo", "Hunter × Hunter"],
  ["gon-transformacao-adulta", "Gon · transformação adulta", 7, "Dourado", "Combatente", "rush", "Jajanken Final", ["Combatente", {"attack": 8}], "ap-gon-transformacao-adulta", "Hunter × Hunter"],
  ["inuyasha", "Inuyasha", 4, "Vermelho", "Combatente", "rush", "Cicatriz do Vento", ["Combatente", {"attack": 8}], "ap-inuyasha", "Inuyasha"],
  ["edward-elric", "Edward Elric", 3, "Vermelho", "Guardião", "ward", "Transmutação Relâmpago", ["Guardião", {"defense": 8}], "ap-edward-elric", "Fullmetal Alchemist"],
  ["kenshin-himura", "Kenshin Himura", 3, "Vermelho", "Combatente", "rush", "Saque Relâmpago", ["Combatente", {"attack": 8}], "ap-kenshin-himura", "Rurouni Kenshin"],
  ["magna", "Magna", 1, "Vermelho", "Mágico", "beam", "Bola de Fogo", ["Vermelho", {"magic": 8}], "ap-magna", "Black Clover"],
  ["mereoleona", "Mereoleona", 6, "Laranja", "Combatente", "rush", "Calidus Brachium", ["Combatente", {"attack": 8}], "ap-mereoleona", "Black Clover"],
  ["luck", "Luck", 4, "Amarelo", "Combatente", "rush", "Salto Relâmpago", ["Combatente", {"attack": 8}], "ap-luck", "Black Clover"],
  ["finral", "Finral", 2, "Verde", "Suporte", "ward", "Portal de Retirada", ["Verde", {"resistance": 10}], "ap-finral", "Black Clover"],
  ["noelle", "Noelle", 4, "Azul", "Guardião", "ward", "Berço do Dragão Marinho", ["Guardião", {"defense": 8}], "ap-noelle", "Black Clover"],
  ["zagred", "Zagred", 6, "Roxo", "Mágico", "beam", "Palavra Manifestada", ["Mágico", {"magic": 8}], "ap-zagred", "Black Clover"],
  ["vanessa", "Vanessa", 3, "Rosa", "Suporte", "beam", "Fio de Rouge", ["Suporte", {"hp": 8}], "ap-vanessa", "Black Clover"],
  ["licht", "Licht", 6, "Branco", "Guardião", "ward", "Espada Absorvente", ["Guardião", {"defense": 8}], "ap-licht", "Black Clover"],
  ["asta-devil-union", "Asta · Devil Union", 7, "Preto", "Combatente", "rush", "Antimagia", ["Combatente", {"attack": 8}], "ap-asta-devil-union", "Black Clover"],
  ["yami", "Yami", 5, "Preto", "Combatente", "rush", "Corte Dimensional", ["Combatente", {"attack": 8}], "ap-yami", "Black Clover"],
  ["lucius-zogratis", "Lucius Zogratis", 8, "Dourado", "Suporte", "ward", "Reescrita Temporal", ["Suporte", {"hp": 8}], "ap-lucius-zogratis", "Black Clover"],
  ["yuno-star-magic", "Yuno · Star Magic", 7, "Dourado", "Mágico", "beam", "Constelação", ["Mágico", {"magic": 8}], "ap-yuno-star-magic", "Black Clover"],
  ["naruto-modo-kurama", "Naruto · Modo Kurama", 6, "Laranja", "Combatente", "rush", "Manto da Raposa", ["Combatente", {"attack": 8}], "ap-naruto-modo-kurama", "Naruto"],
  ["gaara", "Gaara", 4, "Laranja", "Guardião", "ward", "Escudo de Areia", ["Guardião", {"defense": 8}], "ap-gaara", "Naruto"],
  ["minato", "Minato", 5, "Amarelo", "Combatente", "rush", "Deus Voador do Trovão", ["Combatente", {"attack": 8}], "ap-minato", "Naruto"],
  ["tenten", "Tenten", 1, "Turquesa", "Combatente", "rush", "Chuva de Armas", ["Combatente", {"attack": 8}], "ap-tenten", "Naruto"],
  ["kakashi-mangekyo", "Kakashi · Mangekyō", 5, "Azul", "Mágico", "beam", "Kamui", ["Mágico", {"magic": 8}], "ap-kakashi-mangekyo", "Naruto"],
  ["iruka", "Iruka", 1, "Azul", "Suporte", "ward", "Instrução de Campo", ["Azul", {"defense": 8}], "ap-iruka", "Naruto"],
  ["kaguya-otsutsuki", "Kaguya Ōtsutsuki", 8, "Branco", "Mágico", "beam", "Troca Dimensional", ["Mágico", {"magic": 8}], "ap-kaguya-otsutsuki", "Naruto"],
  ["neji", "Neji", 3, "Branco", "Guardião", "ward", "Rotação", ["Branco", {"defense": 10}], "ap-neji", "Naruto"],
  ["madara-dez-caudas", "Madara · Dez-Caudas", 7, "Preto", "Mágico", "beam", "Esferas da Verdade", ["Mágico", {"magic": 8}], "ap-madara-dez-caudas", "Naruto"],
  ["shikamaru", "Shikamaru", 2, "Preto", "Suporte", "ward", "Possessão das Sombras", ["Preto", {"resistance": 10}], "ap-shikamaru", "Naruto"],
  ["hagoromo-otsutsuki", "Hagoromo Ōtsutsuki", 8, "Dourado", "Suporte", "heal", "Chakra dos Seis Caminhos", ["Suporte", {"hp": 8}], "ap-hagoromo-otsutsuki", "Naruto"],
  ["arataka-reigen", "Arataka Reigen", 2, "Laranja", "Suporte", "ward", "Conversa Convincente", ["Suporte", {"defense": 10}], "ap-arataka-reigen", "Mob Psycho 100"],
  ["speedwagon", "Speedwagon", 1, "Laranja", "Suporte", "ward", "Apoio de Campo", ["Laranja", {"hp": 8}], "ap-speedwagon", "JoJo"],
  ["dio", "DIO", 6, "Amarelo", "Combatente", "rush", "The World", ["Combatente", {"attack": 8}], "ap-dio", "JoJo"],
  ["joseph-jovem", "Joseph · jovem", 2, "Amarelo", "Suporte", "ward", "Armadilha de Hamon", ["Amarelo", {"defense": 10}], "ap-joseph-jovem", "JoJo"],
  ["kakyoin", "Kakyoin", 4, "Verde", "Mágico", "beam", "Emerald Splash", ["Mágico", {"magic": 8}], "ap-kakyoin", "JoJo"],
  ["polnareff", "Polnareff", 4, "Azul", "Combatente", "rush", "Silver Chariot", ["Combatente", {"attack": 8}], "ap-polnareff", "JoJo"],
  ["jotaro", "Jotaro", 6, "Roxo", "Combatente", "rush", "Star Platinum", ["Combatente", {"attack": 8}], "ap-jotaro", "JoJo"],
  ["johnny-tusk-act-4", "Johnny · Tusk Act 4", 7, "Rosa", "Mágico", "beam", "Rotação Infinita", ["Mágico", {"magic": 8}], "ap-johnny-tusk-act-4", "JoJo"],
  ["josuke-parte-4", "Josuke · Parte 4", 5, "Rosa", "Suporte", "heal", "Crazy Diamond", ["Suporte", {"hp": 8}], "ap-josuke-parte-4", "JoJo"],
  ["pucci-made-in-heaven", "Pucci · Made in Heaven", 7, "Branco", "Combatente", "rush", "Contagem Acelerada", ["Combatente", {"attack": 8}], "ap-pucci-made-in-heaven", "JoJo"],
  ["bruno-bucciarati", "Bruno Bucciarati", 4, "Branco", "Guardião", "ward", "Sticky Fingers", ["Guardião", {"defense": 8}], "ap-bruno-bucciarati", "JoJo"],
  ["koichi", "Koichi", 3, "Branco", "Mágico", "beam", "Echoes Act 3", ["Mágico", {"magic": 8}], "ap-koichi", "JoJo"],
  ["giorno-gold-experience-requiem", "Giorno · Gold Experience Requiem", 8, "Dourado", "Suporte", "ward", "Retorno a Zero", ["Suporte", {"hp": 8}], "ap-giorno-gold-experience-requiem", "JoJo"],
  ["misaka-mikoto", "Misaka Mikoto", 4, "Amarelo", "Mágico", "beam", "Railgun", ["Mágico", {"magic": 8}], "ap-misaka-mikoto", "Toaru"],
  ["simon-tengen-toppa", "Simon · Tengen Toppa Gurren Lagann", 8, "Verde", "Combatente", "rush", "Força Espiral", ["Combatente", {"attack": 8}], "ap-simon-tengen-toppa", "Gurren Lagann"],
  ["frieren", "Frieren", 5, "Turquesa", "Mágico", "beam", "Zoltraak", ["Mágico", {"magic": 8}], "ap-frieren", "Frieren"],
  ["rimuru-tempest", "Rimuru Tempest", 8, "Azul", "Guardião", "ward", "Predação", ["Guardião", {"defense": 8}], "ap-rimuru-tempest", "Tensei Shitara Slime Datta Ken"],
  ["tetsuo-shima", "Tetsuo Shima", 7, "Roxo", "Mágico", "beam", "Colapso Psíquico", ["Mágico", {"magic": 8}], "ap-tetsuo-shima", "Akira"],
  ["ultimate-madoka", "Madoka Kaname · Ultimate Madoka", 8, "Rosa", "Suporte", "ward", "Lei dos Ciclos", ["Suporte", {"hp": 8}], "ap-ultimate-madoka", "Madoka Magica"],
  ["eternal-sailor-moon", "Eternal Sailor Moon", 8, "Branco", "Suporte", "heal", "Luz da Lua Eterna", ["Suporte", {"hp": 8}], "ap-eternal-sailor-moon", "Sailor Moon"],
  ["anos-voldigoad", "Anos Voldigoad", 7, "Preto", "Mágico", "beam", "Destruição da Fonte", ["Mágico", {"magic": 8}], "ap-anos-voldigoad", "The Misfit of Demon King Academy"],
];
const approvedArt = {"hoova-shisui":"hoova-shisui","zawa-cheon":"zawa-cheon","careca-kumagawa":"careca-kumagawa",
  "yamcha": "yamcha",
  "bulma": "bulma",
  "piccolo": "piccolo",
  "kuririn": "kuririn",
  "gohan": "gohan-namek",
  "tenshinhan": "tenshinhan",
  "freeza": "freeza-forma-final",
  "android17": "android-17-torneio-do-poder",
  "vegeta": "vegeta-super-saiyajin-blue",
  "broly": "broly-super",
  "goku": "goku-instinto-superior",
  "beerus": "beerus",
  "usopp": "usopp",
  "nami": "nami",
  "rocklee": "rock-lee",
  "zoro": "zoro",
  "law": "trafalgar-law",
  "gojo": "gojo",
  "netero": "netero",
  "mob": "mob-por-cento",
  "accelerator": "accelerator",
  "shinra_banshoman": "shinra-banshoman",
  "benimaru_shinmon": "benimaru-shinmon",
  "luminous": "luminous-valentine",
  "veldora": "veldora-tempest",
  "shinra": "shinra-kusakabe",
  "arthur": "arthur-boyle",
  "maki_oze": "maki-oze",
  "iris": "iris",
  "mayuri": "mayuri-kurotsuchi",
  "starrk": "coyote-starrk",
  "yoruichi": "yoruichi-shihoin",
  "urahara": "kisuke-urahara",
  "sukuna-forma-original": "sukuna-forma-original",
  "nanami": "nanami",
  "maki-desperta": "maki-desperta",
  "aoi-todo": "aoi-todo",
  "kasumi-miwa": "kasumi-miwa",
  "kenjaku": "kenjaku",
  "nobara": "nobara",
  "mahoraga": "mahoraga",
  "yuta": "yuta",
  "panda": "panda",
  "toji": "toji",
  "yamamoto": "yamamoto",
  "renji": "renji",
  "ikkaku": "ikkaku",
  "orihime": "orihime",
  "grimmjow": "grimmjow",
  "uryu-thousand-year-blood-war": "uryu-thousand-year-blood-war",
  "aizen-hogyoku": "aizen-hogyoku",
  "byakuya": "byakuya",
  "rukia": "rukia",
  "yhwach": "yhwach",
  "ichigo-bankai-verdadeiro": "ichigo-bankai-verdadeiro",
  "kenpachi": "kenpachi",
  "shanks": "shanks",
  "portgas-d-ace": "portgas-d-ace",
  "sanji": "sanji",
  "kaido": "kaido",
  "chopper": "chopper",
  "barba-branca-auge": "barba-branca-auge",
  "luffy-gear-5": "luffy-gear-5",
  "gol-d-roger": "gol-d-roger",
  "alucard": "alucard",
  "ban-pos-purgatorio": "ban-pos-purgatorio",
  "diane": "diane",
  "gilthunder": "gilthunder",
  "king-asas-completas": "king-asas-completas",
  "howzer": "howzer",
  "merlin": "merlin",
  "gowther": "gowther",
  "hawk": "hawk",
  "elizabeth-poderes-de-deusa": "elizabeth-poderes-de-deusa",
  "meliodas-magia-verdadeira": "meliodas-magia-verdadeira",
  "rei-dos-demonios": "rei-dos-demonios",
  "escanor-the-one-ultimate": "escanor-the-one-ultimate",
  "metal-bat": "metal-bat",
  "genos": "genos",
  "saitama": "saitama",
  "snek": "snek",
  "tatsumaki": "tatsumaki",
  "fubuki": "fubuki",
  "mumen-rider": "mumen-rider",
  "bang": "bang",
  "tanktop-master": "tanktop-master",
  "blast": "blast",
  "flashy-flash": "flashy-flash",
  "garou-cosmico": "garou-cosmico",
  "vash": "vash",
  "kurapika": "kurapika",
  "knuckle": "knuckle",
  "meruem-pos-rosa": "meruem-pos-rosa",
  "killua": "killua",
  "leorio": "leorio",
  "zushi": "zushi",
  "hisoka": "hisoka",
  "neferpitou": "neferpitou",
  "biscuit": "biscuit",
  "chrollo": "chrollo",
  "gon-transformacao-adulta": "gon-transformacao-adulta",
  "inuyasha": "inuyasha",
  "edward-elric": "edward-elric",
  "kenshin-himura": "kenshin-himura",
  "magna": "magna",
  "mereoleona": "mereoleona",
  "luck": "luck",
  "finral": "finral",
  "noelle": "noelle",
  "zagred": "zagred",
  "vanessa": "vanessa",
  "licht": "licht",
  "asta-devil-union": "asta-devil-union",
  "yami": "yami",
  "lucius-zogratis": "lucius-zogratis",
  "yuno-star-magic": "yuno-star-magic",
  "naruto-modo-kurama": "naruto-modo-kurama",
  "gaara": "gaara",
  "minato": "minato",
  "tenten": "tenten",
  "kakashi-mangekyo": "kakashi-mangekyo",
  "iruka": "iruka",
  "kaguya-otsutsuki": "kaguya-otsutsuki",
  "neji": "neji",
  "madara-dez-caudas": "madara-dez-caudas",
  "shikamaru": "shikamaru",
  "hagoromo-otsutsuki": "hagoromo-otsutsuki",
  "arataka-reigen": "arataka-reigen",
  "speedwagon": "speedwagon",
  "dio": "dio",
  "joseph-jovem": "joseph-jovem",
  "kakyoin": "kakyoin",
  "polnareff": "polnareff",
  "jotaro": "jotaro",
  "johnny-tusk-act-4": "johnny-tusk-act-4",
  "josuke-parte-4": "josuke-parte-4",
  "pucci-made-in-heaven": "pucci-made-in-heaven",
  "bruno-bucciarati": "bruno-bucciarati",
  "koichi": "koichi",
  "giorno-gold-experience-requiem": "giorno-gold-experience-requiem",
  "misaka-mikoto": "misaka-mikoto",
  "simon-tengen-toppa": "simon-tengen-toppa",
  "frieren": "frieren",
  "rimuru-tempest": "rimuru-tempest",
  "tetsuo-shima": "tetsuo-shima",
  "ultimate-madoka": "ultimate-madoka",
  "eternal-sailor-moon": "eternal-sailor-moon",
  "anos-voldigoad": "anos-voldigoad"
};

function spriteFor(unit){
  const slug=approvedArt[unit.id];
  if(!slug)return CHARACTERS[unit.id].sprite;
  return "ap-"+slug+(unit.shiny?"-shiny":"");
}

const leadershipStats={hp:'PV',attack:'Ataque',magic:'Magia',defense:'Defesa',resistance:'Resistência',speed:'Velocidade'};
const leadershipKeys=Object.keys(leadershipStats);
const CHARACTERS = Object.fromEntries(roster.map(([id,name,tier,color,role,kind,skill,[scope,bonuses],sprite,universe='Dragon Ball'])=>{
  const leader=scope+' · '+Object.entries(bonuses).map(([stat,value])=>leadershipStats[stat]+' +'+value+'%').join(' e ');
  return [id,{id,name,tier,color,role,kind,skill,leader,scope,leadership:leadershipKeys.map(k=>(bonuses[k]??0)/100),
    sprite:approvedArt[id]?'ap-'+approvedArt[id]:sprite,universe}];
}));
const SKILL_EFFECTS = {
  koto:'Genjutsu de 150% da Magia. A próxima habilidade do alvo causa 35% menos dano. Na Arena, causa 175% da Magia e marca por 4 s, reduzindo o próximo golpe em 40%. Recarga de 8 s.',
  demonSword:'Três cortes de 65% do Ataque. O terceiro ignora metade da Defesa. Na Arena, dispara duas lâminas de 70%. Se alguma acertar, lança um corte de 100% que ignora metade da Defesa. Recarga de 7 s.',
  fiction:'Na campanha, apaga um golpe fatal contra si uma vez por batalha. Na Arena, lança um parafuso de 130% da Magia e protege o aliado ativo por 4 s. Apaga até 180% da Magia em dano do próximo golpe. Recarga de 10 s.',
  room:'ROOM cura o aliado em campo com a menor fração de PV em 150% da Magia. Gamma Knife atinge o inimigo com 135% da Magia e ignora 40% da Resistência. Recarga de 8 s. Nos duelos de bolas, ROOM abre onde Law ativou a habilidade, e o corte exige que o adversário toque o campo.',
  benihime:'Escudo de 220% da Magia no aliado em campo com a menor fração de PV e corte de 105% da Magia no adversário. Recarga de 8 s.',
  barreira:'Concede a cada aliado em campo um escudo de 100% da Defesa de Android 17. O próprio Android recebe 180% se estiver em campo. Recarga de 9 s.',
  death_ray:'Raio de 175% da Magia que ignora 25% da Resistência. Abaixo de 35% dos PV do alvo, passa para 235% da Magia. Recarga de 7 s.',
  final_flash:'Disparo de 215% do Ataque que causa dano dobrado a escudos. Recarga de 8 s.',
  furia:'Golpe de 165% do Ataque. Cada uso aumenta o próximo em 25 pontos percentuais, até 240%. Recarga de 6 s.',
  instinto:'Dois golpes de 100% do Ataque. Prepara uma esquiva de alvo único se estiver sem cargas. Recarga de 8 s.',
  dominio:'Atinge cada inimigo em campo com 155% da Magia em área e bloqueia suas ações por 1,5 s. Recarga de 12 s.',
  bodisatva:'Três golpes de 65% do Ataque. O terceiro ignora metade da Defesa. Recarga de 7 s.',
  despertar:'Onda de 165% da Magia contra todos os inimigos em campo. Com metade dos PV ou menos, Mob dispara a onda com 225%. Recarga de 9 s.',
  reescrita:"Golpeia com 190% do Ataque. Uma vez por luta, se um aliado em campo estiver com até 40% de PV, usa a ação para restaurar metade dos PV máximos do mais ferido. Recarga de 9 s.",
  nichirin:"Atinge o alvo com 180% do Ataque e os demais inimigos a até 28 unidades dele com 85% do Ataque. Recarga de 10 s.",
  ciclo_vital:"Cura em 200% da Magia o aliado em campo com a menor porcentagem de PV e atinge o adversário com 105% da Magia. Recarga de 9 s.",
  tempestade:"Desfere um raio de 185% da Magia que ignora 30% da Resistência. Um arco secundário de 75% da Magia atinge outro inimigo em campo, se houver. Recarga de 10 s.",

  ashisogi:"Enfraquece os ataques básicos do alvo em 35% por 4 s e causa dano mágico de 130% da Magia. Recarga de 9 s.",
  metralleta:"Dispara três tiros de 60% da Magia contra o mesmo alvo. Recarga de 9 s.",
  shunko:"Golpeia com 140% do Ataque e ganha uma carga de esquiva contra um golpe de alvo único. Recarga de 12 s.",
  excalibur:"O corte de plasma causa 145% do Ataque e ignora 35% da Defesa do alvo. Recarga de 7 s.",

  piccolo:'Cria um escudo de 110% da Magia e pode interceptar um golpe contra um aliado próximo nos 4,5 s seguintes.',
  bulma:'Aplica um escudo de 200% da Magia ao aliado com a menor porcentagem de PV, quando ele tem 95% de PV ou menos.',
  heal:'Cura o aliado com a menor porcentagem de PV em 130% da Magia, quando ele tem 95% de PV ou menos.',
  yamcha:'Causa dano físico equivalente a 160% do Ataque.',
  kuririn:'Causa dano mágico equivalente a 165% da Magia ao inimigo com menos PV.',
  beam:'Causa dano mágico equivalente a 165% da Magia.',
  beerus:'Remove o escudo, causa dano mágico equivalente a 240% da Magia e bloqueia a ressurreição se o golpe for fatal.',
  accelerator:'Reflete até duas habilidades de alvo único por luta, com recarga de 8 s e alcance de um espaço na ordem da formação.',
};
SKILL_EFFECTS.ward=SKILL_EFFECTS.piccolo;
SKILL_EFFECTS.rush=SKILL_EFFECTS.yamcha;
const recruitPools = TIERS.map((_,i)=>Object.values(CHARACTERS).filter(c=>c.tier===i+1));
const chanceByTier = [.57,.27,.11198,.038,.008,.00165,.00032,.00005];
const passives={
  'Haki do Rei':'Ao iniciar a luta, trava as ações inimigas por 1,5 s e aumenta o dano sofrido por eles em +15%. Uma ativação por equipe.',
  'Kaidō':'Inicia o combate com um escudo protetor equivalente a 18% dos PV máximos.',
  'Instinto Superior':'Esquiva dos dois primeiros golpes diretos de alvo único e contra-ataca com um golpe básico se puder agir.',
  'Restrição Celestial':'Intercepta os dois primeiros golpes de alvo único contra aliados próximos, sofrendo apenas 60% do dano. Na Arena, protege da reserva.',
  'Zenkai':'Uma vez por luta, sobrevive a um golpe fatal com 30% dos PV máximos e ganha +25% de Ataque e Magia até o fim do combate.',
  'Full Counter':'Reflete a primeira habilidade mágica de alvo único contra si ou um aliado próximo, devolvendo 150% do dano-base.',
  'The World':'Após a primeira habilidade principal bem-sucedida, para o tempo por 2 s e reduz pela metade a recarga restante da habilidade.',
  'Voto de Nen':'Concede +20% de dano em 1 vaga. Opcionalmente ative Última Aposta na ficha para causar +70% de dano ocupando 2 vagas.',
  'Made in Heaven':'Causa +25% de dano durante toda a luta. Na primeira ação ofensiva, ativa Aceleração por 4 s (−35% intervalo no portador e −20% nos aliados).',
  'Domínio Absoluto':'Inicia o combate com barreira de 25% dos PV máximos, reduz em 15% todo dano recebido e anula o primeiro atordoamento.'
};
const TRAIT_MIGRATION={'Shunpo':'Respiração do Trovão','Haki da Observação':'Instinto Superior'};
const T=(name,tier,odds,buffs)=>({name,tier,odds,buffs,passive:passives[name]??null,rarity:TIERS[tier-1]});
// 16 Traits: exatamente 2 por raridade (Ofensiva/Ágil + Defensiva/Tática), estritamente crescentes de Comum a Transcendente.
const TRAITS = [
  T('Concentração Total',1,6,[.05,.02,.02,.04,.04,0]),
  T('Reforço Amaldiçoado',1,6,[.03,.05,.05,.02,.02,.02]),
  T('Haki do Armamento',2,14,[.07,.08,.05,.08,.06,.02]),
  T('Ten',2,14,[.07,.05,.08,.06,.08,.02]),
  T('Modo Sábio',3,30,[.11,.09,.10,.10,.10,.05]),
  T('Respiração do Trovão',3,30,[.09,.12,.11,.08,.08,.08]),
  T('Haki do Rei',4,60,[.13,.16,.16,.11,.11,.08]),
  T('Kaidō',4,60,[.15,.13,.14,.14,.14,.09]),
  T('Instinto Superior',5,120,[.17,.20,.20,.14,.14,.13]),
  T('Restrição Celestial',5,120,[.20,.16,.16,.18,.18,.10]),
  T('Zenkai',6,250,[.23,.24,.24,.18,.18,.14]),
  T('Full Counter',6,250,[.21,.22,.24,.23,.23,.14]),
  T('The World',7,600,[.27,.30,.30,.23,.23,.18]),
  T('Voto de Nen',7,600,[.30,.27,.27,.26,.26,.16]),
  T('Made in Heaven',8,1500,[.34,.36,.36,.28,.28,.24]),
  T('Domínio Absoluto',8,1500,[.38,.33,.33,.34,.34,.20]),
];
const initial = ['piccolo','yamcha','kuririn','bulma'];
const position = [[72,47],[56,72],[39,28],[22,59]];
const HOUR = 3600000;
const UPGRADES = {
  ritmo:{name:'Ritmo de expedição',worlds:[1,2,3,4,5,6,7,8,9,10],costs:[180,1000,3500,9000,20000,40000,70000,160000,400000,1000000],
    values:[15,14,13,13,12,12,11,11,10,9,8],goldBonus:[0,0,0,5,5,10,10,15,15,15,15],
    unit:' s',description:'Reduz a espera entre encontros ou aumenta o ouro das vitórias em encontros comuns e de elite.'},
  sorte:{name:'Sorte',worlds:[1,1,1,2,3,5,7,8,10],costs:[50,125,300,1000,3500,12000,36000,90000,200000],values:[10,20,30,40,50,60,70,80,90,100],unit:'%',description:'Até 50%, aumenta a chance de encontrar um recruta em lutas comuns. Cada ponto acima de 50% aumenta em 1% relativo a chance de esse recruta ser Raro ou superior.'},
  ouro:{name:'Bônus de ouro',worlds:[1,1,1,2,4,6,8],costs:[75,180,400,2000,18000,90000,250000],values:[0,10,20,35,50,65,80,100],unit:'%',description:'Acrescenta ouro às vitórias em encontros comuns e de elite.'},
  xp:{name:'Experiência compartilhada',worlds:[1,1,1,2,4,6,8],costs:[60,150,325,1600,14000,75000,210000],values:[0,25,40,60,70,80,90,100],unit:'%',description:'Distribui entre os reservas uma fração da XP que um titular recebe por vitória. Cada titular mantém sua recompensa integral.'},
  rastreio:{name:'Rastreio de raros',worlds:[1,2,4,6,9,10],costs:[100,600,4500,24000,100000,250000],values:[16,18,21,24,28,32,36],unit:'%',description:'Chance de um recruta ser de raridade Rara ou superior. Cada uma dessas raridades recebe o mesmo aumento proporcional.'},
  treino:{name:'Treino de combate',worlds:[1,2,4,7,9,10],costs:[80,700,5000,30000,70000,140000],values:[0,10,20,30,40,60,80],unit:'%',description:'Aumenta a XP por vitória na campanha. O bônus também entra no cálculo da experiência compartilhada.'},
  enfermaria:{name:'Enfermaria',worlds:[1,3,5,8,9,10],costs:[90,1000,6500,45000,70000,140000],values:[20,18,16,14,12,10,8],unit:' s',description:'Reduz o tempo de recuperação de titulares derrotados na exploração, inclusive quando a equipe inteira cai.'},
  brilho:{name:'Caçador de Shinies',worlds:[4,6,8,10],costs:[8000,40000,160000,450000],values:[0,10,20,35,50],unit:'%',description:'Aumenta proporcionalmente a chance de encontrar variantes Shiny em recrutamentos.'},
  sintonia:{name:'Sintonia de Traits',worlds:[5,7,9,10],costs:[15000,65000,220000,550000],values:[0,10,20,30,40],unit:'%',description:'Aumenta a chance de recrutas naturais virem com Traits Épicas ou superiores.'},
};
const xpFor = level => 26 + level*12 + Math.round(1.25*level**2 + .070*level**3);
const scale = level => 1 + .1*(level-1) + .001*(level-1)**2;
const thresholds=[0,0];
for(let level=1;level<100;level++)thresholds.push(thresholds[level]+xpFor(level));
const xpTo=level=>thresholds[level];
function levelAt(xp){
  let low=1,high=100;
  while(low<high){const mid=Math.ceil((low+high)/2);if(xp>=thresholds[mid])low=mid;else high=mid-1;}
  return low;
}
function xpProgress(xp,cap=100){
  const level=levelAt(xp);
  return {level,current:xp-xpTo(level),required:level<cap?xpFor(level):0};
}
const maxLevel = state=>Math.max(1,...state.team.map(id=>levelAt(state.collection.find(x=>x.uid===id).xp)));
const readyForBoss = state=>state.team.length>0 && state.finalWins>=(state.bossGoal??15) && !state.completed;
const upgradeLevel = (state,id)=>state.upgrades?.[id]??(id==='ritmo'&&state.upgraded?1:0);
const upgradeValue = (state,id)=>UPGRADES[id].values[upgradeLevel(state,id)];
const waitFor = state=>upgradeValue(state,'ritmo')*1000;

function buyUpgrade(state,id){
  if(!Object.hasOwn(UPGRADES,id))return false;
  const level=upgradeLevel(state,id);
  const cost=UPGRADES[id].costs[level];
  if(cost===undefined||state.gold<cost||(state.unlocked??0)+1<UPGRADES[id].worlds[level])return false;
  state.gold-=cost;
  (state.upgrades??={})[id]=level+1;
  return true;
}

function fresh(now=Date.now(),seed=Date.now()>>>0){
  const collection = initial.map(id=>({uid:`initial-${id}`,id,xp:0,serial:1,shiny:false,trait:null,odds:null}));
  return {version:1,seed,created:now,collection,team:collection.map(x=>x.uid),positions:Object.fromEntries(collection.map((x,i)=>[x.uid,position[i]])),leader:collection[0].uid,area:0,gold:0,wins:0,losses:0,finalWins:0,streak:0,upgrades:{},completed:false,world:0,unlocked:0,journey:{},autoRoutes:true,paused:false,running:true,nextAt:now,waitDuration:0,pending:null,index:0,clock:now,log:[]};
}

const starterBonus = {piccolo:[.05,0,0,.05,0,0],yamcha:[0,.05,0,0,0,.05],kuririn:[0,0,.05,0,0,0],bulma:[0,0,0,0,.05,0]};
function leaderBuff(leader,member){
  if(!leader)return [];
  return [member.role,member.color,member.universe,'Equipe'].includes(leader.scope)?leader.leadership:[];
}

const MAX_STARS=5;
const TRAIT_PITY_LIMIT=25;
const PRESET_SLOTS=['exploracao','arena','torre','raid'];
const PRESET_LABELS={exploracao:'Exploração',arena:'Arena',torre:'Torre',raid:'Raid'};
const RAID_MILESTONES=[
  {damage:10000,label:'10 mil',gold:5000,items:{essence:1}},
  {damage:25000,label:'25 mil',gold:15000,traitItems:1},
  {damage:45000,label:'45 mil',gold:35000,items:{essence:2,xpTome:1}},
  {damage:80000,label:'80 mil',gold:75000,traitItems:1,items:{catalyst:1}},
  {damage:150000,label:'150 mil',gold:150000,traitItems:2,items:{traitLock:1}},
];
const WORLD_BOSS_MILESTONES=[
  {damage:100000,label:'100 mil',gold:20000,traitItems:1,items:{essence:1}},
  {damage:400000,label:'400 mil',gold:50000,traitItems:2,items:{essence:2}},
  {damage:1000000,label:'1M',gold:100000,traitItems:2,items:{xpTome:2,catalyst:1}},
  {damage:2500000,label:'2,5M',gold:200000,traitItems:3,items:{essence:4,traitLock:1}},
  {damage:6000000,label:'6M',gold:400000,traitItems:5,items:{catalyst:2,traitLock:1}},
];
const TOWER_AFFIXES=[
  {id:'padrao',name:'Combate padrão',desc:'Sem modificadores ambientais.',apply:()=>{}},
  {id:'fisica',name:'Fúria Física',desc:'+20% Ataque e −15% Magia para todos.',apply:f=>{f.attack=Math.round(f.attack*1.2);f.magic=Math.round(f.magic*.85);}},
  {id:'arcana',name:'Maré Arcana',desc:'+20% Magia e −15% Ataque para todos.',apply:f=>{f.magic=Math.round(f.magic*1.2);f.attack=Math.round(f.attack*.85);}},
  {id:'bastiao',name:'Bastião',desc:'+25% PV e +15% Defesa/Resistência.',apply:f=>{f.hp=Math.round(f.hp*1.25);f.defense=Math.round(f.defense*1.15);f.resistance=Math.round(f.resistance*1.15);}},
  {id:'aceleracao',name:'Fluxo Acelerado',desc:'+20% Velocidade para todos.',apply:f=>{f.speed=Math.round(f.speed*1.2);}},
];
const WEEKLY_TOWER_FLOORS=15;
const WEEKLY_TOWER_RULES=[
  {id:'no_transcendent',name:'Sem Transcendentes',desc:'Apenas personagens de Comum até Secreta.',allow:c=>c.tier<8},
  {id:'classic',name:'Clássicos (até Mítica)',desc:'Apenas personagens de Comum até Mítica.',allow:c=>c.tier<=5},
  {id:'warm',name:'Cores Quentes',desc:'Apenas Vermelho, Laranja, Amarelo, Rosa ou Dourado.',allow:c=>['Vermelho','Laranja','Amarelo','Rosa','Dourado'].includes(c.color)},
  {id:'cool',name:'Cores Frias',desc:'Apenas Verde, Turquesa, Azul, Roxo, Branco ou Preto.',allow:c=>['Verde','Turquesa','Azul','Roxo','Branco','Preto'].includes(c.color)},
  {id:'tactical',name:'Guardiões & Suportes',desc:'Apenas Guardiões e Suportes entram em campo.',allow:c=>['Guardião','Suporte'].includes(c.role)},
];

// Build 57 stored claims by the old damage thresholds, in the same reward order.
function normalizeClaims(claimed,milestones,oldThresholds){
  return [...new Set(claimed.map(damage=>{
    const index=oldThresholds.indexOf(damage);
    return index<0?damage:milestones[index].damage;
  }))];
}
const raidClaims=claimed=>normalizeClaims(claimed,RAID_MILESTONES,[50000,250000,750000,2000000,5000000]);
const worldBossClaims=claimed=>normalizeClaims(claimed,WORLD_BOSS_MILESTONES,[500000,2000000,10000000,50000000,200000000]);

function grantItems(state,bundle){
  if(!bundle)return;
  if(bundle.gold)state.gold=(state.gold??0)+bundle.gold;
  if(bundle.traitItems)state.traitItems=(state.traitItems??0)+bundle.traitItems;
  if(bundle.arenaTrophies)state.arenaTrophies=(state.arenaTrophies??0)+bundle.arenaTrophies;
  if(bundle.items){
    state.items??={};
    for(const [k,v] of Object.entries(bundle.items)){
      if(v>0)state.items[k]=(state.items[k]??0)+v;
    }
  }
}

function awakenCost(unit){
  const card=CHARACTERS[unit?.id];
  const stars=Math.max(0,Math.min(MAX_STARS,unit?.stars??0));
  if(!card||stars>=MAX_STARS)return null;
  const next=stars+1;
  return {
    next,
    gold:card.tier*15000*next,
    essence:next*Math.max(1,card.tier-3)
  };
}

function dexMastery(state){
  if(!state)return {charTiers:0,shinyTiers:0,allBonus:0,offenseBonus:0,goldBonus:0,completedUniverses:[],universes:[]};
  const {characters,totals}=dexSummary(state);
  const byUni=new Map();
  for(const c of characters){
    const entry=byUni.get(c.universe)??{universe:c.universe,seen:0,total:0};
    entry.total++;
    if(c.seen)entry.seen++;
    byUni.set(c.universe,entry);
  }
  const universes=[...byUni.values()].sort((a,b)=>a.universe.localeCompare(b.universe,'pt-BR'));
  const completedUniverses=universes.filter(u=>u.total>0&&u.seen===u.total).map(u=>u.universe);
  const charTiers=Math.floor(totals.seenChars/15);
  const shinyTiers=Math.floor(totals.shinyChars/10);
  return {
    charTiers,shinyTiers,
    allBonus:charTiers*0.01,
    offenseBonus:shinyTiers*0.01,
    goldBonus:charTiers*0.03,
    completedUniverses,
    universes
  };
}

function slotTraits(unit,index=unit.activeSlot??0){
  const stored=unit.traitSlots?.[index]??(index===0&&unit.trait?[unit.trait]:[]);
  return Array.isArray(stored)?[...new Set(stored.map(n=>TRAIT_MIGRATION[n]??n))].filter(name=>TRAITS.some(t=>t.name===name)).slice(0,3):[];
}
function pickWeightedTrait(random,pool){
  let weight=random()*pool.reduce((n,t)=>n+1/t.odds,0);
  const index=pool.findIndex(t=>(weight-=1/t.odds)<0);
  return pool.splice(index<0?pool.length-1:index,1)[0];
}
function rollLoadout(random,{lockTrait=null,catalyst=false,pity=false}={}){
  const multiRoll=random();
  let count;
  if(lockTrait){
    count=multiRoll<(catalyst?0.18:0.08)?3:2;
  }else if(catalyst){
    count=multiRoll<0.16?(multiRoll<0.01?3:2):1;
  }else{
    count=multiRoll<0.05?(multiRoll<0.0005?3:2):1;
  }
  const basePool=catalyst?TRAITS.filter(t=>t.tier>=3):TRAITS.slice();
  const pool=basePool.slice(),picked=[];
  if(lockTrait&&TRAITS.some(t=>t.name===lockTrait)){
    picked.push(lockTrait);
    const idx=pool.findIndex(t=>t.name===lockTrait);
    if(idx>=0)pool.splice(idx,1);
  }
  if(pity&&!picked.some(n=>(TRAITS.find(t=>t.name===n)?.tier??0)>=5)){
    const mythicPool=pool.filter(t=>t.tier>=5);
    if(mythicPool.length){
      const chosen=pickWeightedTrait(random,mythicPool);
      picked.push(chosen.name);
      const idx=pool.findIndex(t=>t.name===chosen.name);
      if(idx>=0)pool.splice(idx,1);
    }
  }
  while(picked.length<count&&pool.length){
    picked.push(pickWeightedTrait(random,pool).name);
  }
  return picked;
}
// Exact chance for this unordered set: sum every draw order without replacement.
function loadoutChance(names){
  if(!names.length||names.length>3)return 0;
  const weights=names.map(name=>1/TRAITS.find(t=>t.name===name).odds);
  function orders(left,total){
    if(left.length===0)return 1;
    return left.reduce((p,w,i)=>p+w/total*orders(left.filter((_,j)=>j!==i),total-w),0);
  }
  return [0,.95,.0495,.0005][names.length]*orders(weights,TRAITS.reduce((n,t)=>n+1/t.odds,0));
}
function changeTraitSlot(state,action){
  const {uid,slot}=action;
  const unit=state.collection.find(u=>u.uid===uid);
  if(!unit||![0,1].includes(slot))return false;
  const slots=[slotTraits(unit,0),slotTraits(unit,1)];
  if(action.type==='reroll'){
    if(!(state.traitItems>=1)||action.roll!==(state.traitRolls??0))return false;
    const useCatalyst=action.useCatalyst===true;
    const lockTrait=typeof action.lockTrait==='string'&&action.lockTrait?action.lockTrait:null;
    if(useCatalyst&&!((state.items?.catalyst??0)>=1))return false;
    if(lockTrait){
      if(!((state.items?.traitLock??0)>=1)||!slots[slot].includes(lockTrait))return false;
    }
    const pity=(state.traitPity??0)+1>=TRAIT_PITY_LIMIT;
    state.traitRolls=(state.traitRolls??0)+1;
    recordDex(state,unit);
    const rolled=rollLoadout(rng(state.seed,0x54524149^state.traitRolls),{lockTrait,catalyst:useCatalyst,pity});
    slots[slot]=rolled;
    state.traitItems--;
    if(useCatalyst)state.items.catalyst--;
    if(lockTrait)state.items.traitLock--;
    const hitMythic=rolled.some(n=>(TRAITS.find(t=>t.name===n)?.tier??0)>=5);
    state.traitPity=hitMythic?0:(state.traitPity??0)+1;
  }else{
    if(!slots[slot].length||slot===(unit.activeSlot??0))return false;
    unit.activeSlot=slot;
  }
  unit.traitSlots=slots;
  const active=slots[unit.activeSlot??0];
  unit.trait=active[0]??null;
  recordDex(state,unit);
  if(!active.includes('Voto de Nen'))delete unit.nen;
  return true;
}
function fighter(unit, coords=[55,50], leader=null, tactical=false, mastery=null){
  const card=CHARACTERS[unit.id];
  const level=levelAt(unit.xp);
  const growth=scale(level);
  const names=slotTraits(unit);
  const buffs=names.map(n=>TRAITS.find(t=>t.name===n).buffs);
  const aura=leaderBuff(leader,card);
  const stars=Math.max(0,Math.min(MAX_STARS,unit.stars??0));
  const starMult=1+stars*0.04;
  const uniBonus=mastery?.completedUniverses?.includes(card.universe)?0.05:0;
  const globalBonus=(mastery?.allBonus??0)+uniBonus;
  const offBonus=mastery?.offenseBonus??0;
  const [hp,attack,magic,defense,resistance,speed]=baseStats[card.tier-1].map((base,i)=>{
    const mBoost=1+globalBonus+(i<=2?offBonus:0);
    const sBoost=i===5?(stars>=5?starMult*1.05:starMult):starMult;
    return Math.round(base*(1+roles[card.role][i])*(1+(starterBonus[card.id]?.[i]||0))*(1+buffs.reduce((sum,b)=>sum+b[i],0))*(1+(aura[i]||0))*sBoost*mBoost*(i===5?1:growth*(unit.shiny?1.12:1)));
  });
  const [x,y]=coords;
  return {...card,stars,signatureAssist:card.tier>=5&&card.role==='Suporte', uid:unit.uid,trait:unit.trait,traits:names,nen:names.includes("Voto de Nen")&&unit.nen===true, level, x,y,hp,attack,magic,defense,resistance,speed,scale:growth,interval:tactical?Math.max(600,Math.round(300000/speed/100)*100):3000,magicBasic:card.role==='Mágico'||card.role==='Suporte',evade:names.includes('Instinto Superior')?2:0,survive:names.includes('Zenkai')?1:0,sprite:spriteFor(unit)};
}

function chachaBlock(keyWords, counter, nonce0, nonce1){
  const init=new Uint32Array([
    0x61707865,0x3320646e,0x79622d32,0x6b206574,
    keyWords[0],keyWords[1],keyWords[2],keyWords[3],
    keyWords[4],keyWords[5],keyWords[6],keyWords[7],
    counter>>>0,Math.floor(counter/4294967296)>>>0,nonce0>>>0,nonce1>>>0
  ]);
  const x=new Uint32Array(init);
  const qr=(a,b,c,d)=>{
    x[a]=(x[a]+x[b])>>>0;x[d]=((x[d]^x[a])<<16|(x[d]^x[a])>>>16)>>>0;
    x[c]=(x[c]+x[d])>>>0;x[b]=((x[b]^x[c])<<12|(x[b]^x[c])>>>20)>>>0;
    x[a]=(x[a]+x[b])>>>0;x[d]=((x[d]^x[a])<<8|(x[d]^x[a])>>>24)>>>0;
    x[c]=(x[c]+x[d])>>>0;x[b]=((x[b]^x[c])<<7|(x[b]^x[c])>>>25)>>>0;
  };
  for(let r=0;r<10;r++){
    qr(0,4,8,12);qr(1,5,9,13);qr(2,6,10,14);qr(3,7,11,15);
    qr(0,5,10,15);qr(1,6,11,12);qr(2,7,8,13);qr(3,4,9,14);
  }
  for(let i=0;i<16;i++)x[i]=(x[i]+init[i])>>>0;
  return x;
}
function rng(seed,index){
  if(typeof seed==='string'&&/^[0-9a-f]{64}$/i.test(seed)){
    const keyWords=new Uint32Array(8);
    for(let i=0;i<8;i++)keyWords[i]=parseInt(seed.slice(i*8,i*8+8),16)>>>0;
    let blockCounter=0,offset=16,words=null;
    const nonce0=index>>>0,nonce1=Math.floor(index/4294967296)>>>0;
    return ()=>{
      if(offset>=16){words=chachaBlock(keyWords,blockCounter++,nonce0,nonce1);offset=0;}
      return words[offset++]/4294967296;
    };
  }
  let state=(seed^Math.imul(index+1,2654435761))>>>0 || 1;
  return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
}
function isEpicTrait(t){return (t.tier??(t.odds>=50?4:1))>=4;}
function pickTrait(random,qualityBoost=0){
  const mult=t=>isEpicTrait(t)?(1+qualityBoost):1;
  let p=random();
  for(const t of TRAITS){p-=mult(t)/t.odds;if(p<0)return t;}
  return null;
}
function recruitWeights(rarePercent){
  const base=UPGRADES.rastreio.values[0];
  const clamped=Math.min(65,Math.max(base,rarePercent));
  if(clamped===base)return chanceByTier;
  const delta=(clamped-base)/100;
  // Transfere de Comum (e de Incomum se necessário) mantendo pesos sempre positivos.
  const fromCommon=Math.min(chanceByTier[0]-.05,delta);
  const fromUncommon=Math.max(0,delta-fromCommon);
  return chanceByTier.map((weight,i)=>{
    if(i===0)return weight-fromCommon;
    if(i===1)return weight-fromUncommon;
    return weight*clamped/base;
  });
}
function recruitRates(luckPercent,rastreioPercent){
  return {encounter:Math.min(50,luckPercent),rare:Math.min(65,rastreioPercent*(100+Math.max(0,luckPercent-50))/100)};
}
function rollRecruit(random,luck=.10,universe='Dragon Ball',rarePercent=UPGRADES.rastreio.values[0],shinyBoost=0,traitBoost=0){
  const rates=recruitRates(luck*100,rarePercent);
  const chance=rates.encounter/100;
  if(random()>=chance) return null;
  let p=random(),tier=1;
  const weights=recruitWeights(rates.rare);
  for(const weight of weights){if(p<weight)break;p-=weight;tier++;}
  tier=Math.min(tier,8);
  const pool=recruitPools[tier-1];
  const local=pool.filter(c=>c.universe===universe);
  // One ticket per character globally, plus a second ticket for each local character.
  const total=pool.length+local.length;
  const ticket=Math.floor(random()*total);
  const card=ticket<pool.length?pool[ticket]:local[ticket-pool.length];
  const cardChance=(card.universe===universe?2:1)/total;
  const baseShiny=tier>=7?.10:.05;
  const shinyP=Math.min(.25,baseShiny*(1+shinyBoost));
  const shiny=random()<shinyP;
  const trait=pickTrait(random,traitBoost);
  const traitMult=t=>isEpicTrait(t)?(1+traitBoost):1;
  const totalTraitP=TRAITS.reduce((sum,t)=>sum+traitMult(t)/t.odds,0);
  const traitP=trait?traitMult(trait)/trait.odds:Math.max(.05,1-totalTraitP);
  return {id:card.id,shiny,trait:trait?.name??null,odds:Math.round(1/(chance*weights[tier-1]*cardChance*(shiny?shinyP:1-shinyP)*traitP))};
}

const SALE_PRICES=[8,20,50,125,350,1000,3500,12000];
const RECOVERY_MS=20000;
function readyAt(state,uid){
  return Math.max(state.partyRecovery??0,state.recovery?.[uid]??0);
}
function firstReady(state){
  return Math.min(...state.team.map(uid=>readyAt(state,uid)));
}

// Progressão por mundo (1 a 10): escala para valorizar raridades, upgrades e formação ao longo de 1–3 dias.
const enemyBonuses = [
  {hp:0,    damage:0,    bossHp:0,    bossDamage:0},    // M1 Namek
  {hp:.18,  damage:.12,  bossHp:.26,  bossDamage:.16},  // M2 Arlong Park
  {hp:.42,  damage:.26,  bossHp:.62,  bossDamage:.38},  // M3 Exames Chūnin
  {hp:.72,  damage:.45,  bossHp:1.08, bossDamage:.64},  // M4 Soul Society
  {hp:1.10, damage:.66,  bossHp:1.68, bossDamage:.95},  // M5 Jujutsu Kaisen
  {hp:1.55, damage:.90,  bossHp:2.40, bossDamage:1.28}, // M6 Black Clover
  {hp:2.05, damage:1.15, bossHp:3.20, bossDamage:1.62}, // M7 Nanatsu no Taizai
  {hp:2.65, damage:1.42, bossHp:4.10, bossDamage:1.98}, // M8 JoJo
  {hp:3.30, damage:1.70, bossHp:5.10, bossDamage:2.35}, // M9 Hunter × Hunter
  {hp:4.00, damage:2.00, bossHp:6.20, bossDamage:2.75}, // M10 One Punch Man
];

function makeBattle(state,start,boss=false,towerFloor=0){
  const random=rng(state.seed,state.index++);
  const encounterWorld=towerFloor?(towerFloor-1)%WORLDS.length:state.world??0;
  const world=WORLDS[encounterWorld];
  const area=world.areas[state.area];
  const elite=!boss&&state.area===2&&state.index%7===0;
  const special=boss?world.boss:elite?world.elite:null;
  const leader=state.collection.find(c=>c.uid===state.leader);
  const available=state.team.filter(uid=>readyAt(state,uid)<=start);
  const mastery=dexMastery(state);
  const team=available.map(uid=>fighter(state.collection.find(c=>c.uid===uid),state.positions[uid],available.includes(leader?.uid)?CHARACTERS[leader.id]:null,!!special,mastery));
  const level=towerFloor?90+towerFloor:special?special.level:Math.max(area.levels[0],Math.min(area.levels[1],maxLevel(state)+Math.floor(random()*3)-1));
  const recruit=special?null:rollRecruit(random,upgradeValue(state,'sorte')/100,world.universe,upgradeValue(state,'rastreio'),upgradeValue(state,'brilho')/100,upgradeValue(state,'sintonia')/100);
  const grow=scale(level)*(towerFloor?1+.06*(towerFloor-1):1);
  const bonus=enemyBonuses[Math.min(enemyBonuses.length-1,encounterWorld)];
  const hpBonus=boss?bonus.bossHp:elite?(bonus.hp+bonus.bossHp)/2:bonus.hp;
  const damageBonus=boss?bonus.bossDamage:elite?(bonus.damage+bonus.bossDamage)/2:bonus.damage;
  const [rawHp,rawPower,def,res]=(special?.base??area.base).map(x=>Math.round(x*grow));
  const hp=Math.round(rawHp*(1+hpBonus)),power=Math.round(rawPower*(1+damageBonus));
  const baseEnemy={name:towerFloor?`Torre ${towerFloor} · ${special.name}`:special?.name??area.enemy,hp,attack:power,magic:boss?Math.round(power*.88):power,defense:def,resistance:res,scale:grow,color:boss?world.boss.color:area.color,level,sprite:`enemy-${encounterWorld+1}-${boss?5:elite?4:state.area+1}`,interval:boss?3200:3000,skill:boss?'Ofensiva de '+special.name:null,kind:boss?world.boss.kind:null,x:60,y:50};
  const candidate = recruit ? fighter({...recruit,xp:xpTo(level)},[60,50],null,false) : null;
  const enemy = candidate ? {...baseEnemy,name:candidate.name,sprite:candidate.sprite,skill:candidate.skill,trait:candidate.trait,color:candidate.color,kind:candidate.kind, hp:Math.max(hp,Math.round(candidate.hp*1.65)),attack:Math.max(power,candidate.attack),magic:Math.max(power,candidate.magic),magicBasic:candidate.magicBasic,defense:Math.max(def,candidate.defense),resistance:Math.max(res,candidate.resistance),evade:candidate.evade,survive:candidate.survive} : baseEnemy;
  const damageBoost=boss?1.30:elite?1.45:1.55;
  enemy.attack=Math.round(enemy.attack*damageBoost);
  enemy.magic=Math.round(enemy.magic*damageBoost);
  const result=new Combate([team,[enemy]],{mode:'equipe'}).run();
  const simulatedTime=result.seconds*1000;
  const duration=Math.max(1200,Math.min(boss?16000:6000,simulatedTime/(boss?2:4)));
  const reserveShare=upgradeValue(state,'xp')/100;
  const reserves=reserveShare?state.collection.filter(unit=>!state.team.includes(unit.uid)&&unit.xp<xpTo(levelCap(state))).map(unit=>unit.uid):[];
  return {start,end:start+duration,boss,elite,towerFloor,world:encounterWorld,area:state.area,level,team,enemy,recruit,result,
    goldReward:Math.round((6+2*level)*1.2*(boss?8:(elite?2:1)*(1+(upgradeValue(state,'ouro')+UPGRADES.ritmo.goldBonus[upgradeLevel(state,'ritmo')])/100+mastery.goldBonus))),
    xpBonus:upgradeValue(state,'treino')/100,recoveryMs:upgradeValue(state,'enfermaria')*1000,reserveShare,reserves};
}

function shareExperience(state,battle,xp){
  let available=Math.floor(xp*(battle.reserveShare??0));
  if(!available||!battle.reserves?.length)return 0;
  const maxXp=xpTo(levelCap(state));
  const reserves=new Set(battle.reserves);
  const eligible=state.collection.filter(unit=>reserves.has(unit.uid)&&unit.xp<maxXp).sort((a,b)=>b.xp-a.xp);
  let granted=0;
  for(const [index,unit] of eligible.entries()){
    const amount=Math.min(maxXp-unit.xp,Math.floor(available/(eligible.length-index)));
    unit.xp+=amount;
    available-=amount;
    granted+=amount;
  }
  return granted;
}

const legacyTraitOdds={"Concentração Total": 4, "Reforço Amaldiçoado": 5, "Haki do Armamento": 10, "Ten": 10, "Kaidō": 20, "Shunpo": 20, "Modo Sábio": 25, "Respiração do Trovão": 25, "Haki do Rei": 50, "Instinto Superior": 100, "Restrição Celestial": 125, "Haki da Observação": 125, "Zenkai": 200, "Full Counter": 250, "The World": 500, "Voto de Nen": 1000, "Made in Heaven": 2000};

function saleSettings(saved){
  // Novo sistema simplificado de Auto-Sell, com retrocompatibilidade para saves antigos.
  const list=value=>Array.isArray(value)?value:[];
  const tiers=[...new Set(list(saved?.tiers).map(Number).filter(i=>Number.isInteger(i)&&i>=1&&i<=TIERS.length))].sort((a,b)=>a-b);
  const keepCharacters=[...new Set(list(saved?.keepCharacters).filter(id=>Object.hasOwn(CHARACTERS,id)))];
  const shinyRule=['all','first','none'].includes(saved?.shinyRule)?saved.shinyRule:'all';
  const keepFirstNormal=saved?.keepFirstNormal!==false;
  const rawMin=Number(saved?.minTraitTier);
  const minTraitTier=Number.isInteger(rawMin)&&rawMin>=1&&rawMin<=9?rawMin:1;
  const old=saved?.legacy??(saved?.characters||saved?.traitRules?saved:null);
  const settings={enabled:saved?.enabled===true,tiers,keepFirstNormal,shinyRule,minTraitTier,keepCharacters};
  if(old)settings.legacy={characters:list(old.characters),traitRules:old.traitRules??{}};
  return settings;
}

function describeAutoSell(saved){
  const s=saleSettings(saved);
  if(!s.enabled)return 'Venda automática desligada. Todos os novos recrutas entram na coleção.';
  if(!s.tiers.length)return 'Ligada, mas nenhuma raridade selecionada para venda.';
  const tierNames=s.tiers.map(i=>TIERS[i-1]).join(', ');
  const prot=[];
  if(s.keepFirstNormal)prot.push('1ª cópia normal de cada personagem');
  if(s.shinyRule==='all')prot.push('todos os Shinies');
  else if(s.shinyRule==='first')prot.push('1º Shiny de cada personagem');
  if(s.minTraitTier<=8)prot.push(s.minTraitTier===1?'qualquer Trait':`Traits ${TIERS[s.minTraitTier-1]}+`);
  if(s.keepCharacters.length)prot.push(`${s.keepCharacters.length} personagem(ns) VIP`);
  return `Vende automaticamente: ${tierNames}.`+(prot.length?` Mantém sempre: ${prot.join(', ')}.`:' Sem proteções ativas.');
}

function traitTierOf(t){return t?.tier??(TIERS.indexOf(t?.rarity)+1);}

function saleMatches(saved,unit,collection){
  const s=saleSettings(saved);
  if(!s.enabled)return false;
  const tier=CHARACTERS[unit.id].tier;
  if(s.legacy){
    if(!s.tiers.includes(tier)&&!s.legacy.characters.includes(unit.id))return false;
    if(!collection.some(c=>c.id===unit.id&&!!c.shiny===!!unit.shiny))return false;
    if(!unit.trait)return true;
    const rule=s.legacy.traitRules[tier];
    const odds=legacyTraitOdds[unit.trait];
    return !!(odds&&rule&&(odds<rule.below||rule.names?.includes(unit.trait)));
  }
  if(!s.tiers.includes(tier))return false;
  if(s.keepCharacters.includes(unit.id))return false;
  if(unit.shiny){
    if(s.shinyRule==='all')return false;
    if(s.shinyRule==='first'&&!collection.some(c=>c.id===unit.id&&c.shiny))return false;
  }else if(s.keepFirstNormal&&!collection.some(c=>c.id===unit.id&&!c.shiny)){
    return false;
  }
  const names=slotTraits(unit);
  if(names.length&&s.minTraitTier<=8){
    const highestTraitTier=Math.max(...names.map(n=>traitTierOf(TRAITS.find(t=>t.name===n))));
    if(highestTraitTier>=s.minTraitTier)return false;
  }
  return true;
}

function settle(state,battle){
  const entry={won:battle.result.winner===0&&battle.result.reason==='eliminação',gold:0,xp:0,reserveXp:0,teamXp:0,recruit:null,boss:battle.boss,label:battle.enemy.name,end:battle.end};
  const fallen=battle.result.events.filter(e=>e.type==='cai'&&e.actor.startsWith('0:'));
  if(fallen.length){
    state.recovery??={};
    for(const e of fallen){
      const unit=battle.team[Number(e.actor.slice(2))];
      const when=battle.start+(battle.end-battle.start)*Math.min(1,e.time/Math.max(1,battle.result.seconds*1000));
      state.recovery[unit.uid]=Math.ceil(when)+(battle.recoveryMs??RECOVERY_MS);
    }
    if(fallen.length===battle.team.length)state.partyRecovery=battle.end+(battle.recoveryMs??RECOVERY_MS);
  }
  if(entry.won){
    state.wins++;state.streak=0;
    if(battle.area===2&&!battle.boss) state.finalWins++;
    entry.xp=Math.round((8+1.25*battle.level)*(battle.boss?3:battle.elite?2:1)*(1+(battle.xpBonus??0)));
    entry.gold=battle.goldReward??Math.round((6+2*battle.level)*(battle.boss?8:(battle.elite?2:1)*(1+(battle.goldBonus??0))));
    if(battle.towerFloor && battle.towerFloor===(state.towerCleared??0)+1){
      state.towerCleared=battle.towerFloor;
      state.traitItems=(state.traitItems??0)+towerPrize(battle.towerFloor);
    }
    state.gold+=entry.gold;
    for(const fighter of battle.team){const copy=state.collection.find(c=>c.uid===fighter.uid);if(copy){const previous=copy.xp;copy.xp=Math.min(xpTo(levelCap(state)),previous+entry.xp);entry.teamXp+=copy.xp-previous;}}
    entry.reserveXp=shareExperience(state,battle,entry.xp);
    if(battle.recruit){
      const {id,shiny}=battle.recruit;
      const key=id+(shiny?'-shiny':'');
      const serial=1+(state.serials?.[key]??state.collection.reduce((max,c)=>c.id===id&&!!c.shiny===!!shiny?Math.max(max,c.serial):max,0));
      (state.serials??={})[key]=serial;
      const copy={...battle.recruit,uid:`catch-${state.index}`,xp:xpTo(Math.min(levelCap(state),battle.level)),serial};
      recordDex(state,copy);
      const tier=CHARACTERS[id].tier;
      if(saleMatches(state.autoSell,copy,state.collection)){
        entry.sold=copy;entry.saleGold=SALE_PRICES[tier-1];entry.gold+=entry.saleGold;state.gold+=entry.saleGold;
        if(tier>=5){state.items??={};state.items.essence=(state.items.essence??0)+(tier-4);}
      }else{state.collection.push(copy);entry.recruit=copy;}
    }
    if(battle.boss && !battle.towerFloor){
      state.completed=true;
      state.unlocked=Math.min(WORLDS.length-1,Math.max(state.unlocked??0,(state.world??0)+1));
    }
    if(state.autoRoutes){
      const areas=worldOf(state).areas;
      state.area=Math.max(state.area,areas.findLastIndex(a=>a.unlock<=maxLevel(state)));
    }
  }else{
    state.losses++;
    if(!battle.boss && ++state.streak>=3){if(state.area>0)state.area--;state.streak=0;}
  }
  state.log=[entry,...state.log].slice(0,25);
  return entry;
}

function advance(state,now,budget=null,encounterLimit=Infinity){
  if(typeof budget==='number'){encounterLimit=budget;budget=null;}
  if(state.autoSell)state.autoSell=saleSettings(state.autoSell);
  if(state.world===undefined){
    state.world=0;state.unlocked=state.completed?1:0;state.journey={};state.autoRoutes=true;
    state.paused=false;
    if(!state.running&&!state.pending)state.nextAt=now;
    state.running=true;
  }
  const previous=state.clock;
  if(now<previous) return [];
  const cap=Math.min(now,previous+12*HOUR);
  const entries=[];
  function canStart(at){
    if(!budget)return true;
    if(budget.remaining>0){budget.remaining--;return true;}
    budget.exhausted=true;
    state.clock=at;
    return false;
  }
  while(true){
    if(state.pending){
      if(state.pending.end>cap) break;
      const battle=state.pending;
      state.pending=null;
      entries.push(settle(state,battle));
      state.waitDuration=waitFor(state);
      state.nextAt=battle.end+state.waitDuration;
      state.running=!state.paused;
      if(state.destination!==undefined)travel(state,state.destination);
      else if(state.autoRoutes && state.running && battle.boss && state.completed && state.world<state.unlocked)travel(state,state.world+1);
      if(entries.length>=encounterLimit){
        state.clock=Math.max(previous,battle.end);
        return entries;
      }
      continue;
    }
    if(state.towerQueued && state.team.length){
      const when=Math.max(previous,state.towerQueued.at,firstReady(state),entries.at(-1)?.end??0);
      if(when<=cap){
        if(!canStart(when))return entries;
        delete state.towerQueued;
        state.pending=makeBattle(state,when,true,(state.towerCleared??0)+1);
        continue;
      }
    }
    if(!state.team.length||!state.running||state.nextAt>cap) break;
    const start=Math.max(state.nextAt,firstReady(state));
    if(start>cap)break;
    if(!canStart(Math.max(previous,start)))return entries;
    if(state.autoRoutes && state.completed && state.world<state.unlocked)travel(state,state.world+1);
    state.pending=makeBattle(state,start,!!state.autoRoutes && readyForBoss(state));
  }
  if(now>cap){
    if(state.pending){
      // Preserve the fight and the remaining replay when the AFK window ends mid-battle.
      state.pending.start+=now-cap;
      state.pending.end+=now-cap;
    }
    state.running=!state.paused;
    state.nextAt=now+waitFor(state);
  }
  state.clock=now;
  return entries;
}

const AWAY_THRESHOLD=10*60*1000;
const AFK_ENCOUNTER_LIMIT=2400;
function newWindow(state,start){
  return {start,encounters:0,wins:0,gold:0,teamXp:0,reserveXp:0,firstRecruit:state.collection.length,recruitUids:[]};
}
function hydrateAwayRecruits(state){
  if(state.awayWindow&&!Array.isArray(state.awayWindow.recruitUids)){
    const start=Number.isInteger(state.awayWindow.firstRecruit)?Math.max(0,state.awayWindow.firstRecruit):state.collection.length;
    state.awayWindow.recruitUids=state.collection.slice(start).map(u=>u.uid);
  }
  if(Array.isArray(state.awayReports)){
    for(const r of state.awayReports){
      if(r&&!Array.isArray(r.recruitUids)){
        const start=Number.isInteger(r.firstRecruit)?Math.max(0,r.firstRecruit):state.collection.length;
        const end=Number.isInteger(r.lastRecruit)?Math.max(start,r.lastRecruit):start;
        r.recruitUids=state.collection.slice(start,end).map(u=>u.uid);
      }
    }
  }
}
function advanceWithPresence(state,now,observedAt=null,budget=null){
  if(!state.dex){
    state.dex={normal:[],shiny:[],traits:[]};
    for(const u of state.collection)recordDex(state,u);
    for(const e of state.log??[]){if(e.recruit||e.sold)recordDex(state,e.recruit??e.sold);}
    for(const id of Object.keys(CHARACTERS)){
      if(state.serials?.[id]>0)recordDex(state,{id});
      if(state.serials?.[id+'-shiny']>0)recordDex(state,{id,shiny:true});
    }
  }
  if(Object.hasOwn(state,'traitFragments')){
    state.traitItems=(state.traitItems??0)+Math.max(0,Math.floor(state.traitFragments)||0);
    delete state.traitFragments;
  }
  hydrateAwayRecruits(state);
  const window=state.awayWindow??=newWindow(state,state.clock);
  const all=[];
  function run(until){
    const w=state.awayWindow;
    const limit=w.start+12*HOUR;
    const remaining=AFK_ENCOUNTER_LIMIT-w.encounters;
    if(remaining>0&&until>=state.clock&&state.clock<=limit){
      const entries=advance(state,Math.min(until,limit),budget,remaining);
      for(const e of entries){
        if(e.sold){w.sold=(w.sold??0)+1;w.saleGold=(w.saleGold??0)+e.saleGold;}
        if(e.recruit?.uid)(w.recruitUids??=[]).push(e.recruit.uid);
        w.encounters++;w.wins+=Number(e.won);w.gold+=e.gold;w.teamXp+=e.teamXp;w.reserveXp+=e.reserveXp;all.push(e);
      }
    }
    if(!budget?.exhausted&&until>state.clock&&(until>limit||w.encounters>=AFK_ENCOUNTER_LIMIT)){
      if(w.encounters>=AFK_ENCOUNTER_LIMIT)w.encounterLimitReached=true;
      const shift=until-state.clock;
      if(state.pending){state.pending.start+=shift;state.pending.end+=shift;}
      state.nextAt+=shift;state.clock=until;
    }
  }
  if(Number.isFinite(observedAt)&&observedAt>window.start){
    const seen=Math.min(now,observedAt);
    run(seen);
    if(budget?.exhausted)return all;
    if(seen-window.start>=AWAY_THRESHOLD){
      (state.awayReports??=[]).push({...window,recruitUids:[...(window.recruitUids??[])],end:seen,lastRecruit:state.collection.length});
      if(state.awayReports.length>10)state.awayReports=state.awayReports.slice(-10);
    }
    state.awayWindow=newWindow(state,seen);
  }
  run(now);
  return all;
}

function startExploration(state,now){
  if(state.pending?.boss||state.running)return false;
  state.running=true;
  if(!state.pending)state.nextAt=Math.max(now,state.nextAt);
  return true;
}

const TOWER_LIMIT=30;
const towerPrize=floor=>floor%10===0?3:floor%5===0?2:1;
function towerAffix(floor){
  return TOWER_AFFIXES[Math.floor((Math.max(1,floor)-1)/5)%TOWER_AFFIXES.length];
}
function raidToday(now){
  const {day,nextAt}=dailyCycle(now);
  const index=Math.floor(Date.parse(day+'T00:00:00Z')/86400000)%WORLDS.length;
  return {day,nextAt,index,boss:WORLDS[index].boss};
}
function weeklyTowerToday(now){
  const cycle=weeklyCycle(now);
  const rule=WEEKLY_TOWER_RULES[Math.abs(cycle.index)%WEEKLY_TOWER_RULES.length];
  return {...cycle,rule};
}
const TRANSCENDENT_IDS=Object.values(CHARACTERS).filter(c=>c.tier===8).map(c=>c.id);
function ballBoss(index,level,factor,raid){
  const b=WORLDS[index].boss,g=scale(level)*factor;
  const [hp,attack,defense,resistance]=b.base.map(v=>Math.round(v*g));
  return {name:b.name,kind:b.arenaKind??b.kind??'freeza-boss',skill:bossKits[b.arenaKind]?.name??'Ofensiva de '+b.name,color:b.color,role:'Combatente',
    sprite:'enemy-'+(index+1)+'-5',level,scale:g,speed:106,hp:raid?10000000:hp,attack,magic:attack,defense,resistance,x:60,y:50};
}
function transcendentBoss(slotIndex,level,factor){
  const id=TRANSCENDENT_IDS[slotIndex%TRANSCENDENT_IDS.length];
  const f=fighter({id,xp:xpTo(level),shiny:false,trait:null},[60,50],null,true);
  f.hp=Math.round(f.hp*factor*0.95);
  f.attack=Math.round(f.attack*factor*0.85);
  f.magic=Math.round(f.magic*factor*0.85);
  f.defense=Math.round(f.defense*factor*0.85);
  f.resistance=Math.round(f.resistance*factor*0.85);
  return f;
}
function towerEnemies(floor){
  const index=(floor-1)%WORLDS.length;
  const level=Math.min(100,62+Math.floor((floor-1)*.45));
  const factor=.85+.014*(floor-1)+(floor>30?.016*(floor-30):0);
  if(floor%10===0&&TRANSCENDENT_IDS.length){
    const count=Math.min(4,Math.floor(floor/10));
    const offset=Math.floor(floor/10)-1;
    return Array.from({length:count},(_,i)=>transcendentBoss(offset*3+i,level,factor*(i===0?1:0.78)));
  }
  const team=[ballBoss(index,level,factor,false)];
  if(floor>TOWER_LIMIT){
    const count=Math.min(3,1+Math.floor((floor-31)/10));
    for(let i=1;i<=count;i++)team.push(ballBoss((index+i)%WORLDS.length,level,factor*.65,false));
  }
  return team;
}
function weeklyTowerEnemies(floor,weekIndex=0){
  const level=Math.min(100,55+floor*3);
  const factor=0.72+0.025*(floor-1);
  const base=(Math.abs(weekIndex)*3+floor-1)%WORLDS.length;
  const count=floor>=12?3:floor>=6?2:1;
  return Array.from({length:count},(_,i)=>ballBoss((base+i)%WORLDS.length,level,factor*(i===0?1:0.7),false));
}
function ballChallenge(state,action,now){
  const kind=action.type; // 'raid' | 'tower' | 'weeklyTower'
  const raid=kind==='raid',weekly=kind==='weeklyTower';
  const daily=raidToday(now),wt=weeklyTowerToday(now);
  const used=state.raid?.day===daily.day?state.raid.attempts:0;
  const weeklyCleared=state.weeklyTower?.week===wt.week?state.weeklyTower.cleared:0;
  const floor=weekly?weeklyCleared+1:(state.towerCleared??0)+1;
  if(action.sequence!==(state.ballSequence??0))return false;
  if(raid){
    if(used>=3||action.day!==daily.day)return false;
  }else if(weekly){
    if((state.unlocked??0)<5||floor>WEEKLY_TOWER_FLOORS||action.week!==wt.week||action.floor!==floor)return false;
  }else{
    if((state.unlocked??0)<9||state.towerQueued||state.pending?.towerFloor||action.floor!==floor)return false;
  }
  const available=state.team.filter(uid=>readyAt(state,uid)<=now);
  if(!available.length)return false;
  if(weekly&&state.team.some(uid=>!wt.rule.allow(CHARACTERS[state.collection.find(u=>u.uid===uid).id])))return false;
  const mastery=dexMastery(state);
  const leader=available.includes(state.leader)?CHARACTERS[state.collection.find(u=>u.uid===state.leader).id]:null;
  const left=available.map(uid=>fighter(state.collection.find(u=>u.uid===uid),state.positions[uid],leader,true,mastery));
  const right=raid?[ballBoss(daily.index,90,1,true)]:weekly?weeklyTowerEnemies(floor,wt.index):towerEnemies(floor);
  const affix=!raid&&!weekly?towerAffix(floor):null;
  if(affix){left.forEach(affix.apply);right.forEach(affix.apply);}
  const limit=raid?60:120;
  const match=finishDuel(createDuel(left,right,limit));
  const damage=Math.round(match.combat.log.reduce((sum,e)=>sum+(e.type==='dano'&&e.actor?.startsWith('0:')&&e.target?.startsWith('1:')?e.hp:0),0));
  const fallen=match.sides[0].team.filter(f=>!match.combat.alive(f));
  if(fallen.length){
    const until=now+upgradeValue(state,'enfermaria')*1000;
    state.recovery??={};
    for(const f of fallen)state.recovery[f.uid]=Math.max(until,state.recovery[f.uid]??0);
    if(fallen.length===available.length)state.partyRecovery=Math.max(until,state.partyRecovery??0);
  }
  let items=0,rewardGold=0,bonusItems={};
  const newMilestones=[];
  if(raid){
    items=1;
    const prevClaimed=state.raid?.day===daily.day&&Array.isArray(state.raid.claimed)?raidClaims(state.raid.claimed):[];
    const bestToday=Math.max(used?(state.raid.bestDamage??0):0,damage);
    for(const m of RAID_MILESTONES){
      if(bestToday>=m.damage&&!prevClaimed.includes(m.damage)){
        prevClaimed.push(m.damage);
        newMilestones.push(m.label);
        grantItems(state,m);
        rewardGold+=m.gold??0;
        items+=m.traitItems??0;
        if(m.items)for(const [k,v] of Object.entries(m.items))bonusItems[k]=(bonusItems[k]??0)+v;
      }
    }
    state.raid={day:daily.day,attempts:used+1,bestDamage:bestToday,bestEver:Math.max(state.raid?.bestEver??0,damage),claimed:prevClaimed,lastDamage:damage};
    state.traitItems=(state.traitItems??0)+1;
  }else if(weekly&&match.result==='Vitória'){
    state.weeklyTower={week:wt.week,cleared:floor};
    const bundle={items:{essence:1}};
    if(floor%3===0&&floor!==15){bundle.traitItems=1;items+=1;}
    if(floor===10){bundle.items.catalyst=1;}
    if(floor===15){bundle.items.traitLock=1;bundle.traitItems=(bundle.traitItems??0)+2;items+=2;}
    grantItems(state,bundle);
    bonusItems=bundle.items;
  }else if(!weekly&&match.result==='Vitória'){
    state.towerCleared=floor;
    items=towerPrize(floor);
    state.traitItems=(state.traitItems??0)+items;
    if(floor%10===0){
      const ess=Math.min(5,1+Math.floor(floor/20));
      grantItems(state,{items:{essence:ess}});
      bonusItems.essence=ess;
    }
  }
  state.ballSequence=(state.ballSequence??0)+1;
  state.ballRun={physics:5,launchSeed:match.launchSeed,sequence:state.ballSequence,left,right,limit,raid,weekly,floor,damage,items,reward:rewardGold,bonusItems,milestones:newMilestones,affix:affix?.name??null,result:match.result};
  return true;
}
function challenge(state,now){
  if(!readyForBoss(state))return false;
  if(state.pending||firstReady(state)>now)return false;
  state.pending=makeBattle(state,now,true);
  return true;
}

function formationSlots(state){
  return state.slots??Array.from({length:4},(_,i)=>state.team[i]??null);
}

function formationCost(state,slots=state.team){
  return slots.reduce((n,uid)=>n+(uid?(state.collection.find(u=>u.uid===uid)?.nen?2:1):0),0);
}
function equip(state,uid,replaced,requestedSlot){
  if(!state.collection.some(c=>c.uid===uid)||state.team.includes(uid))return false;
  const slots=formationSlots(state).slice();
  const index=requestedSlot??(replaced?slots.indexOf(replaced):slots.indexOf(null));
  if(!Number.isInteger(index)||index<0||index>=4||slots[index]!== (replaced??null))return false;
  const next=slots.slice();next[index]=uid;
  if(formationCost(state,next)>4)return false;
  state.positions[uid]=(state.positions[replaced]??state.slotPositions?.[index]??position[index]).slice();
  if(!state.leader||state.leader===replaced)state.leader=uid;
  slots[index]=uid;
  state.slots=slots;state.team=slots.filter(Boolean);
  return true;
}

function removeMember(state,uid){
  const slots=formationSlots(state).slice(),index=slots.indexOf(uid);
  if(!uid||index<0)return false;
  state.slotPositions??={};
  state.slotPositions[index]=state.positions[uid];
  slots[index]=null;
  state.slots=slots;state.team=slots.filter(Boolean);
  if(state.leader===uid)state.leader=state.team[0]??null;
  return true;
}

function travel(state,index){
  state.journey[state.world]={area:state.area,completed:state.completed,finalWins:state.finalWins,bossGoal:state.bossGoal??15};
  const progress=state.journey[index]??{area:0,completed:false,finalWins:0,bossGoal:15+10*index};
  Object.assign(state,{bossGoal:15},progress,{world:index,streak:0});
  delete state.destination;
}
const STAT_KEYS=['hp','attack','magic','defense','resistance','speed'];
function unitPower(unit, leader=null){
  const stats=fighter(unit,undefined,leader);
  return STAT_KEYS.reduce((sum,key)=>sum+stats[key],0);
}
function formationPower(unit,leader=null,atMaxLevel=true){
  const f=fighter(atMaxLevel?{...unit,xp:xpTo(100)}:unit,undefined,leader);
  const health=f.hp/5;
  const protection=(f.defense+f.resistance)/2;
  const offense=(f.magicBasic?f.magic:f.attack)*f.speed/100;
  switch(f.role){
    case 'Guardião': return Math.round(.25*offense+.40*health+.35*protection);
    case 'Suporte': return Math.round(.55*offense+.25*health+.20*protection);
    case 'Mágico': return Math.round(.80*offense+.10*health+.10*protection);
    default: return Math.round(.70*offense+.15*health+.15*protection);
  }
}
function projectedPower(unit,leader=null){
  return unitPower({...unit,xp:xpTo(100)},leader);
}
function leaderApplies(leader, member){
  return leaderBuff(leader,member).some(Boolean);
}

const ROLE_ORDER={Guardião:0,Combatente:1,Mágico:2,Suporte:3};
const PRESET_COORDS={
  padrao:[[74,44],[56,76],[36,26],[22,60]],
  espalhado:[[82,20],[62,82],[24,20],[20,82]],
  proteger:[[72,50],[46,42],[46,58],[58,24]],
};
function applyFormationPreset(state, preset='padrao'){
  const coords=PRESET_COORDS[preset];
  if(!coords||!state.team.length)return false;
  const ordered=state.team.slice().sort((a,b)=>{
    const ca=CHARACTERS[state.collection.find(u=>u.uid===a).id];
    const cb=CHARACTERS[state.collection.find(u=>u.uid===b).id];
    return (ROLE_ORDER[ca.role]??9)-(ROLE_ORDER[cb.role]??9);
  });
  ordered.forEach((uid,i)=>{state.positions[uid]=coords[i].slice();});
  return true;
}

function autoFormation(state, mode='power', now=Date.now()){
  if(!['power','projected','balanced','area'].includes(mode)||!state.collection.length)return false;
  const enemyColor=worldOf(state).areas[state.area]?.color;
  const unitCost=u=>u.nen?2:1;
  const areaFactor=c=>mode==='area'&&enemyColor?affinity(c.color,enemyColor)/Math.sqrt(affinity(enemyColor,c.color)):1;
  function scoreWith(unit,leader){
    if(mode==='power')return unitPower(unit,leader);
    if(mode==='projected')return projectedPower(unit,leader);
    return formationPower(unit,leader,false)*areaFactor(CHARACTERS[unit.id]);
  }
  const cmp=(a,b)=>b.score-a.score||b.u.xp-a.u.xp||b.tier-a.tier||a.u.serial-b.u.serial;
  // Best representative per (character.id, cost) as candidate leader.
  const leaderMap=new Map();
  for(const u of state.collection){
    const c=CHARACTERS[u.id],cost=unitCost(u),key=`${u.id}:${cost}`;
    const item={u,cost,score:scoreWith(u,c),role:c.role,tier:c.tier};
    const prev=leaderMap.get(key);
    if(!prev||cmp(item,prev)<0)leaderMap.set(key,item);
  }
  let best=null;
  for(const lead of leaderMap.values()){
    const leaderCard=CHARACTERS[lead.u.id];
    const rem=4-lead.cost;
    const others=[];
    for(const u of state.collection){
      if(u.uid===lead.u.uid)continue;
      const cost=unitCost(u);
      if(cost>rem)continue;
      const c=CHARACTERS[u.id];
      others.push({u,cost,score:scoreWith(u,leaderCard),role:c.role,tier:c.tier});
    }
    others.sort(cmp);
    let combo=[lead];
    if(mode==='balanced'){
      const buildBalanced=pool=>{
        let budget=rem;
        const cand=[lead];
        const rolesUsed=new Set([lead.role]);
        const picked=new Set([lead.u.uid]);
        for(const role of ['Guardião','Combatente','Mágico','Suporte']){
          if(rolesUsed.has(role))continue;
          const match=pool.find(x=>x.role===role&&!picked.has(x.u.uid)&&x.cost<=budget);
          if(match){cand.push(match);picked.add(match.u.uid);rolesUsed.add(role);budget-=match.cost;}
        }
        for(const x of pool){
          if(budget<=0)break;
          if(!picked.has(x.u.uid)&&x.cost<=budget){cand.push(x);picked.add(x.u.uid);budget-=x.cost;}
        }
        return {cand,roles:rolesUsed.size,score:cand.reduce((s,x)=>s+x.score,0)};
      };
      const withAny=buildBalanced(others);
      const singlesOnly=buildBalanced(others.filter(x=>x.cost===1));
      combo=singlesOnly.roles>withAny.roles||(singlesOnly.roles===withAny.roles&&singlesOnly.score>withAny.score+1e-9)?singlesOnly.cand:withAny.cand;
    }else{
      const singles=others.filter(x=>x.cost===1).slice(0,rem);
      const doubles=others.filter(x=>x.cost===2).slice(0,Math.floor(rem/2));
      let bestSub=-1;
      for(let d=0;d<=doubles.length;d++){
        const candidate=[lead,...doubles.slice(0,d),...singles.slice(0,rem-d*2)];
        const total=candidate.reduce((s,x)=>s+x.score,0);
        if(total>bestSub){bestSub=total;combo=candidate;}
      }
    }
    const score=combo.reduce((s,x)=>s+x.score,0);
    const roles=mode==='balanced'?new Set(combo.map(x=>x.role)).size:0;
    if(!best||roles>best.roles||(roles===best.roles&&score>best.score+1e-9)){
      best={combo,lead:lead.u,score,roles};
    }
  }
  if(!best)return false;
  best.combo.sort((a,b)=>(ROLE_ORDER[a.role]??9)-(ROLE_ORDER[b.role]??9)||b.score-a.score);
  const units=best.combo.map(x=>x.u);
  const wasEmpty=!state.team.length;
  const slots=Array.from({length:4},(_,i)=>units[i]?.uid??null);
  state.slots=slots;
  state.team=slots.filter(Boolean);
  state.leader=best.lead.uid;
  applyFormationPreset(state,'padrao');
  if(wasEmpty&&!state.pending)state.nextAt=now;
  return true;
}

function allTraits(unit){return [...new Set([...slotTraits(unit,0),...slotTraits(unit,1)])];}
function recordDex(state,unit){
  if(!unit||!Object.hasOwn(CHARACTERS,unit.id))return;
  const dex=state.dex??={normal:[],shiny:[],traits:[]};
  const bucket=unit.shiny?(dex.shiny??=[]):(dex.normal??=[]);
  if(!bucket.includes(unit.id))bucket.push(unit.id);
  for(const name of allTraits(unit)){
    const traits=dex.traits??=[];
    if(!traits.includes(name))traits.push(name);
  }
}
function dexSummary(state){
  const normal=new Set(Array.isArray(state.dex?.normal)?state.dex.normal:[]);
  const shiny=new Set(Array.isArray(state.dex?.shiny)?state.dex.shiny:[]);
  const traitsSeen=new Set(Array.isArray(state.dex?.traits)?state.dex.traits:[]);
  const counts=new Map(),traitCounts=new Map();
  for(const u of state.collection){
    if(!Object.hasOwn(CHARACTERS,u.id))continue;
    if(u.shiny)shiny.add(u.id);else normal.add(u.id);
    counts.set(u.id,(counts.get(u.id)??0)+1);
    for(const name of allTraits(u)){traitsSeen.add(name);traitCounts.set(name,(traitCounts.get(name)??0)+1);}
  }
  const worldsByUniverse=new Map();
  for(const w of WORLDS){
    if(!worldsByUniverse.has(w.universe))worldsByUniverse.set(w.universe,[]);
    worldsByUniverse.get(w.universe).push(w.name);
  }
  const characters=Object.values(CHARACTERS).map(c=>({
    ...c,normal:normal.has(c.id),shiny:shiny.has(c.id),seen:normal.has(c.id)||shiny.has(c.id),
    count:counts.get(c.id)??0,worlds:worldsByUniverse.get(c.universe)??[]
  })).sort((a,b)=>a.tier-b.tier||a.name.localeCompare(b.name,'pt-BR'));
  const traits=TRAITS.map(t=>({...t,seen:traitsSeen.has(t.name),count:traitCounts.get(t.name)??0}));
  return {
    characters,traits,
    totals:{
      seenChars:characters.filter(c=>c.seen).length,totalChars:characters.length,
      shinyChars:characters.filter(c=>c.shiny).length,
      seenTraits:traits.filter(t=>t.seen).length,totalTraits:traits.length
    }
  };
}

function canSellUnit(state, uid){
  if(!uid||state.collection.length<=1||state.team.includes(uid))return false;
  const unit=state.collection.find(u=>u.uid===uid);
  return !!unit&&unit.locked!==true;
}
function toggleLock(state, uid, locked){
  if(typeof uid!=='string'||typeof locked!=='boolean')return false;
  const unit=state.collection.find(u=>u.uid===uid);
  if(!unit||Boolean(unit.locked)===locked)return false;
  if(locked)unit.locked=true;else delete unit.locked;
  return true;
}
function duplicateSellCandidates(state,{includeCommonTraits=false}={}){
  const teamSet=new Set(state.team);
  const traitOdds=new Map(TRAITS.map(t=>[t.name,t.odds]));
  const groups=new Map();
  for(const u of state.collection){
    const key=`${u.id}:${u.shiny?1:0}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(u);
  }
  const candidates=[];
  for(const list of groups.values()){
    if(list.length<=1)continue;
    const sorted=list.slice().sort((a,b)=>{
      return projectedPower(b)-projectedPower(a)||b.xp-a.xp||a.serial-b.serial;
    });
    for(const u of sorted.slice(1)){
      if(teamSet.has(u.uid)||u.locked||u.shiny)continue;
      const names=allTraits(u);
      if(names.length&&(!includeCommonTraits||names.length>1||(traitOdds.get(names[0])??Infinity)>25))continue;
      candidates.push(u);
    }
  }
  return candidates;
}

function sellUnit(state, uid){
  if(!canSellUnit(state,uid))return false;
  hydrateAwayRecruits(state);
  const index=state.collection.findIndex(u=>u.uid===uid);
  const [unit]=state.collection.splice(index,1);
  recordDex(state,unit);
  const tier=CHARACTERS[unit.id].tier;
  const gold=SALE_PRICES[tier-1]??0;
  state.gold+=gold;
  if(tier>=5){state.items??={};state.items.essence=(state.items.essence??0)+(tier-4);}
  delete state.positions?.[uid];
  if(state.recovery)delete state.recovery[uid];
  if(state.awayWindow&&index<state.awayWindow.firstRecruit)state.awayWindow.firstRecruit--;
  if(Array.isArray(state.awayReports)){
    for(const r of state.awayReports){
      if(index<r.firstRecruit)r.firstRecruit--;
      if(index<r.lastRecruit)r.lastRecruit--;
    }
  }
  return gold;
}

function goldShopPrice(item,bought=0){
  return item.base+item.step*bought;
}
function resolveDefenseSquad(state){
  const key=state.defensePreset;
  const preset=key&&PRESET_SLOTS.includes(key)?state.presets?.[key]:null;
  const byUid=new Map(state.collection.map(u=>[u.uid,u]));
  const rawTeam=preset?.team?.filter(uid=>byUid.has(uid))??[];
  const usePreset=rawTeam.length>0&&formationCost(state,rawTeam)<=4;
  const team=usePreset?rawTeam:state.team.filter(uid=>byUid.has(uid));
  const leader=usePreset?(team.includes(preset.leader)?preset.leader:team[0]):state.leader;
  const positions=usePreset?{...state.positions,...preset.positions}:state.positions;
  return {team,leader,positions};
}
function savePreset(state,slot){
  if(!PRESET_SLOTS.includes(slot)||!state.team.length)return false;
  state.presets??={};
  const pos={};
  for(const uid of state.team)pos[uid]=(state.positions[uid]??[50,50]).slice();
  state.presets[slot]={team:state.team.slice(),slots:formationSlots(state).slice(),leader:state.leader,positions:pos};
  return true;
}
function loadPreset(state,slot,now){
  const p=PRESET_SLOTS.includes(slot)?state.presets?.[slot]:null;
  if(!p||!Array.isArray(p.team))return false;
  const validIds=new Set(state.collection.map(u=>u.uid));
  const nextSlots=(p.slots??p.team).slice(0,4).map(uid=>uid&&validIds.has(uid)?uid:null);
  while(nextSlots.length<4)nextSlots.push(null);
  const team=nextSlots.filter(Boolean);
  if(!team.length||formationCost(state,team)>4)return false;
  const wasEmpty=!state.team.length;
  state.slots=nextSlots;
  state.team=team;
  state.leader=team.includes(p.leader)?p.leader:team[0];
  for(const uid of team){
    const c=p.positions?.[uid];
    if(Array.isArray(c)&&c.length===2&&c.every(Number.isFinite))state.positions[uid]=c.slice();
  }
  if(wasEmpty&&!state.pending)state.nextAt=now;
  return true;
}
function awakenUnit(state,action){
  const unit=state.collection.find(u=>u.uid===action.uid);
  const cost=awakenCost(unit);
  if(!unit||!cost||state.gold<cost.gold)return false;
  if(action.useEssence){
    if(!((state.items?.essence??0)>=cost.essence))return false;
    state.gold-=cost.gold;
    state.items.essence-=cost.essence;
  }else{
    const sac=state.collection.find(u=>u.uid===action.sacrificeUid);
    if(!sac||sac.uid===unit.uid||sac.id!==unit.id||state.team.includes(sac.uid)||sac.locked===true||state.collection.length<=1)return false;
    hydrateAwayRecruits(state);
    const idx=state.collection.findIndex(u=>u.uid===sac.uid);
    state.collection.splice(idx,1);
    recordDex(state,sac);
    delete state.positions?.[sac.uid];
    if(state.recovery)delete state.recovery[sac.uid];
    if(state.awayWindow&&idx<state.awayWindow.firstRecruit)state.awayWindow.firstRecruit--;
    if(Array.isArray(state.awayReports)){
      for(const r of state.awayReports){
        if(idx<r.firstRecruit)r.firstRecruit--;
        if(idx<r.lastRecruit)r.lastRecruit--;
      }
    }
    state.gold-=cost.gold;
  }
  unit.stars=cost.next;
  return true;
}
function applySuggestedFormation(state,action,now){
  const {team,leader}=action;
  if(!Array.isArray(team)||!team.length||team.length>4||
    team.some(uid=>typeof uid!=='string')||new Set(team).size!==team.length||!team.includes(leader))return false;
  const units=team.map(uid=>state.collection.find(unit=>unit.uid===uid));
  if(units.some(unit=>!unit)||units.reduce((cost,unit)=>cost+(unit.nen?2:1),0)>4)return false;
  const wasEmpty=!state.team.length;
  state.team=team.slice();
  state.slots=Array.from({length:4},(_,i)=>team[i]??null);
  state.leader=leader;
  applyFormationPreset(state,'padrao');
  if(wasEmpty&&!state.pending)state.nextAt=now;
  return true;
}

function applyGameAction(state,action,now){
  switch(action?.type){
    case 'lock': return toggleLock(state,action.uid,action.locked);
    case 'awaken': return awakenUnit(state,action);
    case 'savePreset': return savePreset(state,action.slot);
    case 'loadPreset': return loadPreset(state,action.slot,now);
    case 'setDefensePreset': {
      if(action.slot!==null&&(!PRESET_SLOTS.includes(action.slot)||!state.presets?.[action.slot]))return false;
      state.defensePreset=action.slot;
      return true;
    }
    case 'useXpTome': {
      const unit=state.collection.find(u=>u.uid===action.uid);
      const maxXp=xpTo(levelCap(state));
      if(!unit||!((state.items?.xpTome??0)>=1)||unit.xp>=maxXp)return false;
      state.items.xpTome--;
      unit.xp=Math.min(maxXp,unit.xp+250000);
      return true;
    }
    case 'useElixir': {
      if(!((state.items?.elixir??0)>=1))return false;
      const hasRec=(state.partyRecovery??0)>now||Object.values(state.recovery??{}).some(t=>t>now);
      if(!hasRec)return false;
      state.items.elixir--;
      state.partyRecovery=0;
      state.recovery={};
      return true;
    }
    case 'goldShop': {
      const item=GOLD_SHOP.find(x=>x.id===action.itemId);
      if(!item)return false;
      const {week}=weeklyCycle(now);
      if(state.goldShop?.week!==week)state.goldShop={week,bought:{}};
      const bought=state.goldShop.bought[item.id]??0;
      if(bought>=item.limit)return false;
      const price=goldShopPrice(item,bought);
      if(state.gold<price)return false;
      state.gold-=price;
      state.goldShop.bought[item.id]=bought+1;
      if(item.grant.traitItems)state.traitItems=(state.traitItems??0)+item.grant.traitItems;
      for(const [k,v] of Object.entries(item.grant)){
        if(k==='traitItems')continue;
        state.items??={};state.items[k]=(state.items[k]??0)+v;
      }
      return true;
    }
    case 'sellBatch': {
      if(!Array.isArray(action.uids)||!action.uids.length||action.uids.length>200||typeof action.includeCommonTraits!=='boolean')return false;
      const eligible=new Set(duplicateSellCandidates(state,{includeCommonTraits:action.includeCommonTraits}).map(u=>u.uid));
      const ids=new Set(action.uids);
      if(ids.size!==action.uids.length||[...ids].some(uid=>!eligible.has(uid)))return false;
      for(const uid of ids)sellUnit(state,uid);
      return true;
    }
    case 'arenaShop': {
      const count=state.arenaPurchases??0;
      const item=ARENA_SHOP.find(x=>x.id===(action.itemId??'token'));
      if(!item||action.purchase!==count||!((state.arenaTrophies??0)>=item.cost))return false;
      state.arenaTrophies-=item.cost;
      state.arenaPurchases=count+1;
      if(item.grant.traitItems)state.traitItems=(state.traitItems??0)+item.grant.traitItems;
      for(const [k,v] of Object.entries(item.grant)){
        if(k==='traitItems')continue;
        state.items??={};state.items[k]=(state.items[k]??0)+v;
      }
      return true;
    }
    case 'reroll': case 'equipTraitSlot': return changeTraitSlot(state,action);
    case 'raid': case 'tower': case 'weeklyTower': return ballChallenge(state,action,now);
    case 'nen': {
      const u=state.collection.find(c=>c.uid===action.uid);
      if(!u||!slotTraits(u).includes('Voto de Nen')||typeof action.enabled!=='boolean')return false;
      if(action.enabled&&!u.nen&&state.team.includes(u.uid)&&formationCost(state)>=4)return false;
      u.nen=action.enabled;return true;
    }
    case 'autoSell': {
      const settings=saleSettings(state.autoSell);
      if(settings.legacy){
        if(action.resetLegacy!==true)return false;
        state.autoSell=saleSettings();
        return true;
      }
      state.autoSell=settings;
      if(typeof action.enabled==='boolean')settings.enabled=action.enabled;
      if(Array.isArray(action.tiers)){
        const next=[...new Set(action.tiers.map(Number).filter(i=>Number.isInteger(i)&&i>=1&&i<=TIERS.length))].sort((a,b)=>a-b);
        settings.tiers=next;
      }
      if(Number.isInteger(action.toggleTier)&&action.toggleTier>=1&&action.toggleTier<=TIERS.length){
        const has=settings.tiers.includes(action.toggleTier);
        settings.tiers=has?settings.tiers.filter(t=>t!==action.toggleTier):[...settings.tiers,action.toggleTier].sort((a,b)=>a-b);
      }
      if(typeof action.keepFirstNormal==='boolean')settings.keepFirstNormal=action.keepFirstNormal;
      if(['all','first','none'].includes(action.shinyRule))settings.shinyRule=action.shinyRule;
      if(Number.isInteger(action.minTraitTier)&&action.minTraitTier>=1&&action.minTraitTier<=9)settings.minTraitTier=action.minTraitTier;
      if(typeof action.keepChar==='string'&&Object.hasOwn(CHARACTERS,action.keepChar)){
        const add=action.keep!==false;
        settings.keepCharacters=add?[...new Set([...settings.keepCharacters,action.keepChar])]:settings.keepCharacters.filter(id=>id!==action.keepChar);
      }
      return true;
    }
    case 'saleSetting': {
      const {group,value,checked}=action;
      if(typeof checked!=='boolean'||!['enabled','tiers'].includes(group))return false;
      if(group==='tiers'&&(!Number.isInteger(value)||value<1||value>TIERS.length))return false;
      const settings=state.autoSell=saleSettings(state.autoSell);
      if(group==='enabled')settings.enabled=checked;
      else settings.tiers=checked?[...new Set([...settings.tiers,value])].sort((a,b)=>a-b):settings.tiers.filter(v=>v!==value);
      return true;
    }
    case 'dismissAway': {
      if(!state.awayReports?.length||state.awayReports[0].end!==action.end)return false;
      state.awayReports.shift();return true;
    }
    case 'pause':
      state.running=false;state.paused=true;return true;
    case 'resume': {
      const wasPaused=Boolean(state.paused);
      state.paused=false;
      return startExploration(state,now)||wasPaused;
    }
    case 'autoRoutes':
      state.autoRoutes=action.enabled===true;return true;
    case 'world':
      if(!Number.isInteger(action.index)||action.index<0||action.index>state.unlocked)return false;
      state.autoRoutes=false;
      if(state.pending)state.destination=action.index;else travel(state,action.index);
      return true;
    case 'area': {
      const area=Number.isInteger(action.area)&&worldOf(state).areas[action.area];
      if(!area||maxLevel(state)<area.unlock||(!state.autoRoutes&&state.area===action.area))return false;
      state.autoRoutes=false;state.area=action.area;state.streak=0;return true;
    }
    case 'leader':
      if(!state.team.includes(action.uid)||state.leader===action.uid)return false;
      state.leader=action.uid;return true;
    case 'remove': return removeMember(state,action.uid);
    case 'equip': {
      const empty=!state.team.length;
      const changed=equip(state,action.uid,action.replaced,action.slot);
      if(changed&&empty&&!state.pending)state.nextAt=now;
      return changed;
    }
    case 'boss': return challenge(state,now);
    case 'upgrade': return buyUpgrade(state,action.id);
    case 'position': {
      if(!state.team.includes(action.uid))return false;
      const coords=action.coords;
      if(!Array.isArray(coords)||coords.length!==2||!coords.every(Number.isFinite))return false;
      state.positions[action.uid]=coords.map(value=>Math.max(8,Math.min(92,Math.round(value))));
      return true;
    }
    case 'autoFormation': return Array.isArray(action.team)?applySuggestedFormation(state,action,now):autoFormation(state,action.mode??'power',now);
    case 'formationPreset': return applyFormationPreset(state,action.preset);
    case 'sell': return sellUnit(state,action.uid)!==false;
    default: return false;
  }
}
return {AREAS,BOSS,WORLDS,worldOf,levelCap,COLORS,TIERS,spriteFor,CHARACTERS,SKILL_EFFECTS,TRAIT_MIGRATION,TRAITS,UPGRADES,xpFor,levelAt,xpProgress,maxLevel,readyForBoss,upgradeLevel,waitFor,buyUpgrade,fresh,MAX_STARS,TRAIT_PITY_LIMIT,PRESET_SLOTS,PRESET_LABELS,RAID_MILESTONES,WORLD_BOSS_MILESTONES,TOWER_AFFIXES,WEEKLY_TOWER_FLOORS,WEEKLY_TOWER_RULES,raidClaims,worldBossClaims,grantItems,awakenCost,dexMastery,slotTraits,loadoutChance,fighter,recruitRates,rollRecruit,SALE_PRICES,RECOVERY_MS,readyAt,makeBattle,saleSettings,describeAutoSell,advance,AWAY_THRESHOLD,AFK_ENCOUNTER_LIMIT,advanceWithPresence,startExploration,TOWER_LIMIT,towerPrize,towerAffix,raidToday,weeklyTowerToday,towerEnemies,weeklyTowerEnemies,challenge,formationSlots,formationCost,equip,unitPower,formationPower,projectedPower,leaderApplies,applyFormationPreset,autoFormation,dexSummary,canSellUnit,duplicateSellCandidates,sellUnit,goldShopPrice,resolveDefenseSquad,applyGameAction};
})();
const {serialSchema,issueSerials} =serials;
const {advance,advanceWithPresence,applyGameAction,fighter,fresh,CHARACTERS,dexMastery,resolveDefenseSquad,WORLD_BOSS_MILESTONES,worldBossClaims} =game;
const {dailyCycle,weeklyCycle,arenaLeague,DEFAULT_PROFILE,appearancePatch,PROFILE_BODY_LIMIT,GIFT_GOLD} =communityRules;

class ApiError extends Error {
  constructor(status,message,code){super(message);this.status=status;this.code=code;}
}
function reject(status,message,code){throw new ApiError(status,message,code);}
const BUILD='nexus-namek-59';
const RANKINGS_TTL=15000;
const rankingsCache=new WeakMap();
const invalidateRankings=db=>rankingsCache.delete(db);
const makeToken=()=>btoa(String.fromCharCode(...random(24))).replaceAll('+','-').replaceAll('/','_');
const schemas=[
  'CREATE TABLE IF NOT EXISTS nexus_links(provider TEXT,subject TEXT,player TEXT NOT NULL,PRIMARY KEY(provider,subject),UNIQUE(provider,player))',
  'CREATE TABLE IF NOT EXISTS nexus_oauth(key TEXT PRIMARY KEY,browser TEXT,provider TEXT,player TEXT,expires INTEGER)',
  'CREATE TABLE IF NOT EXISTS nexus_handoffs(key TEXT PRIMARY KEY,player TEXT NOT NULL,expires INTEGER)',
  'CREATE TABLE IF NOT EXISTS nexus_sessions(key TEXT PRIMARY KEY,player TEXT NOT NULL,expires INTEGER)',
  'CREATE TABLE IF NOT EXISTS nexus_arena_seasons(player TEXT NOT NULL,season TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(player,season))',
  'CREATE TABLE IF NOT EXISTS nexus_arena_defenses(player TEXT NOT NULL,day TEXT NOT NULL,wins INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(player,day))',
  'CREATE TABLE IF NOT EXISTS nexus_world_boss(week TEXT PRIMARY KEY,total_damage INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS nexus_world_boss_contrib(week TEXT NOT NULL,player TEXT NOT NULL,damage INTEGER NOT NULL DEFAULT 0,claimed TEXT NOT NULL DEFAULT \'[]\',PRIMARY KEY(week,player))',

  `CREATE TABLE IF NOT EXISTS nexus_arena_matches(
    player TEXT NOT NULL, day TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 5),
    rival TEXT NOT NULL, delta INTEGER NOT NULL, replay TEXT NOT NULL,
    PRIMARY KEY(player,day,attempt), UNIQUE(player,day,rival), CHECK(player<>rival))`,

  `CREATE TABLE IF NOT EXISTS nexus_players(
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, token_hash TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, game TEXT NOT NULL, appearance TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, play_ms INTEGER NOT NULL DEFAULT 0, last_seen INTEGER,
    reg_key TEXT NOT NULL, power INTEGER NOT NULL, top_units TEXT NOT NULL, rare_units TEXT NOT NULL)`,
  'CREATE TABLE IF NOT EXISTS nexus_game_backups(player TEXT,day INTEGER,game TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(player,day))',
  `CREATE TRIGGER IF NOT EXISTS nexus_campaign_history BEFORE UPDATE OF game ON nexus_players
    WHEN OLD.game<>NEW.game AND NOT EXISTS(SELECT 1 FROM nexus_game_backups WHERE player=OLD.id AND day=unixepoch()/86400)
    BEGIN
      INSERT INTO nexus_game_backups(player,day,game,revision) VALUES(OLD.id,unixepoch()/86400,OLD.game,OLD.revision);
      DELETE FROM nexus_game_backups WHERE player=OLD.id AND day<unixepoch()/86400-6;
    END`,
  `CREATE TRIGGER IF NOT EXISTS nexus_arena_trophy_win AFTER INSERT ON nexus_arena_matches
    WHEN json_extract(NEW.replay,'$.trophies') BETWEEN 1 AND 5 BEGIN
      UPDATE nexus_players SET game=json_set(game,'$.arenaTrophies',
        coalesce(json_extract(game,'$.arenaTrophies'),0)+json_extract(NEW.replay,'$.trophies')),
        revision=revision+1 WHERE id=NEW.player;
    END`,
  `CREATE TRIGGER IF NOT EXISTS nexus_arena_defense_credit AFTER INSERT ON nexus_arena_matches
    WHEN json_extract(NEW.replay,'$.result')='Derrota'
      AND coalesce((SELECT wins FROM nexus_arena_defenses WHERE player=NEW.rival AND day=NEW.day),0)<3
    BEGIN
      UPDATE nexus_players SET game=json_set(game,'$.arenaTrophies',
        coalesce(json_extract(game,'$.arenaTrophies'),0)+1),revision=revision+1 WHERE id=NEW.rival;
      INSERT INTO nexus_arena_defenses(player,day,wins) VALUES(NEW.rival,NEW.day,1)
        ON CONFLICT(player,day) DO UPDATE SET wins=wins+1;
    END`,
  `CREATE TRIGGER IF NOT EXISTS nexus_raid_world_credit AFTER UPDATE OF game ON nexus_players
    WHEN json_type(NEW.game,'$.ballRun.worldBossWeek')='text'
      AND json_extract(NEW.game,'$.ballRun.sequence')>coalesce(json_extract(OLD.game,'$.ballRun.sequence'),0)
    BEGIN
      INSERT INTO nexus_world_boss(week,total_damage)
        VALUES(json_extract(NEW.game,'$.ballRun.worldBossWeek'),json_extract(NEW.game,'$.ballRun.damage'))
        ON CONFLICT(week) DO UPDATE SET total_damage=total_damage+excluded.total_damage;
      INSERT INTO nexus_world_boss_contrib(week,player,damage)
        VALUES(json_extract(NEW.game,'$.ballRun.worldBossWeek'),NEW.id,json_extract(NEW.game,'$.ballRun.damage'))
        ON CONFLICT(week,player) DO UPDATE SET damage=damage+excluded.damage;
    END`,
  'CREATE INDEX IF NOT EXISTS nexus_registration ON nexus_players(reg_key)',
  'CREATE INDEX IF NOT EXISTS nexus_power ON nexus_players(power DESC,name,id)',
  `CREATE TABLE IF NOT EXISTS nexus_friends(
    a TEXT NOT NULL REFERENCES nexus_players(id), b TEXT NOT NULL REFERENCES nexus_players(id),
    requested_by TEXT NOT NULL REFERENCES nexus_players(id), accepted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(a,b),CHECK(a<b))`,
  'CREATE INDEX IF NOT EXISTS nexus_friends_b ON nexus_friends(b)',
  `CREATE TABLE IF NOT EXISTS nexus_gifts(
    sender TEXT NOT NULL REFERENCES nexus_players(id), recipient TEXT NOT NULL REFERENCES nexus_players(id),
    day TEXT NOT NULL, gold INTEGER NOT NULL, sent_at INTEGER NOT NULL,PRIMARY KEY(sender,recipient,day))`,
  'CREATE INDEX IF NOT EXISTS nexus_inbox ON nexus_gifts(recipient,sent_at DESC)',
  'CREATE INDEX IF NOT EXISTS nexus_gift_day ON nexus_gifts(recipient,day)',
  'DROP TRIGGER IF EXISTS nexus_fragment_credit',
  `CREATE TRIGGER IF NOT EXISTS nexus_token_credit AFTER INSERT ON nexus_gifts
   WHEN (SELECT count(*) FROM nexus_gifts WHERE recipient=NEW.recipient AND day=NEW.day)<=3 BEGIN
    UPDATE nexus_players SET game=json_set(game,'$.traitItems',coalesce(json_extract(game,'$.traitItems'),0)+1)
    WHERE id=NEW.recipient;
   END`,
  `CREATE TRIGGER IF NOT EXISTS nexus_gift_credit AFTER INSERT ON nexus_gifts BEGIN
    UPDATE nexus_players SET game=json_set(game,'$.gold',json_extract(game,'$.gold')+NEW.gold),
      revision=revision+1 WHERE id=NEW.recipient;
  END`
];
const initialized=new WeakSet();
const SCHEMA_VERSION=3;
async function initialize(db){
  if(initialized.has(db))return;
  let schema;
  try{
    schema=await db.prepare('SELECT version FROM nexus_schema_version WHERE id=1').first();
  }catch(error){
    // Existing deployments do not have the version marker until this migration commits.
    if(!/no such table: (?:main\.)?nexus_schema_version\b/i.test(String(error?.message)))throw error;
  }
  if(!schema||schema.version<SCHEMA_VERSION){
    const migration=[...schemas,...serialSchema('nexus_players',true),
      'CREATE TABLE IF NOT EXISTS nexus_schema_version(id INTEGER PRIMARY KEY,version INTEGER NOT NULL)',
      'INSERT INTO nexus_schema_version(id,version) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version=max(version,excluded.version)'];
    await db.batch(migration.map((sql,i)=>i===migration.length-1?db.prepare(sql).bind(SCHEMA_VERSION):db.prepare(sql)));
  }
  initialized.add(db);
}
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const random=count=>crypto.getRandomValues(new Uint8Array(count));
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const publicPlayer=({id,name,code})=>({id,name,code});
function summarize(unit,mastery=null){
  const stats=fighter(unit,undefined,null,false,mastery);
  const power=['hp','attack','magic','defense','resistance','speed'].reduce((sum,k)=>sum+stats[k],0);
  return {id:unit.id,xp:unit.xp,stars:unit.stars??0,name:CHARACTERS[unit.id].name,level:stats.level,shiny:unit.shiny,
    trait:unit.trait,traitSlots:unit.traitSlots,activeSlot:unit.activeSlot,nen:unit.nen===true,serial:unit.serial,odds:unit.odds,power};
}
function rankedUnits(collection,mastery=null){
  const units=collection.map(u=>summarize(u,mastery));
  const rarity=(a,b)=>(b.odds??0)-(a.odds??0)||a.name.localeCompare(b.name)||a.serial-b.serial;
  const rare=units.filter(u=>u.odds>0).sort(rarity).slice(0,30);
  const top=units.sort((a,b)=>b.power-a.power||rarity(a,b)).slice(0,4);
  return [top.reduce((sum,u)=>sum+u.power,0),JSON.stringify(top),JSON.stringify(rare)];
}
async function register(db,input,request){
  const name=typeof input.name==='string'?input.name.normalize('NFC').trim().replace(/\s+/gu,' '):'';
  if(!/^[\p{L}\p{N} _.-]{2,24}$/u.test(name))reject(400,'Use de 2 a 24 letras ou números no nome.');
  const now=Date.now();
  const regKey=await hash(Math.floor(now/3600000)+'/'+(request.headers.get('CF-Connecting-IP')??'local'));
  const token=makeToken();
  const state=fresh(now,hex(random(32)));
  const tokenHash=await hash(token);
  const id=crypto.randomUUID();
  for(let attempt=0;attempt<3;attempt++){
    const counter=await db.prepare('SELECT * FROM nexus_serials WHERE id=1').first();
    issueSerials(state,state.collection,counter);
    const ranks=rankedUnits(state.collection,dexMastery(state));
    const code=hex(random(5)).toUpperCase();
    const inserted=await db.prepare(`INSERT INTO nexus_players(id,code,token_hash,name,game,appearance,reg_key,power,top_units,rare_units)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT revision FROM nexus_serials WHERE id=1)=? AND (SELECT count(*) FROM nexus_players WHERE reg_key=?)<20
      ON CONFLICT(code) DO NOTHING RETURNING id`).bind(id,code,tokenHash,name,JSON.stringify(state),JSON.stringify(DEFAULT_PROFILE),regKey,...ranks,counter.revision,regKey).first();
    if(inserted){invalidateRankings(db);return {token,player:{id,name,code}};}
    const count=await db.prepare('SELECT count(*) AS n FROM nexus_players WHERE reg_key=?').bind(regKey).first();
    if(count.n>=20)reject(429,'Limite temporário de criação de contas atingido.');
  }
  reject(503,'Tente criar o perfil novamente.','REGISTRATION_CONTENTION');
}
async function rotateToken(db,id){
  const token=makeToken();
  const result=await db.prepare('UPDATE nexus_players SET token_hash=? WHERE id=?').bind(await hash(token),id).run();
  if(!result.meta.changes)reject(404,'Jogador não encontrado.');
  return {token};
}
const providers = {
  google:{authorize:'https://accounts.google.com/o/oauth2/v2/auth',exchange:'https://oauth2.googleapis.com/token',user:'https://openidconnect.googleapis.com/v1/userinfo',scope:'openid'},
  discord:{authorize:'https://discord.com/oauth2/authorize',exchange:'https://discord.com/api/oauth2/token',user:'https://discord.com/api/v10/users/@me',scope:'identify'}
};
const oauthCookie=(value,age)=>`__Host-nexus-auth=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const API_RESPONSE_HEADERS={
  'Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options':'DENY',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
};
function oauthResponse(body,cookie,redirect){
  const headers={...API_RESPONSE_HEADERS};
  if(cookie)headers['Set-Cookie']=cookie;
  if(redirect)headers.Location=redirect;
  else headers['Content-Type']='application/json';
  return new Response(redirect?null:JSON.stringify(body),{status:redirect?303:200,headers});
}
async function socialAuth(request,env,db,url){
  const match=/^\/api\/auth\/(google|discord)\/(start|callback)$/.exec(url.pathname);
  const cookie=(request.headers.get('Cookie')??'').match(/(?:^|;\s*)__Host-nexus-auth=([a-f0-9]{64})(?:;|$)/)?.[1];
  const now=Date.now();
  if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)reject(403,'Origem inválida.');
  if(url.pathname==='/api/auth/finish'&&request.method==='POST'){
    if(!cookie)reject(401,'Entre novamente para continuar.');
    const row=await db.prepare('DELETE FROM nexus_handoffs WHERE key=? AND expires>? RETURNING player').bind(await hash(cookie),now).first();
    if(!row)reject(401,'A entrada expirou. Tente novamente.');
    const access=hex(random(24));
    await db.prepare('INSERT INTO nexus_sessions(key,player,expires) VALUES(?,?,?)').bind(await hash(access),row.player,now+30*86400000).run();
    return oauthResponse({access},oauthCookie('',0));
  }
  if(!match)reject(404,'Rota não encontrada.');
  const [,name,stage]=match,p=providers[name],key=env[name.toUpperCase()+'_CLIENT_ID'],secret=env[name.toUpperCase()+'_CLIENT_SECRET'];
  const callback=url.origin+'/api/auth/'+name+'/callback';
  if(!key||!secret)reject(503,'Este método de entrada ainda precisa ser configurado no servidor.','OAUTH_NOT_CONFIGURED');
  if(stage==='start'&&request.method==='POST'){
    const {intent}=await readBody(request);
    if(!['link','login'].includes(intent))reject(400,'Escolha entrar ou vincular.');
    const player=intent==='link'?await authenticate(db,request):null;
    const state=hex(random(32)),browser=hex(random(32));
    await db.batch(['nexus_oauth','nexus_handoffs','nexus_sessions'].map(table=>db.prepare('DELETE FROM '+table+' WHERE expires<=?').bind(now)).concat(db.prepare('INSERT INTO nexus_oauth(key,browser,provider,player,expires) VALUES(?,?,?,?,?)').bind(await hash(state),await hash(browser),name,player,now+600000)));
    const dest=new URL(p.authorize);
    dest.search=new URLSearchParams({response_type:'code',client_id:key,redirect_uri:callback,scope:p.scope,state});
    return oauthResponse({url:dest.href},oauthCookie(browser,600));
  }
  if(stage!=='callback'||request.method!=='GET')reject(405,'Método inválido.');
  const back=(status)=>oauthResponse(null,oauthCookie('',0),'/?account='+status+'#comunidade');
  const state=url.searchParams.get('state');
  if(!cookie||!state||!/^[a-f0-9]{64}$/.test(state))return back('expired');
  const flow=await db.prepare('DELETE FROM nexus_oauth WHERE key=? AND browser=? AND provider=? AND expires>? RETURNING player').bind(await hash(state),await hash(cookie),name,now).first();
  if(!flow)return back('expired');
  const code=url.searchParams.get('code');
  if(!code)return back('cancelled');
  const exchanged=await fetch(p.exchange,{method:'POST',body:new URLSearchParams({client_id:key,client_secret:secret,redirect_uri:callback,grant_type:'authorization_code',code})});
  if(!exchanged.ok)return back('failed');
  const token=(await exchanged.json()).access_token;
  if(typeof token!=='string'||!token)return back('failed');
  const info=await fetch(p.user,{headers:{Authorization:'Bearer '+token}});
  if(!info.ok)return back('failed');
  const user=await info.json(),subject=name==='google'?user.sub:user.id;
  if(typeof subject!=='string'||!subject||subject.length>255)return back('failed');
  if(flow.player)await db.prepare('INSERT INTO nexus_links(provider,subject,player) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(name,subject,flow.player).run();
  const owner=await db.prepare('SELECT player FROM nexus_links WHERE provider=? AND subject=?').bind(name,subject).first();
  if(flow.player)return back(owner?.player===flow.player?'linked':'conflict');
  if(!owner)return back('unlinked');
  const handoff=hex(random(32));
  await db.prepare('INSERT INTO nexus_handoffs(key,player,expires) VALUES(?,?,?)').bind(await hash(handoff),owner.player,Date.now()+120000).run();
  return oauthResponse(null,oauthCookie(handoff,120),'/?account=login#comunidade');
}

async function authenticate(db,request){
  const token=/^Bearer ([A-Za-z0-9_-]{32}|[a-f0-9]{48})$/.exec(request.headers.get('Authorization')??'')?.[1];
  if(!token)reject(401,'Entre na sua conta da comunidade.');
  const digest=await hash(token);
  const row=token.length===48?await db.prepare('SELECT player AS id FROM nexus_sessions WHERE key=? AND expires>?').bind(digest,Date.now()).first():await db.prepare('SELECT id FROM nexus_players WHERE token_hash=?').bind(digest).first();
  if(!row)reject(401,'Código de acesso inválido.');
  return row.id;
}
function recoveryBatchSize(state,now,conservative){
  if(conservative||now-state.clock<=30000)return 6;
  const size=state.collection.length;
  return size<=250?18:size<=750?12:6;
}
async function sync(db,id,body){
  const row=await db.prepare('SELECT id,name,code,game,revision,last_seen FROM nexus_players WHERE id=?').bind(id).first();
  const state=JSON.parse(row.game),now=Date.now(),previous=state.pending;
  const previousCollection=JSON.stringify(state.collection);
  const age=body.observationAge===undefined&&body.visible===true?0:body.observationAge;
  const seen=Number.isFinite(age)&&age>=0?now-age:null;
  const budget={remaining:recoveryBatchSize(state,now,body.conservativeRecovery===true),exhausted:false};
  const entries=advanceWithPresence(state,now,seen,budget);
  const partial=budget.exhausted;
  const last=entries.at(-1);
  const finished=previous&&last?.end===previous.end?{battle:previous,entry:last}:null;
  if(!partial&&body.action?.type==='autoFormation'&&!Array.isArray(body.action.team))
    reject(409,'Atualize a página para usar a formação automática.','CLIENT_UPDATE_REQUIRED');
  const changed=!partial&&applyGameAction(state,body.action,now);
  if(changed&&body.action.type==='raid'&&state.ballRun?.damage>0)
    state.ballRun.worldBossWeek=weeklyCycle(now).week;
  if(changed)entries.push(...advance(state,now));
  const units=entries.map(e=>e.recruit||e.sold).filter(Boolean);
  const counter=units.length?await db.prepare('SELECT * FROM nexus_serials WHERE id=1').first():null;
  issueSerials(state,units,counter);
  const delta=now-(row.last_seen??now);
  const played=delta>0&&delta<=30000?delta:0;
  const ranks=JSON.stringify(state.collection)===previousCollection?[]:rankedUnits(state.collection,dexMastery(state));
  const rankFields=ranks.length?'power=?,top_units=?,rare_units=?,':'';
  const result=await db.prepare(`UPDATE nexus_players SET game=?,play_ms=play_ms+?,last_seen=?,
    ${rankFields}revision=revision+1 WHERE id=? AND revision=? AND (? IS NULL OR (SELECT revision FROM nexus_serials WHERE id=1)=?)`)
    .bind(JSON.stringify(state),played,body.visible===true?now:null,...ranks,id,row.revision,counter?.revision??null,counter?.revision??null).run();
  if(!result.meta.changes)reject(409,'A campanha está sendo atualizada. Tente novamente.','SYNC_CONTENTION');
  if(changed||entries.length)invalidateRankings(db);
  if(partial){
    if(body.checkpoints!==true)reject(409,'Atualize a página para continuar a recuperação da campanha.','CLIENT_UPDATE_REQUIRED');
    const awayLimit=(state.awayWindow?.start??state.clock)+12*3600000;
    return {catchingUp:true,processed:entries.length,remaining:Math.max(1,Math.min(now,awayLimit)-state.clock)};
  }
  delete state.seed;
  return {state,changed,finished,now,player:publicPlayer(row),entries:entries.slice(-25),
    offline:{total:entries.length,wins:entries.filter(e=>e.won).length,gold:entries.reduce((sum,e)=>sum+e.gold,0),recruits:entries.filter(e=>e.recruit).length}};
}
async function profile(db,id){
  const row=await db.prepare('SELECT id,name,code,game,appearance,play_ms,rare_units FROM nexus_players WHERE id=?').bind(id).first();
  if(!row)reject(404,'Jogador não encontrado.');
  const state=JSON.parse(row.game);
  return {...publicPlayer(row),appearance:JSON.parse(row.appearance),playMs:row.play_ms,encounters:state.wins+state.losses,towerCleared:state.towerCleared??0,
    leaderId:state.collection.find(u=>u.uid===state.leader)?.id,team:state.team.map(uid=>summarize(state.collection.find(u=>u.uid===uid))),
    showcase:JSON.parse(row.rare_units).slice(0,5)};
}
async function arenaOpponents(db,id){
  // Shortlist by stored inventory strength, then compare only the equipped teams.
  const rows=await db.prepare(`SELECT id,name,json_extract(game,'$.team') AS slots,json_extract(game,'$.leader') AS leader,
    (SELECT json_group_array(json(u.value)) FROM json_each(p.game,'$.collection') u
     WHERE json_extract(u.value,'$.uid') IN (SELECT value FROM json_each(p.game,'$.team'))) AS equipped
    FROM nexus_players p WHERE json_array_length(game,'$.team')>0 OR id=?
    ORDER BY (id=?) DESC, abs(power-(SELECT power FROM nexus_players WHERE id=?)),id LIMIT 25`).bind(id,id,id).all();
  const squads=rows.results.map(row=>{
    const units=JSON.parse(row.equipped);
    const team=JSON.parse(row.slots).map(uid=>units.find(u=>u.uid===uid)).filter(Boolean);
    const leaderId=team.find(u=>u.uid===row.leader)?.id;
    const power=team.reduce((sum,u)=>sum+game.unitPower(u,CHARACTERS[leaderId]),0);
    return {id:row.id,name:row.name,leaderId,power,team:team.map(summarize)};
  });
  const own=squads.find(p=>p.id===id)?.power??0;
  return {own,opponents:squads.filter(p=>p.id!==id && p.team.length).sort((a,b)=>Math.abs(a.power-own)-Math.abs(b.power-own)).slice(0,3)};
}
async function rankedStatus(db,id,day=dailyCycle().day){
  const {week,prevWeek,nextAt}=weeklyCycle();
  const [cur,prev,claimed]=await db.batch([
    db.prepare(`SELECT ? AS day, COUNT(CASE WHEN day=? THEN 1 END) AS used,
      COALESCE(SUM(CASE WHEN day>=? THEN delta ELSE 0 END),0) AS points,
      COALESCE(SUM(delta),0) AS allTimePoints FROM nexus_arena_matches WHERE player=?`).bind(day,day,week,id),
    db.prepare(`SELECT COUNT(*) AS matches, COALESCE(SUM(delta),0) AS points FROM nexus_arena_matches
      WHERE player=? AND day>=? AND day<?`).bind(id,prevWeek,week),
    db.prepare('SELECT 1 AS ok FROM nexus_arena_seasons WHERE player=? AND season=?').bind(id,prevWeek)
  ]);
  const s=cur.results[0];
  const prevRow=prev.results[0];
  const prevClaimable=prevRow.matches>0&&!claimed.results.length?{season:prevWeek,points:prevRow.points,league:arenaLeague(prevRow.points)}:null;
  return {...s,season:week,seasonNextAt:nextAt,league:arenaLeague(s.points),prevSeason:prevClaimable};
}
function rankedTeam(row,asDefender=false){
  const state=JSON.parse(row.game);
  const mastery=dexMastery(state);
  const squad=asDefender?resolveDefenseSquad(state):{team:state.team,leader:state.leader,positions:state.positions};
  const units=squad.team.map(uid=>state.collection.find(u=>u.uid===uid)).filter(Boolean);
  const captain=CHARACTERS[units.find(u=>u.uid===squad.leader)?.id];
  return {fighters:units.map(u=>fighter(u,squad.positions?.[u.uid],captain,true,mastery)),
    power:units.reduce((sum,u)=>sum+game.unitPower(u,captain),0)};
}
function winTrophies(result,ownPower,rivalPower){
  if(result!=='Vitória')return 0;
  const scaled=rivalPower*100;
  if(scaled<=80*ownPower)return 1;
  if(scaled<=90*ownPower)return 2;
  if(scaled<110*ownPower)return 3;
  if(scaled<120*ownPower)return 4;
  return 5;
}
async function rankedMatch(db,id,{day,attempt}){
  if(day!==dailyCycle().day||!Number.isInteger(attempt)||attempt<1||attempt>5)
    reject(409,'Atualize as tentativas da Arena.');
  const saved=db.prepare('SELECT replay FROM nexus_arena_matches WHERE player=? AND day=? AND attempt=?').bind(id,day,attempt);
  async function receipt(row){return {run:JSON.parse(row.replay),status:await rankedStatus(db,id,day)};}
  const previous=await saved.first();
  if(previous)return receipt(previous);
  const status=await rankedStatus(db,id,day);
  if(attempt!==status.used+1)reject(409,'Atualize as tentativas da Arena.');
  const own=rankedTeam(await db.prepare('SELECT game FROM nexus_players WHERE id=?').bind(id).first(),false);
  if(!own.power)reject(409,'Monte sua formação antes de entrar na ranqueada.');
  // Fair bracket matchmaking: shortlist closest power candidates first, then pick randomly inside ±25% (or ±50%, then closest).
  const pool=(await db.prepare(`SELECT id,name,power,game FROM nexus_players WHERE id<>? AND json_array_length(game,'$.team')>0
    AND id NOT IN (SELECT rival FROM nexus_arena_matches WHERE player=? AND day=?)
    ORDER BY abs(power-?) LIMIT 20`).bind(id,id,day,own.power).all()).results;
  let rival=null;
  if(pool.length){
    const scored=pool.map(r=>({row:r,team:rankedTeam(r,true)})).filter(x=>x.team.power>0);
    const tight=scored.filter(x=>Math.abs(x.team.power-own.power)<=own.power*0.25);
    const mid=scored.filter(x=>Math.abs(x.team.power-own.power)<=own.power*0.50);
    const bucket=tight.length?tight:mid.length?mid:scored.slice(0,5);
    if(bucket.length){
      const pick=bucket[random(1)[0]%bucket.length];
      rival={...pick.row,_team:pick.team};
    }
  }
  if(!rival){
    const concurrent=await saved.first();
    if(concurrent)return receipt(concurrent);
    reject(409,'Sem adversários disponíveis. Cada jogador pode ser sorteado uma vez por ciclo.');
  }
  const other=rival._team;
  const run={physics:5,ranked:true,rivalName:rival.name,left:own.fighters,right:other.fighters,limit:120};
  const match=duelEngine.finishDuel(duelEngine.createDuel(run.left,run.right,run.limit));
  run.result=match.result;
  run.launchSeed=match.launchSeed;
  const difference=Math.max(-.38,Math.min(.38,other.power/own.power-1));
  run.trophies=winTrophies(run.result,own.power,other.power);
  run.delta=run.result==='Vitória'?Math.round(20+50*difference):run.result==='Derrota'?-Math.round(10-25*difference):0;
  const ins=await db.prepare('INSERT OR IGNORE INTO nexus_arena_matches(player,day,attempt,rival,delta,replay) VALUES(?,?,?,?,?,?)')
    .bind(id,day,attempt,rival.id,run.delta,JSON.stringify(run)).run();
  if(ins.meta.changes)invalidateRankings(db);
  const row=await saved.first();
  if(!row)reject(409,'As tentativas mudaram. Atualize a Arena.');
  return receipt(row);
}
async function arenaLog(db,id){
  const [attacks,defenses]=await db.batch([
    db.prepare(`SELECT m.day,m.attempt,m.delta,json_extract(m.replay,'$.result') AS result,
      json_extract(m.replay,'$.trophies') AS trophies,p.id AS rivalId,p.name AS rivalName
      FROM nexus_arena_matches m JOIN nexus_players p ON p.id=m.rival
      WHERE m.player=? ORDER BY m.day DESC,m.attempt DESC LIMIT 10`).bind(id),
    db.prepare(`SELECT m.day,m.attempt,m.delta,json_extract(m.replay,'$.result') AS attackerResult,
      p.id AS attackerId,p.name AS attackerName
      FROM nexus_arena_matches m JOIN nexus_players p ON p.id=m.player
      WHERE m.rival=? ORDER BY m.day DESC,m.attempt DESC LIMIT 10`).bind(id)
  ]);
  return {
    attacks:attacks.results,
    defenses:defenses.results.map(d=>({...d,defended:d.attackerResult==='Derrota'}))
  };
}
// Reward the latest save in the same D1 transaction that records the claim.
function creditReward(db,id,bundles,condition,params){
  const items={};
  let gold=0,tokens=0,trophies=0;
  for(const bundle of bundles){
    gold+=bundle.gold??0;
    tokens+=bundle.traitItems??0;
    trophies+=bundle.arenaTrophies??0;
    for(const [key,count] of Object.entries(bundle.items??{}))items[key]=(items[key]??0)+count;
  }
  const fields=[['$.gold',gold],['$.traitItems',tokens],['$.arenaTrophies',trophies],
    ...Object.entries(items).map(([key,count])=>['$.items.'+key,count])].filter(([,count])=>count>0);
  const assignments=fields.map(()=> '?,coalesce(json_extract(game,?),0)+?').join(',');
  return db.prepare(`UPDATE nexus_players SET game=json_set(game,${assignments}),revision=revision+1 WHERE id=? AND ${condition}`)
    .bind(...fields.flatMap(([key,count])=>[key,key,count]),id,...params);
}
async function claimArenaSeason(db,id){
  const {week,prevWeek}=weeklyCycle();
  const prev=await db.prepare('SELECT COUNT(*) AS matches,COALESCE(SUM(delta),0) AS points FROM nexus_arena_matches WHERE player=? AND day>=? AND day<?').bind(id,prevWeek,week).first();
  if(!prev?.matches)reject(400,'Você não disputou partidas ranqueadas na temporada anterior.');
  const league=arenaLeague(prev.points);
  const reward={arenaTrophies:league.reward.trophies,traitItems:league.reward.tokens,items:{essence:league.reward.essence}};
  const [credited]=await db.batch([
    creditReward(db,id,[reward],'NOT EXISTS(SELECT 1 FROM nexus_arena_seasons WHERE player=? AND season=?)',[id,prevWeek]),
    db.prepare('INSERT OR IGNORE INTO nexus_arena_seasons(player,season,claimed) SELECT ?,?,1 WHERE changes()=1').bind(id,prevWeek)
  ]);
  if(!credited.meta.changes)reject(409,'Recompensa da temporada anterior já resgatada.');
  return {season:prevWeek,league,reward:league.reward};
}
async function worldBossStatus(db,id,{rawClaims=false}={}){
  const {week,nextAt}=weeklyCycle();
  const [boss,mine,top]=await db.batch([
    db.prepare('SELECT total_damage FROM nexus_world_boss WHERE week=?').bind(week),
    db.prepare('SELECT damage,claimed FROM nexus_world_boss_contrib WHERE week=? AND player=?').bind(week,id),
    db.prepare(`SELECT c.player AS id,p.name,c.damage AS score FROM nexus_world_boss_contrib c
      JOIN nexus_players p ON p.id=c.player WHERE c.week=? ORDER BY c.damage DESC,p.id LIMIT 10`).bind(week)
  ]);
  const totalDamage=boss.results[0]?.total_damage??0;
  const myDamage=mine.results[0]?.damage??0;
  const claimed=JSON.parse(mine.results[0]?.claimed??'[]');
  return {week,nextAt,totalDamage,myDamage,claimed:rawClaims?claimed:worldBossClaims(claimed),milestones:WORLD_BOSS_MILESTONES,top:top.results};
}
async function claimWorldBoss(db,id){
  const status=await worldBossStatus(db,id,{rawClaims:true});
  const {week}=status;
  if(status.myDamage<=0)reject(400,'Participe de pelo menos uma Raid nesta semana para resgatar.');
  const claimed=worldBossClaims(status.claimed);
  const newly=WORLD_BOSS_MILESTONES.filter(m=>status.totalDamage>=m.damage&&!claimed.includes(m.damage));
  if(!newly.length)reject(409,'Nenhum novo marco global disponível para resgate.');
  const previous=JSON.stringify(status.claimed);
  const next=JSON.stringify([...claimed,...newly.map(m=>m.damage)]);
  const [credited]=await db.batch([
    creditReward(db,id,newly,'EXISTS(SELECT 1 FROM nexus_world_boss_contrib WHERE week=? AND player=? AND claimed=?)',[week,id,previous]),
    db.prepare('UPDATE nexus_world_boss_contrib SET claimed=? WHERE week=? AND player=? AND claimed=? AND changes()=1').bind(next,week,id,previous)
  ]);
  if(!credited.meta.changes)reject(409,'Tente resgatar novamente.');
  return {claimed:newly.map(m=>m.label),status:await worldBossStatus(db,id)};
}
function scoreBoard(db,kind,limit){
  const {week}=weeklyCycle();
  const sql=kind==='tower'?`SELECT id,name,json_extract(game,'$.towerCleared') AS score FROM nexus_players
      WHERE score>0 ORDER BY score DESC,id LIMIT ?`:
    `SELECT p.id,p.name,SUM(m.delta) AS score FROM nexus_arena_matches m
      JOIN nexus_players p ON p.id=m.player WHERE m.day>=? GROUP BY p.id,p.name ORDER BY score DESC,p.name,p.id LIMIT ?`;
  return kind==='tower'?db.prepare(sql).bind(limit):db.prepare(sql).bind(week,limit);
}
async function rankings(db){
  const now=Date.now(),cached=rankingsCache.get(db);
  if(cached&&now-cached.at<RANKINGS_TTL)return cached.data;
  const [power,rarity,raid,tower,arena]=await db.batch([
    db.prepare('SELECT id,name,power,top_units FROM nexus_players ORDER BY power DESC,name,id LIMIT 30'),
    db.prepare(`SELECT p.id,p.name,u.value AS unit FROM nexus_players p,json_each(p.rare_units) u
      ORDER BY json_extract(u.value,'$.odds') DESC,json_extract(u.value,'$.name'),json_extract(u.value,'$.serial'),p.id LIMIT 30`),
    db.prepare(`SELECT id,name,json_extract(game,'$.raid.bestDamage') AS score FROM nexus_players
      WHERE json_extract(game,'$.raid.day')=? AND score>0 ORDER BY score DESC,id LIMIT 30`).bind(dailyCycle().day),
    scoreBoard(db,'tower',30),scoreBoard(db,'arena',30)
  ]);
  const data={arena:arena.results.map(r=>({...r,league:arenaLeague(r.score).name})),raid:raid.results,tower:tower.results,power:power.results.map(({id,name,power,top_units})=>({player:{id,name},power,units:JSON.parse(top_units)})),
    rarity:rarity.results.map(({id,name,unit})=>({...JSON.parse(unit),player:{id,name}}))};
  rankingsCache.set(db,{at:now,data});
  return data;
}
const pair=(a,b)=>a<b?[a,b]:[b,a];
async function friends(db,id){
  const now=Date.now(),cycle=dailyCycle(now);
  const [connections,inbox]=await db.batch([
    db.prepare(`SELECT p.id,p.name,p.code,f.accepted,f.requested_by,
      EXISTS(SELECT 1 FROM nexus_gifts g WHERE g.sender=? AND g.recipient=p.id AND g.day=?) AS sent
      FROM nexus_friends f JOIN nexus_players p ON p.id=CASE WHEN f.a=? THEN f.b ELSE f.a END
      WHERE f.a=? OR f.b=? ORDER BY p.name,p.id`).bind(id,cycle.day,id,id,id),
    db.prepare(`SELECT p.id,p.name,g.gold,g.sent_at AS sentAt FROM nexus_gifts g JOIN nexus_players p ON p.id=g.sender
      WHERE g.recipient=? ORDER BY g.sent_at DESC LIMIT 20`).bind(id)
  ]);
  return {friends:connections.results.filter(r=>r.accepted),requests:connections.results.filter(r=>!r.accepted),inbox:inbox.results,cycle,now,giftGold:GIFT_GOLD};
}
async function invite(db,id,code){
  if(typeof code!=='string'||!/^[a-f0-9]{10}$/i.test(code.trim()))reject(400,'Informe o código de amigo com 10 caracteres.');
  const other=await db.prepare('SELECT id FROM nexus_players WHERE code=?').bind(code.trim().toUpperCase()).first();
  if(!other)reject(404,'Código de amigo não encontrado.');
  if(other.id===id)reject(400,'Esse é o seu próprio código.');
  const result=await db.prepare(`INSERT OR IGNORE INTO nexus_friends(a,b,requested_by) SELECT ?,?,?
    WHERE (SELECT count(*) FROM nexus_friends WHERE (a=? OR b=?) AND accepted=1)<40
      AND (SELECT count(*) FROM nexus_friends WHERE (a=? OR b=?) AND accepted=1)<40
      AND (SELECT count(*) FROM nexus_friends WHERE requested_by=? AND accepted=0)<20
      AND (SELECT count(*) FROM nexus_friends WHERE (a=? OR b=?) AND accepted=0 AND requested_by<>?)<40`)
    .bind(...pair(id,other.id),id,id,id,other.id,other.id,id,other.id,other.id,other.id).run();
  if(!result.meta.changes)reject(409,'Já existe um convite ou o limite de amigos foi atingido.');
}
async function reply(db,id,body){
  if(typeof body.id!=='string'||!['accept','remove'].includes(body.decision))reject(400,'Resposta inválida.');
  const ids=pair(id,body.id);
  const statement=body.decision==='remove'
    ?db.prepare('DELETE FROM nexus_friends WHERE a=? AND b=?').bind(...ids)
    :db.prepare(`UPDATE nexus_friends SET accepted=1 WHERE a=? AND b=? AND requested_by<>? AND accepted=0
      AND (SELECT count(*) FROM nexus_friends WHERE (a=? OR b=?) AND accepted=1)<40
      AND (SELECT count(*) FROM nexus_friends WHERE (a=? OR b=?) AND accepted=1)<40`)
      .bind(...ids,id,id,id,body.id,body.id);
  if(!(await statement.run()).meta.changes)reject(409,'A amizade ou o convite já mudou.');
}
async function gift(db,id,recipient){
  if(typeof recipient!=='string')reject(400,'Escolha um amigo.');
  const now=Date.now(),ids=pair(id,recipient);
  const result=await db.prepare(`INSERT OR IGNORE INTO nexus_gifts(sender,recipient,day,gold,sent_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM nexus_friends WHERE a=? AND b=? AND accepted=1)`)
    .bind(id,recipient,dailyCycle(now).day,GIFT_GOLD,now,...ids).run();
  if(!result.meta.changes){
    if(!await db.prepare('SELECT 1 FROM nexus_friends WHERE a=? AND b=? AND accepted=1').bind(...ids).first())reject(403,'Presentes são exclusivos para amigos confirmados.');
    reject(409,'Você já enviou um presente a esse amigo neste ciclo.');
  }
  return {gold:GIFT_GOLD};
}
async function readBody(request,limit=8192){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))reject(415,'Envie JSON.');
  const reader=request.body?.getReader();
  if(!reader)reject(400,'Pedido inválido.');
  const decoder=new TextDecoder();let raw='',bytes=0;
  for(;;){
    const chunk=await reader.read();if(chunk.done)break;
    bytes+=chunk.value.byteLength;
    if(bytes>limit){await reader.cancel();reject(413,'Pedido muito grande.');}
    raw+=decoder.decode(chunk.value,{stream:true});
  }
  let body;
  try{body=JSON.parse(raw+decoder.decode());}catch{reject(400,'Pedido inválido.');}
  if(!body||Array.isArray(body)||typeof body!=='object')reject(400,'Pedido inválido.');
  return body;
}
function json(value,status=200,extraHeaders={}){
  return Response.json(value,{status,headers:{...API_RESPONSE_HEADERS,...extraHeaders}});
}
function databaseFailure(error){
  const message=[error?.message,error?.cause?.message].filter(Boolean).join(' ');
  if(/D1 DB is overloaded|requests queued for too long|too many requests queued/i.test(message))return 'D1_OVERLOADED';
  if(/D1 DB storage operation exceeded timeout/i.test(message))return 'D1_TIMEOUT';
  if(/D1 DB.*(?:restart|transient issue)|replica disconnected from primary|D1_ERROR.*network connection lost|D1 DB storage caused object to be reset/i.test(message))
    return 'D1_UNAVAILABLE';
  return null;
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
    const start=Date.now();
    let stage='binding';
    try{
      const db=env.NEXUS_DB;
      if(!db)reject(503,'O banco da campanha está indisponível neste ambiente.','D1_BINDING_MISSING');
      if(request.method==='GET'&&path==='/api/health'){
        stage='health';
        await db.prepare('SELECT 1 AS ok').first();
        return json({ok:true,build:BUILD});
      }
      stage='schema';
      await initialize(db);
      stage='route';
      if(path.startsWith('/api/auth/'))return await socialAuth(request,env,db,new URL(request.url));
      const post=request.method==='POST';
      
      if(post&&path==='/api/community/account')return json(await register(db,await readBody(request),request),201);
      const id=await authenticate(db,request);
      const body=post?await readBody(request,path==='/api/community/profile'?PROFILE_BODY_LIMIT:8192):null;
      if(request.method==='GET'){
        if(path==='/api/community/profile')return json(await profile(db,id));
        const other=/^\/api\/community\/profile\/([a-f0-9-]{36})$/.exec(path)?.[1];
        if(other)return json(await profile(db,other));
        if(path==='/api/community/friends')return json(await friends(db,id));
        if(path==='/api/community/ranked')return json(await rankedStatus(db,id));
        if(path==='/api/community/arena')return json(await arenaOpponents(db,id));
        if(path==='/api/community/arena-log')return json(await arenaLog(db,id));
        if(path==='/api/community/world-boss')return json(await worldBossStatus(db,id));
        if(path==='/api/community/top/tower'||path==='/api/community/top/arena')
          return json({rows:(await scoreBoard(db,path.endsWith('/tower')?'tower':'arena',10).all()).results});
        if(path==='/api/community/rankings')return json(await rankings(db));
      }
      if(post){
        if(path==='/api/community/logout'){
          const token=request.headers.get('Authorization').slice(7);
          await db.prepare('DELETE FROM nexus_sessions WHERE key=? AND player=?').bind(await hash(token),id).run();
          return json({});
        }
        if(path==='/api/community/rotate-token')return json(await rotateToken(db,id));
        if(path==='/api/community/arena-season-claim')return json(await claimArenaSeason(db,id));
        if(path==='/api/community/world-boss/claim')return json(await claimWorldBoss(db,id));
        if(path==='/api/community/ranked')return json(await rankedMatch(db,id,body));
        if(path==='/api/game')return json(await sync(db,id,body));
        if(path==='/api/community/profile'){
          let patch;
          const owner=await db.prepare('SELECT code FROM nexus_players WHERE id=?').bind(id).first();
          try{patch=appearancePatch(body,owner?.code);}catch(error){reject(400,error.message);}
          await db.prepare('UPDATE nexus_players SET appearance=json_patch(appearance,?) WHERE id=?').bind(JSON.stringify(patch),id).run();
          return json(await profile(db,id));
        }
        if(path==='/api/community/friend-request'){await invite(db,id,body.code);return json({});}
        if(path==='/api/community/friend-reply'){await reply(db,id,body);return json({});}
        if(path==='/api/community/gift')return json(await gift(db,id,body.id));
      }
      reject(404,'Rota não encontrada.');
    }catch(error){
      if(error instanceof ApiError&&error.status<500&&!error.code)return json({error:error.message},error.status);
      const temporary=databaseFailure(error);
      const code=temporary??error.code??'API_INTERNAL_ERROR';
      const status=temporary?503:error instanceof ApiError?error.status:500;
      const ray=request.headers.get('CF-Ray')??undefined;
      const route=path.replace(/^\/api\/community\/profile\/[^/]+$/,'/api/community/profile/:id');
      console.error(JSON.stringify({event:'nexus_api_error',build:BUILD,route,method:request.method,stage,status,code,ray,elapsedMs:Date.now()-start,errorName:error.name}));
      const message=temporary?'O serviço da campanha está temporariamente ocupado. Tente novamente em instantes.':
        error instanceof ApiError?error.message:'Não foi possível acessar a campanha online.';
      const retryable=temporary||['REGISTRATION_CONTENTION','SYNC_CONTENTION'].includes(code);
      return json({error:message,code,...(ray?{ray}:{})},status,retryable?{'Retry-After':code==='SYNC_CONTENTION'?'4':'15'}:{});
    }
  }
};
