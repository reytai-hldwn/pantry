import { escapeHtml as h, safeUrl } from './domain.js';
import { renderFoodNutrition } from './food-nutrition.js';
import { renderPantryShelfSkeleton } from './fridge.js';

const metrics = ['熱量', '蛋白質', '脂肪', '飽和脂肪', '反式脂肪', '碳水化合物', '糖', '鈉'];
const labelValues = values => Object.fromEntries(metrics.map((key, index) => [key, values[index]]));
const frozenNutrition = (serving, portion, per100, note, source) => ({
  serving, portion: labelValues(portion), per100: labelValues(per100), note, source,
});
const partialNutrition = (serving, values, source) => ({
  ...frozenNutrition(serving, values, values.map(value => value == null ? null : Math.round(value * 1000 / serving) / 10), '通路提供部分營養資訊，熱量待依包裝核對。', source),
  per100Estimated: true,
});

export const FROZEN_PRODUCTS = [
  {
    name: '曠世奇派比利時巧克力',
    photo: './assets/frozen/crunch-pie-belgian-display.webp',
    photoNote: '商品圖依冰棒與外盒照片調整方向及比例。',
    nutrition: partialNutrition(90, [null, 4.1, 19.6, 8.9, 0, 23.5, 18.8, 70], 'https://online.uni-prosperity.com.tw/zh/%E6%9D%9C%E8%80%81%E7%88%BA/1531100800101.html'),
  },
  {
    name: '曠世奇派玫瑰鹽焦糖巧克力',
    aliases: ['曠世奇派玫瑰岩礁糖巧克力', '曠世奇派玫瑰岩鹽焦糖巧克力'],
    photo: './assets/frozen/crunch-pie-rose-display.webp',
    photoNote: '冰棒與外盒依提供的商品圖組合呈現。',
    nutrition: partialNutrition(91, [null, 2.8, 19.5, 11.9, 0, 31.1, 23.6, 161], 'https://online.uni-prosperity.com.tw/zh/%E6%9D%9C%E8%80%81%E7%88%BA/1531101500101.html'),
  },
  {
    name: '曠世奇派草莓',
    photo: './assets/frozen/crunch-pie-strawberry-display.webp',
    photoNote: '商品圖依提供的冰棒與外盒照片重製。',
    source: 'https://online.uni-prosperity.com.tw/zh/%E6%9D%9C%E8%80%81%E7%88%BA/1531101400101.html',
  },
  {
    name: 'Poki巧克力脆皮雪糕',
    aliases: ['Poki巧克力脆皮大雪糕', '百吉巧克力脆皮大雪糕', '百吉脆皮巧克力'],
    photo: './assets/frozen/poki-chocolate-wrapper.webp',
    photoNote: '商品圖依提供的包裝照片重製。',
    allergens: '牛奶、花生、大豆、堅果類。',
    nutrition: frozenNutrition(70, [147.3, 1.4, 8, 7.3, 0, 17.4, 14.3, 64], [210.4, 2, 11.4, 10.4, 0, 24.9, 20.4, 91], '一盒含 5 份。依提供的包裝營養標示。'),
  },
  {
    name: 'Poki布丁雪糕',
    aliases: ['百吉布丁雪糕', '百吉布丁大雪糕'],
    photo: './assets/frozen/poki-pudding-wrapper.webp',
    photoNote: '單支包裝圖依提供的商品照片重製。',
    allergens: '本產品含奶類、蛋、堅果類製品。生產設備或產線亦處理花生、含麩質穀物、芝麻、奇異果、芒果和大豆及其製品。',
    nutrition: frozenNutrition(75, [99.2, 1.4, 2.4, 2.4, 0, 17.9, 12.5, 47], [132.2, 1.9, 3.2, 3.2, 0, 23.8, 16.7, 63], '一盒含 5 份。', 'https://online.uni-prosperity.com.tw/zh/%E7%99%BE%E5%90%89/1531012700101.html'),
  },
  {
    name: '杜老爺甜筒',
    aliases: ['杜老爺高級甜筒'],
    photo: './assets/frozen/duroyal-cone-upright.webp',
    source: 'https://www.momoshop.com.tw/TP/TP0007568/goodsDetail/TP00075680000469',
    ingredients: '水、蔗糖、巧克力液［椰子油、蔗糖、乳糖、可可粉、可可膏、全脂奶粉、大豆卵磷脂、巧克力香料（丙二醇、乙醇、水、甘油、香料）、香莢蘭醛］、麵粉、麥芽糖、完全氫化椰子油、花生碎角、乳清粉、脫脂奶粉、軟質棕油、複方粘稠劑（脂肪酸甘油酯、關華豆膠、刺槐豆膠、鹿角菜膠）、大豆卵磷脂、複方香料（丙二醇、水、乙醇、焦糖色素、食用黃色四號、食用紅色六號、蔗糖、甘油、玉米糖膠、葡萄糖、糊精、香料）、刺槐豆膠、精鹽、鹿角菜膠、焦糖色素、食用黃色四號、食用黃色五號。',
    allergens: '本產品含牛奶、含麩質穀物、大豆、花生及其製品。生產線設備亦有處理芒果、蛋、堅果類、芝麻及其製品。',
    nutrition: frozenNutrition(74, [185, 2, 8.9, 6.5, 0, 24.2, 13.6, 64], [250, 2.7, 12, 8.8, 0, 32.7, 18.4, 86], '每支 1 份。依提供的包裝營養標示。'),
  },
  {
    name: '哈根達斯比利時巧克力冰淇淋 473 毫升',
    aliases: ['哈根達斯比利時巧克力冰淇淋品脫杯'],
    photo: './assets/frozen/haagen-dazs-belgian-chocolate-473.webp',
    allergens: '含牛乳、大豆和雞蛋。生產設備或產線亦處理含麩質穀物和種子類成分。',
    nutrition: frozenNutrition(98, [300.2, 4.5, 19, 12.2, 0.4, 27.8, 24.8, 45.9], [306.6, 4.6, 19.4, 12.4, 0.4, 28.4, 25.3, 46.8], '一桶含 4 份。使用台灣版包裝標示。', 'https://online.uni-prosperity.com.tw/zh/1531213200101.html'),
  },
  {
    name: '哈根達斯香草冰淇淋 473 毫升',
    aliases: ['哈根達斯香草冰淇淋品脫杯', '哈根達斯香草品脫杯'],
    photo: './assets/frozen/haagen-dazs-vanilla-473.webp',
    allergens: '含牛乳和雞蛋。',
    nutrition: frozenNutrition(98, [249, 4, 17, 10, 0.5, 20, 20, 63], [249, 4, 17, 10, 0.5, 20, 20, 64], '一桶含 4 份。依台灣通路原始標示。', 'https://online.uni-prosperity.com.tw/zh/%E5%93%88%E6%A0%B9%E9%81%94%E6%96%AF/1531201800101.html'),
  },
  {
    name: '哈根達斯草莓冰淇淋 473 毫升',
    aliases: ['哈根達斯草莓冰淇淋品脫杯'],
    photo: './assets/frozen/haagen-dazs-strawberry-473.webp',
    allergens: '含牛乳和雞蛋。',
    nutrition: frozenNutrition(98, [239, 4, 15, 10, 0.4, 22, 22, 57], [239, 4, 15, 10, 0.4, 22, 22, 58], '一桶含 4 份。依台灣通路原始標示。', 'https://online.uni-prosperity.com.tw/zh/%E5%93%88%E6%A0%B9%E9%81%94%E6%96%AF/1531201500101.html'),
  },
  {
    name: '哈根達斯草莓起司蛋糕冰淇淋 473 毫升',
    aliases: ['哈根達斯草莓起司蛋糕冰淇淋品脫杯'],
    photo: './assets/frozen/haagen-dazs-cheesecake-473.webp',
    nutrition: frozenNutrition(98, [254, 4, 14, 9, 0.4, 28, 25, 112], [258, 4, 14, 9, 0.4, 29, 26, 114], '一桶含 4 份。依台灣通路原始標示。', 'https://online.uni-prosperity.com.tw/zh/1531211700101.html'),
  },
];

