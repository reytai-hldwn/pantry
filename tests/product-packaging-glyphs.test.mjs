import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalDrinkPackaging, createCompanyData, prepareCompanyCatalog } from '../js/catalog.js';
import { GoogleInventoryStore, normalizeGooglePublicData } from '../js/google-store.js';
import { websiteBackend } from './helpers/google-website.mjs';

const names=['午后時光重乳奶茶','義美寶吉葡萄汁','波蜜蜂蜜檸檬'];
test('the three confirmed cartons display their verified packaging without changing source quantities, identity or explicit alternatives',()=>{
  const b=websiteBackend();
  for(const [i,name]of names.entries())b.sheets.Catalog.rows.push(['confirmed-'+i,name,'其他','其他','包','',10,true]);
  const raw=JSON.parse(b.ctx.doGet({parameter:{action:'warehouse'}}).body),before=structuredClone(raw);
  const data=normalizeGooglePublicData(raw,{warehouse:true});
  for(const name of names){const source=before.drinks.find(d=>d.name===name),actual=data.data.drinks.find(d=>d.name===name);assert.equal(actual.packaging,'鋁箔包');assert.equal(actual.id,source.id);assert.equal(actual.stock,source.stock);assert.equal(actual.lastCountAt,source.lastCountAt);assert.equal(actual.unit,source.unit);}
  assert.deepEqual(raw,before);
  for(const name of names){assert.equal(canonicalDrinkPackaging('寶特瓶',name),'寶特瓶');assert.equal(canonicalDrinkPackaging('其他',name+'另一個規格'),'其他');}
  const local=createCompanyData();local.drinks.push({id:'local-carton',name:names[0],category:'其他',packaging:'其他',stock:8,lastCountAt:'2026-11-03T00:00:00Z',unit:'包',active:true});
  const next=prepareCompanyCatalog(local).drinks.find(d=>d.id==='local-carton');assert.equal(next.packaging,'鋁箔包');assert.equal(next.stock,8);assert.equal(local.drinks.at(-1).packaging,'其他');
});

const lemonTea = '貝思寶兒檸檬紅茶';
const oldSunMoonTea = '日月潭台茶十八號（450ml)';
const sunMoonTea = '日月潭台茶十八號';
const date = '2026-11-03T00:00:00Z';

test('confirmed tea corrections preserve source rows and stock across deployed and local catalogs', () => {
  const backend = websiteBackend();
  backend.sheets.Catalog.rows.push(
    ['lemon-tea', lemonTea, '茶飲', '其他', '瓶', 24, 10, true],
    ['lemon-tea-pet', lemonTea, '茶飲', '寶特瓶', '瓶', 24, 10, true],
    ['sun-moon-tea', oldSunMoonTea, '茶飲', '寶特瓶', '瓶', 24, 10, true],
  );
  backend.sheets.History.rows.push(['count-lemon', date, 'count', 'lemon-tea', 0, 8, '', '測試', '採計']);
  const source = structuredClone(backend.sheets.Catalog.rows);
  const data = JSON.parse(backend.ctx.doGet({ parameter: { action: 'warehouse' } }).body);
  const [first, second, sunMoon] = ['lemon-tea', 'lemon-tea-pet', 'sun-moon-tea'].map(id=>data.drinks.find(row=>row.id===id));
  for (const carton of [first,second]) {
    assert.equal(carton.packaging, '鋁箔包');
    assert.equal(carton.unit, '包');
  }
  assert.equal(sunMoon.name, oldSunMoonTea, 'the server still exposes the authoritative name for the guarded edit');
  assert.deepEqual(backend.sheets.Catalog.rows, source);
  // Model the older Apps Script response, including the two legacy packaging values.
  Object.assign(first, { packaging: '其他', unit: '瓶' });
  Object.assign(second, { packaging: '寶特瓶', unit: '瓶' });
  const before = structuredClone(data);
  for (const warehouse of [false, true]) {
    const result = normalizeGooglePublicData(data, { warehouse });
    for (const id of ['lemon-tea', 'lemon-tea-pet']) {
      const tea = result.data.drinks.find(item=>item.id===id);
      assert.equal(tea.packaging, '鋁箔包');
      assert.equal(tea.unit, '包');
      assert.equal(tea.category, '茶飲');
      if (warehouse && id==='lemon-tea') assert.equal(tea.stock, 8);
    }
    assert.equal(result.data.drinks.find(item=>item.id==='sun-moon-tea').name, sunMoonTea);
    assert.ok(!warehouse || result.data.events.some(event=>event.drinkId==='lemon-tea' && event.quantity===8));
  }
  assert.deepEqual(data, before);
  const local = createCompanyData();
  const originalLocal = structuredClone(local);
  local.drinks.push(first, second, {...sunMoon, name:'日月潭台茶十八號（450ml）'});
  const prepared = prepareCompanyCatalog(local);
  assert.equal(prepared.drinks.find(item=>item.id==='lemon-tea-pet').packaging, '鋁箔包');
  assert.equal(prepared.drinks.find(item=>item.id==='lemon-tea').unit, '包');
  assert.equal(prepared.drinks.find(item=>item.id==='lemon-tea').stock, 8);
  assert.equal(prepared.drinks.find(item=>item.id==='sun-moon-tea').name, sunMoonTea);
  assert.equal(first.unit, '瓶');
  assert.deepEqual(prepared.drinks.slice(0, originalLocal.drinks.length), originalLocal.drinks);
});

