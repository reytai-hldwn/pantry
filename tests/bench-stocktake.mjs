// Counts Sheets read/write/format calls on fictional data; no production writes.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {websiteBackend} from './helpers/google-website.mjs';
const after=await readFile(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8');
const sources=process.env.PANTRY_BASELINE_CODE?[['before',await readFile(process.env.PANTRY_BASELINE_CODE,'utf8')],['after',after]]:[['after',after]];
function setup(source){
 const b=websiteBackend(),required=b.ctx.requiredSpreadsheet_,forms=b.ctx.forms_;vm.runInContext(source,b.ctx);b.ctx.requiredSpreadsheet_=required;b.ctx.forms_=forms;b.ctx.locked_=work=>work();
 const chain=new Proxy({},{get:(_target,key)=>key==='build'?()=>({}):()=>chain});b.ctx.SpreadsheetApp.newConditionalFormatRule=()=>chain;
 for(const sheet of Object.values(b.sheets)){sheet.setConditionalFormatRules=()=>{};sheet.setColumnWidth=()=>{};}
 b.ctx.ensureSupplyStorage_(b.ss);
 for(let i=0;i<2000;i++)b.sheets.SupplyHistory.rows.push([`fixture-${i}`,new Date(Date.UTC(2026,0,1)+i*60000).toISOString(),'count','supply-snack-01','虛構零食',20,'','測試','採計','','']);
 b.ctx.renderWarehouse_(b.ss,b.ctx.computeInventory_(b.ctx.catalog_(b.ss),b.ctx.historyEvents_(b.ss)));b.ctx.renderSupplyWarehouse_(b.ss);
 b.send('wish',{kind:'snack',name:'計量用虛構願望',note:'',url:''});
 const stats={operations:0,reads:0,writes:0,formats:0,formatCells:0,clears:0};
 for(const sheet of Object.values(b.sheets)){
  const range=sheet.getRange;sheet.getRange=(...coordinates)=>{const original=range(...coordinates);let proxy;proxy=new Proxy(original,{get:(target,key)=>{
   const method=target[key];if(typeof method!=='function')return method;return (...args)=>{
    if(key==='getValues'){stats.operations++;stats.reads++;}else if(key==='setValues'||key==='setValue'||key==='setFormula'){stats.operations++;stats.writes++;}else if(String(key).startsWith('set')){stats.operations++;stats.formats++;if(key==='setNumberFormat')stats.formatCells+=(coordinates[2]||1)*(coordinates[3]||1);}
    const value=method(...args);return value===original?proxy:value;
   };
  }});return proxy;};
  for(const key of ['clearContents','setFrozenRows','setColumnWidth','setConditionalFormatRules']){const original=sheet[key]||(()=>{});sheet[key]=(...args)=>{stats.operations++;if(key==='clearContents')stats.clears++;else stats.formats++;return original(...args);};}
 }
 return {b,stats};
}
const result={};
for(const [name,source]of sources)for(const kind of ['drink','supply']){
 const {b,stats}=setup(source);const receipt=kind==='drink'?b.send('stocktake',{entries:[{drinkId:'milk',quantity:4}],recorder:'測試'}):b.send('supply-stocktake',{entries:[{supplyId:'supply-snack-01',quantity:4}],recorder:'測試'});
 if(receipt.state!=='accepted')throw Error(JSON.stringify(receipt));result[`${name}-${kind}`]=stats;
}
console.log(JSON.stringify(result,null,2));
