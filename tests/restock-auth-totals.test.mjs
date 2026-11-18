import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {websiteBackend} from './helpers/google-website.mjs';
import {GoogleInventoryStore} from '../js/google-store.js';
import {inventoryTotals,normalizeInventoryTotals} from '../js/inventory-activity.js';
const code='8642',plain=x=>JSON.parse(JSON.stringify(x)),intent={kind:'drink',itemId:'milk',mode:'consider',expectedMode:'normal'};
const storage=()=>{const values=new Map();return {values,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const domain=b=>plain({catalog:b.sheets.Catalog.rows,history:b.sheets.History.rows,supplies:b.sheets.SupplyCatalog?.rows,supplyHistory:b.sheets.SupplyHistory?.rows,prefs:b.sheets.RestockPreferences?.rows});
function client(b,extra={}){const disk=storage(),pending=storage(),reads=[],posts=[];let now=0;const store=new GoogleInventoryStore({googleScriptUrl:'https://script.google.com/macros/s/PIN_TEST/exec'},{publicStorage:disk,pendingStorage:pending,now:()=>now,readPublicData:async(_url,opts)=>{reads.push(opts.action);return plain(opts.action==='warehouse'?b.ctx.warehouseData_():opts.action==='admin'?b.ctx.adminSummaryData_():b.ctx.publicData_());},submitWebsiteCommand:async(_url,command)=>{posts.push(command);const receipt=b.send(command.operation,command.data,command.requestId);if(receipt.state==='rejected'){const error=new Error(receipt.message);error.code=receipt.errorCode;throw error;}return receipt.result;},...extra});return {store,disk,pending,reads,posts,setNow:value=>{now=value;}};}

test('names protect marking/canceling and zero-stock decisions before catalog reads; legacy PIN properties are ignored',()=>{
 const b=websiteBackend({defaultRecorder:null});b.ctx.ensureSupplyStorage_(b.ss);b.props.set('HOLDWIN_RESTOCK_PIN',code);const before=domain(b),catalog=b.ctx.catalog_;b.ctx.catalog_=()=>{throw Error('must record name before reads');};
 for(const recorder of [undefined,' ',123,'',null,'a'.repeat(81),'a\nname'])for(const operation of ['restock-preference','zero-stock-decision']){
  const result=b.send(operation,{...intent,recorder,restockPin:code});assert.equal(result.state,'rejected');assert.equal(result.errorCode,'restock_auth');assert.deepEqual(domain(b),before);
 }
 b.ctx.catalog_=catalog;
 const saved=b.send('restock-preference',{...intent,recorder:' 小王 '});assert.equal(saved.state,'accepted');assert.equal(saved.result.recorder,'小王');assert.equal(saved.result.restockAuthVersion,2);assert.equal(b.sheets.RestockPreferences.rows[1][7],'小王');
 const cancel={...intent,mode:'normal',expectedMode:'consider'};assert.equal(b.send('restock-preference',cancel).errorCode,'restock_auth');assert.equal(b.send('restock-preference',{...cancel,recorder:'小李'}).state,'accepted');
 assert.equal(b.ctx.publicData_().websiteEntry.restockAuthVersion,2);assert.equal(b.sheets.RestockPreferences.rows.at(-1)[7],'小李');
 assert.ok(!JSON.stringify(b.sheets.WebsiteRequests.rows).includes(JSON.stringify(code)));
 assert.equal(b.send('wish',{kind:'drink',name:'測試願望',url:'',note:''}).state,'accepted');
});

test('name confirmation and first save share one POST and the remembered name expires after thirty minutes',async()=>{
 const b=websiteBackend(),c=client(b);await c.store.readWarehouse();assert.equal(c.store.requiresRestockAuth,true);assert.equal(c.store.hasRestockAuthorization,false);
 await assert.rejects(c.store.setRestockPreference(intent),e=>e.code==='restock_auth');assert.equal(c.posts.length,0);
 for(const name of ['', ' ', 'a'.repeat(81)])assert.throws(()=>c.store.setRestockName(name));
 c.store.setRestockName('Rey');await c.store.setRestockPreference(intent);assert.equal(c.store.hasRestockAuthorization,true);assert.equal(c.posts.length,1);assert.equal(c.posts[0].data.recorder,'Rey');assert.equal(c.posts[0].data.restockPin,undefined);assert.deepEqual(c.reads,['warehouse']);
 await c.store.setRestockPreference({...intent,mode:'normal',expectedMode:'consider'});assert.equal(c.posts.length,2);assert.equal(c.posts[1].data.recorder,'Rey');
 const next=client(b);await next.store.readWarehouse();assert.equal(next.store.hasRestockAuthorization,false);
 c.setNow(30*60*1000);assert.equal(c.store.hasRestockAuthorization,false);await assert.rejects(c.store.setRestockPreference(intent),e=>e.code==='restock_auth');assert.equal(c.posts.length,2);
});

test('a recorder is part of the durable intent and replay cannot silently change the name',()=>{
 const b=websiteBackend(),requestId='named-restock-request-00000001',data={...intent,recorder:'小王'};
 const receipt=b.send('restock-preference',data,requestId);assert.deepEqual(b.send('restock-preference',data,requestId),receipt);assert.throws(()=>b.send('restock-preference',{...data,recorder:'小李'},requestId),/request_conflict/);
 assert.notEqual(b.ctx.websiteFingerprint_({operation:'restock-preference',data}),b.ctx.websiteFingerprint_({operation:'restock-preference',data:{...data,recorder:'小李'}}));
});

test('uncertain retries preserve the same named intent and never optimistically toggle a mark',async()=>{
 const b=websiteBackend();let first=true;const c=client(b,{submitWebsiteCommand:async(_url,command)=>{c.posts.push(command);const receipt=b.send(command.operation,command.data,command.requestId);if(first){first=false;const error=Error('pending');error.code='pending';throw error;}return receipt.result;}});
 await c.store.readWarehouse();c.store.setRestockName('小王');await assert.rejects(c.store.setRestockPreference(intent),/pending/);assert.equal(c.store.hasRestockAuthorization,false);assert.equal(c.store.restockPreferences.length,0);
 for(const raw of c.pending.values.values())assert.ok(raw.includes('小王'));
 await c.store.setRestockPreference(intent);assert.equal(c.posts[0].requestId,c.posts[1].requestId);assert.equal(c.store.hasRestockAuthorization,true);assert.equal(b.sheets.RestockPreferences.rows.length,2);
});

test('existing seven-column preference records gain an audit-name column only when writing',()=>{
 const b=websiteBackend();b.send('restock-preference',{...intent,recorder:'原登記'});for(const row of b.sheets.RestockPreferences.rows)row.length=7;
 assert.equal(b.ctx.restockPreferences_(b.ss)[0].mode,'consider');assert.equal(b.sheets.RestockPreferences.rows[0].length,7);
 b.send('restock-preference',{...intent,mode:'normal',expectedMode:'consider',recorder:'小王'});assert.equal(b.sheets.RestockPreferences.rows[0][7],'登記人');assert.equal(b.sheets.RestockPreferences.rows.at(-1)[7],'小王');
 b.props.set('HOLDWIN_RESTOCK_PIN','wrong legacy pin');assert.equal(b.ctx.publicData_().websiteEntry.restockAuthVersion,2);
});

test('old PIN deployments request an update instead of sending a name as a PIN',async()=>{
 for(const version of [0,1]){const b=websiteBackend(),c=client(b);await c.store.readWarehouse();c.store.restockAuthVersion=version;c.store.setRestockName('小王');await assert.rejects(c.store.setRestockPreference(intent),/更新原 Google 部署/);assert.equal(c.posts.length,0);}
});

test('totals use every latest balance and all later arrivals, independent of the most recent count batch',async()=>{
 const b=websiteBackend();b.ctx.ensureSupplyStorage_(b.ss);b.send('stocktake',{entries:[{drinkId:'milk',quantity:3}],recorder:'虛構'});b.send('arrival',{drinkId:'tea',cases:0,loose:4,recorder:'虛構',note:''});
 b.send('supply-stocktake',{entries:[{supplyId:'supply-snack-01',quantity:0},{supplyId:'supply-noodle-01',quantity:6}],recorder:'虛構'});
 b.sheets.Catalog.rows.push(['unmeasured','待盤點品項','茶飲','鐵罐','罐',24,10,true]);b.sheets.Catalog.rows.push(['historic-positive','歷史餘量','茶飲','鐵罐','罐',24,10,false]);b.sheets.History.rows.push(['h-count','2020-01-02T00:00:00Z','count','historic-positive','歷史餘量',2,'','虛構','採計']);
 const c=client(b);await c.store.readWarehouse();const warm=plain(await c.store.readAdminSummary()),fresh=plain(await c.store.readAdminSummary({force:true}));assert.deepEqual(warm.inventoryTotals,fresh.inventoryTotals);
 const drinks=fresh.inventoryTotals.find(g=>g.kind==='drink');assert.equal(drinks.items.find(i=>i.id==='tea').stock,24);assert.equal(drinks.items.find(i=>i.id==='milk').stock,3);assert.equal(drinks.items.length,3);assert.equal(drinks.unknownCount,1);assert.equal(drinks.items.find(i=>i.id==='historic-positive').active,false);
 assert.equal(fresh.inventoryTotals.find(g=>g.kind==='noodle').items.find(i=>i.id==='supply-noodle-01').stock,6);assert.equal(fresh.inventoryTotals.find(g=>g.kind==='snack').items.length,0);
 assert.equal(fresh.recentCounts.find(g=>g.kind==='drink').items.length,1,'fixture reproduces partial recent count, not total');
 assert.deepEqual(normalizeInventoryTotals(fresh.inventoryTotals),fresh.inventoryTotals);
 for(const bad of [[],[...fresh.inventoryTotals.slice(0,3),fresh.inventoryTotals[0]],fresh.inventoryTotals.map(g=>g.kind==='drink'?{...g,items:[{...g.items[0],stock:NaN}]}:g)])assert.throws(()=>normalizeInventoryTotals(bad));
 assert.equal(inventoryTotals([{kind:'drink',id:'zero',stock:0,active:true},{kind:'drink',id:'unknown',stock:null,active:true}])[0].items.length,0);
});
