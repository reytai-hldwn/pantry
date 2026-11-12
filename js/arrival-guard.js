// Check each drink's combined quantity, including repeated rows in a batch.
export function largeDrinkArrivals(entries, drinks) {
  const totals = new Map();
  for (const entry of entries) {
    if (entry.kind !== 'drink' || entry.isNew || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1) continue;
    totals.set(entry.drinkId, (totals.get(entry.drinkId) || 0) + entry.quantity);
  }
  return drinks.flatMap(drink => {
    const quantity = totals.get(drink.id) || 0;
    if (!Number.isSafeInteger(drink.perCase) || drink.perCase < 1 || quantity <= drink.perCase * 3) return [];
    return [{ id: drink.id, name: drink.name, unit: drink.unit, quantity, limit: drink.perCase * 3 }];
  });
}
