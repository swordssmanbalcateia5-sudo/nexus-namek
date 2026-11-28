import {paintBossEffects} from './boss-fx.js';
import {effects,ballAnimations,singularSheets} from './arena-assets.js';
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
const secondKits={
 ...thirdKits,
 m2_frieren:{wind:.25,speed:112,range:60,radius:1.15,art:'zoltraak',factor:1.4,assist:.8,cd:9},
 m2_yami:{wind:.27,speed:94,range:68,radius:2.4,art:'fenda',factor:1.6,assist:.9,cd:9},
 m2_toji:{wind:.14,speed:118,range:46,radius:2,art:'lanca',factor:1.45,assist:.8,cd:8},
 m2_hisoka:{wind:.14,speed:96,range:50,radius:1,art:'goma',factor:.35,assist:.25,cd:8}
};

const sheets={};
const names=["barba_fratura", "barba_onda", "barba_tremor", "beerus_basico", "beerus_dissipacao", "beerus_hakai", "cero_flight", "cero_impact", "contato_azul", "dot_chamas_azuis", "dot_chamas_negras", "dot_fogo", "dot_sangramento", "giorno_acao", "giorno_impacto", "giorno_punho", "giorno_selo", "giorno_zero", "gojo_basico", "gojo_carga", "gojo_ilimitado", "gojo_vazio", "goku_contra", "goku_postura", "kaguya_basico", "kaguya_fenda", "kaguya_fragmentos", "kaguya_marca", "lucius_marca", "lucius_reversao", "madoka_purifica", "madoka_retorno", "madoka_selo", "meliodas_contato", "meliodas_corte", "meliodas_escudo", "meliodas_reserva", "meruem_carapaca", "meruem_esfera", "meruem_impacto", "meruem_lamina", "roger_dash", "roger_hit", "sailor_barreira", "sailor_cura", "sailor_onda", "saitama_impacto", "saitama_onda", "saitama_soco", "shinra_cura", "shinra_fratura", "shinra_golpe", "shinra_ignicao", "simon_broca", "simon_espiral", "simon_impacto", "sukuna_basico", "sukuna_corte", "sukuna_santuario", "yhwach_futuro", "yhwach_visao"];
const modernSheets={};
const pending=new Set();
const ballSheets={};
function loadArt(store,key,url){
  if(!url||Object.hasOwn(store,key)||pending.has(url))return store[key];
  pending.add(url);
  const im=new Image();
  im.onload=()=>{store[key]=im;pending.delete(url);};
  im.onerror=()=>{pending.delete(url);store[key]=null;};
  im.src=url;
  return undefined;
}
let loaded=false;
function loadSheets(){
  if(loaded)return;
  loaded=true;
  for(const name of names){
    const image=new Image();
    image.onload=()=>{sheets[name]=image;};
    image.src='art/transcendentes/'+name+'.png';
  }
}
const singularImages={};
function paintSingularEffects(ctx,match,motion){
  function draw(art,point,born,{size=18,angle=0,stand=false}={}){
    const info=singularSheets[art];
    if(!info)return;
    const [url,width,height,frames,ms,pivot,loop]=info;
    const im=loadArt(singularImages,art,url);
    if(!im)return;
    const age=Math.max(0,match.t-born)*1000;
    const frame=motion?(loop?Math.floor(age/ms)%frames:Math.min(frames-1,Math.floor(age/ms))):0;
    const ratio=size/Math.max(width,height);
    ctx.save();
    ctx.translate(point.x,point.y);
    if(stand){
      ctx.scale(Math.cos(angle)<0?-1:1,1);
      ctx.rotate(Math.sin(angle)*.22);
    }else ctx.rotate(angle);
    ctx.drawImage(im,frame*width,0,width,height,-pivot[0]*ratio,-pivot[1]*ratio,width*ratio,height*ratio);
    ctx.restore();
  }
  for(const effect of match.singularFx??[]){
    const point=effect.follow===undefined?effect:match.sides[effect.follow];
    draw(effect.art,point,effect.born,{...effect,size:effect.size??(effect.stand?22:17)});
    if(effect.direction){
      ctx.save();
      ctx.translate(point.x,point.y);
      ctx.rotate(effect.angle);
      ctx.strokeStyle='#ffdd8d';ctx.lineWidth=.35;
      ctx.beginPath();ctx.moveTo(2,0);ctx.lineTo(9,0);ctx.lineTo(7,-1.5);ctx.moveTo(9,0);ctx.lineTo(7,1.5);ctx.stroke();
      ctx.restore();
    }
  }
  for(const shot of match.shots){
    if(shot.singular)draw(shot.art,shot,shot.born,{angle:shot.angle,size:13});
  }
  for(const side of match.sides){
    if(side.dash?.art!=='dio_investida')continue;
    const {born,angle}=side.dash;
    draw('dio_investida',side,born,{angle,size:19});
    draw('dio_stand_punho',side,born,{angle,stand:true,size:24});
  }
}
export function paintTranscendentes(canvas,match,motion,balls=[],finishAge=0){
 const ctx=canvas.getContext('2d');
 if(!ctx)return;
 loadSheets();
 const R=4;
 const modern=Number.isInteger(match.launchSeed);
 const batchImages=modern?new Proxy(modernSheets,{get:(obj,key)=>effects[key]?loadArt(obj,key,effects[key]):sheets[key]}):sheets;
 const drawn=[false,false];
 const rogerArt={investida:sheets.roger_dash,contato:sheets.roger_hit},ceroImages={flight:sheets.cero_flight,impact:sheets.cero_impact};
 const quakeRadius=age=>[3,8,14,18][Math.min(3,Math.floor(Math.max(0,age)/.06))];
 const ceroLength=(age,speed)=>Math.min(26,Math.max(.6,age*speed));
function shape(x,y,r,fill,stroke,line=.28){
 ctx.beginPath();ctx.arc(x,y,Math.max(0,r),0,2*Math.PI);
 if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=line;ctx.stroke()}
}
function artAt(im,x,y,w,h,frames=1,index=0,angle=0){
 if(!motion)index=0;
 const sw=im.width/frames,ratio=Math.min(w/sw,h/im.height),dw=sw*ratio,dh=im.height*ratio;
 ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.drawImage(im,index*sw,0,sw,im.height,-dw/2,-dh/2,dw,dh);ctx.restore();
}
function batchArt(key,x,y,size,age,angle=0){const im=batchImages[key==='roger_corte_apoio'?'roger_dash':key==='roger_contato_apoio'?'roger_hit':key==='mob_descarga'?'mob_basico':key==='anos_retorno'?'anos_basico':key];if(im)artAt(im,x,y,size,size,4,Math.floor(Math.max(0,age)*25)%4,angle)}