const frozenNameKey = value => value.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, '').replace(/(\d+)ml$/, '$1毫升');
const frozenNames = product => [product.name, ...(product.aliases || [])];
const frozenByName = new Map(FROZEN_PRODUCTS.flatMap(product => frozenNames(product).map(name => [frozenNameKey(name), product])));

export function findFrozenProduct(name) {
  return frozenByName.get(frozenNameKey(name));
}

export function renderFrozenProductPhoto(product, { thumbnail = false, detail = false } = {}) {
  if (!product?.photo) return '';
  return `<img class="frozen-product-photo" src="${h(product.photo)}" width="${thumbnail ? 43 : 136}" height="${thumbnail ? 43 : 136}" alt="${detail ? h(`${product.name}包裝`) : ''}" decoding="async" loading="${detail ? 'eager' : 'lazy'}">`;
}

export function renderFrozenShelf(items, { query, selected, status }) {
  const search = frozenNameKey(query);
  const available = items.map(item => ({ item, product: findFrozenProduct(item.name) }))
    .sort((a, b) => Number(a.item.active === false) - Number(b.item.active === false));
  const displayed = available.filter(({ item, product }) => [item.name, ...(product ? frozenNames(product) : [])].some(name => frozenNameKey(name).includes(search)));
  if (!displayed.length && !selected && (search || status === 'ready' || status === 'idle')) return '';
  const cards = displayed.map(({ item, product }) => {
    const archived = item.active === false;
    const name = h(product?.name || item.name);
    return `<button type="button" class="fridge-product${archived ? ' is-archived' : ''}" data-action="view-frozen" data-id="${h(item.id)}" aria-label="${name}${archived ? '，歷史品項' : ''}"><span class="fridge-product-stage">${renderFrozenProductPhoto(product) || '<span class="frozen-product-placeholder">圖片待補</span>'}</span><span class="fridge-product-info"><span class="frozen-product-name">${name}</span></span></button>`;
  }).join('');
  const message = status === 'error'
    ? '<p class="frozen-shelf-message" role="status">冰品暫時無法更新。 <button type="button" class="button button-small button-outline" data-action="retry-frozen">重試</button></p>'
    : !cards && status === 'loading' ? renderPantryShelfSkeleton('正在讀取冰品…')
    : !cards ? '<p class="frozen-shelf-message" role="status">找不到符合的冰品。</p>' : '';
  return `<section class="fridge-shelf frozen-shelf" aria-label="冰品"><div class="fridge-shelf-heading"><h3>冰品</h3></div>${message}${cards ? `<div class="fridge-products">${cards}</div>` : ''}</section>`;
}

export function renderFrozenProductDetails(product) {
  const photo = renderFrozenProductPhoto(product, { detail: true });
  const source = safeUrl(product?.source);
  return `<div class="snack-nutrition">${photo ? `<div class="frozen-detail-art">${photo}</div>` : ''}<h3>營養標示</h3>${renderFoodNutrition(product?.nutrition)}
    ${product?.ingredients ? `<details><summary>成分</summary><p>${h(product.ingredients)}</p></details>` : ''}
    ${product?.allergens ? `<p><strong>過敏原</strong> ${h(product.allergens)}</p>` : ''}
    ${product?.photoNote ? `<p class="subtle">${h(product.photoNote)}</p>` : ''}
    ${source ? `<p><a href="${h(source)}" target="_blank" rel="noopener noreferrer">商品資料來源 ↗</a></p>` : ''}</div>`;
}
