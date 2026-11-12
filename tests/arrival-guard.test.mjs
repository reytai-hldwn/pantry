import test from 'node:test';
import assert from 'node:assert/strict';
import { largeDrinkArrivals } from '../js/arrival-guard.js';

const drinks = [
  { id:'tea', name:'虛構紅茶', unit:'包', perCase:24 },
  { id:'juice', name:'虛構果汁', unit:'瓶', perCase:12, active:false },
  { id:'unknown', name:'待確認', unit:'罐', perCase:null },
];
const entry = (quantity, drinkId='tea') => ({kind:'drink', drinkId, quantity});

test('24 individual packs and exactly three cases pass; a mistaken 24 cases requires confirmation', () => {
  assert.deepEqual(largeDrinkArrivals([entry(24)],drinks),[]);
  assert.deepEqual(largeDrinkArrivals([entry(72)],drinks),[]);
  assert.equal(largeDrinkArrivals([entry(73)],drinks)[0].quantity,73);
  assert.deepEqual(largeDrinkArrivals([entry(576)],drinks),[{id:'tea',name:'虛構紅茶',unit:'包',quantity:576,limit:72}]);
});

test('batch rows for the same drink share one limit, while different drinks have separate limits', () => {
  assert.equal(largeDrinkArrivals([entry(40),entry(40)],drinks)[0].quantity,80);
  assert.deepEqual(largeDrinkArrivals([entry(40),entry(30,'juice')],drinks),[]);
  assert.equal(largeDrinkArrivals([entry(37,'juice')],drinks)[0].limit,36);
});

test('unknown case sizes, new products and snacks never use an invented case conversion', () => {
  assert.deepEqual(largeDrinkArrivals([entry(500,'unknown'),{...entry(500),isNew:true},{kind:'snack',supplyId:'tea',quantity:500}],drinks),[]);
});
