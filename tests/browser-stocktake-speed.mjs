// Fictional Google Sheets only; real production inventory is never written.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {websiteBackend} from './helpers/google-website.mjs';
const {chromium}=await import(process.env.PANTRY_PLAYWRIGHT_MODULE||'playwright-core');
const root=fileURLToPath(new URL('../',import.meta.url)),mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'};
const server=createServer(async(req,res)=>{try{const file=resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');if(!file.startsWith(root.replace(/\/$/,'')+sep))throw Error();res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,endpoint='https://script.google.com/macros/s/COUNT_SPEED_BROWSER/exec',browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [1440,390]){
 const b=websiteBackend();b.ctx.ensureSupplyStorage_(b.ss);b.sheets.SupplyCatalog.rows.push(['corn-stick','鴻津玉米棒','snack','條',true,'其他鹹食','']);b.send('coffee-receipt',{brand:'虛構咖啡',poundsPerBag:0.5,bags:5,recorder:'虛構入庫'});
 b.sheets.SupplyHistory.rows.push(['baseline-corn','2020-01-01T18:34:00Z','count','corn-stick','鴻津玉米棒',5,'原紀錄','測試','採計','','']);
 b.sheets.SupplyCatalog.rows.push(['fixture-ice','虛構冰品','frozen','支',true,'','']);
 const supplies = [['frozen','fixture-ice'],['noodle','supply-noodle-01'],['toner','supply-toner-black']];
 for (const [,id] of supplies) b.sheets.SupplyHistory.rows.push([`baseline-${id}`,'2020-01-01T18:34:00Z','count',id,'虛構品項',6,'原紀錄','測試','採計','','']);
 b.send('arrival',{drinkId:'milk',cases:0,loose:2,recorder:'虛構入庫'});
 b.send('supply-arrival',{supplyId:'corn-stick',quantity:2,recorder:'虛構入庫'});
 b.send('supply-arrival',{supplyId:'supply-snack-01',quantity:3,recorder:'虛構入庫'});
 const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],posts=[],timings={};let hold=false,release=null,started=null;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/config.js*',r=>r.fulfill({contentType:'application/javascript',body:`window.DRINKS_CONFIG=${JSON.stringify({provider:'google',googleScriptUrl:endpoint})};`}));
 await page.route(endpoint+'**',async r=>{
  if(r.request().method()==='POST'){const parameter=Object.fromEntries(new URLSearchParams(r.request().postData()));posts.push(JSON.parse(parameter.payload));return r.fulfill({contentType:'text/html',body:b.ctx.doPost({parameter}).body});}
  const parameter=Object.fromEntries(new URL(r.request().url()).searchParams),body=b.ctx.doGet({parameter}).body;
  if(parameter.action==='warehouse'&&hold){await new Promise(resolve=>{release=resolve;started?.();});}
  return r.fulfill({contentType:'application/javascript',body});
 });
 const gate=()=>{hold=true;return new Promise(resolve=>{started=resolve;});};
 const finish=async()=>{hold=false;release?.();release=null;await page.waitForFunction(()=>!document.querySelector('#refresh-button[aria-busy=true]'));};
 const countPage=async()=>{hold=false;await page.goto(base+'/#count');await page.waitForSelector('#count-form [name=milk]');};
 await countPage();
 for(const kind of ['drink','snack']){
  if(kind==='snack'){await page.reload();await page.waitForSelector('[data-action=count-kind][data-id=snack]');await page.locator('[data-action=count-kind][data-id=snack]').click();await page.waitForSelector('[data-supply-count][name=corn-stick]');assert.match(await page.locator('[data-count-item="corn-stick"]').innerText(),/以單條登記/);assert.equal(await page.locator('[data-count-item="corn-stick"] .count-unit').innerText(),'條');}
  const form=page.locator(kind==='drink'?'#count-form':'#supply-count-form'),field=form.locator(kind==='drink'?'[name=milk]':'[data-supply-count][name=corn-stick]');
  const stockCell = field.locator('xpath=ancestor::tr/td[2]');
  const priorTime = stockCell.locator('time');
  assert.equal(await stockCell.locator('.muted').innerText(),kind==='drink'?'11 包':'尚未確認');
  if(kind==='drink')assert.equal(await priorTime.innerText(),'2020/01/01 08:00','shows the previous actual count in Taipei time after later arrivals');
  else assert.equal(await priorTime.count(),0,'bag counts do not establish stick inventory');
  if(kind==='snack'){
   const arrivalOnly = form.locator('[data-count-item="supply-snack-01"] .supply-count-stock');
   assert.equal(await arrivalOnly.locator('.muted').innerText(),'3 包');
   assert.match(await arrivalOnly.locator('.count-last-time').innerText(),/尚未實際盤點/);
   assert.equal(await arrivalOnly.locator('time').count(),0);
   assert.equal(await form.locator('[data-count-item="supply-snack-02"] .count-last-time').innerText(),'尚未盤點');
  }
  await form.locator('[name=recorder]').fill('速度測試');await field.fill('4');const reading=gate(),start=Date.now();await form.locator('button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('form[aria-busy=true]')&&/已完成|已保存/.test(document.querySelector('#toast').innerText),{},{timeout:4000});timings[kind]=Date.now()-start;
  assert.equal(await stockCell.locator('.muted').innerText(),kind==='drink'?'4 包':'4 條');
  assert.doesNotMatch(await priorTime.getAttribute('datetime'),/^2020-/,'a saved count immediately updates the time');
  await reading;assert.ok(release,'full history read is still held after success feedback');await field.fill('17');await finish();await page.waitForTimeout(150);assert.equal(await field.inputValue(),'17','background synchronization preserves the next unsaved count');
  assert.equal(posts.at(-1).data.entries[0].quantity,4);assert.equal(posts.filter(row=>row.operation===(kind==='drink'?'stocktake':'supply-stocktake')).length,1);
 }
 await page.reload();await page.waitForSelector('#supply-count-form,#count-form');
 for (const [kind,id] of supplies) {
  await page.locator(`[data-action=count-kind][data-id=${kind}]`).click();
  assert.equal(await page.locator(`[data-count-item="${id}"] .supply-count-stock time`).innerText(),'2020/01/02 02:34');
 }
 await page.locator('#navigation [data-view=products]').click();await page.waitForSelector('[data-action=warehouse-kind][data-id=coffee]');await page.locator('[data-action=warehouse-kind][data-id=coffee]').click();await page.locator('[data-action=coffee-count]').click();
 const coffee=page.locator('#coffee-stocktake-form');await coffee.locator('[name=recorder]').fill('速度測試');await coffee.locator('[name=bags]').fill('2');const reading=gate(),start=Date.now();await coffee.locator('button[type=submit]').click();await page.waitForSelector('dialog[open]',{state:'hidden',timeout:4000});timings.coffee=Date.now()-start;await reading;assert.ok(release);assert.equal(await page.locator('[data-coffee-stock]').innerText(),'2 包');await finish();
 assert.equal(b.sheets.SupplyCatalog.rows.find(row=>row[0]==='corn-stick')[3],'條');assert.deepEqual(errors,[]);
 console.log(`PASS ${width}: confirmed counts finish before held full reads; new input survives synchronization; single-stick unit is correct. Mock feedback ms: ${JSON.stringify(timings)}`);
 hold=false;release?.();await context.close();
}}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