function secondDraw(m){
 for(const q of m.secondMoves||[]){
  const k=secondKits[q.f.kind],a=m.sides[q.f.side],b=m.sides[1-q.f.side],wind=q.angle==null;
  const angle=wind?Math.atan2(b.y-a.y,b.x-a.x):q.angle;
  const key=wind&&q.f.kind==='m2_frieren'?'selo_zoltraak':k.art;
  const size=({fenda:18,lanca:15,goma:8,zoltraak:17,selo_zoltraak:13,hiken:20,incinerador:24,desarme:8,luz_pulso:14})[key]??16;
  const shift=wind?R+2:q.f.kind==='m2_toji'?R:0;
  batchArt(key,(wind?a.x:q.x)+Math.cos(angle)*shift,(wind?a.y:q.y)+Math.sin(angle)*shift,wind?size*.72:size,m.t,angle);
 }
 for(const t of m.gums||[]){
  const a=m.sides[t.f.side],b=m.sides[t.v.side],angle=Math.atan2(b.y-a.y,b.x-a.x),len=Math.hypot(b.x-a.x,b.y-a.y);
  ctx.save();ctx.translate(a.x,a.y);ctx.rotate(angle);const im=batchImages.fio;if(im?.naturalWidth){const w=im.width/4;ctx.drawImage(im,w*(Math.floor(m.t*12)%4),0,w,im.height,0,-1.1,len,2.2)}ctx.restore();
 }
}