test('legacy aggregate responses display the verified tea name and unit without altering their rates or quantities', async () => {
  const endpoint = 'https://script.google.com/macros/s/PACKAGING_TEST/exec';
  const [lemon, sunMoon] = [
    { id: 'lemon-tea', name: lemonTea, unit: '瓶', stock: 5, kind: 'drink', mode: 'consider' },
    { id: 'sun-moon-tea', name: oldSunMoonTea, unit: '瓶', stock: 0, kind: 'drink', mode: 'consider' },
  ];
  const result = {
    ok:true, version:1, totalDrinks:2, pendingWishes:0, lowItems:[lemon], outOfStockItems:[sunMoon],
    restockItems:[lemon,sunMoon], inventoryTotalsVersion:1,
    inventoryTotals:['drink','snack','noodle','toner'].map(kind=>({
      kind, unknownCount:0, items:kind==='drink'?[{...lemon,flavor:'',active:true}]:[],
    })),
    recentArrivals:[{...lemon,id:'arrival',itemId:lemon.id,quantity:2,createdAt:date,type:'restock'}],
    recentCounts:[{kind:'drink',countedAt:date,items:[{...sunMoon,id:'count',itemId:sunMoon.id,quantity:0,createdAt:date,type:'count'}]}],
  };
  const popularity = {ok:true,version:3,popularity:{
    countedProducts:2,observedProducts:2,workweekDays:5,windowDays:30,windowStartAt:'2026-10-04T00:00:00Z',windowEndAt:date,calculatedAt:date,
    rows:[lemon,sunMoon].map(({id,name,unit})=>({id,name,unit,weeklyRate:3.5,days:3,samples:1})),
  }};
  const store = new GoogleInventoryStore({googleScriptUrl:endpoint},{readPublicData:async(_url,{action})=>action==='admin'?result:popularity});
  store.popularityVersion = 3;
  const [summary, ranking] = await Promise.all([store.readAdminSummary(),store.readPopularity()]);
  assert.deepEqual(summary.lowItems.map(row=>[row.id,row.unit,row.stock]), [[lemon.id,'包',5]]);
  assert.equal(summary.outOfStockItems[0].name, sunMoonTea);
  assert.equal(summary.restockItems[0].unit, '包');
  assert.equal(summary.inventoryTotals[0].items[0].unit, '包');
  assert.equal(summary.recentArrivals[0].unit, '包');
  assert.equal(summary.recentArrivals[0].quantity, 2);
  assert.equal(summary.recentCounts[0].items[0].name, sunMoonTea);
  assert.deepEqual(ranking.rows.map(row=>[row.id,row.name,row.unit,row.weeklyRate]), [[lemon.id,lemonTea,'包',3.5],[sunMoon.id,sunMoonTea,'瓶',3.5]]);
});

test('product-character fallback is small, precedes the UI subset and is embedded in offline previews',async()=>{
  const root=new URL('../',import.meta.url),font=await readFile(new URL('assets/pantry-product-characters.woff2',root));
  assert.equal(font.subarray(0,4).toString(),'wOF2');assert.ok(font.length<16000);
  const css=await readFile(new URL('pantry.css',root),'utf8'),builder=await readFile(new URL('scripts/build-demo.mjs',root),'utf8');
  assert.ok(css.includes('--heading-font:"Pantry Product Characters","Pantry Hand","Pantry Hand Complete",serif'));
  for(const code of ['5409','540E','601D','723E'])assert.ok(css.includes('U+'+code));
  assert.ok(builder.includes("{ src: './assets/pantry-product-characters.woff2' }"));
});
