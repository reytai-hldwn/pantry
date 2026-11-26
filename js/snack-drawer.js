import { escapeHtml as h } from './domain.js';
import { renderFoodNutrition } from './food-nutrition.js';
import { stockPopularity } from './consumption.js';
import { SNACK_CATEGORIES, supplyNameKey } from './supplies.js';
import { SNACK_DRAWER_PRODUCTS } from './snack-drawer-catalog.js';
import { renderFridgePopularity, renderPantryCategoryBar, selectPantryCategory, renderPantryShelfSkeleton, bindPantryShelfBounce } from './fridge.js';
import { archivedFoodWishId } from './wish-support.js';
import { snackDrawerCorners, snackDrawerCrop } from './snack-room.js';

export const SNACK_DRAWER_CONTENTS = './assets/snacks/tea-room-drawer-contents.webp';

const drawerCategories = [...SNACK_CATEGORIES, '泡麵'];
const normalizeSnackSearch = text => text.normalize('NFKC').toLocaleLowerCase('zh-TW');
const excludedSnackHistory = new Set(['烤馬鈴薯風味', '柚子胡椒風味'].map(flavor => supplyNameKey({ name: '卡迪那95℃薯條', flavor })));

function snackProductPhoto(photo, id) {
  const clip = photo.silhouette ? `<svg class="snack-photo-clip" width="0" height="0" aria-hidden="true"><defs>
    <clipPath id="${id}" clipPathUnits="objectBoundingBox">${photo.silhouette.map(points => `<polygon points="${points}"></polygon>`).join('')}</clipPath>
  </defs></svg>` : '';
  const treatment = clip ? ` class="has-silhouette" style="clip-path:url(#${id})"` : photo.opaque ? ' class="is-opaque"' : '';
  return `${clip}<img src="${h(photo.src)}" alt="" loading="lazy" decoding="async"${treatment}>`;
}

function snackProductArt({ photos, compactPhoto }, outlineId) {
  const classes = ['snack-product-art', photos.length > 1 ? 'is-paired' : '', compactPhoto ? 'is-compact' : ''].filter(Boolean).join(' ');
  const images = photos.map((photo, index) => snackProductPhoto(photo, `${outlineId}-${index}`)).join('');
  return `<span class="${classes}">${images}</span>`;
}

const drawerProductNames = product => [product.name, ...(product.aliases || [])];

function findDrawerProduct(item) {
  const key = supplyNameKey(item);
  const [name, flavor] = key.split('\u0000');
  const matches = SNACK_DRAWER_PRODUCTS.filter(product =>
    (product.category === '泡麵') === (item.kind === 'noodle') &&
    drawerProductNames(product).some(candidate => supplyNameKey({ name: candidate }).split('\u0000')[0] === name));
  const exact = matches.find(product => [product.flavors, ...product.details.map(detail => detail.flavor)]
    .some(candidate => supplyNameKey({ name: product.name, flavor: candidate }) === key));
  return exact || (!flavor && matches.length === 1 ? matches[0] : null);
}

export function renderGachaSnackArt(snack) {
  const product = findDrawerProduct(snack);
  if (product) return snackProductArt(product, `gacha-outline-${product.key}`);
  return `<figure class="gacha-snack-illustration"><img src="${h(SNACK_DRAWER_CONTENTS)}" alt="" decoding="async"><figcaption>零食示意</figcaption></figure>`;
}

export function renderPurchasedSnackArt(wish, outlineId) {
  if (wish.purchasedProduct) {
    const product = findDrawerProduct(wish.purchasedProduct);
    return product?.photos.length ? snackProductArt(product, outlineId) : '';
  }
  const nameKey = value => normalizeSnackSearch(value).replace(/[\s|｜]/g, '');
  const name = nameKey(wish.name);
  const matches = SNACK_DRAWER_PRODUCTS.filter(product =>
    archivedFoodWishId(product.key) === wish.id || drawerProductNames(product).some(candidate => nameKey(candidate) === name) ||
    [product.flavors, ...product.details.map(detail => detail.flavor)].some(flavor => nameKey(product.name + flavor) === name));
  const product = matches.length === 1 ? matches[0] : null;
  return product?.photos.length ? snackProductArt(product, outlineId) : '';
}

