import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {websiteBackend} from './helpers/google-website.mjs';
import {NamedInventoryStore} from './helpers/named-stores.mjs';
import {groupSnackItems} from '../js/supplies.js';
const plain=x=>JSON.parse(JSON.stringify(x));
const mode=(b,kind,id)=>b.ctx.restockMode_(b.ctx.restockPreferences_(b.ss),kind,id);
const mark=(b,kind,itemId,expectedMode='normal')=>b.send('restock-preference',{kind,itemId,mode:'consider',expectedMode,recorder:'小王'});
const arrival=(b,kind,id,quantity=2,requestId)=>kind==='drink'?b.send('arrival',{drinkId:id,cases:0,loose:quantity,recorder:'入庫同事'},requestId):b.send('supply-arrival',{supplyId:id,quantity,recorder:'入庫同事',...(kind==='noodle'?{expiresOn:'2099-01-01'}:{})},requestId);

test('positive arrivals clear manual marks for every stock level and category, including toner',()=>{
 for(const kind of ['drink','snack','frozen','noodle','toner'])for(const stock of [null,0,23]){
  const b=websiteBackend();b.ctx.ensureSupplyStorage_(b.ss);let id={drink:'tea',snack:'supply-snack-01',noodle:'supply-noodle-01',toner:'supply-toner-black',frozen:'frozen-test'}[kind];
  if(kind==='frozen')b.sheets.SupplyCatalog.rows.push([id,'虛構冰品','frozen','支',true,'','']);
  if(kind==='drink'&&stock===null)b.sheets.History.rows=b.sheets.History.rows.filter(row=>row[3]!==id);
  if(stock!==null)assert.equal(b.send(kind==='drink'?'stocktake':'supply-stocktake',{entries:[{[kind==='drink'?'drinkId':'supplyId']:id,quantity:stock}],recorder:'盤點'}).state,'accepted');
  assert.equal(mark(b,kind,id).state,'accepted');assert.equal(arrival(b,kind,id).state,'accepted');assert.equal(mode(b,kind,id),'normal');
  const record=b.sheets.RestockPreferences.rows.at(-1);assert.equal(record[4],'normal');assert.equal(record[7],'入庫同事');
 }
});

test('counts, invalid arrivals and unrelated arrivals preserve a mark',()=>{
 const b=websiteBackend();mark(b,'drink','tea');b.send('stocktake',{entries:[{drinkId:'tea',quantity:17}],recorder:'盤點'});assert.equal(mode(b,'drink','tea'),'consider');
 assert.equal(arrival(b,'drink','tea',0).state,'rejected');assert.equal(mode(b,'drink','tea'),'consider');arrival(b,'drink','milk');assert.equal(mode(b,'drink','tea'),'consider');
});

test('mixed batches clear only arrived flavors after full validation and do not duplicate fulfillment rows on retries',()=>{
 const b=websiteBackend(),a='supply-snack-01',c='supply-snack-02';mark(b,'snack',a);mark(b,'snack',c);mark(b,'drink','tea');
 const data={recorder:'批次同事',entries:[{kind:'snack',supplyId:a,quantity:2},{kind:'drink',drinkId:'tea',quantity:3}]},id=randomUUID();
 assert.equal(b.send('batch-arrival',{...data,entries:[...data.entries,{kind:'noodle',supplyId:'supply-noodle-01',quantity:1}]}).state,'rejected');assert.equal(mode(b,'snack',a),'consider');
 const accepted=b.send('batch-arrival',data,id);assert.equal(accepted.state,'accepted');const rows=plain(b.sheets.RestockPreferences.rows);assert.deepEqual(b.send('batch-arrival',data,id),accepted);assert.deepEqual(b.sheets.RestockPreferences.rows,rows);
 assert.equal(mode(b,'snack',a),'normal');assert.equal(mode(b,'snack',c),'consider');assert.equal(mode(b,'drink','tea'),'normal');
});

