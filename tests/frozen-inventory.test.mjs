import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { websiteBackend } from './helpers/google-website.mjs';
import { GoogleInventoryStore, normalizeGooglePublicData } from '../js/google-store.js';
import { InventoryStore } from '../js/store.js';
import { FROZEN_UNITS, matchesSupplyInventoryFilter } from '../js/supplies.js';
import { normalizeInventoryTotals } from '../js/inventory-activity.js';

const plain=value=>JSON.parse(JSON.stringify(value));
const fresh=(overrides={})=>({kind:'frozen',name:'虛構香草雪糕',unit:'支',quantity:8,recorder:'虛構登記者',...overrides});
const balance=(b,id)=>b.ctx.supplyInventory_(b.ctx.supplyCatalog_(b.ss),b.ctx.supplyEvents_(b.ss)).find(item=>item.id===id);
const snapshot=b=>plain(Object.fromEntries(Object.entries(b.sheets).filter(([name])=>name!=='WebsiteRequests').map(([name,sheet])=>[name,sheet.rows])));
function client(b,{legacy=false}={}) {
  const posts=[],reads=[];
  const store=new GoogleInventoryStore({googleScriptUrl:'https://script.google.com/macros/s/FROZEN_TEST/exec'}, {
    publicStorage:null,pendingStorage:null,
    readPublicData:async(_url,opts)=>{
      reads.push(opts.action);const data=plain(opts.action==='admin'?b.ctx.adminSummaryData_(true):b.ctx.warehouseData_(true));
      if(legacy)delete data.supplyEntry?.frozenVersion;return data;
    },
    submitWebsiteCommand:async(_url,command)=>{
      posts.push(command);const receipt=b.send(command.operation,command.data,command.requestId);
      if(receipt.state!=='accepted')throw Error(receipt.message);return receipt.result;
    },
  });return {store,posts,reads};
}

test('reading the new category does not invent products or mutate existing stock',()=>{
  const b=websiteBackend(),before=snapshot(b),raw=plain(b.ctx.warehouseData_(true));
  assert.equal(raw.supplyEntry.frozenVersion,1);
  assert.equal(raw.supplies.filter(item=>item.kind==='frozen').length,0);
  assert.deepEqual(snapshot(b),before);
  assert.deepEqual(plain(b.ctx.adminSummaryData_(true).inventoryTotals.find(g=>g.kind==='frozen')),{kind:'frozen',unknownCount:0,items:[]});
  assert.equal(b.ctx.publicData_().supplies,undefined);
});

test('each frozen packaging unit creates one arrival-backed balance without a fabricated count; retries save once',()=>{
  for(const unit of FROZEN_UNITS){
    const b=websiteBackend(),requestId=randomUUID(),data=fresh({unit});
    const saved=b.send('new-arrival',data,requestId);assert.equal(saved.state,'accepted');
    assert.equal(balance(b,saved.result.id).stock,8);assert.equal(balance(b,saved.result.id).lastCountAt,null);
    assert.equal(balance(b,saved.result.id).unit,unit);
    b.send('new-arrival',data,requestId);
    assert.equal(b.ctx.supplyEvents_(b.ss).filter(e=>e.supplyId===saved.result.id).length,1);
    assert.equal(b.ctx.historyEvents_(b.ss).some(e=>e.drinkId===saved.result.id),false);
  }
});

test('invalid frozen units, quantities, names and box conversion reject before source changes',()=>{
  for(const change of [{unit:'箱'},{unit:'瓶'},{quantity:0},{quantity:-1},{quantity:1.5},{quantity:1000000},{name:''},{cases:24}]){
    const b=websiteBackend(),before=snapshot(b);assert.equal(b.send('new-arrival',fresh(change)).state,'rejected');assert.deepEqual(snapshot(b),before);
  }
});

test('zero counts archive frozen products and repurchase restores the same product and history',()=>{
  const b=websiteBackend(),id=b.send('new-arrival',fresh()).result.id;
  assert.equal(b.send('supply-stocktake',{recorder:'虛構',entries:[{supplyId:id,quantity:0}]}).state,'accepted');
  const view=normalizeGooglePublicData(plain(b.ctx.warehouseData_(true)),{warehouse:true}),item=view.supplies.find(i=>i.id===id);
  assert.equal(item.stock,0);assert.equal(item.active,false);assert.equal(matchesSupplyInventoryFilter(item,'archived'),true);
  assert.equal(b.send('supply-arrival',{supplyId:id,quantity:3,restoreArchived:true,recorder:'虛構'}).state,'accepted');
  const after=normalizeGooglePublicData(plain(b.ctx.warehouseData_(true)),{warehouse:true}).supplies.find(i=>i.id===id);
  assert.equal(after.stock,3);assert.equal(after.active,true);assert.equal(b.ctx.supplyCatalog_(b.ss).filter(i=>i.id===id).length,1);
});

