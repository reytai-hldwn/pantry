// All service traffic uses fictional in-memory data, never the real spreadsheet.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {websiteBackend} from './helpers/google-website.mjs';
const {chromium}=await import(process.env.PANTRY_PLAYWRIGHT_MODULE||'playwright-core');
const root=fileURLToPath(new URL('../',import.meta.url)),mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');if(!path.startsWith(root.replace(/\/$/,'')+sep))throw Error();res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,endpoint='https://script.google.com/macros/s/TEST_FROZEN_BROWSER/exec';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [1440,390]){
 const b=websiteBackend();b.props.set('HOLDWIN_RESTOCK_PIN','8642');
 const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'}),page=await context.newPage(),posts=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const r=route.request(),url=r.url();
  if(url.startsWith(endpoint)){
   const parameter=r.method()==='POST'?Object.fromEntries(new URLSearchParams(r.postData())):Object.fromEntries(new URL(url).searchParams);
   if(r.method()==='POST')posts.push(JSON.parse(parameter.payload));
   const output=r.method()==='POST'?b.ctx.doPost({parameter}):b.ctx.doGet({parameter});
   await route.fulfill({contentType:r.method()==='POST'?'text/html':'application/javascript',body:output.body});return;
  }
  if(url===base+'/config.js'){await route.fulfill({contentType:'application/javascript',body:`window.DRINKS_CONFIG=${JSON.stringify({provider:'google',googleScriptUrl:endpoint})};`});return;}
  if(!url.startsWith(base+'/')){await route.abort();return;}await route.continue();
 });
 const done=async()=>{await page.waitForFunction(()=>!document.querySelector('form[aria-busy=true]'));};
 const go=async view=>{await page.evaluate(v=>location.hash=v,view);try{await page.waitForFunction(v=>document.body.dataset.view===v,view,{timeout:10000});}catch(e){console.log(JSON.stringify({destination:view,url:page.url(),state:await page.evaluate(()=>({view:document.body.dataset.view,toast:document.querySelector('#toast')?.innerText,main:document.querySelector('#main')?.innerText.slice(0,900)})),errors,posts:posts.map(p=>p.operation)}));throw e;}};
 const frozenWarehouse=async()=>{await go('products');await page.locator('[data-action=warehouse-kind][data-id=frozen]').click();};
 const itemRow=id=>page.locator(`[data-supply-id="${id}"]`);
 await page.goto(base+'/#products');await page.waitForSelector('[data-action=warehouse-kind]');
 assert.equal(await page.locator('[data-action=warehouse-kind]').count(),5);
 await page.locator('[data-action=warehouse-kind][data-id=frozen]').click();
 await page.locator('a.button[href="#restock-frozen"]').click();
 await page.waitForSelector('#supply-restock-form[data-kind=frozen]');
 assert.equal(await page.locator('.restock-kind-tabs a').count(),5);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.equal(await page.locator('#supply-restock-form [name=expiresOn]').count(),0);
 await page.locator('#supply-restock-form [name=recorder]').fill('虛構冰品登記者');
 await page.locator('#supply-restock-form [name=newName]').fill('虛構香草雪糕');
 await page.locator('#supply-restock-form [name=newUnit]').selectOption('支');
 await page.locator('#supply-restock-form [name=quantity]').fill('12');
 await page.locator('#supply-restock-form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});await done();
 assert.equal(posts.length,1);const ice=b.ctx.supplyCatalog_(b.ss).find(i=>i.name==='虛構香草雪糕');assert.ok(ice);
 assert.equal(b.ctx.supplyEvents_(b.ss).filter(e=>e.supplyId===ice.id&&e.type==='count').length,0);
 assert.equal(await page.locator('[data-recent-arrivals] .order-card').count(),1);
 await frozenWarehouse();await itemRow(ice.id).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`/tmp/frozen-warehouse-${width}.png`,fullPage:true});assert.match(await itemRow(ice.id).locator('.stock-value').innerText(),/12/);
 await itemRow(ice.id).locator('[data-restock-toggle]').click();await page.waitForSelector('#restock-auth-form');
 await page.locator('[name=restockCode]').fill('8642');await page.locator('#restock-auth-form [type=submit]').click();
 await page.waitForFunction(()=>!document.querySelector('#modal').open);await done();
 assert.equal(await itemRow(ice.id).locator('[data-restock-toggle]').isChecked(),true);
 await go('count');await page.locator('[data-action=count-kind][data-id=frozen]').click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const count=page.locator(`[data-count-item="${ice.id}"]`);assert.match(await count.innerText(),/冰品/);assert.match(await count.locator('.supply-count-avatar').innerText(),/❄/);
 await page.locator('#supply-count-form [name=recorder]').fill('虛構盤點者');await count.locator('[data-supply-count]').fill('0');
 await page.locator('#supply-count-form [type=submit]').click();await done();
 await frozenWarehouse();assert.equal(await itemRow(ice.id).count(),0);
 await page.locator('[data-action=supply-stock-filter][data-id=archived]').click();await itemRow(ice.id).waitFor();assert.match(await itemRow(ice.id).locator('.stock-value').innerText(),/0/);
 await itemRow(ice.id).locator('[data-action=supply-arrival]').click();
 assert.equal(await page.locator('#supply-arrival-form [name=expiresOn]').count(),0);
 await page.locator('#supply-arrival-form [name=recorder]').fill('虛構回購者');await page.locator('#supply-arrival-form [name=quantity]').fill('4');
 await page.locator('#supply-arrival-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);await done();
 await page.locator('[data-action=supply-stock-filter][data-id=all]').click();await itemRow(ice.id).waitFor();assert.match(await itemRow(ice.id).locator('.stock-value').innerText(),/4/);
 await go('restock-frozen');await page.locator('[data-action=batch-arrival]').click();
 await page.locator('#batch-arrival-form [name=recorder]').fill('虛構批次登記者');
 const rows=page.locator('.batch-row');await rows.nth(0).locator('[data-batch-item]').selectOption('__new__');
 await rows.nth(0).locator('[data-batch-name]').fill('虛構草莓冰淇淋');await rows.nth(0).locator('[data-batch-unit]').selectOption('杯');
 assert.match(await rows.nth(0).locator('[data-batch-quantity-label]').innerText(),/杯/);await rows.nth(0).locator('[data-batch-quantity]').fill('3');
 await page.locator('[data-action=batch-add]').click();await rows.nth(1).locator('[data-batch-item]').selectOption(ice.id);await rows.nth(1).locator('[data-batch-quantity]').fill('2');
 await page.locator('#batch-arrival-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);await done();
 assert.equal(posts.filter(p=>p.operation==='batch-arrival').length,1);
 await go('admin');await page.waitForSelector('[data-inventory-total=frozen]');
 const totals=page.locator('[data-inventory-total=frozen]');assert.match(await totals.innerText(),/2 項.*6 支.*3 杯/s);
 await totals.locator('summary').click();assert.match(await totals.innerText(),/虛構香草雪糕/);assert.match(await totals.innerText(),/虛構草莓冰淇淋/);
 assert.equal(await page.locator('.count-activity').count(),5);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:`/tmp/frozen-inventory-${width}.png`,fullPage:true});
 assert.deepEqual(errors,[]);await context.close();
 // An existing deployment exposes the tab with an update message and no writable ice form.
 const legacy=websiteBackend(),old=await browser.newContext({viewport:{width,height:960}}),p=await old.newPage();
 await p.route('**/config.js',r=>r.fulfill({contentType:'application/javascript',body:`window.DRINKS_CONFIG=${JSON.stringify({provider:'google',googleScriptUrl:endpoint})};`}));
 await p.route(endpoint+'**',r=>{assert.equal(r.request().method(),'GET');const parameter=Object.fromEntries(new URL(r.request().url()).searchParams);return r.fulfill({contentType:'application/javascript',body:legacy.ctx.doGet({parameter}).body.replace(/,"frozenVersion":1/g,'')});});
 await p.goto(base+'/#restock-frozen');await p.waitForSelector('.supply-upgrade');assert.match(await p.locator('.supply-upgrade').innerText(),/冰品/);assert.equal(await p.locator('#supply-restock-form').count(),0);await old.close();
 console.log(`PASS ${width}: frozen creation, count, zero archive, repurchase, protected restock, mixed batch, unit totals, legacy upgrade and no overflow`);
}}finally{await browser.close();await new Promise(r=>server.close(r));}
