import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {enrichRaw} from './enrich.js';
import {insertNewsWithStatus,insertAlert,enqueuePushForAlerts,saveSourceState,getSourceState} from './db.js';
import {buildNewsAlert} from './refreshFeed.js';

export const LIVE_SOURCE={id:'financialjuice-live',name:'FinancialJuice · sesión autenticada (texto)',type:'breaking',kind:'live',url:'https://www.financialjuice.com/home',channel_note:'Flujo de texto autenticado sin filtro de categoría. La sesión debe renovarse si caduca. No incluye audio. La conexión no certifica por sí sola cobertura Elite completa.'};
export function newsFromFrame(frame) {
 const result=[];
 for(const message of Array.isArray(frame?.M)?frame.M:[]) {
  for(let payload of Array.isArray(message?.A)?message.A:[]) {
   if(typeof payload==='string') {try{payload=JSON.parse(payload);}catch{continue;}}
   for(const raw of Array.isArray(payload)?payload:[payload]) {
    if(!raw || typeof raw.Title!=='string' || !raw.Title.trim() || !/^\d+$/.test(String(raw.NewsID ?? '')))continue;
    let pub=raw.DatePublished;
    const dotnet=typeof pub==='string' && pub.match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/);
    if(dotnet)pub=Number(dotnet[1]);
    // The provider's unzoned DatePublished values are UTC.
    if(typeof pub==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(pub))pub+='Z';
    const date=new Date(pub ?? NaN);
    let url='';try{const u=new URL(raw.EURL);if(u.protocol==='https:'&&!u.username&&!u.password)url=u.href;}catch{}
    result.push({id:String(raw.NewsID),title:raw.Title.slice(0,4000).replace(/^FinancialJuice:\s*/,''),body:typeof raw.Description==='string'?raw.Description.slice(0,20000).replace(/<[^>]*>/g,' '):'',url,published_at:Number.isFinite(date.getTime())?date.toISOString():null,streams:Array.isArray(raw.StreamIDs)?raw.StreamIDs.filter(Number.isFinite):[]});
   }
  }
 }
 return result;
}
export function initLiveStore(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS financialjuice_receipts (provider_id TEXT PRIMARY KEY, received_at TEXT NOT NULL, payload_json TEXT NOT NULL, news_id INTEGER)`);
}
export function ingestLiveItem(db,raw) {
 const seen=db.prepare('SELECT provider_id FROM financialjuice_receipts WHERE provider_id=?').get(raw.id);
 if(seen)return null;
 const captured=new Date().toISOString();
 const item=enrichRaw({...raw,published_at:raw.published_at||captured},LIVE_SOURCE);
 db.exec('BEGIN IMMEDIATE');
 try {
  const result=insertNewsWithStatus(db,item);
  db.prepare('INSERT INTO financialjuice_receipts VALUES (?,?,?,?)').run(raw.id,captured,JSON.stringify(raw),result.id);
  let alert=null;
  if(result.inserted){alert=insertAlert(db,buildNewsAlert(result.item));if(!alert.alreadyExisted)enqueuePushForAlerts(db,[alert]);else alert=null;}
  const prev=getSourceState(db,LIVE_SOURCE.id)||{};
  saveSourceState(db,{...prev,...LIVE_SOURCE,source_id:LIVE_SOURCE.id,status:'ok',last_attempt_at:captured,last_success_at:captured,last_captured_at:captured,last_news_published_at:raw.published_at||prev.last_news_published_at,cursor_id:raw.id,last_fetched_count:1,last_new_count:result.inserted?1:0,last_error:null});
  db.exec('COMMIT');return {alert,item:result.item,inserted:result.inserted};
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function startFinancialJuice(db,dataDir,{onNews=()=>{}}={}) {
 const session=join(dataDir,'financialjuice-session.lwp');
 if(!existsSync(session))return ()=>{};
 initLiveStore(db);
 const broker=fileURLToPath(new URL('./financialjuice-session.py',import.meta.url));
 let snapshotBusy=false,snapshotTimer=null,snapshotFailures=0;
 let stopped=false,socket=null,retryTimer=null,watchdog=null,failures=0,lastFrame=0,lastHealth=0;
 const status=(value,error=null)=>{
  const now=new Date().toISOString();const prev=getSourceState(db,LIVE_SOURCE.id)||{};
  saveSourceState(db,{...prev,...LIVE_SOURCE,source_id:LIVE_SOURCE.id,status:value,last_attempt_at:now,last_success_at:value==='ok'?now:prev.last_success_at,last_new_count:0,last_error:error});
 };
 function scheduleSnapshot(delayMs){
  clearTimeout(snapshotTimer);
  if(!stopped)snapshotTimer=setTimeout(recoverRecent,delayMs);
 }
 async function recoverRecent(){
  if(stopped||snapshotBusy)return;
  snapshotBusy=true;
  try {
   const {stdout}=await promisify(execFile)('python3',[broker,session,'--snapshot'],{timeout:65000,maxBuffer:3000000});
   if(stopped)return;
   const data=JSON.parse(stdout);
   if(!Array.isArray(data.News))throw Error('snapshot_shape');
   snapshotFailures=0;
   for(const raw of newsFromFrame({M:[{A:[data.News]}]}).reverse()){
    const saved=ingestLiveItem(db,raw);if(saved)onNews(saved);
   }
  }catch{
   snapshotFailures++;
   if(snapshotFailures<=2)console.warn('[FinancialJuice] No se pudo recuperar el lote reciente; se reintentara con backoff.');
  }
  finally{
   snapshotBusy=false;
   const nextDelay=snapshotFailures===0?60000:Math.min(1800000,60000*(2**Math.min(snapshotFailures,5)));
   scheduleSnapshot(nextDelay);
  }
 }
 async function connect(){
  if(stopped)return;
  status('connecting','Conectando flujo de texto autenticado');
  let finished=false,initialized=false,activated=false,openedAt=Date.now();
  const finish=(reason)=>{
   if(finished||stopped)return;finished=true;clearInterval(watchdog);socket?.close();
   status('error',reason);const delay=Math.min(1800000,60000*2**Math.min(failures++,5));retryTimer=setTimeout(connect,delay);
  };
  try {
   const {stdout}=await promisify(execFile)('python3',[broker,session],{timeout:65000,maxBuffer:100000});
   const config=JSON.parse(stdout);
   const target=new URL(config.url);
   if(config.transport!=='signalr'||target.protocol!=='wss:'||!target.hostname.endsWith('.service.signalr.net')||target.username||target.password)throw Error('host');
   if(stopped)return;
   socket=new WebSocket(config.url);lastFrame=Date.now();openedAt=Date.now();
   watchdog=setInterval(()=>{if((!activated&&Date.now()-openedAt>25000)||Date.now()-lastFrame>90000)finish('Sin respuesta del canal de texto; reconexión pendiente');},5000);
   socket.onmessage=({data})=>{
    if(finished||stopped)return;
    lastFrame=Date.now();
    try {
     if(typeof data!=='string'||data.length>2000000)return;
     const frame=JSON.parse(data);
     if(frame.S&&!initialized){
      initialized=true;
      const start=new URL(config.start);
      if(start.protocol!=='https:'||start.host!==target.host||start.pathname!==target.pathname.replace(/connect$/,'start'))throw Error('host');
      fetch(start,{headers:{Authorization:'Bearer '+target.searchParams.get('access_token')},redirect:'error',signal:AbortSignal.timeout(15000)}).then(async r=>{
       if(!r.ok)throw Error('start');const result=await r.json();if(result.Response!=='started')throw Error('start');
       if(!finished&&!stopped){activated=true;failures=0;status('ok');}
      }).catch(()=>finish('No se pudo activar la recepción autenticada'));
     }
     if(Date.now()-lastHealth>30000&&activated){status('ok');lastHealth=Date.now();}
     for(const raw of newsFromFrame(frame)){const saved=ingestLiveItem(db,raw);if(saved)onNews(saved);}
    }catch{finish('No se pudo procesar un mensaje; revisión y reconexión necesarias');}
   };
   socket.onerror=()=>finish('Error de transporte del canal de texto');
   socket.onclose=()=>finish('Canal de texto desconectado; reconexión pendiente');
  }catch{finish('No se pudo abrir el flujo. La sesión puede haber caducado; no se han expuesto credenciales.');}
 }
 recoverRecent();
 connect();
 return ()=>{stopped=true;clearTimeout(snapshotTimer);clearTimeout(retryTimer);clearInterval(watchdog);socket?.close();};
}