function snackProductCard(product) {
  const { lookupKey, name, flavors, imageCaption, photos, archived } = product;
  return `<button class="snack-product${archived ? ' is-archived' : ''}" type="button" data-snack-product-key="${h(lookupKey)}"${archived ? ` aria-label="${h(name + (flavors ? ` ${flavors}` : '') + '，歷史品項')}"` : ''}>
    ${photos.length ? snackProductArt(product, `outline-${lookupKey}`) : '<span class="snack-product-art snack-art-unavailable">商品圖片待補</span>'}
    <span class="snack-product-title">${h(name)}${flavors ? `<small>${h(flavors)}</small>` : ''}${imageCaption ? `<small>${h(imageCaption)}</small>` : ''}</span>
  </button>`;
}

export function stockDrawerProducts(supplies, archived) {
  const products = new Map();
  const recordedProducts = new Set();
  for (const item of supplies) {
    if (item.kind !== 'snack' && item.kind !== 'noodle') continue;
    if (archived && item.kind === 'snack' && excludedSnackHistory.has(supplyNameKey(item))) continue;
    const catalogProduct = findDrawerProduct(item);
    if (catalogProduct?.historical) recordedProducts.add(catalogProduct.key);
    if ((item.active === false) !== archived) continue;
    const product = catalogProduct || {
      key: `inventory-${item.id}`, name: item.name, category: item.kind === 'noodle' ? '泡麵' : item.category,
      flavors: item.flavor || '', photos: [], details: [{ flavor: item.flavor || '', nutrition: null }],
    };
    if (!products.has(product.key)) products.set(product.key, { product, flavors: new Set() });
    products.get(product.key).flavors.add(supplyNameKey(item).split('\u0000')[1]);
  }
  if (archived) {
    for (const product of SNACK_DRAWER_PRODUCTS) {
      if (product.historical && !recordedProducts.has(product.key)) products.set(product.key, { product, flavors: new Set() });
    }
  }
  return [...products.values()].map(({ product, flavors }) => {
    if (product.details.length < 2 || flavors.has('')) return product;
    const details = product.details.filter(detail => flavors.has(normalizeSnackSearch(detail.flavor).trim()));
    if (!details.length || details.length === product.details.length) return product;
    return { ...product, details, flavors: details.map(detail => detail.flavor).join('、'), wishName: product.name };
  });
}

function snackShelves(products, search, selected) {
  const terms = normalizeSnackSearch(search).trim().split(/\s+/).filter(Boolean);
  const shelves = drawerCategories.map((category, index) => {
    if (selected && selected !== category) return '';
    const items = products.filter(product => {
      if (product.category !== category) return false;
      const label = normalizeSnackSearch([...drawerProductNames(product), product.flavors, ...product.details.map(detail => detail.flavor)].join(' '));
      return terms.every(term => label.includes(term));
    });
    if (!items.length) return '';
    return `<section class="snack-shelf" aria-labelledby="snack-shelf-${index}">
      <h2 id="snack-shelf-${index}">${h(category)}</h2>
      <div class="snack-products">${items.map(snackProductCard).join('')}</div>
      <div class="snack-shelf-rail" aria-hidden="true"></div>
    </section>`;
  }).join('');
  return shelves || '<p class="snack-empty" role="status">找不到符合的品項。</p>';
}

function openDrawerProduct(product, showDetails, wishActions = '') {
  const details = product.details.map(({ flavor, nutrition, ingredients }) => {
    const ingredientList = ingredients ? `<details><summary>成分</summary><p>${h(ingredients)}</p></details>` : '';
    return `<section>${flavor ? `<h3>${h(flavor)}</h3>` : ''}${renderFoodNutrition(nutrition)}${ingredientList}</section>`;
  }).join('');
  const photoNote = product.photoNote ? `<p class="subtle">${h(product.photoNote)}</p>` : '';
  showDetails(h(product.name), h(product.category), `${wishActions}<div class="snack-nutrition">${details}${photoNote}</div>`);
}

