// Fictional Google backend only; no production inventory is written.
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
const base=`http://127.0.0.1:${server.address().port}`,endpoint='https://script.google.com/macros/s/RESTOCK_SPEED_BROWSER/exec',browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [1440,390]){
 const b=websiteBackend(),context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],posts=[],reads=[];
 const original=JSON.stringify({catalog:b.sheets.Catalog.rows,history:b.sheets.History.rows});
 let blocked=false,release,firstReceipt,start,firstPollMs;
 const commitGate=new Promise(resolve=>{release=resolve;});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  // Model a browser where iframe load hints and sandbox messages are unavailable.
  const add=HTMLIFrameElement.prototype.addEventListener;
  HTMLIFrameElement.prototype.addEventListener=function(type,...args){if(type==='load'&&this.name.startsWith('holdwin_write_'))return;return add.call(this,type,...args);};
 });
 await page.route('**/config.js*',r=>r.fulfill({contentType:'application/javascript',body:`window.DRINKS_CONFIG=${JSON.stringify({provider:'google',googleScriptUrl:endpoint})};`}));
 await page.route(endpoint+'**',async r=>{
  if(r.request().method()==='POST'){
   const parameter=Object.fromEntries(new URLSearchParams(r.request().postData()));posts.push(JSON.parse(parameter.payload));
   if(blocked)await commitGate;
   let body=b.ctx.doPost({parameter}).body;if(blocked)body=body.replace(/<script>[\s\S]*?<\/script>/,'');
   return r.fulfill({contentType:'text/html',body});
  }
  const parameter=Object.fromEntries(new URL(r.request().url()).searchParams);reads.push(parameter.action);
  const body=b.ctx.doGet({parameter}).body;
  await r.fulfill({contentType:'application/javascript',body});
  if(parameter.action==='receipt'&&firstReceipt){firstPollMs=Date.now()-start;firstReceipt();firstReceipt=null;}
 });
 await page.goto(base+'/#products');const row=page.locator('[data-stock-drink-id=milk]');await row.waitFor();
 await row.locator('[data-restock-toggle]').click();await page.locator('[name=restockName]').fill('速度測試');await page.locator('#restock-auth-form button[type=submit]').click();
 await page.waitForSelector('dialog[open]',{state:'hidden'});await page.waitForSelector('[data-stock-drink-id=milk] .warehouse-low');assert.equal(reads.filter(x=>x==='receipt').length,0,'direct receipt remains the fastest route');
 blocked=true;let deadline;
 const firstCheck=new Promise((resolve,reject)=>{firstReceipt=resolve;deadline=setTimeout(()=>reject(Error('restock fallback still waits instead of checking within 3 seconds')),3000);});
 start=Date.now();await row.locator('[data-restock-toggle]').click();await firstCheck;clearTimeout(deadline);
 assert.equal(await row.locator('.warehouse-low').count(),1,'an uncommitted cancellation leaves confirmed state marked');assert.equal(await row.locator('[data-restock-control]').getAttribute('aria-busy'),'true');assert.equal(b.ctx.restockPreferences_(b.ss)[0].mode,'consider');
 release();await page.waitForSelector('[data-stock-drink-id=milk] .warehouse-low',{state:'hidden'});await page.waitForFunction(()=>!document.querySelector('[data-restock-control][aria-busy=true]'));
 assert.equal(await row.locator('[data-restock-toggle]').isChecked(),false);assert.equal(b.ctx.restockPreferences_(b.ss)[0].mode,'normal');assert.equal(posts.length,2);assert.equal(posts[0].data.recorder,posts[1].data.recorder);assert.equal(reads.filter(x=>x==='warehouse').length,1,'confirmed marks do not reread all inventory');assert.equal(reads.filter(x=>x==='receipt').length,2);assert.deepEqual(errors,[]);assert.equal(JSON.stringify({catalog:b.sheets.Catalog.rows,history:b.sheets.History.rows}),original);
 await context.close();console.log(`PASS ${width}: direct message has zero reads; blocked hints start fallback in ${firstPollMs} ms; pending state waits for commit; no extra inventory read.`);
}}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