function mythDraw(m){
 const render=(key,p,size,age,duration,angle=0)=>{const im=batchImages[key];if(im?.naturalWidth)artAt(im,p.x,p.y,size,size,4,Math.min(3,Math.floor(4*age/duration)),angle)};
 for(const s of m.sides){
  const u=s.team[s.slot];if(!u)continue;
  if(u.kind==='m_josuke'&&u.standUntil>m.t){
    const enemy=m.sides[1-u.side],dir=enemy.x>=s.x?1:-1,im=batchImages[u.sprite?.endsWith('-shiny')?'crazy-diamond-shiny':'crazy-diamond'];
    if(im?.naturalWidth){ctx.save();ctx.translate(s.x-dir*4,s.y-4);ctx.scale(dir,1);artAt(im,0,0,12,12,4,Math.floor(m.t/.075)%4);ctx.restore();}
  }
  if(u.mark){const k=u.mark,t=Math.min(1,(m.t-k.born)/.16);render('kunai',{x:k.fromX+(k.x-k.fromX)*t,y:k.fromY+(k.y-k.fromY)*t},10,m.t%.48,.48,k.angle)}
  if(u.waterGuard?.end>=m.combat.time)render('agua',s,14,m.t%.64,.64);
  if(u.petalTrap?.end>m.combat.time)render('petalas',s,13,m.t%.48,.48);
 }
 for(const q of m.waterRuns||[])render(q.angle==null?'agua':'corrente',q,q.angle==null?16:21,m.t%.24,.24,q.angle||0);
 for(const p of m.petals||[])render('petalas',p,22,m.t-p.born,.35);
 for(const e of m.mythFx||[])render(e.key,e.key==='punhos'?{x:e.pos.x+R*1.4,y:e.pos.y}:e.pos,e.size,m.t-e.start,e.duration,e.angle);
}

function divineDraw(m){
  for(const side of m.sides){
    const u=side.team[side.slot];
    if(!u)continue;
    if(u.divineShield?.until>m.t)batchArt('barreira_ativa',side.x,side.y,14.8,m.t);
    if(u.absorbSword?.until>m.t)batchArt('selo_absorcao',side.x,side.y,13,m.t);
    if(u.palmGuard?.until>m.t||u.divinePrayer)batchArt('oracao',side.x,side.y,14,m.t);
    if(u.kind==='div_mereoleona'&&u.divineHeat>=3)batchArt('calor',side.x,side.y,13.5,m.t);
    if(u.divineGarden&&u.shield>0)batchArt('jardim',side.x,side.y,15,m.t);
  }
  for(const e of m.divineFx??[]){
    const im=batchImages[e.art];if(!im?.width)continue;
    const point=e.follow?divinePosition(m,e.follow):e;
    if(!point)continue;
    const frame=Math.max(0,Math.min(3,Math.floor((m.t-e.born)*4/e.duration)));
    artAt(im,point.x,point.y,e.size,e.size,4,frame,e.angle);
  }
  for(const ray of m.divineRays??[])batchArt(ray.art,ray.x,ray.y,15,m.t,ray.angle);
}

