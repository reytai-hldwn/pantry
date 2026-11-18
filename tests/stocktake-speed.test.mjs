import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {GoogleInventoryStore} from '../js/google-store.js';
import {coffeeInventory} from '../js/coffee.js';
import {snackPackHint,prepareSupplyCatalog} from '../js/supplies.js';
import {websiteBackend} from './helpers/google-website.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
function client(b,options={}){
 const reads=[],commands=[];
 const store=new GoogleInventoryStore({googleScriptUrl:'https://script.google.com/macros/s/STOCKTAKE_SPEED/exec'}, {pendingStorage:storage(),createRequestId:randomUUID,
  readPublicData:async(_url,{action})=>{reads.push(action);return plain(action==='warehouse'?b.ctx.buildWarehouseData_():b.ctx.publicData_());},
  submitWebsiteCommand:async(_url,command)=>{commands.push(command);const value=b.send(command.operation,command.data,command.requestId);assert.equal(value.state,'accepted');return value.result;},...options});
 return {store,reads,commands};
}

test('committed multi-item drink counts update confirmed numbers/history without blocking on a second warehouse read',async()=>{
 const b=websiteBackend();b.send('restock-preference',{kind:'drink',itemId:'milk',mode:'consider',expectedMode:'normal'});
 const c=client(b);await c.store.openWarehouse();const before=plain(c.store.data.events);
 await c.store.submitStocktake([{drinkId:'milk',quantity:4},{drinkId:'tea',quantity:0}],'測試');
 assert.deepEqual(c.reads,['warehouse']);assert.equal(c.store.data.drinks.find(x=>x.id==='milk').stock,4);assert.equal(c.store.data.drinks.find(x=>x.id==='tea').active,false);
 assert.equal(c.store.data.events.length,before.length+2);assert.deepEqual(c.store.data.events.slice(0,before.length),before);assert.equal(c.store.restockPreferences[0].mode,'consider');
 assert.equal(c.store.freshWarehouseSnapshot(),null);assert.equal(c.store.stocktakeRefreshPending,true);
 await c.store.readWarehouse();assert.equal(c.store.freshWarehouseSnapshot().result.data.drinks.find(x=>x.id==='milk').stock,4);
});

test('snack/noodle/toner count receipts preserve expiry history and restock flags while returning server units',async()=>{
 const b=websiteBackend();b.send('supply-arrival',{supplyId:'supply-noodle-01',quantity:4,recorder:'入庫',expiresOn:'2099-01-01'});
 b.send('restock-preference',{kind:'noodle',itemId:'supply-noodle-01',mode:'consider',expectedMode:'normal'});
 const c=client(b);await c.store.openWarehouse();const baseline=plain(c.store.supplyEvents);
 await c.store.submitSupplyStocktake([{supplyId:'supply-snack-01',quantity:0},{supplyId:'supply-noodle-01',quantity:3},{supplyId:'supply-toner-black',quantity:4}],'盤點');
 assert.deepEqual(c.reads,['warehouse']);assert.equal(c.store.supplies.find(x=>x.id==='supply-noodle-01').stock,3);assert.equal(c.store.supplies.find(x=>x.id==='supply-snack-01').active,false);assert.equal(c.store.supplies.find(x=>x.id==='supply-toner-black').unit,'盒');
 assert.deepEqual(c.store.supplyEvents.slice(0,baseline.length),baseline);assert.equal(c.store.restockPreferences[0].mode,'consider');assert.equal(c.store.stocktakeRefreshPending,true);
});