function snackDrawerPath(context, points) {
  context.beginPath();
  context.moveTo(...points[0]);
  for (const point of points.slice(1)) context.lineTo(...point);
  context.closePath();
}

function fillDrawerSurface(context, points, color) {
  context.fillStyle = color;
  snackDrawerPath(context, points);
  context.fill();
}

function drawSnackPull(context, image, contents, progress) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  if (progress === 0) return;

  const { x, y, width, height } = snackDrawerCrop;
  // Each corner travels on its own ray from the room's depth vanishing point.
  const scale = 1 + progress * .23;
  const project = ([px, py]) => [465 + (px - 465) * scale, 555 + (py - 555) * scale];
  const [left, right, bottomRight, bottomLeft] = snackDrawerCorners;
  const front = snackDrawerCorners.map(project);
  const [frontLeft, frontRight, frontBottomRight, frontBottomLeft] = front;
  const [frontX, frontY] = project([x, y]);

  context.save();
  context.shadowColor = `rgba(53, 36, 18, ${.3 * progress})`;
  context.shadowOffsetY = 6 * progress;
  context.shadowBlur = 5 * progress;
  fillDrawerSurface(context, front, '#816448');
  context.restore();

  fillDrawerSurface(context, snackDrawerCorners, '#634a32');
  fillDrawerSurface(context, [left, frontLeft, frontBottomLeft, bottomLeft], '#be9a70');
  fillDrawerSurface(context, [right, frontRight, frontBottomRight, bottomRight], '#a07e59');

  // Paint the lip and well inside the exposed quadrilateral so nothing crosses
  // the counter or the moving face even in the first few pixels of travel.
  const top = [left, right, frontRight, frontLeft];
  const insideLeft = [left[0] + 5, left[1]];
  const insideRight = [right[0] - 5, right[1]];
  const floor = context.createLinearGradient(x, y, x + 2, frontY + 14);
  floor.addColorStop(0, '#503e2c');
  floor.addColorStop(.45, '#8e7050');
  floor.addColorStop(1, '#c5a57c');
  context.save();
  snackDrawerPath(context, top);
  context.clip();
  fillDrawerSurface(context, top, floor);
  if (contents?.naturalWidth) {
    // The packed surface travels with the drawer. The counter's edge clips
    // the back of the illustration as the contents slide into view.
    const [artLeft, artRight] = [project(insideLeft), project(insideRight)];
    const artWidth = artRight[0] - artLeft[0];
    const slope = (artRight[1] - artLeft[1]) / artWidth;
    context.save();
    context.transform(1, slope, .28, 1, artLeft[0], artLeft[1]);
    context.drawImage(contents, -4, -51 * scale, artWidth + 22, 51 * scale);
    context.restore();
  }
  const shade = context.createLinearGradient(x, y, x + 2, frontY + 12);
  shade.addColorStop(0, '#332211b3');
  shade.addColorStop(.65, '#442e171f');
  shade.addColorStop(1, '#442e1708');
  fillDrawerSurface(context, top, shade);
  fillDrawerSurface(context, [left, insideLeft, project(insideLeft), frontLeft], '#d7b989');
  fillDrawerSurface(context, [insideRight, right, frontRight, project(insideRight)], '#bca074');
  fillDrawerSurface(context, [frontLeft, frontRight, [frontRight[0], frontRight[1] - 3], [frontLeft[0], frontLeft[1] - 3]], '#dfc199');
  context.restore();

  context.save();
  snackDrawerPath(context, front);
  context.clip();
  context.drawImage(image, x, y, width, height, frontX, frontY, width * scale, height * scale);
  context.restore();
}

async function animateSnackPull(scene, contents, from, to) {
  const context = scene.querySelector('canvas').getContext('2d');
  const image = scene.querySelector('img');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!context || !image.naturalWidth) return;

  await new Promise(resolve => {
    let start;
    function frame(now) {
      if (!scene.isConnected) { resolve(); return; }
      if (reducedMotion.matches) { drawSnackPull(context, image, contents, 0); resolve(); return; }
      start ??= now;
      const time = Math.max(0, Math.min(1, (now - start) / 545));
      const eased = time * time * (3 - 2 * time);
      drawSnackPull(context, image, contents, from + (to - from) * eased);
      if (time < 1) requestAnimationFrame(frame);
      else resolve();
    }
    frame(performance.now());
  });
}

