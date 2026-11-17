// All Google reads/writes use fictional in-memory data.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {websiteBackend} from './helpers/google-website.mjs';
const {chromium}=await import(process.env.PANTRY_PLAYWRIGHT_MODULE||'playwright-core');
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'};
const server=createServer(async(req,res)=>{try{
  const file=resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');
  if(!file.startsWith(root.replace(/\/$/,'')+sep))throw Error();
  res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,endpoint='https://script.google.com/macros/s/COFFEE_BROWSER/exec';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try {
 for(const width of [1440,390]) {
  const b=websiteBackend(),errors=[],posts=[];
  const connect=async({legacy=false,demo=false}={})=>{
   const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   if(!demo){
    await page.route('**/config.js*',r=>r.fulfill({contentType:'application/javascript',body:`window.DRINKS_CONFIG=${JSON.stringify({provider:'google',googleScriptUrl:endpoint})};`}));
    await page.route(endpoint+'**',r=>{
     if(r.request().method()==='POST'){const parameter=Object.fromEntries(new URLSearchParams(r.request().postData()));posts.push(JSON.parse(parameter.payload));return r.fulfill({contentType:'text/html',body:b.ctx.doPost({parameter}).body});}
     const parameter=Object.fromEntries(new URL(r.request().url()).searchParams);let body=b.ctx.doGet({parameter}).body;
     if(legacy)body=body.replace('"coffeeEntry":{"version":2}','"coffeeEntry":{"version":1}');return r.fulfill({contentType:'application/javascript',body});
    });
   }
   return {context,page};
  };
  const {context,page}=await connect();await page.goto(base+'/#restock');await page.waitForSelector('.restock-kind-tabs a[href="#restock-coffee"]');
  assert.deepEqual(await page.locator('.restock-kind-tabs a').allTextContents(),['飲料','零食','冰品','泡麵','咖啡豆','碳粉']);
  assert.equal(await page.locator('#navigation [data-view=coffee]').count(),0,'coffee is not a top-level navigation item');
  await page.locator('.restock-kind-tabs a[href="#restock-coffee"]').click();await page.waitForSelector('#coffee-receipt-form button:enabled');
  const form=()=>page.locator('#coffee-receipt-form');
  assert.equal(await form().locator('input[type=date]').count(),0,'entry date is generated on save');
  assert.equal(await page.locator('[data-coffee-latest-date]').innerText(),'尚無入庫紀錄');
  await form().locator('button').click();assert.equal(posts.length,0);
  const fill=async({brand='測試烘豆所',weight='0.5',bags='3'}={})=>{for(const [name,value] of Object.entries({brand,weight,bags,recorder:'測試同事'}))await form().locator(`[name=${name}]`).fill(value);};
  const done=async()=>{await page.waitForFunction(()=>!document.querySelector('iframe[name^=holdwin_write_]')&&!document.querySelector('form[aria-busy=true]'));};
  const save=async count=>{await form().locator('button[type=submit]').click();await page.waitForFunction(count=>document.querySelectorAll('[data-coffee-receipt]').length===count,count);await done();};
  assert.equal(await form().locator('[name=weight]').inputValue(),'0.5');assert.equal(await form().locator('[name=weight]').getAttribute('step'),'0.5');
  assert.match(await page.locator('#coffee-weight-note').innerText(),/半磅約 227 公克；1 磅約 454 公克/);
  await fill({weight:'0.25'});await form().locator('button').click();assert.equal(posts.length,0);
  await fill();assert.match(await page.locator('[data-coffee-total]').innerText(),/1.5 磅/);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('.restock-kind-tabs a[href="#restock-snack"]').click();await page.waitForURL('**/#restock-coffee');assert.equal(await form().locator('[name=brand]').inputValue(),'測試烘豆所');
  await save(1);assert.equal(await page.locator('[data-coffee-latest-weight]').innerText(),'1.5 磅');
  await fill({bags:'2'});await save(2);await fill({weight:'1',bags:'1'});await save(3);assert.equal(await page.locator('[data-coffee-latest-weight]').innerText(),'3.5 磅');
  assert.ok(posts.every(command=>!Object.hasOwn(command.data,'receivedOn')),'no manual dates are posted');
  const warehouse=async()=>{await page.locator('#navigation [data-view=products]').click();await page.waitForSelector('[data-action=warehouse-kind][data-id=coffee]');await page.locator('[data-action=warehouse-kind][data-id=coffee]').click();await page.waitForSelector('[data-coffee-item]');};
  await warehouse();assert.deepEqual(await page.locator('[data-action=warehouse-kind]').allTextContents(),['飲料','零食','冰品','泡麵','咖啡豆','碳粉']);assert.equal(await page.locator('[data-coffee-item]').count(),2);
  const halfId=await page.locator('[data-coffee-item]').filter({has:page.locator('td:nth-child(2)',{hasText:'0.5 磅'})}).getAttribute('data-coffee-item');
  const half=()=>page.locator(`[data-coffee-item="${halfId}"]`);
  assert.ok(await half().locator('[data-action=coffee-arrival]').isVisible());assert.equal(await half().locator('[data-coffee-stock]').innerText(),'5 包');assert.equal(await half().locator('[data-coffee-stock-weight]').innerText(),'2.5 磅');
  await half().locator('[data-action=coffee-arrival]').click();await page.waitForSelector('dialog #coffee-receipt-form');
  assert.equal(await form().locator('[name=brand]').getAttribute('readonly'),'');assert.equal(await form().locator('input[type=date]').count(),0);
  await form().locator('[name=bags]').fill('2');await form().locator('[name=recorder]').fill('快速入庫測試');await form().locator('button').click();await page.waitForSelector('dialog[open]',{state:'hidden'});await done();
  assert.equal(await half().locator('[data-coffee-stock]').innerText(),'7 包');assert.equal(await page.locator('[data-coffee-latest-weight]').innerText(),'4.5 磅');
  await half().locator('[data-action=coffee-count]').click();const countForm=page.locator('#coffee-stocktake-form');await countForm.locator('[name=bags]').fill('4');await countForm.locator('[name=recorder]').fill('盤點測試');await countForm.locator('button').click();await page.waitForSelector('dialog[open]',{state:'hidden'});await done();
  assert.equal(await half().locator('[data-coffee-stock]').innerText(),'4 包');assert.equal(await half().locator('[data-coffee-stock-weight]').innerText(),'2 磅');assert.equal(await page.locator('[data-coffee-latest-weight]').innerText(),'4.5 磅','counts do not change arrival summary');
  await page.locator('#toast').waitFor({state:'hidden',timeout:6500});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`/tmp/coffee-integrated-warehouse-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#navigation [data-view=restock]').click();await page.locator('.restock-kind-tabs a[href="#restock-coffee"]').click();await page.waitForSelector('#coffee-receipt-form');
  await page.locator('[data-action=batch-arrival]').click();await page.waitForSelector('[data-batch-coffee-brand]');
  await page.locator('[data-batch-coffee-brand]').fill('批次咖啡品牌');await page.locator('[data-batch-coffee-pounds]').fill('1');await page.locator('[data-batch-quantity]').fill('2');await page.locator('#batch-arrival-form [name=recorder]').fill('批次測試');
  await page.locator('[data-action=batch-add]').click();const second=page.locator('.batch-row').nth(1);await second.locator('[data-batch-kind]').selectOption('drink');await second.locator('[data-batch-item]').selectOption('tea');await second.locator('[data-batch-quantity]').fill('2');
  await page.locator('#batch-arrival-form button[type=submit]').click();await page.waitForSelector('dialog[open]',{state:'hidden'});await done();assert.equal(await page.locator('[data-coffee-latest-weight]').innerText(),'6.5 磅');
  await page.locator('#toast').waitFor({state:'hidden',timeout:6500});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`/tmp/coffee-integrated-arrival-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#navigation [data-view=history]').click();await page.waitForSelector('.history-number');assert.match(await page.locator('#main').innerText(),/咖啡豆 · 0.5 磅／包/);assert.match(await page.locator('#main').innerText(),/盤點測試/);
  const shared=await connect();await shared.page.goto(base+'/#products');await shared.page.waitForSelector('[data-action=warehouse-kind][data-id=coffee]');await shared.page.locator('[data-action=warehouse-kind][data-id=coffee]').click();await shared.page.waitForSelector('[data-coffee-item]');assert.equal(await shared.page.locator('[data-coffee-item]').count(),3);assert.match(await shared.page.locator(`[data-coffee-item="${halfId}"] [data-coffee-stock]`).innerText(),/4 包/);await shared.context.close();
  const old=await connect({legacy:true});await old.page.goto(base+'/#restock-coffee');await old.page.waitForSelector('#coffee-receipt-form');assert.equal(await old.page.locator('#coffee-receipt-form button').isDisabled(),true);assert.match(await old.page.locator('.info-box').innerText(),/更新原 Apps Script/);await old.context.close();
  const demo=await connect({demo:true});await demo.page.goto(base+'/demo.html#coffee');await demo.page.waitForSelector('#coffee-receipt-form button:enabled');assert.match(demo.page.url(),/#restock-coffee$/);
  for(const [name,value] of Object.entries({brand:'離線品牌',weight:'1.5',bags:'2',recorder:'離線測試'}))await demo.page.locator(`[name=${name}]`).fill(value);
  await demo.page.locator('#coffee-receipt-form button').click();await demo.page.waitForSelector('[data-coffee-receipt]');assert.equal(await demo.page.locator('[data-coffee-latest-weight]').innerText(),'3 磅');await demo.page.reload();await demo.page.waitForSelector('[data-coffee-receipt]');assert.equal(await demo.page.locator('[data-coffee-receipt]').count(),1);await demo.context.close();
  await context.close();assert.deepEqual(errors,[]);assert.equal(posts.length,6);assert.equal(posts.at(-1).operation,'batch-arrival');
  console.log(`PASS ${width}: coffee subtabs, no main navigation or date input, pounds, same-package stock, quick arrival, counts, mixed batches, shared state, history, old deployment and offline preview.`);
 }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
