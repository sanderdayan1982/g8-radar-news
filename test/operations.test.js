import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inverseChange,rankRows,connectionState,nextCalendarEvent,fxClosed,safeUrl} from '../public/domain.js';
import {openDb,saveDevice,listDevices,insertAlert,enqueuePushForAlerts,listDuePushQueue,markPushQueueFailure,markPushQueueDisplayed} from '../src/db.js';
import {sourceHealth,validPushSubscription,sameOriginMutation} from '../src/operations.js';
import {readSettings,writeSettings} from '../src/settings.js';
import {dispatchAlertsNow} from '../src/server.js';

test('reciprocal simple returns and invalid denominators',()=>{
 assert.ok(Math.abs(inverseChange(10)+9.0909090909)<1e-8);
 assert.equal(inverseChange(0),0);assert.equal(inverseChange(-100),null);assert.equal(inverseChange(NaN),null);
 assert.ok(Math.abs(inverseChange(inverseChange(12))-12)<1e-10);
});
test('ties do not invent an ordering, explicit zero evidence is respected',()=>{
 const rows=rankRows([{currency:'USD',score:24,noEvidence:false},{currency:'CHF',score:24,noEvidence:false},{currency:'EUR',score:0,noEvidence:false},{currency:'NZD',score:0,noEvidence:true}]);
 assert.deepEqual(rows.map(x=>x.rank),[1,1,3,null]);assert.equal(rows[2].noEvidence,false);
});
test('connection state never green before a valid synchronization or after network loss',()=>{
 const now=Date.now();const d={last_sync:{finished_at:new Date(now).toISOString()},sources:[]};
 assert.equal(connectionState(null,null,0,now).kind,'loading');
 assert.equal(connectionState({},null,now,now).kind,'loading');
 assert.equal(connectionState(d,'timeout',now,now).kind,'offline');
 assert.equal(connectionState(d,null,now,now).kind,'ready');
 assert.equal(connectionState(d,null,now-100000,now).kind,'offline');
});
test('next event is chronological and FX sessions follow New York DST',()=>{
 const now=Date.parse('2026-07-03T20:00:00Z');
 assert.equal(nextCalendarEvent([{impact:'High',event_at:'2026-07-03T23:00:00Z',id:2},{impact:'Medium',event_at:'2026-07-03T22:00:00Z',id:1}],now).id,1);
 assert.equal(fxClosed(new Date('2026-07-03T21:00:00Z')),true);
 assert.equal(fxClosed(new Date('2026-01-02T21:30:00Z')),false);
});
test('four subscriptions sharing provider prefix survive registration and exact revalidation',()=>{
 const db=openDb(':memory:');
 for(let i=0;i<4;i++)saveDevice(db,{id:`device-${i}`,label:`Device ${i}`,subscription:{endpoint:'https://web.push.apple.com/'+ 'x'.repeat(90)+i}});
 assert.equal(listDevices(db).length,4);
 const id=saveDevice(db,{id:'new-browser-id',label:'renamed',subscription:{endpoint:'https://web.push.apple.com/'+'x'.repeat(90)+'0'}});
 assert.equal(id,'device-0');assert.equal(listDevices(db).length,4);db.close();
});
test('targeted test is not starved behind 200 queued notifications',()=>{
 const db=openDb(':memory:');saveDevice(db,{id:'a',label:'a',subscription:{endpoint:'https://example.test/push'}});
 const ids=[];for(let i=0;i<205;i++)ids.push(...enqueuePushForAlerts(db,[insertAlert(db,{title:'Test '+i,alert_type:'titular',level:'medio'})]));
 assert.equal(listDuePushQueue(db,new Date().toISOString(),200,[ids.at(-1)])[0].id,ids.at(-1));db.close();
});
test('expired devices remain diagnosable and cannot receive new deliveries',()=>{
 const db=openDb(':memory:');saveDevice(db,{id:'a',label:'iPhone',subscription:{endpoint:'https://example.test/a'}});
 const [id]=enqueuePushForAlerts(db,[insertAlert(db,{title:'Test',alert_type:'titular',level:'medio'})]);
 markPushQueueFailure(db,id,'a','Gone',410);
 assert.equal(listDevices(db).length,0);assert.equal(listDevices(db,true)[0].status,'expired');
 assert.equal(markPushQueueDisplayed(db,{queueId:id,deviceId:'other'}),false);db.close();
});
test('concurrent dispatches send once per alert to all four devices',async()=>{
 const db=openDb(':memory:');for(let i=0;i<4;i++)saveDevice(db,{id:`d${i}`,label:`d${i}`,subscription:{endpoint:`https://example.test/${i}`}});
 const sent=[];const sendFn=async(sub,body)=>{await new Promise(r=>setTimeout(r,2));sent.push(JSON.parse(body));return {statusCode:201};};
 await Promise.all([1,2].map(n=>dispatchAlertsNow([{title:`Test ${n}`,alert_type:'titular',level:'medio'}],{targetDb:db,sendFn})));
 assert.equal(sent.length,8);assert.equal(new Set(sent.map(x=>x.queueId)).size,8);db.close();
});
test('no scripts in links and no private-network push targets',()=>{
 assert.equal(safeUrl('javascript:alert(1)'),'#');
 const keys={p256dh:'a'.repeat(87),auth:'b'.repeat(22)};
 assert.equal(validPushSubscription({endpoint:'https://127.0.0.1/x',keys}),false);
 assert.equal(validPushSubscription({endpoint:'https://web.push.apple.com/x',keys}),true);
});
test('cross-site mutations rejected before request processing',()=>{
 let code=0,called=false;
 sameOriginMutation({method:'POST',get:n=>({'origin':'https://evil.example','host':'radar.example','sec-fetch-site':'cross-site'}[n]),is:()=>true},{status:n=>{code=n;return {json:()=>{}};}},()=>{called=true;});
 assert.equal(code,403);assert.equal(called,false);
});
test('corrupted settings fail safely instead of rotating VAPID keys',()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-settings-'));const file=join(dir,'settings.json');
 writeFileSync(file,'{broken');assert.throws(()=>readSettings(file),/no se regeneran/);
 writeSettings({vapid:{publicKey:'public',privateKey:'private'}},file);
 assert.equal(readSettings(file).vapid.privateKey,'private');rmSync(dir,{recursive:true});
});
test('source content age is independent of successful transport',()=>{
 const h=sourceHealth({type:'oficial',status:'ok',last_news_published_at:'2025-01-01T00:00:00Z'},Date.parse('2026-10-25T00:00:00Z'));
 assert.equal(h.status,'ok');assert.equal(h.freshness,'review');
});

test('sessions require a strong code; cookies and delivery receipts cannot be forged',async()=>{
 const {createAccess}=await import('../src/access.js');
 const access=createAccess('/unused',{code:'a'.repeat(43),key:'b'.repeat(64),secure:true});
 let cookie,options,code;
 const response={cookie:(name,value,opts)=>{cookie=name+'='+value;options=opts;},json:x=>x,status:n=>{code=n;return response;}};
 access.login({body:{code:'wrong'},socket:{remoteAddress:'one'}},response);assert.equal(code,401);
 access.login({body:{code:'a'.repeat(43)},socket:{remoteAddress:'one'}},response);
 assert.equal(options.httpOnly,true);assert.equal(options.secure,true);assert.equal(options.sameSite,'strict');
 assert.equal(access.sessionValid({headers:{cookie}}),true);
 assert.equal(access.sessionValid({headers:{cookie:cookie+'broken'}}),false);
 const token=access.ackToken(1,'phone');assert.equal(access.ackValid({queueId:1,deviceId:'phone',token}),true);
 assert.equal(access.ackValid({queueId:1,deviceId:'other',token}),false);
});