function divinePosition(m,unit){
  const side=m.sides[unit.side];
  return side.team[side.slot]===unit?side:null;
}
function paintBallAction(m,unit,side,index){
  if(!motion||!balls[index])return;
  const age=m.t-(unit.visualBasicStart??-Infinity);
  const skillAge=m.t-(unit.visualSpecialStart??-Infinity);
  const id=unit.characterId;
  const key=id+(unit.shiny?':shiny':'');
  const action=id==='dio'&&skillAge>=0&&skillAge<1.36?':the-world':'';
  const meta=ballAnimations[key+action]??ballAnimations[key]??ballAnimations[id+action]??ballAnimations[id];
  if(!meta)return;
  const [url,w,h,columns,count,pivot,impact,fps,durations]=meta;
  const elapsed=action?skillAge:age;
  if(elapsed<0||elapsed>1.5)return;
  let frame=action?0:impact;
  if(durations){
    let time=elapsed*1000;
    while(frame<count&&time>=durations[frame])time-=durations[frame++];
  }else frame+=Math.floor(elapsed*fps);
  if(frame>=count)return;
  const im=loadArt(ballSheets,url,url);
  if(!im)return;
  drawn[index]=true;
  ctx.save();
  ctx.beginPath();ctx.arc(side.x,side.y,3.78,0,Math.PI*2);ctx.clip();
  ctx.translate(side.x,side.y);ctx.scale(unit.visualFacing??1,1);
  const scale=Math.min(8.4/h,15/w);
  ctx.drawImage(im,(frame%columns)*w,Math.floor(frame/columns)*h,w,h,-pivot[0]*scale,4-pivot[1]*scale,w*scale,h*scale);
  ctx.restore();
}
 ctx.setTransform(canvas.width/100,0,0,canvas.height/50,0,0);ctx.clearRect(0,0,100,50);ctx.imageSmoothingEnabled=false;
 if(modern)paintBossEffects(ctx,match,motion,finishAge);
 paintSingularEffects(ctx,match,motion);
 if(match.result)return drawn;
 if(modern){secondDraw(match);mythDraw(match);divineDraw(match);}

 for(const e of match.flashes){
   if(e.art==='sailor_onda'){const t=match.t-e.time;if(t>=0&&t<.16)batchArt(e.art,e.x,e.y,14+t*155,t)}
 }
 for(const e of match.mirages??[]){
   const age=match.t-e.born;
   batchArt('aizen_eco',e.x,e.y,17+3*Math.min(1,age/.32),age);
 }
 for(const e of match.groundEffects??[]){
   const age=match.t-e.born;
   if(e.art==='benimaru_anel')shape(e.x,e.y,28,'#ff68131a','#ffae75',.25);
   else batchArt(e.art,e.x,e.y,17,age);
 }
 for(const e of match.secretCharges??[]){
   const point=e.origin??match.sides[e.f.side];
   batchArt(e.art,point.x,point.y,16,match.t-e.born);
 }
 for(const e of match.psychicPulses??[]){
   if(e.art==='broly_explosao'||e.art==='luffy_onda'){
     const color=e.art==='broly_explosao'?'#a8ff81':'#ffcff1';
     shape(e.x,e.y,e.radius,null,color,.22);
     continue;
   }
   shape(e.x,e.y,e.radius,e.art==='mob_onda'?'#8374ff18':'#ef64c71a',e.art==='mob_onda'?'#aaa0ff':'#ff97de',.22);
 }
 for(const e of match.starShots??[])batchArt('yuno_estrela',e.x,e.y,10,match.t-e.born);
 const zones=false;
 for(const s of match.shots){
   if(s.kind==='bossShot'||s.singular)continue;
   const zone=['room','zone'].includes(s.kind),age=match.t-s.born,r=s.radius*(zone?Math.min(1,age/.3):1);
   if(s.kind==='tremor'){
     if(!s.support && age<.48){
       ctx.save();ctx.globalAlpha=age<.24?1:Math.max(0,1-(age-.24)/.24);
       if(age<.24)shape(s.x,s.y,quakeRadius(age),'#52e5b80d','#8be4cb70',.13);
       const im=batchImages.barba_tremor;
       if(im)artAt(im,s.x,s.y,37,37,4,Math.min(3,Math.floor(age/.06)),s.angle);
       ctx.restore();
     }
     if(age>=.24){
       const distance=(s.support?0:18)+84*(age-.24),ux=Math.cos(s.angle),uy=Math.sin(s.angle);
       const im=batchImages.barba_onda;
       if(im)artAt(im,s.x+ux*(distance-9),s.y+uy*(distance-9),22,22,4,Math.floor((age-.24)/.06)%4,s.angle);
     }
     continue;
   }
   if(s.kind==='echoArea'){
     const r=s.radius*Math.min(1,age/.16);shape(s.x,s.y,r,'#8857cf33','#c0afff',.2);batchArt(s.art,s.x,s.y,20,age);continue;
   }
   if(s.kind==='muda'){
     const im=s.f.kind==='m_josuke'?batchImages.punhos:batchImages.giorno_punho;
     if(im)artAt(im,s.x-3.8*Math.cos(s.angle),s.y-3.8*Math.sin(s.angle),12,12,4,Math.min(3,Math.floor(age/.045)),s.angle);
     continue;
   }
   const tint=s.side?'#ffb4ae':'#91ebf7',fill=s.side?'#f48b7a24':'#5fdaef28';
   if(s.kind==='dominio'||s.kind==='santuario'){
     const charge=s.kind==='dominio'&&!s.open;
     const pos=charge?match.sides[s.side]:s;
     const art=charge?'gojo_carga':s.kind==='dominio'?'gojo_vazio':'sukuna_santuario';
     batchArt(art,pos.x,pos.y,charge?13:s.radius*2*64/62,age);
     continue;
   }
   if(s.kind==='batch'){
     if(s.art==='teste'){shape(s.x,s.y,1,'#efad86');continue}
     if(s.art==='saitama_soco'){
       batchArt(s.art,s.x-8*Math.cos(s.angle),s.y-8*Math.sin(s.angle),30,age,s.angle);
       if(zones)shape(s.x,s.y,s.radius,null,'#effffcad',.13);
     }else if(s.art==='simon_broca'){batchArt(s.art,s.x-.32*s.size*Math.cos(s.angle),s.y-.32*s.size*Math.sin(s.angle),s.size,age,s.angle)}else if(batchImages[s.art==='mob_descarga'?'mob_basico':s.art==='anos_retorno'?'anos_basico':s.art]||s.art==='roger_corte_apoio')batchArt(s.art,s.x,s.y,({asta_corte:23,asta_retorno:18,madara_disparo:15,yuno_disparo:19,shanks_corte:24,broly_onda:21,blast_disparo:18,luffy_chicote:21,mob_descarga:19,vegeta_feixe:34,kaido_sopro:33,benimaru_corte:19,veldora_raio:25,luminous_lanca:17,anos_fonte:18,anos_retorno:14,aizen_estilhacos:14,yamamoto_corte:20,ichigo_primeira:22,ichigo_segunda:24,johnny_disparo:15,rimuru_retorno:20,accelerator_reflexo:20,garou_copia:20,meliodas_corte:22,meruem_esfera:15,meruem_lamina:19,beerus_hakai:14,beerus_basico:11,kaguya_basico:12,shinra_golpe:16})[s.art]??9,age,s.angle);
     else shape(s.x,s.y,s.radius,'#86fcff');
     continue;
   }
   if(s.kind==='cero'){
     const length=ceroLength(age,s.speed);
     const fx=null;
     const image=fx?.image||ceroImages.flight;
     const cx=s.x-Math.cos(s.angle)*length*.47,cy=s.y-Math.sin(s.angle)*length*.47;
     if(image)artAt(image,cx,cy,length,length,fx?.frames||4,Math.floor(age*(fx?.fps||25))%(fx?.frames||4),s.angle);

     continue;
   }
   const custom=false;
   if(!custom)shape(s.x,s.y,r,fill,tint,zone?.2:.26);
   if(zones){
     ctx.setLineDash([.35,.5]);
     shape(s.x,s.y,s.radius,null,'#effffcad',.13);
     ctx.setLineDash([]);
   }
 }
 match.sides.forEach((s,i)=>{
   const f=s.team[s.slot];if(!f)return;
   if(modern)paintBallAction(match,f,s,i);
   if(f.heatUntil>match.combat.time||s.burnBoost)batchArt('yamamoto_calor',s.x,s.y,15,match.t);
   if(f.dragonSupport?.until>match.combat.time)batchArt('kaido_carga',s.x,s.y,12,match.t);
   const acceleration=f.kind==='pucci_mih'&&f.enteredAt!==undefined
     ?1.05**Math.floor(Math.max(0,match.combat.time-f.enteredAt)/2000):1;
   if(acceleration>1||f.pucciAssistUntil>match.combat.time){
     const angle=Math.atan2(s.vy,s.vx);
     const trailSize=14+Math.min(12,(acceleration-1)*6);
     batchArt('pucci_rastro',s.x-6*Math.cos(angle),s.y-6*Math.sin(angle),trailSize,match.t,angle);
     batchArt('pucci_aura',s.x,s.y,12,match.t);
   }
   if(f.truthOrbs?.until>match.combat.time){
     for(let i=0;i<f.truthOrbs.count;i++){
       const angle=match.t*3+i*2*Math.PI/f.truthOrbs.count;
       batchArt('madara_esfera',s.x+7*Math.cos(angle),s.y+7*Math.sin(angle),5,match.t);
     }
   }
   if(f.rageUntil>match.combat.time||f.rageStacks===4)batchArt('broly_aura',s.x,s.y,15,match.t);
   if(f.blastPortalUntil>match.combat.time)batchArt('blast_portal',s.x,s.y,12,match.t);
   if(f.elasticGuard?.until>match.combat.time||f.wallBoost?.until>match.combat.time){
     const stacks=f.wallBoost?.until>match.combat.time?f.wallBoost.stacks:0;
     batchArt('luffy_guarda',s.x,s.y,13+stacks,match.t);
   }
   if(f.mobWardUntil>match.combat.time)batchArt('mob_aura',s.x,s.y,13,match.t);
   if(f.healSealUntil>match.combat.time)batchArt('anos_marca',s.x,s.y,11,match.t);
   if(f.illusionUntil>match.combat.time||f.illusionBench)batchArt('aizen_ilusao',s.x,s.y,14,match.t);
   if(f.royalWardUntil>match.combat.time||f.rulerSupport)batchArt('governante_guarda',s.x,s.y,14,match.t);
   if(f.royalAttackUntil>match.combat.time||f.invertedAttackUntil>match.combat.time||f.invertedExposureUntil>match.combat.time||f.freedomUntil>match.combat.time||f.invertedShield)batchArt('governante_bonus',s.x,s.y,14,match.t);
   if(f.inversionAt!=null&&match.t-f.inversionAt/1000<.24){
     const im=batchImages.governante_inversao;if(im)artAt(im,s.x,s.y,19,19,4,Math.min(3,Math.floor(Math.max(0,match.t-f.inversionAt/1000)/.06)));
   }
   if(f.storedMagic||f.slimeGuard)batchArt('rimuru_reserva',s.x,s.y,14,match.t);
   if(f.cosmicCopy)batchArt('garou_memoria',s.x,s.y,14,match.t);
   if((f.kind==='accelerator'||f.vectorAssist)&&(!match.combat.vectorPool||match.combat.vectorPool[i].ready<=match.combat.time))batchArt('accelerator_campo',s.x,s.y,14,match.t);
   if(f.sageBless||f.reserveHeal||f.sageLink?.until>match.combat.time)batchArt('hagoromo_vinculo',s.x,s.y,14,match.t);
   if(f.cleanSeal?.size)batchArt('madoka_selo',s.x,s.y,14,match.t);
   if((f.kind==='yhwach'&&!f.almightySpent)||f.futureUntil>match.combat.time)batchArt('yhwach_visao',s.x,s.y,15,match.t);
   if((f.kind==='giorno'||f.zeroGuard)&&!match.combat.zeroUsed?.[i])batchArt('giorno_selo',s.x,s.y,R*80/25,match.t);
   if(f.demonCharge>0)batchArt('meliodas_reserva',s.x,s.y,15,match.t);
   if(f.crackedShield)batchArt('meliodas_escudo',s.x+R,s.y-R,6,match.t);
   if(f.moonGuard||f.moonShield>0)batchArt('sailor_barreira',s.x,s.y,12.8,match.t);
   for(const state of f.dots?.values()??[]){
     const elapsed=match.t-state.start,frame=Math.floor((elapsed+1e-6)/.10)%4;
     const art=batchImages[state.key];
     if(art){ctx.save();ctx.globalAlpha=state.lastTick!==null&&match.t-state.lastTick<.14?1:.80;
       artAt(art,s.x,s.y,15.8,15.8,4,frame);ctx.restore()}
   }
   if(f.adaptiveUntil>match.combat.time)batchArt('meruem_carapaca',s.x,s.y,13,match.t);
   if(f.timeMark?.until>match.combat.time)batchArt('lucius_marca',s.x,s.y,15,match.t);
   if(f.portalDodge)batchArt('kaguya_marca',s.x,s.y,13,match.t);
   if(f.powerUntil>match.combat.time||f.weakenUntil>match.combat.time&&match.sides[1-i].team.some(u=>u.kind==='kaguya')){
     batchArt('kaguya_marca',s.x,s.y,13,match.t);
   }
   if(f.stanceUntil>match.t*1000)batchArt('goku_postura',s.x,s.y-.36,17.5,match.t-(f.stanceUntil-2000)/1000);
   if(s.ignition){
     const age=match.t-s.ignition.born,im=batchImages.shinra_ignicao;
     if(im)artAt(im,s.x,s.y,22,22,4,Math.min(3,Math.floor(age*20)),0);
   }
   if(s.dash?.art==='boss_arlong_dash')return;
   if(s.dash?.art){
     const a=s.dash.angle;batchArt(s.dash.art,s.x-8*Math.cos(a),s.y-8*Math.sin(a),26,match.t-s.dash.born,a);
   }else if(s.dash && rogerArt.investida){
     const a=s.dash.angle;
     artAt(rogerArt.investida,s.x+Math.cos(a)*1.5,s.y+Math.sin(a)*1.5,20,20,4,Math.floor((match.t-s.dash.born)*25)%4,a);
   }
 });
 for(const e of match.flashes){
   const elapsed=match.t-e.time+(match.finishFxAt===undefined?0:(performance.now()-match.finishFxAt)/1000);
   if(e.art==='giorno_selo'||e.art==='sailor_onda')continue;
   if(e.art==='sailor_barreira'||e.art==='sailor_cura'){
     if(elapsed>=0&&elapsed<.16){
       const pos=match.sides[e.follow],size=e.art==='sailor_barreira'?12.8:14;
       ctx.save();ctx.beginPath();ctx.rect(-100,-100,300,250);ctx.arc(pos.x,pos.y,R,0,Math.PI*2);ctx.clip('evenodd');
       batchArt(e.art,pos.x,pos.y,size,elapsed);ctx.restore();
     }
     continue;
   }
   if(e.art==='shinra_fratura'){
     const im=batchImages.shinra_fratura;
     if(im&&elapsed>=0&&elapsed<.28)artAt(im,e.x,e.y,28,28,4,Math.floor(elapsed/.07),e.angle);
     continue;
   }
   if(e.art==='saitama_onda'){
     if(elapsed>=0&&elapsed<.32&&batchImages.saitama_onda){
       const travel=elapsed*45;
       artAt(batchImages.saitama_onda,e.x+Math.cos(e.angle)*travel,e.y+Math.sin(e.angle)*travel,26,26,4,Math.floor(elapsed/.08),e.angle);
     }
     continue;
   }
   if(e.radius&&['tetsuo_onda','mob_onda','broly_explosao','luffy_onda'].includes(e.art)){
     if(elapsed>=0&&elapsed<.32){
       const im=batchImages[e.art],size=e.radius*80/35;
       if(im)artAt(im,e.x,e.y,size,size,4,Math.min(3,Math.floor(elapsed/.08)));
       shape(e.x,e.y,e.radius,null,({mob_onda:'#aaa0ff',tetsuo_onda:'#ff97de',broly_explosao:'#a8ff81',luffy_onda:'#ffcff1'})[e.art],.18);
     }
     continue;
   }
   if(e.art==='benimaru_anel'||e.art==='luminous_cura'){
     if(elapsed>=0&&elapsed<.32){
       const p=e.follow===undefined?e:match.sides[e.follow], im=batchImages[e.art];
       if(im)artAt(im,p.x,p.y,e.art==='benimaru_anel'?64:18,e.art==='benimaru_anel'?64:18,4,Math.min(3,Math.floor(elapsed/.08)));
     }
     continue;
   }
   if(e.art){
     if(elapsed>=.16)continue;
     const p=e.follow===undefined?e:match.sides[e.follow];
     batchArt(e.art==='contato_dourado'?'saitama_impacto':e.art,p.x,p.y,e.art==='sailor_onda'?14+elapsed*155:e.art==='lucius_reversao'?25:e.art==='barba_fratura'?17:e.art==='kaguya_fenda'?31:e.art==='shinra_cura'?22:e.art==='beerus_dissipacao'?17:e.art==='saitama_impacto'?21:e.follow===undefined?11:15,elapsed);continue;
   }
   if(e.kind==='rei'){
     if(rogerArt.contato)artAt(rogerArt.contato,e.x,e.y,16,16,4,Math.min(3,Math.floor((match.t-e.time)*25)),e.angle);
     continue;
   }
   const angle=Math.atan2(e.y-e.fromY,e.x-e.fromX);
   if(e.kind==='cero'){
     const fx=null,im=ceroImages.impact;
     const frames=fx?.frames||4;
     if(im)artAt(im,e.x,e.y,7,7,frames,Math.min(frames-1,Math.floor((match.t-e.time)*(fx?.fps||25))),0);
     continue;
   }
   if(e.kind==='room'){ctx.beginPath();ctx.moveTo(e.fromX,e.fromY);ctx.quadraticCurveTo((e.x+e.fromX)/2,e.y-3,e.x,e.y);ctx.lineWidth=.45;ctx.strokeStyle=e.side?'#ffbfcc':'#c5ffff';ctx.stroke()}
   shape(e.x,e.y,1.7,null,'#fff',.4);
 }
 return drawn;
}
