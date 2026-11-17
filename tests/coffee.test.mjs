import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { coffeeToday, coffeePounds, coffeeReceiptInput, coffeeWeight, coffeeInventory, latestCoffeeReceipt, normalizeCoffeeReceipts } from '../js/coffee.js';
import { InventoryStore } from '../js/store.js';
import { GoogleInventoryStore, normalizeGooglePublicData } from '../js/google-store.js';
import { websiteBackend, memorySheet } from './helpers/google-website.mjs';

const input = (overrides = {}) => ({brand:'測試烘豆所',poundsPerBag:0.5,bags:2,recorder:'測試同事',...overrides});
const event = (overrides = {}) => ({...input(),id:randomUUID(),createdAt:'2026-01-02T08:00:00Z',type:'restock',...overrides});
const plain = value => JSON.parse(JSON.stringify(value));
const storage = () => { const data = new Map(); return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}; };

test('coffee records pounds in half-pound increments; a supplied date never becomes part of a write', () => {
  assert.equal(coffeeToday('2026-11-16T16:01:00Z'),'2026-11-17');
  for(const value of [0.5,1,1.5])assert.equal(coffeePounds(String(value)),value);
  assert.equal(coffeeWeight(2.5),'2.5 磅');
  for (const weight of ['', '0', '0.25', '1.001', 'Infinity', '-0.5', '10000']) assert.throws(()=>coffeePounds(weight));
  for (const change of [{brand:' '},{poundsPerBag:0},{poundsPerBag:0.25},{poundsPerBag:'0.5'},{bags:0},{bags:1.5},{bags:10000},{recorder:''}]) assert.throws(()=>coffeeReceiptInput(input(change)));
  assert.equal(coffeeReceiptInput(input({brand:' 品牌 ',receivedOn:'2099-01-01'})).brand,'品牌');
  assert.equal(coffeeReceiptInput(input({receivedOn:'2099-01-01'})).receivedOn,undefined);
});

test('inventory groups brand and package pounds, replaces stock on actual counts and preserves last arrival', () => {
  const rows=[event({bags:3}),event({brand:' 測試烘豆所 ',bags:2}),event({poundsPerBag:1,bags:4}),event({type:'count',bags:1,createdAt:'2026-01-03T08:00:00Z'}),event({bags:2,createdAt:'2026-01-04T08:00:00Z'})];
  const items=coffeeInventory(rows);assert.equal(items.length,2);assert.equal(items[0].stock,3);assert.equal(items[0].stock*items[0].poundsPerBag,1.5);assert.equal(items[1].stock,4);
  assert.equal(items[0].lastArrivalAt,'2026-01-04T08:00:00Z');assert.equal(items[0].lastCountAt,'2026-01-03T08:00:00Z');
  rows.push(event({type:'count',bags:0,createdAt:'2026-01-05T08:00:00Z'}));assert.equal(coffeeInventory(rows)[0].stock,0);
});

test('latest arrival summary uses Taiwan entry time, includes same-day brands, and excludes counts and manual dates', () => {
  const rows=[event({receivedOn:'2099-01-01'}),event({brand:'第二品牌',poundsPerBag:1,bags:3}),event({type:'count',bags:99,createdAt:'2026-01-03T08:00:00Z'})];
  const summary=latestCoffeeReceipt(rows);assert.equal(summary.receivedOn,'2026-01-02');assert.equal(summary.totalPounds,4);assert.equal(summary.bags,5);
  assert.deepEqual(summary.brands,['測試烘豆所','第二品牌']);assert.equal(latestCoffeeReceipt([]),null);
});

