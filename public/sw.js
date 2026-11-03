// Updates take control without navigating or interrupting open windows.
self.addEventListener('install', () => self.skipWaiting());
function ackDb() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('radarnews-delivery',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('acks',{keyPath:'queueId'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function ackStore(action, value) {
  const db=await ackDb();
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction('acks',action==='getAll'?'readonly':'readwrite');
    const req=tx.objectStore('acks')[action](value);
    let result;
    req.onsuccess=()=>{result=req.result;};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);
  });} finally {db.close();}
}
async function flushAcks() {
  const rows=await ackStore('getAll').catch(()=>[]);
  for (const row of rows) {
    try {
      const res=await fetch('/api/push/ack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row),signal:AbortSignal.timeout(5000)});
      if (!res.ok) break;
      const result=await res.json();
      if (result.ok) await ackStore('delete',row.queueId);
    } catch {break;}
  }
}
self.addEventListener('activate',event=>event.waitUntil((async()=>{await self.clients.claim();await flushAcks();})()));
self.addEventListener('message',event=>{if(event.data?.type==='FLUSH_ACKS')event.waitUntil(flushAcks());});
self.addEventListener('push', event => {
  let data={};
  try {data=event.data?.json() || {};} catch {data={body:event.data?.text() || ''};}
  event.waitUntil((async()=>{
    const tag=data.tag || `rn-alert-${data.alertId || Date.now()}`;
    let url='/';
    try {const parsed=new URL(data.url || '/',self.location.origin);if(parsed.origin===self.location.origin)url=parsed.href;} catch {}
    await self.registration.showNotification(data.title || 'RadarNews',{
      body:data.body || '',tag,renotify:false,icon:'/icon-512.png?v=2',badge:'/icon-192.png?v=2',
      silent:false,vibrate:[200,90,240],data:{url,queueId:data.queueId,deviceId:data.deviceId,tag},
    });
    if(data.queueId && data.deviceId) {
      await ackStore('put',{queueId:data.queueId,deviceId:data.deviceId,token:data.token,tag,displayedAt:new Date().toISOString()}).catch(()=>{});
      await flushAcks();
    }
    if(typeof data.badge==='number' && self.navigator.setAppBadge)await (data.badge?self.navigator.setAppBadge(data.badge):self.navigator.clearAppBadge()).catch(()=>{});
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    let url=new URL('/',self.location.origin);
    try {const candidate=new URL(event.notification.data?.url || '/',self.location.origin);if(candidate.origin===url.origin)url=candidate;} catch {}
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const win=windows.find(w=>new URL(w.url).origin===url.origin);
    if(win) {await win.navigate(url.href);return win.focus();}
    return self.clients.openWindow(url.href);
  })());
});
