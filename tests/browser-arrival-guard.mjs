// Every read/write below uses the in-memory Apps Script fixture.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { websiteBackend } from './helpers/google-website.mjs';
const {chromium}=await import(process.env.PANTRY_PLAYWRIGHT_MODULE||'playwright-core');
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try { const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html',path=resolve(root,name);
    if(!path.startsWith(root.replace(/\/$/,'')+sep))throw Error('not found');
    res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));
  } catch {res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,endpoint='https://script.google.com/macros/s/TEST_ARRIVAL_GUARD/exec';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {for(const width of [1440,390]){
  const b=websiteBackend(),posts=[],errors=[],dialogs=[];
  const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'}),page=await context.newPage();
  let accept=false;
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());if(accept)await dialog.accept();else await dialog.dismiss();});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(url.startsWith(endpoint)){
      const parameter=request.method()==='POST'?Object.fromEntries(new URLSearchParams(request.postData())):Object.fromEntries(new URL(url).searchParams);
      if(request.method()==='POST')posts.push(JSON.parse(parameter.payload));
      const output=request.method()==='POST'?b.ctx.doPost({parameter}):b.ctx.doGet({parameter});
      await route.fulfill({contentType:request.method()==='POST'?'text/html':'application/javascript',body:output.body});return;
    }
    if(url===base+'/config.js') {await route.fulfill({contentType:'application/javascript',body:`window.DRINKS_CONFIG=${JSON.stringify({provider:'google',googleScriptUrl:endpoint})};`});return;}
    if(!url.startsWith(base+'/')){await route.abort();return;}
    await route.continue();
  });
  const done=async()=>{await page.waitForFunction(()=>!document.querySelector('form[aria-busy=true]'));};
  const fill=async(cases,loose)=>{
    await page.locator('#restock-drink').selectOption('tea');
    await page.locator('#restock-form [name=recorder]').fill('虛構登記者');
    await page.locator('#restock-form [name=cases]').fill(cases);
    await page.locator('#restock-form [name=loose]').fill(loose);
  };
  const submit=async()=>{await page.locator('#restock-submit').click();await done();};
  await page.goto(base+'/#restock');await page.waitForSelector('#restock-form');
  assert.equal(await page.locator('#restock-form .form-grid input').first().getAttribute('name'),'loose');
  await fill('24','');
  assert.match(await page.locator('.arrival-quantity-warning').innerText(),/576 瓶.*3 箱/s);
  await submit();assert.equal(posts.length,0);assert.match(dialogs.at(-1),/24 箱 × 每箱 24 瓶.*576 瓶/s);
  assert.equal(await page.locator('#restock-form [name=cases]').inputValue(),'24');
  await page.screenshot({path:`/tmp/arrival-guard-${width}.png`,fullPage:true});
  await fill('','24');assert.equal(await page.locator('.arrival-quantity-warning').count(),0);
  await submit();assert.equal(posts.length,1);assert.equal(b.inventory()[0].stock,44);assert.equal(dialogs.length,1);
  await fill('3','');await submit();assert.equal(posts.length,2);assert.equal(dialogs.length,1);
  await fill('3','1');await submit();assert.equal(posts.length,2);assert.equal(dialogs.length,2);
  accept=true;await fill('4','');await submit();assert.equal(posts.length,3);assert.equal(b.inventory()[0].stock,212);
  // A unit-only batch still checks the combined total of repeated drink rows.
  await page.locator('[data-action=batch-arrival]').click();
  await page.locator('#batch-arrival-form [name=recorder]').fill('虛構批次登記者');
  let rows=page.locator('.batch-row');
  await rows.nth(0).locator('[data-batch-item]').selectOption('tea');
  assert.match(await rows.nth(0).locator('[data-batch-quantity-label]').innerText(),/瓶.*不是箱數/);
  await rows.nth(0).locator('[data-batch-quantity]').fill('40');
  await page.locator('[data-action=batch-add]').click();
  await rows.nth(1).locator('[data-batch-item]').selectOption('tea');
  await rows.nth(1).locator('[data-batch-quantity]').fill('40');
  accept=false;await page.locator('#batch-arrival-form [type=submit]').click();await done();
  assert.equal(posts.length,3);assert.match(dialogs.at(-1),/80 瓶/);assert.equal(await rows.count(),2);
  accept=true;await page.locator('#batch-arrival-form [type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#modal').open);await done();
  assert.equal(posts.length,4);assert.equal(posts.at(-1).operation,'batch-arrival');assert.equal(b.inventory()[0].stock,292);
  // No page-wide overflow after the longer unit explanation.
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}: unit labels, live warning, canceled writes preserve fields, 3-case boundary, large arrival confirmation, repeated batch totals`);
  await context.close();
}} finally {await browser.close();await new Promise(r=>server.close(r));}