export function snackDrawerRankings(data, now = Date.now()) {
  return stockPopularity(data, 'snack', now);
}

export function mountSnackDrawer(root, showDetails, readWarehouse, historyActions, { preview, initialRead } = {}) {
  root.insertAdjacentHTML('beforeend', `
    <section class="snack-cabinet" id="snack-cabinet" aria-label="抽屜內的零食" hidden>
      <header class="snack-open-heading pantry-heading"><h2>今天，吃點什麼</h2><p class="page-description">想吃點鹹的，還是來點甜的？挑一份喜歡的零食，休息一下。</p></header>
      <div class="snack-controls">
        <label class="snack-search"><span aria-hidden="true">⌕</span><input type="search" maxlength="80" aria-label="搜尋零食或泡麵" placeholder="搜尋品名或口味"></label>
        <button class="button button-small button-outline snack-close" type="button">推回抽屜</button>
      </div>
      ${renderPantryCategoryBar(drawerCategories, '', '零食與泡麵分類', true)}
      <p class="snack-inventory-status subtle" role="status" hidden></p>
      <div class="snack-tray" role="region" aria-label="零食分類" tabindex="0">
        <div data-shelf-content>
        <details class="snack-popularity">
          <summary class="popularity-heading"><h3>大家最近愛吃什麼？</h3><span class="popularity-period">90 天</span></summary>
          <div class="snack-ranking-content"></div>
        </details>
        <div class="snack-shelves">${renderPantryShelfSkeleton('正在讀取庫存…')}</div>
        </div>
      </div>
      <button class="snack-drawer-face" type="button"><span class="snack-handle" aria-hidden="true"></span>推回抽屜 <span aria-hidden="true">↑</span></button>
    </section>`);
  const room = root.querySelector('.snack-room');
  // Start loading the illustrated contents ahead of the gesture. The drawer
  // remains usable while the image loads, and reduced-motion can skip it.
  let contents;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    contents = new Image();
    contents.fetchPriority = 'low';
    contents.src = SNACK_DRAWER_CONTENTS;
  }
  const openers = [...root.querySelectorAll('.snack-guide, .snack-hit')];
  const cabinet = root.querySelector('.snack-cabinet');
  const close = root.querySelector('.snack-close');
  const search = root.querySelector('.snack-search input');
  const categoryBar = cabinet.querySelector('.pantry-category-bar');
  const tray = root.querySelector('.snack-tray');
  bindPantryShelfBounce(tray);
  const shelves = tray.querySelector('.snack-shelves');
  const status = cabinet.querySelector('.snack-inventory-status');
  const popularity = tray.querySelector('.snack-popularity');
  const rankingContent = tray.querySelector('.snack-ranking-content');
  let opener;
  let moving = false;
  let selectedCategory = '';
  let warehouse = preview;
  let warehouseIsPreview = Boolean(preview);
  let lastReadAt = -Infinity;
  let warehouseRequest;
  let products = new Map();

  function renderRankings() {
    if (!warehouse || warehouseIsPreview) {
      rankingContent.innerHTML = `<p class="popularity-status" role="status">${warehouseRequest ? '正在讀取零食盤點紀錄…' : '排行榜暫時無法讀取。'}</p>`;
      return;
    }
    rankingContent.innerHTML = renderFridgePopularity(snackDrawerRankings(warehouse), { snack: true });
  }

  function renderTray() {
    if (!warehouse || cabinet.hidden) return;
    const active = stockDrawerProducts(warehouse.supplies, false).map(product => ({ ...product, lookupKey: product.key }));
    const history = stockDrawerProducts(warehouse.supplies, true).map(product => ({
      ...product, lookupKey: `archive-${product.key}`, archived: true,
    }));
    const items = [...active, ...history];
    products = new Map(items.map(product => [product.lookupKey, product]));
    shelves.innerHTML = snackShelves(items, search.value, selectedCategory);
    tray.scrollTop = 0;
  }

  function refreshInventory(force = false, started) {
    if (warehouseRequest) return warehouseRequest;
    if (!warehouse) shelves.innerHTML = renderPantryShelfSkeleton('正在讀取庫存…');
    if (warehouseIsPreview) {
      status.textContent = '顯示上次讀取的品項，正在更新…';
      status.hidden = false;
    }
    warehouseRequest = (started || readWarehouse(force)).then(result => {
      if (!root.isConnected) return;
      warehouse = result;
      lastReadAt = Date.now();
      warehouseIsPreview = false;
      status.hidden = true;
      renderTray();
      if (popularity.open) renderRankings();
    }).catch(error => {
      if (root.isConnected && !warehouse) {
        shelves.innerHTML = '<p class="snack-empty" role="status">暫時無法讀取庫存。 <button class="text-link" type="button">重新讀取</button></p>';
        shelves.querySelector('button').addEventListener('click', () => refreshInventory(true).catch(() => {}));
        rankingContent.innerHTML = '<p class="popularity-status" role="status">排行榜暫時無法讀取。</p>';
      }
      if (root.isConnected && warehouseIsPreview) status.textContent = '暫時無法更新，顯示上次讀取的品項。';
      throw error;
    }).finally(() => { warehouseRequest = undefined; });
    return warehouseRequest;
  }

  async function moveSnackDrawer(open, trigger) {
    if (moving || open === room.hidden) return;
    moving = true;
    for (const button of openers) button.setAttribute('aria-disabled', 'true');
    if (open) {
      opener = trigger;
      if (Date.now() - lastReadAt >= 30000) refreshInventory().catch(() => {});
      room.classList.add('is-pulling');
      await animateSnackPull(room, contents, 0, 1);
      if (!room.isConnected) return;
      room.hidden = true;
      cabinet.hidden = false;
      if (warehouse && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        shelves.innerHTML = renderPantryShelfSkeleton('正在整理零食…');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (shelves.querySelector('.pantry-skeleton')) renderTray();
        }));
      } else renderTray();
      close.focus({ preventScroll: true });
    } else {
      cabinet.hidden = true;
      room.hidden = false;
      opener.focus();
      await animateSnackPull(room, contents, 1, 0);
      if (!room.isConnected) return;
      room.classList.remove('is-pulling');
    }
    for (const button of openers) {
      button.setAttribute('aria-expanded', String(open));
      button.removeAttribute('aria-disabled');
    }
    moving = false;
  }

  for (const button of openers) button.addEventListener('click', () => moveSnackDrawer(true, button));
  for (const button of [close, root.querySelector('.snack-drawer-face')]) button.addEventListener('click', () => moveSnackDrawer(false));
  search.addEventListener('input', renderTray);
  categoryBar.addEventListener('click', event => {
    const button = event.target.closest('[data-pantry-category]');
    if (!button || button.dataset.pantryCategory === selectedCategory) return;
    selectedCategory = button.dataset.pantryCategory;
    selectPantryCategory(categoryBar, selectedCategory);
    renderTray();
  });
  popularity.addEventListener('toggle', () => { if (popularity.open) renderRankings(); });
  tray.addEventListener('click', event => {
    const product = products.get(event.target.closest('[data-snack-product-key]')?.dataset.snackProductKey);
    if (!product) return;
    const wishlist = product.archived ? historyActions(product, warehouse.data?.wishes || []) : '';
    openDrawerProduct(product, showDetails, wishlist);
  });
  if (initialRead) refreshInventory(false, initialRead).catch(() => {});
  return {
    refreshInventory,
    archivedProduct: key => {
      const product = products.get(key);
      return product?.archived ? product : null;
    },
    archiveWish: id => warehouse?.data?.wishes?.find(wish => wish.id === id),
    updateArchiveWishes() {
      if (cabinet.hidden) return;
      const scroll = tray.scrollTop;
      renderTray();
      tray.scrollTop = scroll;
    },
  };
}
