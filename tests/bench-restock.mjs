// Fictional sheets only. Counts service operations, not real Google elapsed time.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {websiteBackend,memorySheet} from './helpers/google-website.mjs';
const sources=[...(process.env.PANTRY_BASELINE_CODE?[['before',await readFile(process.env.PANTRY_BASELINE_CODE,'utf8')]]:[]),['after',await readFile(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8')]];
const results={};
for(const [name,code] of sources)for(const kind of ['drink','snack','frozen','noodle','toner']){
 const b=websiteBackend(),required=b.ctx.requiredSpreadsheet_,forms=b.ctx.forms_;
 vm.runInContext(code,b.ctx);b.ctx.requiredSpreadsheet_=required;b.ctx.forms_=forms;b.ctx.locked_=work=>work();b.ctx.ensureSupplyStorage_(b.ss);
 b.sheets.SupplyCatalog.rows.push(['fixture-ice','虛構雪糕','frozen','支',true,'','']);
 const id=kind==='drink'?'milk':kind==='frozen'?'fixture-ice':kind==='toner'?'supply-toner-black':`supply-${kind}-01`;
 const headers=Array(11).fill('');headers[9]='狀態';
 b.sheets.Warehouse=memorySheet([[],[],[],[],[],headers,['milk','牛乳','','','包',24,9,'','', '',10]]);
 b.sheets.SupplyWarehouse=memorySheet([['品項 ID','品項名稱','分類','單位','目前庫存','最近實際盤點','保存期限','補貨標示'],[id,'虛構品項',kind,'',9,'','','']]);
 b.sheets.RestockPreferences=memorySheet([Array.from(b.ctx.RESTOCK_PREFERENCE_HEADERS)]);
 for(let i=0;i<2000;i++)b.sheets.RestockPreferences.rows.push([`fixture-${i}`,new Date(Date.UTC(2026,0,1)+i*60000).toISOString(),'drink','tea',i%2?'normal':'consider','測試','採計','測試人']);
 // Initialize the durable request journal before counting normal writes.
 b.send('wish',{kind:'snack',name:'虛構基線願望',note:'',url:''});
 const stats={reads:0,writes:0,formats:0,readCells:0,flushes:0};
 for(const sheet of Object.values(b.sheets)){
  const getRange=sheet.getRange;sheet.getRange=(...coords)=>{
   const range=getRange(...coords);let proxy;
   proxy=new Proxy(range,{get:(target,key)=>{
    const value=target[key];if(typeof value!=='function')return value;
    return (...args)=>{if(key==='getValues'){stats.reads++;stats.readCells+=(coords[2]||1)*(coords[3]||1);}else if(key==='setValues'||key==='setValue')stats.writes++;else if(String(key).startsWith('set'))stats.formats++;const result=value(...args);return result===range?proxy:result;};
   }});return proxy;
  };
 }
 b.ctx.SpreadsheetApp.flush=()=>{stats.flushes++;};
 const receipt=b.send('restock-preference',{kind,itemId:id,mode:'consider',expectedMode:'normal'});
 if(receipt.state!=='accepted')throw Error(JSON.stringify(receipt));
 results[`${name}-${kind}`]=stats;
}
console.log(JSON.stringify(results,null,2));
