import {unitLabel} from './unit-label.js';
import {CHARACTERS,TIERS,COLORS,spriteFor} from './game.js';
import {DAILY_ZONE,GIFT_GOLD,canEquipBackground,PROFILE_OPTIONS,PROFILE_WORLDS,AVATAR_SIZE,rarityLabel} from './community-rules.js';

const tokenKey='nexus.community.access';
const number=new Intl.NumberFormat('pt-BR');
const date=new Intl.DateTimeFormat('pt-BR',{timeZone:DAILY_ZONE,dateStyle:'short',timeStyle:'short'});
const icons={estrela:'✦',cometa:'☄',escudo:'⬟'};
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function savedToken(){try{return localStorage.getItem(tokenKey)||'';}catch{return '';}}
function duration(ms){
  const seconds=Math.max(0,Math.ceil(ms/1000));
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':');
}
function playTime(ms){
  const minutes=Math.floor(ms/60000);
  return `${Math.floor(minutes/60)} h ${minutes%60} min`;
}
function odds(unit){
  return unit.odds?`<strong class="rarity-value" title="1 em ${number.format(unit.odds)}">${rarityLabel(unit.odds)}</strong>`:'';
}
const empty=text=>`<p class="community-empty">${text}</p>`;

async function squareAvatar(file){
  if(file.size>8*1024*1024)throw Error('Escolha uma foto de até 8 MB.');
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('Escolha uma foto PNG, JPG, WebP ou GIF.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();
    image.src=url;
    await image.decode();
    const side=Math.min(image.naturalWidth,image.naturalHeight);
    if(!side)throw Error('Imagem vazia.');
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=AVATAR_SIZE;
    const ctx=canvas.getContext('2d');
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,AVATAR_SIZE,AVATAR_SIZE);
    return canvas.toDataURL('image/png');
  }catch{throw Error('Não foi possível abrir a foto. Tente outro arquivo.');}
  finally{URL.revokeObjectURL(url);}
}
const sceneAttrs=key=>Object.hasOwn(PROFILE_WORLDS,key)?`data-world="${PROFILE_WORLDS[key]}"`:'';
const emblem=appearance=>appearance.avatar?`<img src="${escape(appearance.avatar)}" alt="">`:icons[appearance.icon]??icons.estrela;