test('backend creates storage only on first explicit write and recovers an interrupted append without duplication', () => {
  const b=websiteBackend(),before=JSON.stringify(b.inventory());
  const empty=plain(b.ctx.buildWarehouseData_());assert.deepEqual(empty.coffeeReceipts,[]);assert.equal(b.sheets.CoffeeReceipts,undefined);
  const requestId=randomUUID(),data=input({receivedOn:'2099-01-01'}),apply=b.ctx.applyWebsiteRequest_;
  b.ctx.applyWebsiteRequest_=(ss,effects)=>{apply(ss,effects);throw new Error('interrupted after append');};
  assert.throws(()=>b.send('coffee-receipt',data,requestId),/interrupted/);assert.equal(b.sheets.CoffeeReceipts.rows.length,2);assert.equal(b.sheets.CoffeeReceipts.rows[1][4],0.5);
  b.ctx.applyWebsiteRequest_=apply;const receipt=b.send('coffee-receipt',data,requestId);assert.equal(receipt.state,'accepted');
  assert.deepEqual(b.send('coffee-receipt',data,requestId),receipt);assert.equal(b.sheets.CoffeeReceipts.rows.length,2);
  assert.equal(receipt.result.receipt.receivedOn,coffeeToday(receipt.result.receipt.createdAt));
  b.send('coffee-receipt',input({brand:'=安全品牌',poundsPerBag:1,bags:3}));
  const warehouse=plain(b.ctx.buildWarehouseData_());assert.equal(warehouse.coffeeEntry.version,2);assert.equal(latestCoffeeReceipt(warehouse.coffeeReceipts).totalPounds,4);
  assert.equal(warehouse.coffeeReceipts[1].brand,'=安全品牌');assert.equal(JSON.stringify(b.inventory()),before);assert.equal(b.ctx.publicData_().coffeeReceipts,undefined);
  assert.throws(()=>normalizeCoffeeReceipts([warehouse.coffeeReceipts[0],warehouse.coffeeReceipts[0]]));
});

test('backend validates before writing, supports zero counts, and detects overflow and unrelated schemas', () => {
  const b=websiteBackend();
  for(const change of [{brand:''},{bags:0},{bags:1.5},{poundsPerBag:0},{poundsPerBag:'0.5'},{poundsPerBag:0.25},{recorder:''}])assert.equal(b.send('coffee-receipt',input(change)).state,'rejected');
  assert.equal(b.sheets.CoffeeReceipts,undefined);assert.equal(b.send('coffee-stocktake',input({bags:0})).state,'rejected');
  b.send('coffee-receipt',input());assert.equal(b.send('coffee-stocktake',input({bags:999999})).state,'accepted');
  assert.equal(b.send('coffee-receipt',input()).state,'rejected');assert.equal(b.send('coffee-stocktake',input({bags:0})).state,'accepted');
  assert.equal(coffeeInventory(plain(b.ctx.coffeeReceipts_(b.ss)))[0].stock,0);
  const unrelated=websiteBackend();unrelated.sheets.CoffeeReceipts=memorySheet([['其他用途']]);assert.equal(unrelated.send('coffee-receipt',input()).state,'rejected');assert.equal(unrelated.sheets.CoffeeReceipts.rows.length,1);
});

test('seven-column receipts are retained and acquire a type column only when a new entry is saved', () => {
  const b=websiteBackend();b.send('coffee-receipt',input());for(const row of b.sheets.CoffeeReceipts.rows)row.length=7;
  assert.equal(plain(b.ctx.buildWarehouseData_()).coffeeReceipts[0].type,'restock');assert.equal(b.sheets.CoffeeReceipts.rows[0].length,7);
  b.send('coffee-stocktake',input({bags:0}));assert.equal(b.sheets.CoffeeReceipts.rows[0][7],'類型');assert.equal(b.sheets.CoffeeReceipts.rows.length,3);
});

