import { escapeHtml } from './domain.js';

export function coffeeToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

export const coffeeKey = item => `${item.brand.trim().normalize('NFKC').toLowerCase()}\u0000${item.poundsPerBag}`;
export const coffeeWeight = pounds => `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(pounds)} 磅`;

export function coffeePounds(weight) {
  const pounds = Number(weight);
  if (!Number.isSafeInteger(pounds * 2) || pounds < 0.5 || pounds > 9999) throw new Error('請填寫有效磅數，以半磅（0.5 磅）為單位。');
  return pounds;
}

export function coffeeReceiptInput(data, { count = false } = {}) {
  const brand = typeof data?.brand === 'string' ? data.brand.trim() : '';
  const recorder = typeof data?.recorder === 'string' ? data.recorder.trim() : '';
  if (!brand || brand.length > 80 || /[\u0000-\u001f\u007f]/.test(brand)) throw new Error('請填寫咖啡豆品牌，最多 80 字。');
  if (typeof data.poundsPerBag !== 'number') throw new Error('每包重量請以磅登記。');
  coffeePounds(data.poundsPerBag);
  if (!Number.isSafeInteger(data.bags) || data.bags < (count ? 0 : 1) || data.bags > (count ? 999999 : 9999)) throw new Error(count ? '盤點包數須為 0 到 999999 的整數。' : '請填寫 1 到 9999 的整數包數。');
  if (!recorder || recorder.length > 80 || /[\u0000-\u001f\u007f]/.test(recorder)) throw new Error('請填寫登記人，最多 80 字。');
  return { brand, poundsPerBag: data.poundsPerBag, bags: data.bags, recorder };
}