export function createCommunity({spriteURL,onSession,onChallenge}){
  const supported=location.protocol!=='file:';
  const root=document.querySelector('#community-panel');
  const dialog=document.querySelector('#player-profile');
  if(!root||!dialog)return null;
  const content=dialog.querySelector('.player-profile-content');
  const message=root.querySelector('.community-message');
  const body=root.querySelector('.community-content');
  let generation=0;
  let token=supported?savedToken():'';
  let me=null,section='rarity',profile=null,view='team',opener=null,profileRequest=0;
  let ranking=null,friends=null,clock=null,clockRefresh=false;
  let busy=false;
  let draft=null,photoJob=0,readingPhoto=false,saving=false;
  function updatePreview(){
    const banner=content.querySelector('.player-banner');
    if(!banner||!draft)return;
    banner.dataset.background=draft.background;
    banner.dataset.border=draft.border;
    if(Object.hasOwn(PROFILE_WORLDS,draft.background))banner.dataset.world=PROFILE_WORLDS[draft.background];
    else delete banner.dataset.world;
    banner.querySelector('.player-emblem').innerHTML=emblem(draft);
    const form=content.querySelector('[data-form="customize"]');
    if(!form)return;
    form.querySelector('[data-bg-label]').textContent=PROFILE_OPTIONS.background[draft.background];
    form.querySelector('[data-remove-photo]').hidden=!draft.avatar;
    form.elements.icon.disabled=!!draft.avatar;
    form.querySelector('[type="submit"]').disabled=readingPhoto||saving;
  }
  const showMessage=text=>{message.textContent=text;message.hidden=!text;};
  let syncRetryAt=0,syncFailures=0,syncError=null,conservativeRecoveryUntil=0;
  function deferSync(error,retryAfter){
    const seconds=retryAfter?.trim();
    const hinted=seconds&&/^\d+$/.test(seconds)?Number(seconds)*1000:
      seconds?Math.max(0,Date.parse(seconds)-Date.now())||0:0;
    syncFailures++;
    syncRetryAt=Date.now()+Math.max(hinted,Math.min(90000,4000*2**Math.min(syncFailures-1,5)))+Math.random()*3000;
    syncError=error;
  }
  async function request(path,input,access=token){
    if(path==='/game'&&Date.now()<syncRetryAt)throw syncError;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api'+path,{
          method:input===undefined?'GET':'POST',
          headers:{...(access?{Authorization:'Bearer '+access}:{}),...(input===undefined?{}:{'Content-Type':'application/json'})},
          body:input===undefined?undefined:JSON.stringify(input),
          signal:controller.signal,
      });
      const isJson=response.headers.get('content-type')?.includes('application/json');
      if(!response.ok){
        const data=isJson?await response.json().catch(()=>null):null;
        const reference=[data?.code,data?.ray??response.headers.get('CF-Ray')].filter(Boolean).join(' · ');
        const error=new Error((data?.error??'O servidor do Alca RNG respondeu com HTTP '+response.status+'.')+(reference?' Referência: '+reference:''));
        error.status=response.status;
        if(path==='/game'&&[502,503,504].includes(response.status))conservativeRecoveryUntil=Date.now()+120000;
        if(path==='/game'&&([429,502,503,504].includes(response.status)||data?.code==='SYNC_CONTENTION'))deferSync(error,response.headers.get('Retry-After'));
        throw error;
      }
      if(!isJson)throw Error('O servidor do Alca RNG respondeu em um formato inesperado (HTTP '+response.status+').');
      const data=await response.json();
      if(path==='/game'){syncFailures=0;syncRetryAt=0;syncError=null;}
      return data;
    }catch(error){
      if(controller.signal.aborted||error instanceof TypeError){
        const connectionError=new Error(controller.signal.aborted?'O servidor demorou para responder. Tente novamente.':
          'O navegador não conseguiu acessar o servidor do Alca RNG. Verifique a conexão.');
        if(path==='/game'){
          if(controller.signal.aborted)conservativeRecoveryUntil=Date.now()+120000;
          deferSync(connectionError);
        }
        throw connectionError;
      }
      throw error;
    }finally{clearTimeout(timer);}
  }
  async function synchronize(body,access){
    const current=generation;
    const observedAt=Number.isFinite(body.observationAge)?Date.now()-body.observationAge:null;
    let processed=0;
    while(current===generation){
      const data=await request('/game',{...body,checkpoints:true,
        conservativeRecovery:Date.now()<conservativeRecoveryUntil,
        observationAge:observedAt===null?null:Date.now()-observedAt},access);
      if(!data.catchingUp)return data;
      if(Number.isFinite(data.processed))processed+=data.processed;
      const message=document.querySelector('#account-message');
      if(message)message.textContent=processed
        ?'Recuperando progresso offline… '+number.format(processed)+' encontros processados.'
        :'Recuperando progresso offline…';
      await new Promise(resolve=>setTimeout(resolve,150+Math.random()*200));
    }
    return null;
  }
  async function game(action,observationAge){
    const access=token;
    const data=await synchronize({action,visible:!document.hidden,observationAge},access);
    if(!data||access!==token)return null;
    me=data.player;
    return data;
  }
  function setToken(value){
    if(value!==token)generation++;
    token=value;
    try{if(value)localStorage.setItem(tokenKey,value);else localStorage.removeItem(tokenKey);}catch{}
  }
  function clear(){
    me=null;ranking=null;friends=null;clock=null;section='rarity';
    setToken('');
    if(dialog.open)dialog.close();
    render();
  }
  async function signIn(access){
    const data=await synchronize({visible:!document.hidden,observationAge:document.hidden?null:0},access);
    if(!data)return;
    me=data.player;
    setToken(access);
    ranking=null;friends=null;
    onSession(data);
    render();
    await loadSection();
  }
  function avatar(unit){
    const {id,xp,stars,shiny,trait,traitSlots,activeSlot,nen,serial,odds}=unit;
    const data=escape(JSON.stringify({id,xp,stars:stars??0,shiny,trait,traitSlots,activeSlot,nen,serial,odds}));
    const card=CHARACTERS[unit.id];
    return `<button class="unit-portrait" type="button" data-public-unit="${data}" aria-label="Ficha de ${escape(card.name)}"><img class="community-sprite" src="${spriteURL(spriteFor(unit))}" alt="" style="--unit-color:${COLORS[card.color]}"></button>`;
  }
  function namedPlayer(player){
    return `<button class="player-link" type="button" data-player="${escape(player.id)}">${escape(player.name)}</button>`;
  }
  function rankArt(){
    if(!ranking)return empty('Carregando classificação…');
    const list=ranking[section]??[];
    if(!list.length&&section==='arena')return empty('A classificação começa com o primeiro duelo ranqueado.');
    if(!list.length)return empty('Os primeiros recrutas e jogadores aparecerão aqui conforme as expedições avançarem.');
    if(section==='raid'||section==='tower'||section==='arena')return '<ol class="rank-list">'+list.map((r,i)=>`<li class="rank-row"><span>${i+1}</span>${namedPlayer(r)}${section==='arena'&&r.league?`<small class="league-tag">${escape(r.league)}</small>`:''}<strong>${number.format(r.score)} ${section==='raid'?'dano':section==='arena'?'pts':'andares'}</strong></li>`).join('')+'</ol>';
    return `<ol class="rank-list">${list.map((row,i)=>section==='rarity'?`
      <li class="rank-row"><span class="rank-number">${i+1}</span>${avatar(row)}
        <div class="rank-description"><strong>${unitLabel(row)}</strong><small>${TIERS[CHARACTERS[row.id]?.tier-1]??''} · ${row.trait?escape(row.trait)+' · ':''}#${String(row.serial).padStart(3,'0')} · ${namedPlayer(row.player)}</small></div>${odds(row)}</li>`:`
      <li class="rank-row"><span class="rank-number">${i+1}</span><div class="top-team">${row.units.map(avatar).join('')}</div>
        <div class="rank-description">${namedPlayer(row.player)}<small>${row.units.map(unitLabel).join(' · ')}</small></div><strong class="power-value">${number.format(row.power)}</strong></li>`).join('')}</ol>`;
  }
  function friendList(){
    if(!friends)return empty('Carregando amigos…');
    return `<form class="community-form friend-add" data-form="friend"><label for="friend-code">Código de amigo</label>
      <div class="inline-fields"><input id="friend-code" name="code" maxlength="10" required autocomplete="off" spellcheck="false" placeholder="10 caracteres">
      <button class="primary">Enviar convite</button></div></form>
      <h3>Amigos</h3>${friends.friends.length?`<ul class="friends-list">${friends.friends.map(row=>`<li>${namedPlayer(row)}
      <span class="friend-actions"><button class="ghost" data-gift="${row.id}" ${row.sent?'disabled':''}>${row.sent?'Presente enviado':'Presentear'}</button>
      <button class="ghost" data-remove="${row.id}" aria-label="Remover ${escape(row.name)}">Remover</button></span></li>`).join('')}</ul>`:empty('Adicione um amigo usando o código que aparece no perfil dele.')}
      <h3>Convites</h3>${friends.requests.length?`<ul class="friends-list">${friends.requests.map(row=>`<li>${namedPlayer(row)}
      <span class="friend-actions">${row.requested_by!==me?.id?`<button class="primary" data-accept="${row.id}">Aceitar</button>`:'<small>Convite enviado</small>'}
      <button class="ghost" data-remove="${row.id}">${row.requested_by===me?.id?'Cancelar':'Recusar'}</button></span></li>`).join('')}</ul>`:empty('Você está em dia com os convites.')}
      <h3>Presentes recebidos</h3>${friends.inbox.length?`<ul class="friends-list">${friends.inbox.map(row=>`<li><span>${namedPlayer(row)} <small>· ${date.format(row.sentAt)}</small></span><strong>+${number.format(row.gold)} ouro</strong></li>`).join('')}</ul>`:empty('O ouro dos presentes entra direto no saldo.')}
    `;
  }
  function authButtons(verb){
    return ['Google','Discord'].map(name=>`<button type="button" class="ghost" data-auth-provider="${name.toLowerCase()}">${verb} ${name}</button>`).join(' ');
  }
  async function startAuth(provider){
    const data=await request('/auth/'+provider+'/start',{intent:me?'link':'login'});
    location.assign(data.url);
  }
  function render(){
    if(!supported){
      body.innerHTML=empty('Abra a versão online do Alca RNG para jogar com outras contas. Este arquivo abre o jogo solo.');
      return;
    }
    if(!me){
      body.innerHTML=token?empty('Conectando à Comunidade…'):`<div class="community-auth">
        <form class="community-form card" data-form="register"><h3>Criar perfil</h3><p class="caption">A conta online começa uma nova expedição. Seu progresso solo fica neste navegador.</p>
        <label for="new-player">Nome do jogador</label><input id="new-player" name="name" minlength="2" maxlength="24" required autocomplete="nickname"><button class="primary">Criar perfil</button></form>
        <form class="community-form card" data-form="restore"><h3>Entrar</h3><p class="caption">Use o código de acesso privado do seu perfil para recuperar a conta.</p>
        <label for="access-code">Código de acesso</label><input id="access-code" name="access" required autocomplete="off" type="password"><button class="ghost">Entrar na conta</button>${authButtons('Entrar com')}</form>
        </div>`;
      return;
    }
    body.innerHTML=`<div class="community-toolbar"><nav class="community-tabs" aria-label="Comunidade">
      ${[['rarity','Raridade'],['power','Força'],['raid','Raid'],['tower','Torre'],['arena','Arena'],['friends','Amigos']].map(([id,label])=>`<button class="ghost" data-community-tab="${id}" aria-pressed="${id===section}">${label}</button>`).join('')}</nav>
      <div class="friend-actions">${authButtons('Vincular')} <button class="ghost" data-refresh>Atualizar</button><button class="ghost" data-my-profile>Meu perfil</button></div></div>
      <p class="caption community-help">${section==='arena'?'Top 30 por pontos acumulados em duelos ranqueados.':section==='rarity'?'Personagens recrutados ordenados pela chance de obtenção.':section==='power'?'Soma dos atributos dos quatro personagens mais fortes do inventário, com Shiny e Traits.':section==='raid'?'Maior dano contra o chefe do ciclo atual.':section==='tower'?'Maior andar conquistado.':'Um presente de '+number.format(friends?.giftGold??GIFT_GOLD)+' ouro por amigo. Os três primeiros presentes recebidos no ciclo também dão um token de reroll cada. Reset às 12h, horário de Brasília.'}</p>
      ${section==='friends'?'<p class="daily-clock">Próximo reset <strong data-reset-clock>—</strong></p>'+friendList():rankArt()}`;
    tick();
  }
  async function loadSection(){
    if(!me||root.hidden)return;
    const access=token;
    const wanted=section;
    if(wanted==='friends'){
      const data=await request('/community/friends');
      if(access!==token)return;
      friends=data;
      clock={start:performance.now(),remaining:data.cycle.nextAt-data.now};
    }else{
      const data=await request('/community/rankings');
      if(access!==token)return;
      ranking=data;
    }
    if(wanted===section)render();
  }
  async function guarded(work){
    if(busy)return;
    busy=true;
    showMessage('');
    try{await work();}
    catch(error){showMessage(error.message||'Não foi possível acessar a Comunidade.');}
    finally{busy=false;}
  }
  function tick(){
    if(root.hidden||section!=='friends'||!clock)return;
    const remaining=clock.remaining-(performance.now()-clock.start);
    const node=root.querySelector('[data-reset-clock]');
    if(node)node.textContent=duration(remaining);
    if(remaining<=0&&!clockRefresh){
      clockRefresh=true;
      void loadSection().catch(error=>showMessage(error.message)).finally(()=>{
        setTimeout(()=>{clockRefresh=false;},1500);
      });
    }
  }
  function showProfile(){
    const isMine=profile.id===me?.id;
    const attributes=isMine&&draft?draft:profile.appearance;
    const team=profile[view];
    content.innerHTML=`<header class="player-banner" data-background="${escape(attributes.background)}" ${sceneAttrs(attributes.background)} data-border="${escape(attributes.border)}">
      <span class="player-emblem" aria-hidden="true">${emblem(attributes)}</span><div><h2 id="player-profile-title">${escape(profile.name)}</h2>
      <p>Código de amigo <strong>${profile.code}</strong></p></div></header>
      <div class="player-meta"><div><span>Tempo de jogo ativo</span><strong>${playTime(profile.playMs)}</strong></div>
      <div><span>Encontros concluídos</span><strong>${number.format(profile.encounters)}</strong></div>
      <div><span>Recorde na Torre</span><strong>${number.format(profile.towerCleared??0)} andares</strong></div></div>
      <div class="community-tabs"><button class="ghost" data-view="team" aria-pressed="${view==='team'}">Time atual</button>
      <button class="ghost" data-view="showcase" aria-pressed="${view==='showcase'}">Destaques</button></div>
      ${view==='showcase'?'<p class="caption">Até cinco personagens com menor chance de obtenção.</p>':''}
      ${team.length?`<ul class="player-team">${team.map(unit=>`<li>${avatar(unit)}<div><strong>${unitLabel(unit)}</strong>
      <small>Nv. ${unit.level}${unit.trait?' · '+escape(unit.trait):''} · #${String(unit.serial).padStart(3,'0')}</small></div>${odds(unit)}</li>`).join('')}</ul>`:empty('As primeiras capturas aparecerão em Destaques.')}
      ${!isMine?'<button class="primary" data-challenge>Duelo amistoso · sem pontos</button>':''}
      ${isMine?`<form class="community-form customize" data-form="customize"><h3>Personalizar perfil</h3>
      <fieldset class="appearance-fields" ${saving?'disabled':''}>
      <details class="scene-picker"><summary>Fundo · <span data-bg-label>${escape(PROFILE_OPTIONS.background[attributes.background])}</span></summary>
      <div class="scene-grid" role="radiogroup" aria-label="Fundo do perfil">${Object.entries(PROFILE_OPTIONS.background).filter(([key])=>canEquipBackground(key,profile.code)).map(([key,label])=>`<label class="scene-choice" data-background="${key}" ${sceneAttrs(key)}>
      <input type="radio" name="background" value="${key}" ${key===attributes.background?'checked':''}><span>${escape(label)}</span></label>`).join('')}</div></details>
      <div class="avatar-upload"><label>Foto de perfil<input type="file" data-photo accept="image/png,image/jpeg,image/webp,image/gif" aria-describedby="avatar-hint"></label>
      <button class="ghost" type="button" data-remove-photo ${attributes.avatar?'':'hidden'}>Remover foto</button></div>
      <small id="avatar-hint">PNG, JPG, WebP ou GIF de até 8 MB. O recorte é quadrado e central. GIFs ficam estáticos.</small>
      <div class="customize-inputs">${['icon','border'].map(key=>`<label>${key==='icon'?'Ícone padrão':'Borda'}
      <select name="${key}" ${key==='icon'&&attributes.avatar?'disabled':''}>${Object.entries(PROFILE_OPTIONS[key]).map(([value,label])=>`<option value="${value}" ${attributes[key]===value?'selected':''}>${label}</option>`).join('')}</select></label>`).join('')}
      </div><button class="primary" type="submit" ${readingPhoto||saving?'disabled':''}>Salvar aparência</button></fieldset></form>
      <details class="community-access"><summary>Acesso à conta</summary>${token.length===32?`<p class="caption">Guarde para entrar em outro navegador. Envie aos amigos somente o código de amigo.</p>
      <div class="inline-fields"><input class="access-code" type="password" readonly aria-label="Código de acesso privado" value="${escape(token)}"><button type="button" class="ghost" data-toggle-access>Mostrar</button></div>
      <div class="friend-actions"><button type="button" class="ghost" data-rotate-token>Gerar novo código</button><button type="button" class="ghost" data-sign-out>Sair da conta</button></div>`:'<p>Você entrou com uma conta vinculada.</p><button class="ghost" data-sign-out>Sair da conta</button>'}</details>`:''}`;
  }
  async function openProfile(button,playerId){
    const requestId=++profileRequest;
    const data=await request('/community/profile'+(playerId?'/'+playerId:''));
    if(requestId!==profileRequest)return;
    profile=data;view='team';opener=button;
    draft=profile.id===me?.id?{...profile.appearance}:null;photoJob++;readingPhoto=false;saving=false;
    showProfile();
    if(!dialog.open)dialog.showModal();
  }
  root.addEventListener('click',event=>{
    const target=event.target.closest('button');
    if(!target)return;
    const d=target.dataset;
    const next=d.communityTab;
    if(d.authProvider){void guarded(()=>startAuth(d.authProvider));return;}
    if(next){
      section=next;render();void loadSection().catch(error=>showMessage(error.message));
    }else if('refresh' in d){
      void guarded(loadSection);
    }else if(d.player||'myProfile' in d){
      void guarded(()=>openProfile(target,d.player));
    }else if(d.gift||d.accept||d.remove){
      void guarded(async()=>{
        const input=d.gift?{id:d.gift}:{id:d.accept??d.remove,decision:d.accept?'accept':'remove'};
        await request(d.gift?'/community/gift':'/community/friend-reply',input);
        await loadSection();
        if(d.gift)showMessage('Presente entregue.');
      });
    }
  });
  root.addEventListener('submit',event=>{
    const form=event.target;
    const type=form.dataset.form;
    if(!type)return;
    event.preventDefault();
    const fields=Object.fromEntries(new FormData(form));
    void guarded(async()=>{
      if(type==='register'){
        const account=await request('/community/account',{name:fields.name},'');
        setToken(account.token);
        await signIn(account.token);
        await openProfile(root.querySelector('[data-my-profile]'));
        showMessage('Perfil criado. Guarde seu código de acesso privado.');
      }else if(type==='restore')await signIn(fields.access.trim());
      else if(type==='friend'){
        await request('/community/friend-request',{code:fields.code});
        await loadSection();
        showMessage('Convite enviado.');
      }
    });
  });
  dialog.addEventListener('change',async event=>{
    const input=event.target;
    if(!draft||!input.closest('[data-form="customize"]'))return;
    const status=dialog.querySelector('.player-status');
    if(input.hasAttribute('data-photo')){
      const file=input.files[0];
      if(!file)return;
      const job=++photoJob;
      readingPhoto=true;updatePreview();
      status.textContent='Preparando foto…';
      try{
        const result=await squareAvatar(file);
        if(job!==photoJob)return;
        draft.avatar=result;
        status.textContent='Confira a prévia e salve a aparência.';
      }catch(error){if(job===photoJob)status.textContent=error.message;}
      finally{if(job===photoJob){readingPhoto=false;input.value='';updatePreview();}}
    }else if(Object.hasOwn(PROFILE_OPTIONS,input.name)){
      draft[input.name]=input.value;
      updatePreview();status.textContent='Prévia · alterações por salvar.';
    }
  });
  dialog.addEventListener('click',event=>{
    const target=event.target.closest('button');
    if(!target)return;
    if(target.hasAttribute('data-remove-photo')&&draft){
      photoJob++;readingPhoto=false;draft.avatar=null;updatePreview();
      dialog.querySelector('.player-status').textContent='Ícone padrão na prévia. Salve para aplicar.';
      return;
    }
    if('challenge' in target.dataset && profile && profile.id!==me?.id){dialog.close();onChallenge(profile);return;}
    if(target.id==='close-player-profile')dialog.close();
    if(target.dataset.view){
      view=target.dataset.view;
      showProfile();
      content.querySelector(`[data-view="${view}"]`)?.focus();
    }
    if('toggleAccess' in target.dataset){
      const input=dialog.querySelector('.access-code');
      if(!input)return;
      const show=input.type==='password';
      input.type=show?'text':'password';
      target.textContent=show?'Ocultar':'Mostrar';
      return;
    }
    if('rotateToken' in target.dataset){
      if(!confirm('Gerar um novo código de acesso? O código anterior deixará de funcionar imediatamente em outros navegadores.'))return;
      const status=dialog.querySelector('.player-status');
      target.disabled=true;status.textContent='Gerando novo código…';
      void request('/community/rotate-token',{}).then(data=>{
        setToken(data.token);
        showProfile();
        dialog.querySelector('.player-status').textContent='Novo código gerado. Guarde-o em local seguro.';
      }).catch(error=>{target.disabled=false;status.textContent=error.message||'Não foi possível gerar o novo código.';});
      return;
    }
    if('signOut' in target.dataset){if(token.length===48)void request('/community/logout',{}).catch(()=>{});clear();onSession(null);}
  });
  dialog.addEventListener('submit',event=>{
    if(event.target.dataset.form!=='customize')return;
    event.preventDefault();
    if(!draft||readingPhoto||saving)return;
    const fields={...draft};
    if(fields.avatar===profile.appearance.avatar)delete fields.avatar;
    const requestId=profileRequest;
    const status=dialog.querySelector('.player-status');
    saving=true;event.target.querySelector('fieldset').disabled=true;status.textContent='Salvando…';
    void request('/community/profile',fields).then(data=>{
      if(!dialog.open||requestId!==profileRequest||profile?.id!==data.id)return;
      profile=data;draft={...data.appearance};
      status.textContent='Aparência salva.';
    }).catch(error=>{if(requestId===profileRequest)status.textContent=error.message;}).finally(()=>{
      if(requestId===profileRequest){saving=false;showProfile();}
    });
  });
  dialog.addEventListener('close',()=>{
    profileRequest++;photoJob++;draft=null;readingPhoto=false;saving=false;
    dialog.querySelector('.player-status').textContent='';
    if(opener?.isConnected)opener.focus();
    else root.querySelector('[data-my-profile]')?.focus();
  });

  const authResult=new URL(location.href).searchParams.get('account');
  if(supported&&authResult){
    history.replaceState(null,'',location.pathname+'#comunidade');
    const messages={linked:'Conta vinculada. Você já pode entrar em outro aparelho.',conflict:'Esse vínculo já pertence a outro perfil ou provedor já vinculado.',cancelled:'Entrada cancelada.',expired:'A autorização expirou. Tente novamente.',failed:'Falha na autorização. Tente novamente.',unlinked:'Essa conta ainda não tem vínculo. Abra seu perfil Nexus original para vinculá-la.'};
    queueMicrotask(()=>{if(authResult==='login')void guarded(async()=>{
      const {access}=await request('/auth/finish',{},'');
      setToken(access);
      await signIn(access);
    });else showMessage(messages[authResult]??'Autorização encerrada.');});
  }
  return {
    active:()=>!!token,
    isBusy:()=>busy,
    syncAvailable:()=>Date.now()>=syncRetryAt,
    ready:()=>!!me,
    playerId:()=>me?.id,
    topBoard:kind=>request('/community/top/'+kind),
    ranked:input=>request('/community/ranked',input),
    arenaOpponents:()=>request('/community/arena'),
    arenaLog:()=>request('/community/arena-log'),
    claimArenaSeason:()=>request('/community/arena-season-claim',{}),
    worldBoss:()=>request('/community/world-boss'),
    claimWorldBoss:()=>request('/community/world-boss/claim',{}),
    generation:()=>generation,clear,game,tick,signIn,
    mount(){root.hidden=false;render();void loadSection().catch(error=>showMessage(error.message));},
    hide(){root.hidden=true;},
  };
}
