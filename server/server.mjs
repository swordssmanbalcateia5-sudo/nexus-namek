// Servidor Node.js para rodar o Alca RNG numa VM (AWS, Oracle ou outra).
// Reaproveita o public/_worker.js sem alterações: a API continua num só lugar.
import {createServer} from 'node:http';
import {createReadStream,readFileSync,statSync} from 'node:fs';
import {extname,join,normalize,resolve,sep} from 'node:path';
import {Readable} from 'node:stream';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {D1Sqlite} from './d1-sqlite.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const publicDir=join(root,'public');
const PORT=Number(process.env.PORT??4173);
const HOST=process.env.NEXUS_HOST??'127.0.0.1';
const DB_PATH=resolve(root,process.env.NEXUS_DB??'data/nexus.sqlite');
// Atrás do Caddy/Nginx: confia em X-Forwarded-For/-Proto/-Host.
const TRUST_PROXY=process.env.TRUST_PROXY==='1';
// Ex.: https://jogo.exemplo.com.br — usado nas checagens de origem do OAuth.
const PUBLIC_ORIGIN=process.env.PUBLIC_ORIGIN?.replace(/\/$/,'');

const db=new D1Sqlite(DB_PATH);
const worker=(await import(pathToFileURL(join(publicDir,'_worker.js')).href)).default;

const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const HIDDEN=new Set(['/_worker.js','/_headers','/_routes.json']);

// Lê public/_headers (formato do Cloudflare Pages): blocos "caminho" + linhas "  Nome: valor".
function parseHeaders(){
  const rules=[];let current=null;
  let text='';try{text=readFileSync(join(publicDir,'_headers'),'utf8');}catch{return rules;}
  for(const line of text.split(/\r?\n/)){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    if(!/^\s/.test(line)){current={pattern:line.trim(),headers:[]};rules.push(current);continue;}
    const at=line.indexOf(':');
    if(current&&at>0)current.headers.push([line.slice(0,at).trim(),line.slice(at+1).trim()]);
  }
  return rules;
}
const headerRules=parseHeaders();
const matches=(pattern,path)=>pattern.endsWith('*')?path.startsWith(pattern.slice(0,-1)):pattern===path;

function staticResponse(request){
  const url=new URL(request.url);
  let path=decodeURIComponent(url.pathname);
  if(HIDDEN.has(path))return new Response('Não encontrado.',{status:404});
  const requested=path;
  if(path.endsWith('/'))path+='index.html';
  const file=normalize(join(publicDir,path));
  if(!file.startsWith(publicDir+sep))return new Response('Não encontrado.',{status:404});
  let info;
  try{info=statSync(file);if(!info.isFile())throw 0;}catch{return new Response('Não encontrado.',{status:404});}
  const headers=new Headers({'Content-Type':TYPES[extname(file).toLowerCase()]??'application/octet-stream',
    'Last-Modified':info.mtime.toUTCString(),'Content-Length':String(info.size)});
  for(const rule of headerRules)if(matches(rule.pattern,requested)||matches(rule.pattern,path))
    for(const [name,value] of rule.headers)headers.set(name,value);
  if(!headers.has('Cache-Control'))headers.set('Cache-Control',path.startsWith('/art/')||path.startsWith('/icons/')?'public, max-age=604800':'no-cache');
  const since=Date.parse(request.headers.get('If-Modified-Since')??'');
  if(since&&Math.floor(info.mtimeMs/1000)*1000<=since)return new Response(null,{status:304,headers});
  if(request.method==='HEAD')return new Response(null,{headers});
  return new Response(Readable.toWeb(createReadStream(file)),{headers});
}

const env={
  NEXUS_DB:db,
  ASSETS:{fetch:async request=>staticResponse(request)},
  GOOGLE_CLIENT_ID:process.env.GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET:process.env.GOOGLE_CLIENT_SECRET,
  DISCORD_CLIENT_ID:process.env.DISCORD_CLIENT_ID,DISCORD_CLIENT_SECRET:process.env.DISCORD_CLIENT_SECRET,
  // Encontros por lote na recuperação offline (12 h ≈ 1.500–2.400 encontros).
  RECOVERY_BATCH:process.env.RECOVERY_BATCH??'300',
};

function toRequest(req){
  const forwarded=name=>TRUST_PROXY?req.headers[name]?.split(',')[0].trim():undefined;
  const origin=PUBLIC_ORIGIN??`${forwarded('x-forwarded-proto')??'http'}://${forwarded('x-forwarded-host')??req.headers.host??'localhost'}`;
  const headers=new Headers();
  for(const [name,value] of Object.entries(req.headers))
    if(value!==undefined&&!name.startsWith(':'))headers.set(name,Array.isArray(value)?value.join(', '):value);
  // O worker usa CF-Connecting-IP para limitar cadastros por IP.
  headers.set('CF-Connecting-IP',forwarded('x-forwarded-for')??req.socket.remoteAddress??'local');
  headers.delete('cf-ray');
  const hasBody=!['GET','HEAD'].includes(req.method);
  return new Request(origin+req.url,{method:req.method,headers,body:hasBody?Readable.toWeb(req):undefined,duplex:hasBody?'half':undefined});
}

async function send(res,response){
  const headers={};
  response.headers.forEach((value,name)=>{if(name!=='set-cookie')headers[name]=value;});
  const cookies=response.headers.getSetCookie();
  if(cookies.length)headers['set-cookie']=cookies;
  res.writeHead(response.status,headers);
  if(!response.body){res.end();return;}
  for await(const chunk of response.body)if(!res.write(chunk))await new Promise(r=>res.once('drain',r));
  res.end();
}

const server=createServer(async(req,res)=>{
  try{
    const request=toRequest(req);
    await send(res,await worker.fetch(request,env,{waitUntil(){},passThroughOnException(){}}));
  }catch(error){
    console.error(JSON.stringify({event:'nexus_server_error',url:req.url,message:String(error?.message??error)}));
    if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});
    res.end(JSON.stringify({error:'Erro interno do servidor.'}));
  }
});
server.keepAliveTimeout=65000;
server.listen(PORT,HOST,()=>console.log(`Alca RNG em http://${HOST}:${PORT} · banco ${DB_PATH}`));

function shutdown(){
  server.close(()=>{db.close();process.exit(0);});
  setTimeout(()=>process.exit(1),10000).unref();
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
