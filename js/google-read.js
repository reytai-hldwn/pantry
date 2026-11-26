let googleCallbackSequence = 0;

export function validateGoogleScriptUrl(value) {
  let url;
  try { url = new URL(typeof value === 'string' ? value.trim() : ''); } catch { /* handled below */ }
  if (!url || url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
      url.username || url.password || url.port || url.search || url.hash ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) {
    throw new Error('請在 config.js 設定已發布的 Google Apps Script HTTPS 網址（結尾為 /exec）。');
  }
  return url.href;
}

/** Read-only JSONP: catalogs, warehouse observations and write receipts. */
export function fetchGooglePublicData(endpoint, options = {}) {
  const url = new URL(validateGoogleScriptUrl(endpoint));
  const action = options.action ?? 'public';
  if (!['public', 'warehouse', 'receipt', 'popularity', 'admin', 'gacha'].includes(action)) throw new Error('不支援的 Google 資料讀取方式。');
  if (action === 'receipt' && !/^[A-Za-z0-9_-]{20,100}$/.test(options.requestId || '')) throw new Error('儲存回條代號不正確。');
  const pageWindow = options.window || globalThis.window;
  const pageDocument = options.document || globalThis.document;
  const schedule = options.setTimeout || globalThis.setTimeout;
  const cancel = options.clearTimeout || globalThis.clearTimeout;
  const timeout = options.timeout ?? 15000;
  if (!pageWindow || !pageDocument?.createElement || !pageDocument.head?.appendChild) {
    return Promise.reject(new Error('目前的瀏覽器無法載入 Google 共用資料。'));
  }
  const callback = `__holdwin_${Date.now().toString(36)}_${(++googleCallbackSequence).toString(36)}_${Math.random().toString(36).slice(2)}`;
  url.searchParams.set('action', action);
  url.searchParams.set('callback', callback);
  if(['admin','warehouse'].includes(action)&&options.force===true)url.searchParams.set('fresh','1');
  if (action === 'receipt') url.searchParams.set('requestId', options.requestId);
  return new Promise((resolve, reject) => {
    const script = pageDocument.createElement('script');
    let timer;
    let settled = false;
    const cleanup = () => {
      if (timer !== undefined) cancel(timer);
      script.onerror = null;
      script.onload = null;
      script.remove();
      delete pageWindow[callback];
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };
    pageWindow[callback] = (result) => finish(null, result);
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = url.href;
    script.onerror = () => finish(new Error('無法讀取 Google 共用資料。請確認網路，以及 Apps Script 是否已發布為任何人可讀取。'));
    script.onload = () => {
      if (!settled) finish(new Error('Google 端點未回傳預期資料。請確認部署的是提供的 Apps Script，並重新發布最新版本。'));
    };
    timer = schedule(() => finish(new Error('Google 共用資料讀取逾時，請稍後重新整理。')), timeout);
    try { pageDocument.head.appendChild(script); }
    catch { finish(new Error('無法載入 Google 共用資料，請稍後重新整理。')); }
  });
}

export function takeEarlyInventoryRead(endpoint, action) {
  const early = globalThis.pantryEarlyInventory;
  if (early?.endpoint !== endpoint || early.action !== action) return null;
  delete globalThis.pantryEarlyInventory;
  return Date.now() - early.startedAt < 15000 ? early.request : null;
}