export function normalizeCoffeeReceipts(rows) {
  if (!Array.isArray(rows) || rows.length > 100000) throw new Error('咖啡豆入庫紀錄格式不正確。');
  const ids = new Set();
  return rows.map(row => {
    const type = row.type || 'restock';
    if (!['count', 'restock'].includes(type)) throw new Error('咖啡豆紀錄類型不正確。');
    const data = coffeeReceiptInput(row, { count: type === 'count' });
    if (typeof row.id !== 'string' || !row.id || row.id.length > 160 || ids.has(row.id) ||
        typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw new Error('咖啡豆入庫紀錄格式不正確。');
    ids.add(row.id);
    return { ...data, id: row.id, createdAt: row.createdAt, type, receivedOn: coffeeToday(row.createdAt) };
  });
}

/** Brand and per-bag pounds identify a package. Counts replace the bag balance. */
export function coffeeInventory(rows) {
  const items = new Map();
  const ordered = rows.map((row, index) => ({ row, index })).sort((a,b) => Date.parse(a.row.createdAt)-Date.parse(b.row.createdAt)||a.index-b.index);
  for (const {row} of ordered) {
    const key = coffeeKey(row);
    const item = items.get(key) || { id: row.id, brand: row.brand, name: row.brand, poundsPerBag: row.poundsPerBag, kind: 'coffee', unit: '包', stock: 0, lastCountAt: null, lastArrivalAt: null };
    if (row.type === 'count') { item.stock = row.bags; item.lastCountAt = row.createdAt; }
    else { item.stock += row.bags; item.lastArrivalAt = row.createdAt; }
    if (!Number.isSafeInteger(item.stock) || item.stock > 999999) throw new Error('咖啡豆累計庫存不可超過 999999 包。');
    items.set(key, item);
  }
  return [...items.values()];
}

export function coffeeStockEvents(rows) {
  const items = coffeeInventory(rows);
  return rows.map(row => ({ id: row.id, coffeeId: items.find(item => coffeeKey(item) === coffeeKey(row)).id, type: row.type || 'restock', quantity: row.bags, createdAt: row.createdAt, recorder: row.recorder, note: `咖啡豆 · ${coffeeWeight(row.poundsPerBag)}／包 · 合計 ${coffeeWeight(row.poundsPerBag * row.bags)}` }));
}

export function latestCoffeeReceipt(rows) {
  const arrivals = rows.filter(row => row.type !== 'count');
  if (!arrivals.length) return null;
  const receivedOn = arrivals.reduce((latest, row) => coffeeToday(row.createdAt) > latest ? coffeeToday(row.createdAt) : latest, '');
  const receipts = arrivals.filter(row => coffeeToday(row.createdAt) === receivedOn);
  return { receivedOn, totalPounds: receipts.reduce((sum, row) => sum + row.poundsPerBag * row.bags, 0),
    bags: receipts.reduce((sum, row) => sum + row.bags, 0), brands: [...new Set(receipts.map(row => row.brand))], receipts };
}

const coffeeEntryNotice = enabled => enabled ? '' : '<div class="info-box" role="status">咖啡豆共用入庫需先更新原 Apps Script 部署。<a href="https://github.com/reytai-hldwn/pantry/blob/main/docs/COFFEE-SETUP.md" target="_blank" rel="noopener noreferrer">查看更新步驟 ↗</a></div>';
const coffeeConversionNote = '以半磅（0.5 磅）為單位。半磅約 227 公克；1 磅約 454 公克。';

export function renderCoffeeSummary(rows) {
  const latest = latestCoffeeReceipt(rows), e = escapeHtml;
  return `<section class="coffee-summary" aria-label="最近入庫摘要"><div class="coffee-summary-mark" aria-hidden="true">☕</div><div><p class="coffee-summary-label">最近入庫日期</p><strong data-coffee-latest-date>${latest ? e(latest.receivedOn.replaceAll('-', ' / ')) : '尚無入庫紀錄'}</strong><p class="subtle">${latest ? e(latest.brands.join('、')) : '第一次入庫後，這裡就會顯示最近補給。'}</p></div><div class="coffee-summary-weight"><p class="coffee-summary-label">最近入庫日總重量（磅）</p><strong data-coffee-latest-weight>${latest ? e(coffeeWeight(latest.totalPounds)) : '—'}</strong><p class="subtle">${latest ? `共 ${latest.bags} 包 · ${latest.receipts.length} 筆入庫` : '每包磅數 × 包數，自動加總'}</p></div></section><p class="subtle coffee-summary-note">同一天的咖啡豆入庫會合併計算總磅數；庫存依入庫及實際盤點更新。</p>`;
}

export function coffeeFormFields({ rows = [], item = null, count = false, enabled = true } = {}) {
  const e = escapeHtml, brands = [...new Set(rows.map(row => row.brand))];
  return `<fieldset class="arrival-fields"${enabled ? '' : ' disabled'}><label class="field">品牌<input name="brand" list="coffee-brands" required maxlength="80" placeholder="輸入咖啡豆品牌" autocomplete="off" value="${e(item?.brand || '')}"${item ? ' readonly' : ''}></label><datalist id="coffee-brands">${brands.map(brand => `<option value="${e(brand)}"></option>`).join('')}</datalist><div class="form-grid"><label class="field">每包重量（磅）<input name="weight" type="number" inputmode="decimal" required min="0.5" max="9999" step="0.5" value="${item?.poundsPerBag || 0.5}" aria-describedby="coffee-weight-note"${item ? ' readonly' : ''}></label><label class="field">${count ? '實際剩餘包數' : '本次入庫包數'}<input name="bags" type="number" inputmode="numeric" required min="${count ? 0 : 1}" max="${count ? 999999 : 9999}" step="1" placeholder="${count ? '已用完填 0' : '例如：2'}"></label></div><p class="subtle" id="coffee-weight-note">${coffeeConversionNote}</p><div class="order-summary" data-coffee-total role="status" aria-live="polite">填入每包磅數與包數，即可預覽總磅數。</div><label class="field recorder-field">登記人<input name="recorder" required maxlength="80" autocomplete="name" placeholder="請填姓名或大家認得的稱呼"></label><div class="form-actions"><button type="submit" class="button">${count ? '儲存盤點' : '確認到貨入庫'}</button></div><p class="subtle">儲存時自動記錄${count ? '盤點' : '入庫'}時間。</p></fieldset>`;
}

export function renderCoffeeArrival(rows, { enabled = true, formatDate } = {}) {
  const e = escapeHtml, until = Date.now(), recent = rows.filter(row => row.type !== 'count' && Date.parse(row.createdAt) >= until - 72 * 3600000 && Date.parse(row.createdAt) <= until).sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt));
  return coffeeEntryNotice(enabled) + renderCoffeeSummary(rows) + `<div class="restock-layout coffee-layout"><section class="panel form-panel"><h2>咖啡豆到貨入庫</h2><form id="coffee-receipt-form">${coffeeFormFields({rows,enabled})}</form></section><section class="coffee-history" aria-label="咖啡豆最近入庫紀錄"><div class="section-heading"><h2>咖啡豆最近3天入庫紀錄</h2><a href="#history" class="text-link">完整紀錄 ↗</a></div><div class="panel coffee-receipts"><p class="subtle">最近72小時，共 ${recent.length} 筆</p>${recent.length ? recent.map(row => `<article class="coffee-receipt" data-coffee-receipt><div class="coffee-receipt-heading"><h3>${e(row.brand)}</h3><strong>${e(coffeeWeight(row.poundsPerBag * row.bags))}</strong></div><p>${e(coffeeWeight(row.poundsPerBag))}／包 × ${row.bags} 包</p><p class="subtle">入庫 ${e(formatDate(row.createdAt,true))} · ${e(row.recorder)}</p></article>`).join('') : '<div class="empty-state"><span class="empty-icon" aria-hidden="true">☕</span><h3>最近3天沒有咖啡豆入庫</h3><p>登記品牌、每包磅數與包數，就能完成入庫。</p></div>'}</div></section></div>`;
}

