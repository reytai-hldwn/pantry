export function groupEmptyStock(items) {
  const pending=item=>item.mode==='consider'&&item.zeroStockPending===true;
  return { pending:items.filter(pending), undecided:items.filter(item=>!pending(item)) };
}

/** Successful positive arrivals fulfil a marked item; counts keep the manual mark. */
export function fulfilZeroRestocks(previous, next) {
  const oldIds=new Set([...(previous.events||[]),...(previous.supplyEvents||[])].map(event=>event.id));
  const incoming=[...(next.events||[]),...(next.supplyEvents||[])].filter(event=>!oldIds.has(event.id)&&event.type==='restock'&&event.accepted!==false&&event.quantity>0);
  const fulfilled=new Map();
  for(const event of incoming){
    const kind=event.drinkId?'drink':(next.supplies||[]).find(item=>item.id===event.supplyId)?.kind;
    const id=event.drinkId||event.supplyId,item=(kind==='drink'?next.drinks:next.supplies||[]).find(item=>item.id===id);
    const old=(previous.restockPreferences||[]).find(entry=>entry.kind===kind&&entry.itemId===id);
    const current=(next.restockPreferences||[]).find(entry=>entry.kind===kind&&entry.itemId===id);
    if(item?.stock>0&&old?.mode==='consider'&&current?.mode==='consider'&&old.updatedAt===current.updatedAt)fulfilled.set(`${kind}:${id}`,event.recorder);
  }
  return fulfilled.size?{...next,restockPreferences:(next.restockPreferences||[]).map(entry=>fulfilled.has(`${entry.kind}:${entry.itemId}`)?{kind:entry.kind,itemId:entry.itemId,mode:'normal',updatedAt:new Date().toISOString(),recorder:fulfilled.get(`${entry.kind}:${entry.itemId}`)}:entry)}:next;
}
