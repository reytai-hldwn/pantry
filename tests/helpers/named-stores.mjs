// Existing domain fixtures use an explicitly named test actor.
import {InventoryStore} from '../../js/store.js';
import {GoogleInventoryStore} from '../../js/google-store.js';
export class NamedInventoryStore extends InventoryStore {
  constructor(...args){super(...args);this.setRestockName('測試管理者');}
}
export class NamedGoogleInventoryStore extends GoogleInventoryStore {
  constructor(...args){super(...args);this.setRestockName('測試管理者');}
}
