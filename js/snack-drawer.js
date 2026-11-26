import { escapeHtml as h, safeUrl } from './domain.js';
import { buildConsumptionRecords, consumptionPeriod, selectConsumption } from './consumption.js';
import { SNACK_CATEGORIES, supplyLabel, supplyNameKey } from './supplies.js';
import { SNACK_DRAWER_PRODUCTS } from './snack-drawer-catalog.js';

export const SNACK_DRAWER_SCENE = './assets/snacks/tea-room-drawer.webp';
export const SNACK_DRAWER_CONTENTS = './assets/snacks/tea-room-drawer-contents.webp';
const snackSceneSize = { width: 1446, height: 1087 };
// The opening follows the perspective of the actual upper drawer in the illustration.
const snackDrawerCorners = [[432, 762], [856, 749], [857, 791], [432, 808]];
const snackDrawerCrop = { x: 432, y: 749, width: 425, height: 59 };

const productsByKey = new Map(SNACK_DRAWER_PRODUCTS.map(product => [product.key, product]));
const drawerCategories = [...SNACK_CATEGORIES, '泡麵'];
const normalizeSnackSearch = text => text.normalize('NFKC').toLocaleLowerCase('zh-TW');

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

function findDrawerProduct(item) {
  const key = supplyNameKey(item);
  const [name, flavor] = key.split('\u0000');
  const matches = SNACK_DRAWER_PRODUCTS.filter(product =>
    (product.category === '泡麵') === (item.kind === 'noodle') &&
    supplyNameKey({ name: product.name }).split('\u0000')[0] === name);
  const exact = matches.find(product => [product.flavors, ...product.details.map(detail => detail.flavor)]
    .some(candidate => supplyNameKey({ name: product.name, flavor: candidate }) === key));
  return exact || (!flavor && matches.length === 1 ? matches[0] : null);
}

export function renderGachaSnackArt(snack) {
  const product = findDrawerProduct(snack);
  if (product) return snackProductArt(product, `gacha-outline-${product.key}`);
  return `<figure class="gacha-snack-illustration"><img src="${h(SNACK_DRAWER_CONTENTS)}" alt="" decoding="async"><figcaption>零食示意</figcaption></figure>`;
}

function snackProductCard(product) {
  const { key, name, flavors, imageCaption } = product;
  return `<button class="snack-product" type="button" data-snack-product-key="${h(key)}">
    ${snackProductArt(product, `outline-${key}`)}
    <span class="snack-product-title">${h(name)}${flavors ? `<small>${h(flavors)}</small>` : ''}${imageCaption ? `<small>${h(imageCaption)}</small>` : ''}</span>
  </button>`;
}