test('mixed coffee and drink batches validate atomically and retain idempotent retry and aggregate bounds', () => {
  const b=websiteBackend(),id=randomUUID(),data={recorder:'批次測試',entries:[{kind:'coffee',...input()},{kind:'coffee',...input({bags:3})},{kind:'drink',drinkId:'tea',quantity:2}]};
  const receipt=b.send('batch-arrival',data,id);assert.equal(receipt.state,'accepted');assert.equal(receipt.result.count,3);assert.deepEqual(b.send('batch-arrival',data,id),receipt);
  assert.equal(coffeeInventory(plain(b.ctx.coffeeReceipts_(b.ss)))[0].stock,5);assert.equal(b.sheets.CoffeeReceipts.rows.length,3);
  const before=JSON.stringify(b.sheets.CoffeeReceipts.rows);assert.equal(b.send('batch-arrival',{...data,entries:[data.entries[0],{kind:'coffee',...input({poundsPerBag:0.25})}]}).state,'rejected');assert.equal(JSON.stringify(b.sheets.CoffeeReceipts.rows),before);
  b.send('coffee-stocktake',input({bags:999990}));assert.equal(b.send('batch-arrival',{recorder:'測試',entries:[{kind:'coffee',...input({bags:5})},{kind:'coffee',...input({bags:5})}]}).state,'rejected');
});

test('demo coffee stock, dates and mixed batches persist while unrelated inventory and stale-tab protection remain intact', async () => {
  const previous=globalThis.localStorage;globalThis.localStorage=storage();
  try {
    const store=new InventoryStore();await store.init();const drinks=plain(store.data.drinks);
    const saved=await store.submitCoffeeReceipt(input({receivedOn:'2099-01-01'}));assert.equal(saved.receivedOn,coffeeToday(saved.createdAt));
    const reopened=new InventoryStore();await reopened.init();assert.equal(reopened.coffeeReceipts.length,1);assert.deepEqual(reopened.data.drinks,drinks);
    await store.submitCoffeeStocktake(input({bags:1}));assert.equal(coffeeInventory(store.coffeeReceipts)[0].stock,1);
    await assert.rejects(reopened.submitCoffeeReceipt(input()),/另一個分頁/);
    await store.submitBatchArrival({recorder:'批次',entries:[{kind:'coffee',...input({bags:3})},{kind:'coffee',...input({poundsPerBag:1,bags:2})}]});assert.equal(coffeeInventory(store.coffeeReceipts).length,2);
    const count=store.coffeeReceipts.length;await assert.rejects(store.submitBatchArrival({recorder:'批次',entries:[{kind:'coffee',...input()},{kind:'coffee',...input({bags:0})}]}));assert.equal(store.coffeeReceipts.length,count);
  }finally{globalThis.localStorage=previous;}
});

test('Google confirms coffee entries, shares counts across clients and blocks old receipt-only deployments', async () => {
  const b=websiteBackend();let posts=0;
  const options={pendingStorage:storage(),createRequestId:randomUUID,readPublicData:async(_url,{action})=>plain(action==='warehouse'?b.ctx.buildWarehouseData_():b.ctx.publicData_()),submitWebsiteCommand:async(_url,command)=>{posts++;const receipt=b.send(command.operation,command.data,command.requestId);if(receipt.state!=='accepted')throw Error(receipt.message);return receipt.result;}};
  const config={googleScriptUrl:'https://script.google.com/macros/s/COFFEE_TEST/exec'};
  const store=new GoogleInventoryStore(config,options);await store.openWarehouse();assert.equal(store.supportsCoffee,true);
  await store.submitCoffeeReceipt(input());await store.submitCoffeeStocktake(input({bags:1}));assert.equal(posts,2);assert.equal(coffeeInventory(store.coffeeReceipts)[0].stock,1);
  const other=new GoogleInventoryStore(config,options);await other.openWarehouse();assert.deepEqual(other.coffeeReceipts,store.coffeeReceipts);
  const legacy=plain(b.ctx.buildWarehouseData_());legacy.coffeeEntry.version=1;
  store.applyGoogleView(normalizeGooglePublicData(legacy,{warehouse:true}),true);assert.equal(store.coffeeReceipts.length,2);assert.equal(store.supportsCoffee,false);
  await assert.rejects(store.submitCoffeeReceipt(input()),/更新原 Apps Script/);assert.equal(posts,2);
});
