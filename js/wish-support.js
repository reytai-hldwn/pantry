/** Display only submitted names; browser identifiers never belong in the UI. */
export function wishSupportDetails(wish) {
  const votes = Number.isSafeInteger(wish?.votes) && wish.votes >= 0 ? wish.votes : 0;
  const submitted = Array.isArray(wish?.supporters)
    ? wish.supporters
    : [...new Set(Array.isArray(wish?.voterIds) ? wish.voterIds : [])].map((id) => wish?.voterNames?.[id]);
  const names = submitted.filter((name) => typeof name === 'string' && name.trim() && name.trim().length <= 80).map((name) => name.trim()).slice(0, votes);
  return { votes, names, unnamed: Math.max(0, votes - names.length) };
}

export function wishSupportPreview(wish) {
  const { votes, names, unnamed } = wishSupportDetails(wish);
  if (!votes) return '還沒有人贊同這個提案。';
  const listed = names.slice(0, 8).join('、');
  return [listed + (names.length > 8 ? `等 ${names.length} 位` : ''), unnamed ? `${unnamed} 位未留姓名` : ''].filter(Boolean).join('；');
}

export function archivedFoodWishId(key) {
  const inventory = key.startsWith('inventory-');
  const id = inventory ? key.slice('inventory-'.length) : key;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('找不到這個歷史品項。');
  return `wish-web-pf-${inventory ? 'i' : 'c'}-${id}-v1-pantry-wish`;
}

export function wishVoterName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 80) throw new Error('請填寫姓名，最多 80 字。');
  return name;
}