test('frozen duplicate names reuse the existing product, while separate categories can share a name',()=>{
  const b=websiteBackend();assert.equal(b.send('new-arrival',fresh()).state,'accepted');
  assert.equal(b.send('new-arrival',fresh({name:'  虛構香草雪糕  '})).state,'rejected');
  assert.equal(b.send('new-arrival',{...fresh(),kind:'snack',unit:'包',category:'其他甜食'}).state,'accepted');
});

test('mixed batches count frozen arrivals once and reject every row if another row is invalid',()=>{
  const b=websiteBackend(),before=snapshot(b);
  assert.equal(b.send('batch-arrival',{recorder:'虛構',entries:[{...fresh(),isNew:true},{kind:'noodle',supplyId:'supply-noodle-01',quantity:2}]}).state,'rejected');assert.deepEqual(snapshot(b),before);
  const data={recorder:'虛構',entries:[{...fresh(),isNew:true},{kind:'drink',drinkId:'tea',quantity:3}]},requestId=randomUUID();
  const saved=b.send('batch-arrival',data,requestId);assert.equal(saved.state,'accepted');b.send('batch-arrival',data,requestId);
  assert.equal(balance(b,saved.result.items[0].id).stock,8);assert.equal(b.inventory()[0].stock,23);
});

test('manual frozen restock follows the existing PIN and appears in totals and activity without automatic red warnings',async()=>{
  const b=websiteBackend(),id=b.send('new-arrival',fresh()).result.id;
  assert.equal(b.ctx.adminSummaryData_(true).lowItems.some(i=>i.id===id),false);
  b.props.set('HOLDWIN_RESTOCK_PIN','8642');
  const intent={kind:'frozen',itemId:id,mode:'consider',expectedMode:'normal'};
  assert.equal(b.send('restock-preference',intent).errorCode,'restock_auth');
  assert.equal(b.send('restock-preference',{...intent,restockPin:'8642'}).state,'accepted');
  const {store}=client(b);await store.readWarehouse();assert.equal(store.supportsFrozen,true);
  const summary=await store.readAdminSummary({force:true});
  assert.ok(summary.restockItems.some(i=>i.id===id));assert.ok(summary.lowItems.some(i=>i.id===id));
  const group=summary.inventoryTotals.find(g=>g.kind==='frozen');assert.equal(group.items[0].stock,8);assert.equal(group.items[0].unit,'支');
  assert.ok(summary.recentArrivals.some(e=>e.kind==='frozen'&&e.quantity===8));
  assert.equal(balance(b,id).stock,8);
});

test('old deployments keep their four-category totals readable and reject frozen writes before transport',async()=>{
  const b=websiteBackend(),{store,posts}=client(b,{legacy:true});await store.readWarehouse();assert.equal(store.supportsFrozen,false);
  await assert.rejects(store.submitNewArrival(fresh()),/更新/);
  await assert.rejects(store.setRestockPreference({kind:'frozen',itemId:'supply-frozen-example',mode:'consider',expectedMode:'normal'}),/更新/);
  await assert.rejects(store.submitBatchArrival({entries:[{...fresh(),isNew:true}],recorder:'虛構'}),/更新/);assert.equal(posts.length,0);
  const groups=plain(b.ctx.adminSummaryData_(true).inventoryTotals);
  assert.equal(normalizeInventoryTotals(groups.filter(g=>g.kind!=='frozen')).length,4);
  assert.throws(()=>normalizeInventoryTotals(groups.filter(g=>g.kind!=='toner')),/缺少/);
});

test('local preview supports frozen creation, inventory counts and units without touching existing products',async t=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
  t.after(()=>old?Object.defineProperty(globalThis,'localStorage',old):delete globalThis.localStorage);
  const store=new InventoryStore();await store.init();const drinkCount=store.data.drinks.length;
  const saved=await store.submitNewArrival(fresh({unit:'桶',quantity:2}));
  assert.equal(store.supportsFrozen,true);assert.equal(store.supplies.find(i=>i.id===saved.id).stock,2);
  await store.submitSupplyStocktake([{supplyId:saved.id,quantity:0}],'虛構');
  assert.equal(store.supplies.find(i=>i.id===saved.id).active,false);assert.equal(store.data.drinks.length,drinkCount);
});