test('coffee count receipts replace only that brand/package ledger and keep its arrival dates and pounds',async()=>{
 const b=websiteBackend(),data={brand:'虛構咖啡',poundsPerBag:0.5,bags:5,recorder:'入庫'};
 b.send('coffee-receipt',data);b.send('coffee-receipt',{...data,brand:'另一品牌'});
 const c=client(b);await c.store.openWarehouse();const prior=plain(c.store.coffeeReceipts.filter(x=>x.brand==='另一品牌'));
 await c.store.submitCoffeeStocktake({...data,bags:2,recorder:'盤點'});assert.deepEqual(c.reads,['warehouse']);assert.equal(coffeeInventory(c.store.coffeeReceipts).find(x=>x.brand===data.brand).stock,2);assert.deepEqual(c.store.coffeeReceipts.filter(x=>x.brand==='另一品牌'),prior);assert.equal(c.store.stocktakeRefreshPending,true);
});

test('missing, mismatched or malformed confirmed patches use the existing full-read fallback',async()=>{
 for(const mutate of [r=>delete r.stocktake,r=>r.stocktake.events[0].quantity=99,r=>r.stocktake.events[0].id='unrelated',r=>r.stocktake.items[0].stock=-1,r=>r.stocktake.items=[],r=>r.stocktake.kind='supply',r=>r.stocktake.events[0].createdAt='invalid']){
  const b=websiteBackend(),c=client(b,{submitWebsiteCommand:async(_url,command)=>{const receipt=b.send(command.operation,command.data,command.requestId);mutate(receipt.result);return receipt.result;}});
  await c.store.openWarehouse();await c.store.submitStocktake([{drinkId:'milk',quantity:4}],'測試');assert.deepEqual(c.reads,['warehouse','warehouse']);assert.equal(c.store.data.drinks.find(x=>x.id==='milk').stock,4);assert.equal(c.store.stocktakeRefreshPending,false);
 }
});

test('unconfirmed writes never patch counts and a retry reuses its request without duplicate events',async()=>{
 const b=websiteBackend(),ids=[];let fail=true;
 const c=client(b,{submitWebsiteCommand:async(_url,command)=>{ids.push(command.requestId);const receipt=b.send(command.operation,command.data,command.requestId);if(fail){fail=false;const error=Error('pending');error.code='pending';throw error;}return receipt.result;}});
 await c.store.openWarehouse();const before=plain(c.store.data);await assert.rejects(c.store.submitStocktake([{drinkId:'milk',quantity:4}],'測試'),/pending/);assert.deepEqual(c.store.data,before);
 await c.store.submitStocktake([{drinkId:'milk',quantity:4}],'測試');assert.equal(ids[0],ids[1]);assert.equal(b.sheets.History.rows.filter(x=>x[0]===`website:${ids[0]}:milk`).length,1);assert.equal(c.store.data.drinks.find(x=>x.id==='milk').stock,4);
});

test('superseded receipts and reads cannot replace newer confirmed inventory',async()=>{
 const b=websiteBackend(),c=client(b);await c.store.openWarehouse();const id=randomUUID(),data={entries:[{drinkId:'milk',quantity:4}],recorder:'測試'},result=b.send('stocktake',data,id).result;
 c.store.snapshotAt=new Date(Date.parse(result.stocktake.snapshotAt)+1000).toISOString();const before=plain(c.store.data);
 assert.equal(c.store.applyStocktakeReceipt('stocktake',data,result,id),false);assert.deepEqual(c.store.data,before);
});

test('oversized count receipts fall back without violating the Sheets result-cell limit',()=>{
 const b=websiteBackend(),entries=[];
 for(let i=0;i<300;i++){const id=`test-${i}`;b.sheets.Catalog.rows.push([id,'虛構長品名'.repeat(12),'茶飲','鋁箔包','包',24,10,true]);entries.push({drinkId:id,quantity:i});}
 const receipt=b.send('stocktake',{entries,recorder:'測試'});assert.equal(receipt.state,'accepted');assert.equal(receipt.result.stocktake,undefined);assert.ok(JSON.stringify(receipt.result).length<40000);assert.equal(receipt.result.count,300);
});