export function renderCoffeeWarehouse(rows, { enabled = true, formatDate } = {}) {
  const e = escapeHtml, items = coffeeInventory(rows).sort((a,b) => a.stock-b.stock||a.brand.localeCompare(b.brand,'zh-TW')||a.poundsPerBag-b.poundsPerBag);
  return coffeeEntryNotice(enabled) + renderCoffeeSummary(rows) + `<p class="subtle">相同品牌、相同每包重量合併庫存；不同重量分開登記。${coffeeConversionNote}</p><div class="admin-summary"><span>${items.length} 種包裝</span><span>共 ${items.reduce((sum,item) => sum+item.stock,0)} 包</span><span>庫存總重量 ${e(coffeeWeight(items.reduce((sum,item) => sum+item.stock*item.poundsPerBag,0)))}</span></div><div class="inventory-panel">${items.length ? `<div class="table-scroll"><table class="coffee-inventory-table"><thead><tr><th>品牌</th><th>每包重量（磅）</th><th>庫存包數</th><th>庫存總重量（磅）</th><th>最近入庫</th><th>登記</th></tr></thead><tbody>${items.map(item => `<tr data-coffee-item="${e(item.id)}"><td><strong>${e(item.brand)}</strong></td><td data-label="每包重量（磅）">${e(coffeeWeight(item.poundsPerBag))}</td><td data-coffee-stock data-label="庫存包數">${item.stock} 包</td><td data-coffee-stock-weight data-label="庫存總重量（磅）">${e(coffeeWeight(item.stock*item.poundsPerBag))}</td><td class="cell-note" data-label="最近入庫">${e(formatDate(item.lastArrivalAt,true))}${item.lastCountAt ? `<br>最近盤點 ${e(formatDate(item.lastCountAt,true))}` : ''}</td><td><div class="inline-actions"><button type="button" class="button button-small button-outline" data-action="coffee-arrival" data-id="${e(item.id)}"${enabled ? '' : ' disabled'}>＋ 快速入庫</button><button type="button" class="button button-small button-plain" data-action="coffee-count" data-id="${e(item.id)}"${enabled ? '' : ' disabled'}>盤點</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><span class="empty-icon" aria-hidden="true">☕</span><h2>尚無咖啡豆庫存</h2><p>第一次入庫時登記品牌與每包磅數，即可建立品項。</p><a class="button" href="#restock-coffee">＋ 登記咖啡豆入庫</a></div>'}</div>`;
}
