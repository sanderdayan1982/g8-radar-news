import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDb,saveDevice,listDuePushQueue,listSourceStates} from '../src/db.js';
import {newsFromFrame,initLiveStore,ingestLiveItem} from '../src/financialjuice.js';
const raw={NewsID:9820682,Title:'Federal Reserve signals higher interest rates',DatePublished:'2026-10-26T04:06:24',StreamIDs:[1,11],EURL:'https://example.test/story',Description:'<b>Statement</b>'};
test('text headline decoding preserves time and identity without category filtering',()=>{
 const [n]=newsFromFrame({M:[{A:[JSON.stringify([raw])]}]});
 assert.equal(n.id,'9820682');assert.equal(n.published_at,'2026-10-26T04:06:24.000Z');assert.deepEqual(n.streams,[1,11]);assert.equal(n.body,' Statement ');
 assert.deepEqual(newsFromFrame({M:[{A:['invalid',{AudioURL:'https://example.test/podcast.mp3'}]}]}),[]);
 assert.equal(newsFromFrame({M:[{A:[{...raw,EURL:'javascript:alert(1)'}]}]})[0].url,'');
});
test('replay does not duplicate headline, alert or device delivery',()=>{
 const db=openDb(':memory:');initLiveStore(db);saveDevice(db,{id:'phone',label:'Phone',subscription:{endpoint:'https://example.test/push'}});
 const [n]=newsFromFrame({M:[{A:[raw]}]});
 const first=ingestLiveItem(db,n);assert.equal(first.inserted,true);
 assert.equal(listSourceStates(db).find(s=>s.id==='financialjuice-live').stored_count,1);
 assert.equal(ingestLiveItem(db,n),null);assert.equal(db.prepare('SELECT count(*) n FROM financialjuice_receipts').get().n,1);
 assert.equal(listDuePushQueue(db).length,1);db.close();
});
test('a failed receipt commit rolls back news and alerts',()=>{
 const db=openDb(':memory:');initLiveStore(db);
 db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON financialjuice_receipts BEGIN SELECT RAISE(ABORT,'test'); END");
 const [n]=newsFromFrame({M:[{A:[raw]}]});assert.throws(()=>ingestLiveItem(db,n));
 assert.equal(db.prepare('SELECT count(*) n FROM news').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM alerts').get().n,0);db.close();
});