test('鴻津玉米棒 uses whole bulk bags across backend, client and local migration without converting historical amounts',async()=>{
 const b=websiteBackend();b.ctx.ensureSupplyStorage_(b.ss);
 const item=['corn-stick','鴻津玉米棒','snack','條',true,'其他鹹食','原味'];b.sheets.SupplyCatalog.rows.push(item);b.sheets.SupplyCatalog.rows.push(['other-stick','其他玉米棒','snack','條',true,'其他鹹食','']);
 b.sheets.SupplyHistory.rows.push(['original-corn','2026-01-01T00:00:00Z','count','corn-stick','鴻津玉米棒',7,'原數量','原登記','採計','','']);
 const c=client(b);await c.store.openWarehouse();assert.equal(c.store.supplies.find(x=>x.id==='corn-stick').unit,'包');assert.match(snackPackHint(c.store.supplies.find(x=>x.id==='corn-stick')),/整個大包為 1 包/);assert.equal(c.store.supplies.find(x=>x.id==='other-stick').unit,'條');
 const old=plain(b.sheets.SupplyHistory.rows[1]);await c.store.submitSupplyStocktake([{supplyId:'corn-stick',quantity:5}],'測試');assert.equal(item[3],'包');assert.deepEqual(b.sheets.SupplyHistory.rows[1],old);assert.equal(c.store.supplies.find(x=>x.id==='corn-stick').stock,5);
 const data={supplies:[{id:'corn-stick',kind:'snack',name:'鴻津玉米棒',unit:'條',category:'其他鹹食',stock:7}],supplyEvents:[{id:'keep',quantity:7}]};const prepared=prepareSupplyCatalog(data);assert.equal(prepared.supplies.find(x=>x.id==='corn-stick').unit,'包');assert.equal(prepared.supplies.find(x=>x.id==='corn-stick').stock,7);assert.equal(prepared.supplyEvents,data.supplyEvents);
});

test('recovery returns the current server balance when another arrival followed an interrupted count',async()=>{
 const b=websiteBackend();let fail=true;const render=b.ctx.renderWarehouse_;
 b.ctx.renderWarehouse_=(...args)=>{if(fail){fail=false;throw Error('view interrupted');}return render(...args);};
 const c=client(b);await c.store.openWarehouse();await assert.rejects(c.store.submitStocktake([{drinkId:'milk',quantity:4}],'測試'),/view interrupted/);
 b.send('arrival',{drinkId:'milk',cases:0,loose:3,recorder:'稍後到貨'});
 await c.store.submitStocktake([{drinkId:'milk',quantity:4}],'測試');assert.equal(c.store.data.drinks.find(x=>x.id==='milk').stock,7);assert.equal(c.store.stocktakeRefreshPending,true);
});

