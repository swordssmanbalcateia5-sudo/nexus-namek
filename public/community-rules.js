// A daily period is keyed by the local calendar date on which its noon began.
export const DAILY_ZONE='America/Sao_Paulo';
export const GIFT_GOLD=10;
export const PROFILE_OPTIONS={
  background:{hoova:'Hoova · Floresta do Susanoo',zawa:'Zawa · Pátio do Demônio Celestial',careca:'Careca · Página apagada',namek:'Namek · Dragon Ball',arlong:'Arlong Park · One Piece',konoha:'Konoha · Naruto',
    seireitei:'Seireitei · Bleach',shibuya:'Shibuya · Jujutsu Kaisen',clover:'Reino Clover · Black Clover',
    britannia:'Britannia · Nanatsu no Taizai',morioh:'Morioh · JoJo',heavens:'Heavens Arena · Hunter × Hunter',
    cidadez:'Cidade Z · One Punch Man',noite:'Noite violeta',aurora:'Aurora turquesa'},
  icon:{estrela:'Estrela',cometa:'Cometa',escudo:'Escudo'},
  border:{menta:'Menta',violeta:'Violeta',ouro:'Ouro'},
};
export const DEFAULT_PROFILE={background:'namek',icon:'estrela',border:'menta'};
export const PROFILE_WORLDS={namek:0,arlong:1,konoha:2,seireitei:3,shibuya:4,clover:5,britannia:6,morioh:7,heavens:8,cidadez:9};
export const AVATAR_SIZE=128;
export const PROFILE_BODY_LIMIT=100*1024;

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
export function canEquipBackground(key,code){
  const owners={hoova:'0DA6605BD4',zawa:'89B75CB773',careca:'4A6913795B'};
  return !Object.hasOwn(owners,key)||owners[key]===code;
}
export function appearancePatch(input,code){
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
export function dailyCycle(now=Date.now()){
  const f=localFields(now);
  const today=Date.UTC(f.year,f.month-1,f.day);
  const startDate=today-(f.hour<12?86400000:0);
  return {day:new Date(startDate).toISOString().slice(0,10),nextAt:localNoon(startDate+86400000)};
}

// Weekly cycle resets every Monday at 12:00 America/Sao_Paulo.
export function weeklyCycle(now=Date.now()){
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

export const ARENA_LEAGUES=[
  {id:'bronze',name:'Bronze',min:0,color:'#cd9b6a',reward:{trophies:3,tokens:1,essence:1}},
  {id:'prata',name:'Prata',min:100,color:'#c9d4e4',reward:{trophies:6,tokens:2,essence:2}},
  {id:'ouro',name:'Ouro',min:200,color:'#f5d66c',reward:{trophies:10,tokens:3,essence:3}},
  {id:'platina',name:'Platina',min:320,color:'#7ce7df',reward:{trophies:15,tokens:5,essence:5}},
  {id:'diamante',name:'Diamante',min:450,color:'#98b8ff',reward:{trophies:22,tokens:7,essence:7}},
  {id:'transcendente',name:'Transcendente',min:600,color:'#ff9cf2',reward:{trophies:30,tokens:10,essence:10}},
];
export function arenaLeague(points=0){
  let current=ARENA_LEAGUES[0];
  for(const l of ARENA_LEAGUES){if(points>=l.min)current=l;}
  return current;
}

export const ARENA_SHOP=[
  {id:'token',name:'Token de reroll',desc:'Rola as traits de um slot.',cost:5,grant:{traitItems:1}},
  {id:'xpTome',name:'Tomo de XP',desc:'+250.000 XP instantâneo para um personagem.',cost:6,grant:{xpTome:1}},
  {id:'essence2',name:'Essência de Despertar ×2',desc:'Substitui duplicatas no Despertar (★1–★5).',cost:8,grant:{essence:2}},
  {id:'catalyst',name:'Catalisador de Trait',desc:'Triplica chance de 2–3 traits e garante Rara+.',cost:15,grant:{catalyst:1}},
  {id:'traitLock',name:'Selo de Trava de Trait',desc:'Trava 1 trait atual durante o reroll.',cost:20,grant:{traitLock:1}},
];

export const GOLD_SHOP=[
  {id:'token',name:'Token de reroll',desc:'Preço sobe a cada compra na semana.',base:150000,step:75000,limit:10,grant:{traitItems:1}},
  {id:'essence',name:'Essência de Despertar',desc:'Desperta personagens sem precisar de cópia.',base:120000,step:40000,limit:10,grant:{essence:1}},
  {id:'xpTome',name:'Tomo de XP',desc:'+250.000 XP instantâneo em qualquer unidade.',base:100000,step:25000,limit:5,grant:{xpTome:1}},
  {id:'elixir',name:'Elixir de Recuperação',desc:'Zera imediatamente a recuperação da equipe.',base:25000,step:5000,limit:10,grant:{elixir:1}},
  {id:'catalyst',name:'Catalisador de Trait',desc:'3× chance de 2–3 traits e mínimo Rara+.',base:350000,step:150000,limit:3,grant:{catalyst:1}},
  {id:'traitLock',name:'Selo de Trava de Trait',desc:'Mantém 1 trait escolhida ao rolar o slot.',base:500000,step:250000,limit:2,grant:{traitLock:1}},
];

export function rarityLabel(odds){
  const format=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
  for(const [divisor,suffix] of [[1e9,'B'],[1e6,'M'],[1e3,' mil']]){
    if(odds>=divisor)return '1/'+format.format(odds/divisor)+suffix;
  }
  return '1/'+format.format(odds);
}