function snackShelves(search, selected) {
  const terms = normalizeSnackSearch(search).trim().split(/\s+/).filter(Boolean);
  const shelves = drawerCategories.map((category, index) => {
    if (selected && selected !== category) return '';
    const items = SNACK_DRAWER_PRODUCTS.filter(product => {
      if (product.category !== category) return false;
      const label = normalizeSnackSearch([product.name, product.flavors, ...product.details.map(detail => detail.flavor)].join(' '));
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

function snackNutrition(nutrition) {
  if (!nutrition) return '<p class="subtle">營養標示待補。</p>';
  const { serving, portion, per100, note, source, servingEstimated, per100Estimated, estimatedPer100gFields } = nutrition;
  const servingLine = serving == null ? '每份重量依包裝標示' : `每份 ${h(serving)} 公克`;
  const sourceUrl = safeUrl(source);
  const metrics = new Set([...Object.keys(portion), ...Object.keys(per100)]);
  const rows = [...metrics].map(key => {
    const unit = key === '熱量' ? '大卡' : ['鈉', '支鏈胺基酸（BCAA）'].includes(key) ? '毫克' : '公克';
    const value = number => number == null ? '—' : `${h(number)} ${unit}`;
    return `<tr><th scope="row">${h(key)}</th><td>${value(portion[key])}</td><td>${value(per100[key])}${estimatedPer100gFields?.includes(key) ? '（估算）' : ''}</td></tr>`;
  }).join('');
  return `<p>${servingLine}</p><div class="nutrition-table-wrap"><table class="nutrition-table">
    <thead><tr><th scope="col">項目</th><th scope="col">每份${servingEstimated ? '（估算）' : ''}</th><th scope="col">每 100 公克${per100Estimated ? '（估算）' : ''}</th></tr></thead><tbody>${rows}</tbody>
  </table></div>${note ? `<p class="subtle">${h(note)}</p>` : ''}${sourceUrl ? `<p><a href="${h(sourceUrl)}" target="_blank" rel="noopener noreferrer">營養標示來源 ↗</a></p>` : ''}`;
}

function openDrawerProduct(product, showDetails) {
  const details = product.details.map(({ flavor, nutrition, ingredients }) => {
    const ingredientList = ingredients ? `<details><summary>成分</summary><p>${h(ingredients)}</p></details>` : '';
    return `<section>${flavor ? `<h3>${h(flavor)}</h3>` : ''}${snackNutrition(nutrition)}${ingredientList}</section>`;
  }).join('');
  const photoNote = product.photoNote ? `<p class="subtle">${h(product.photoNote)}</p>` : '';
  showDetails(h(product.name), h(product.category), `<div class="snack-nutrition">${details}${photoNote}</div>`);
}

export function mountSupplyArchive(root, items, showDetails) {
  if (!items.length) {
    root.innerHTML = '<p class="subtle" role="status">目前沒有這類歷史品項。</p>';
    return;
  }
  root.innerHTML = `<div class="archive-grid">${items.map((item, index) => {
    const product = findDrawerProduct(item);
    const art = product?.photos.length ? snackProductArt(product, `archive-outline-${index}`) : '';
    const details = [item.category || '泡麵', item.flavor].filter(Boolean).map(h).join(' · ');
    return `<article class="panel archive-card archive-food-card" data-archived-supply-id="${h(item.id)}">
      ${art}<h3>${h(item.name)}</h3><p>${details}</p>
      ${product ? `<button class="button button-small button-outline" type="button" data-archive-product="${h(product.key)}">查看商品資訊</button>` : ''}
    </article>`;
  }).join('')}</div>`;
  root.addEventListener('click', event => {
    const product = productsByKey.get(event.target.closest('[data-archive-product]')?.dataset.archiveProduct);
    if (product) openDrawerProduct(product, showDetails);
  });
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

export function snackDrawerRankings({ supplies, supplyEvents }, now = Date.now()) {
  const snacks = supplies.filter(item => item.kind === 'snack');
  const measured = consumptionPeriod(buildConsumptionRecords({ supplies: snacks, supplyEvents }, now), { now });
  const { units } = selectConsumption(measured, { kind: 'snack' });
  return units.map(unit => {
    const { ranked, observed } = selectConsumption(measured, { kind: 'snack', unit });
    return { unit, observed, rows: ranked.slice(0, 3).map(item => ({ label: supplyLabel(item), weekly: item.weekly })) };
  });
}

const snackRateFormatter = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });

function renderSnackRanking({ unit, observed, rows } = {}) {
  if (!rows?.length) return `<p class="popularity-status" role="status">${observed ? '這段期間尚未觀察到消耗量。' : '累積盤點紀錄中，下次盤點後再來看看。'}</p>`;
  return `<ol class="snack-ranking-list">${rows.map((row, index) => `<li><span class="popularity-rank" aria-hidden="true">${index + 1}</span><span class="snack-rank-name">${h(row.label)}</span><span>約 <strong>${row.weekly < .1 ? '少於 0.1' : snackRateFormatter.format(row.weekly)}</strong> ${h(unit)}／週</span></li>`).join('')}</ol><p class="popularity-note">最近 30 天 · 依實際盤點和入庫紀錄估算，每週以 5 個工作日計。</p>`;
}

export function mountSnackDrawer(root, showDetails, readRankings) {
  const { width, height } = snackSceneSize;
  const crop = snackDrawerCrop;
  const hitPoints = snackDrawerCorners.map(([x, y]) => [x - crop.x, y - crop.y]);
  const hitShape = hitPoints.map(([x, y]) => `${x / crop.width * 100}% ${y / crop.height * 100}%`).join(',');
  const hitBox = `left:${crop.x / width * 100}%;top:${crop.y / height * 100}%;width:${crop.width / width * 100}%;height:${crop.height / height * 100}%;clip-path:polygon(${hitShape})`;
  root.innerHTML = `
    <div class="pantry-heading snack-heading"><h1>零食抽屜</h1></div>
    <section class="snack-room" aria-label="電視下方的零食抽屜">
      <div class="snack-scene">
        <img class="snack-scene-art" src="${SNACK_DRAWER_SCENE}" alt="茶水間裡，木質零食抽屜在電視下方" width="${width}" height="${height}">
        <canvas width="${width}" height="${height}" aria-hidden="true"></canvas>
        <button class="snack-hit" style="${hitBox}" type="button" aria-controls="snack-cabinet" aria-expanded="false" aria-label="拉開電視下方的抽屜">
          <svg class="snack-hit-outline" viewBox="0 0 ${crop.width} ${crop.height}" preserveAspectRatio="none" aria-hidden="true">
            <polygon points="${hitPoints.join(' ')}" vector-effect="non-scaling-stroke"></polygon>
          </svg>
        </button>
        <span class="snack-guide-arrow" aria-hidden="true"></span>
        <button class="snack-guide" type="button" aria-controls="snack-cabinet" aria-expanded="false">拉開零食抽屜</button>
      </div>
    </section>
    <section class="snack-cabinet" id="snack-cabinet" aria-label="抽屜內的零食" hidden>
      <header class="snack-open-heading pantry-heading"><h2>今天，吃點什麼</h2><p class="page-description">想吃點鹹的，還是來點甜的？挑一份喜歡的零食，休息一下。</p></header>
      <div class="snack-controls">
        <label class="snack-search"><span aria-hidden="true">⌕</span><input type="search" maxlength="80" aria-label="搜尋零食或泡麵" placeholder="搜尋品名或口味"></label>
        <select aria-label="篩選零食小類"><option value="">全部小類</option>${drawerCategories.map(category => `<option value="${h(category)}">${h(category)}</option>`).join('')}</select>
        <button class="button button-small button-outline snack-close" type="button">推回抽屜</button>
      </div>
      <div class="snack-tray" role="region" aria-label="零食分類" tabindex="0">
        <details class="snack-popularity">
          <summary class="popularity-heading"><h3>大家最近愛吃什麼？</h3><span class="popularity-period">每週</span></summary>
          <div class="snack-ranking-content"></div>
        </details>
        <div class="snack-shelves"></div>
      </div>
      <button class="snack-drawer-face" type="button"><span class="snack-handle" aria-hidden="true"></span>推回抽屜 <span aria-hidden="true">↑</span></button>
    </section>`;
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
  const filter = root.querySelector('.snack-controls select');
  const tray = root.querySelector('.snack-tray');
  const shelves = tray.querySelector('.snack-shelves');
  const popularity = tray.querySelector('.snack-popularity');
  const rankingContent = tray.querySelector('.snack-ranking-content');
  let opener;
  let moving = false;
  let rankings;
  let rankingRequest = false;

  async function loadRankings() {
    if (rankingRequest || rankings) return;
    rankingRequest = true;
    rankingContent.innerHTML = '<p class="popularity-status" role="status">正在整理零食盤點紀錄…</p>';
    try {
      rankings = await readRankings();
      const initial = rankings.find(group => group.rows.length) ?? rankings[0];
      const options = rankings.map(({ unit }) => `<option value="${h(unit)}"${unit === initial.unit ? ' selected' : ''}>${h(unit)}</option>`).join('');
      rankingContent.innerHTML = `${rankings.length > 1 ? `<label class="snack-ranking-unit">依單位 <select>${options}</select></label>` : ''}<div class="snack-ranking-results">${renderSnackRanking(initial)}</div>`;
      rankingContent.querySelector('select')?.addEventListener('change', event => {
        rankingContent.querySelector('.snack-ranking-results').innerHTML = renderSnackRanking(rankings.find(group => group.unit === event.target.value));
      });
    } catch {
      rankingContent.innerHTML = '<p class="popularity-status" role="status">排行榜暫時無法讀取。<button type="button" class="text-link">再試一次</button></p>';
      rankingContent.querySelector('button').addEventListener('click', loadRankings);
    } finally {
      rankingRequest = false;
    }
  }

  function renderTray() {
    shelves.innerHTML = snackShelves(search.value, filter.value);
    tray.scrollTop = 0;
  }

  async function moveSnackDrawer(open, trigger) {
    if (moving || open === room.hidden) return;
    moving = true;
    for (const button of openers) button.setAttribute('aria-disabled', 'true');
    if (open) {
      opener = trigger;
      room.classList.add('is-pulling');
      await animateSnackPull(room, contents, 0, 1);
      if (!room.isConnected) return;
      if (!shelves.hasChildNodes()) renderTray();
      room.hidden = true;
      cabinet.hidden = false;
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
  filter.addEventListener('change', renderTray);
  popularity.addEventListener('toggle', () => { if (popularity.open) loadRankings(); });
  tray.addEventListener('click', event => {
    const product = productsByKey.get(event.target.closest('[data-snack-product-key]')?.dataset.snackProductKey);
    if (product) openDrawerProduct(product, showDetails);
  });
}