const backendSource=await (await import('node:fs/promises')).readFile(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8');
const {default:vm}=await import('node:vm');
function actualDrinkView(b){
 vm.runInContext(backendSource.slice(backendSource.indexOf('function renderWarehouse_('),backendSource.indexOf('function renderArchive_(')),b.ctx);
 const chain=new Proxy({},{get:(_target,key)=>key==='build'?()=>({}):()=>chain});b.ctx.SpreadsheetApp.newConditionalFormatRule=()=>chain;
 b.sheets.Warehouse.setColumnWidth=()=>{};b.sheets.Warehouse.setConditionalFormatRules=()=>{};
}

test('ordinary counts preserve generated view headers and formats, use bounded history formatting and keep all commit flushes',()=>{
 const b=websiteBackend();actualDrinkView(b);b.ctx.renderWarehouse_(b.ss,b.ctx.computeInventory_(b.ctx.catalog_(b.ss),b.ctx.historyEvents_(b.ss)));
 b.ctx.ensureSupplyStorage_(b.ss);b.ctx.renderSupplyWarehouse_(b.ss);
 const warehouseHeader=plain(b.sheets.Warehouse.rows.slice(0,6)),supplyHeader=plain(b.sheets.SupplyWarehouse.rows[0]);
 b.sheets.Warehouse.clearContents=()=>{throw Error('unnecessary drink view clear');};b.sheets.SupplyWarehouse.clearContents=()=>{throw Error('unnecessary supply view clear');};b.ctx.websiteFormUrls_=()=>{throw Error('ordinary count does not need forms');};
 const formatRanges=[],history=b.sheets.SupplyHistory,range=history.getRange;
 history.getRange=(row,column,count,width)=>{const original=range(row,column,count,width);return new Proxy(original,{get:(target,key)=>key==='setNumberFormat'?()=>{formatRanges.push({row,column,count,width});return original;}:target[key]});};
 let flushes=0;b.ctx.SpreadsheetApp.flush=()=>{flushes++;};
 assert.equal(b.send('stocktake',{entries:[{drinkId:'milk',quantity:4}],recorder:'測試'}).state,'accepted');assert.equal(flushes,3);assert.deepEqual(plain(b.sheets.Warehouse.rows.slice(0,6)),warehouseHeader);
 flushes=0;assert.equal(b.send('supply-stocktake',{entries:[{supplyId:'supply-snack-01',quantity:4}],recorder:'測試'}).state,'accepted');assert.equal(flushes,3);assert.deepEqual(b.sheets.SupplyWarehouse.rows[0],supplyHeader);
 assert.deepEqual(formatRanges,[{row:2,column:10,count:1,width:2}]);assert.equal(b.sheets.History.rows.at(-1)[5],4);assert.equal(b.sheets.SupplyHistory.rows.at(-1)[5],4);
});

test('grouped history scans retain per-item same-time order and rejected drink-event behavior',()=>{
 const b=websiteBackend(),catalog=[{id:'a'},{id:'b'},{id:'unknown'}],supplies=catalog.map(item=>({...item,name:item.id,kind:'snack',unit:'包',active:true}));
 const rows=[{drinkId:'a',supplyId:'a',type:'restock',quantity:3,createdAt:'2026-01-02T00:00:00Z',accepted:true},{drinkId:'b',supplyId:'b',type:'count',quantity:5,createdAt:'2026-01-01T00:00:00Z',accepted:true},{drinkId:'a',supplyId:'a',type:'count',quantity:10,createdAt:'2026-01-01T00:00:00Z',accepted:true},{drinkId:'a',supplyId:'a',type:'count',quantity:8,createdAt:'2026-01-02T00:00:00Z',accepted:true},{drinkId:'a',supplyId:'a',type:'restock',quantity:2,createdAt:'2026-01-02T00:00:00Z',accepted:true},{drinkId:'b',supplyId:'b',type:'count',quantity:0,createdAt:'2026-01-03T00:00:00Z',accepted:false}];
 const drinks=plain(b.ctx.computeInventory_(catalog,rows));assert.equal(drinks[0].stock,10);assert.equal(drinks[0].receivedAfterCount,2);assert.equal(drinks[1].stock,5);assert.equal(drinks[2].stock,null);
 const supply=plain(b.ctx.supplyInventory_(supplies,rows.filter(row=>row.accepted)));assert.equal(supply[0].stock,10);assert.equal(supply[1].stock,5);assert.equal(supply[2].stock,null);
});

test('new corn-stick arrivals and catalog creation persist the same whole-bag unit and retry safely',()=>{
 for(const operation of ['new-arrival','snack-catalog-batch']){
  const b=websiteBackend(),requestId=randomUUID(),entry={name:'鴻津玉米棒',unit:'條',flavor:'',category:'其他鹹食'},data=operation==='new-arrival'?{...entry,kind:'snack',quantity:2,recorder:'測試'}:{entries:[entry],recorder:'測試'};
  const accepted=b.send(operation,data,requestId);assert.equal(accepted.state,'accepted');assert.deepEqual(b.send(operation,data,requestId),accepted);
  const item=b.sheets.SupplyCatalog.rows.find(row=>row[1]==='鴻津玉米棒');assert.equal(item[3],'包');assert.equal(b.sheets.SupplyCatalog.rows.filter(row=>row[1]==='鴻津玉米棒').length,1);
 }
});
