import { escapeHtml as h, safeUrl } from './domain.js';

export function renderFoodNutrition(nutrition) {
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