test('a rejected duplicate creation keeps the mark and using the existing item clears it',()=>{
 const b=websiteBackend(),data={kind:'snack',name:'虛構同品項',flavor:'海鹽',category:'其他鹹食',unit:'包',quantity:2,recorder:'入庫'};
 const created=b.send('new-arrival',data).result.id;mark(b,'snack',created);assert.equal(b.send('new-arrival',data).state,'rejected');assert.equal(mode(b,'snack',created),'consider');arrival(b,'snack',created);assert.equal(mode(b,'snack',created),'normal');assert.equal(b.ctx.supplyCatalog_(b.ss).filter(item=>item.name===data.name).length,1);
});

test('retrying an interrupted arrival preserves a newer re-mark, even when timestamps are identical',()=>{
 const b=websiteBackend();b.ctx.Date=class extends Date {constructor(...args){super(...(args.length?args:['2026-11-18T00:00:00Z']));}};mark(b,'drink','tea');const apply=b.ctx.applyZeroRestockFulfilments_;let fail=true;
 b.ctx.applyZeroRestockFulfilments_=(...args)=>{if(fail){fail=false;throw Error('interrupted');}return apply(...args);};
 const id=randomUUID();assert.throws(()=>arrival(b,'drink','tea',2,id),/interrupted/);
 b.send('restock-preference',{kind:'drink',itemId:'tea',mode:'normal',expectedMode:'consider',recorder:'小李'});mark(b,'drink','tea');
 const rows=b.sheets.RestockPreferences.rows;assert.equal(rows.at(-1)[1],rows[1][1]);assert.equal(mode(b,'drink','tea'),'consider');
 assert.equal(arrival(b,'drink','tea',2,id).state,'accepted');assert.equal(mode(b,'drink','tea'),'consider');assert.equal(b.sheets.History.rows.filter(row=>row[0]===`website:${id}:tea`).length,1);
});

test('an arrival recovered after a later zero count does not clear the still-needed restock mark',()=>{
 const b=websiteBackend();mark(b,'drink','tea');const apply=b.ctx.applyZeroRestockFulfilments_;let fail=true;b.ctx.applyZeroRestockFulfilments_=(...args)=>{if(fail){fail=false;throw Error('interrupted');}return apply(...args);};
 const id=randomUUID();assert.throws(()=>arrival(b,'drink','tea',2,id));b.send('stocktake',{entries:[{drinkId:'tea',quantity:0}],recorder:'後續盤點'});assert.equal(arrival(b,'drink','tea',2,id).state,'accepted');assert.equal(mode(b,'drink','tea'),'consider');
});

test('local mixed arrivals follow the same clear-on-arrival rule while counts retain manual marks',async()=>{
 const previous=globalThis.localStorage,values=new Map();globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 try{
  const store=new NamedInventoryStore();await store.init();const id='supply-snack-01';await store.setRestockPreference({kind:'snack',itemId:id,mode:'consider',expectedMode:'normal'});await store.submitSupplyStocktake([{supplyId:id,quantity:5}],'盤點');assert.equal(store.restockPreferences.find(row=>row.itemId===id).mode,'consider');
  await store.submitBatchArrival({recorder:'入庫',entries:[{kind:'snack',supplyId:id,quantity:2}]});assert.equal(store.restockPreferences.find(row=>row.itemId===id).mode,'normal');assert.equal(store.supplies.find(item=>item.id===id).stock,7);
 }finally{globalThis.localStorage=previous;}
});

test('flavor grouping is presentation-only and keeps row identity, amounts, input order and filtered subsets',()=>{
 const name='宴麥森林綜合纖脆燕麥棒',items=[{id:'almond',name,flavor:'杏仁芝麻',stock:4,unit:'條'},{id:'chocolate',name,flavor:'巧克力風味',stock:4,unit:'條'},{id:'other',name:'不同品項',stock:2,unit:'包'}],before=plain(items),groups=groupSnackItems(items);
 assert.equal(groups.length,2);assert.equal(groups[0].name,name);assert.deepEqual(groups[0].items.map(item=>item.id),['almond','chocolate']);assert.equal(groups[0].items[0],items[0]);assert.deepEqual(items,before);assert.equal(groupSnackItems(items.filter(item=>item.flavor==='巧克力風味'))[0].items.length,1);
});
