#!/usr/bin/env node
'use strict';

/**
 * 自检：不依赖 MCP，用几个能手算的小例子核对核心逻辑。
 *
 *   node bin/selftest.js
 */

const assert = require('assert');
const { solve, toYuan } = require('../src/optimizer');

const menu = [
  { id: 'burger', name: '汉堡', price: 25.0, tags: ['burger'] },
  { id: 'drink', name: '饮料', price: 10.5, tags: ['drink'] },
];

const cases = [];

function run(name, { people, coupons, expect }) {
  const r = solve({ people, menu, coupons });
  cases.push({ name, got: toYuan(r.total), expect: expect.toFixed(2), exact: r.exact });
}

// 1) 组合价：两杯 10.5 的饮料用 1+1（13.9）→ 13.90
run('bundle 1+1 应取代两件小食/饮料', {
  people: [{ name: 'A', items: [{ id: 'drink', qty: 2 }] }],
  coupons: [{ id: 'oao', type: 'bundle', price: 13.9, pick: 2, eligibleTags: ['drink', 'side', 'dessert'] }],
  expect: 13.9,
});

// 2) 满减：3 个汉堡 75 元，满 40 减 8 → 67.00
run('满减应作用于整单', {
  people: [{ name: 'A', items: [{ id: 'burger', qty: 3 }] }],
  coupons: [{ id: 'f40', type: 'threshold', threshold: 40, discount: 8 }],
  expect: 67.0,
});

// 3) 组合价 + 满减 必须拆成两单才最优：
//    饮料走 1+1（13.9），两个汉堡 50 走满 40 减 8（42）→ 合计 55.90
run('拆单应优于一次性满减（63.00）', {
  people: [{ name: 'A', items: [{ id: 'burger', qty: 2 }, { id: 'drink', qty: 2 }] }],
  coupons: [
    { id: 'oao', type: 'bundle', price: 13.9, pick: 2, eligibleTags: ['drink'] },
    { id: 'f40', type: 'threshold', threshold: 40, discount: 8 },
  ],
  expect: 55.9,
});

// 4) 单品券：25 元的汉堡用 19 元券 → 19.00
run('单品券应按券价结算一份', {
  people: [{ name: 'A', items: [{ id: 'burger', qty: 1 }] }],
  coupons: [{ id: 'b19', type: 'item', itemId: 'burger', price: 19 }],
  expect: 19.0,
});

// 5) 无券时应等于原价
run('没有券时不应改动总价', {
  people: [{ name: 'A', items: [{ id: 'burger', qty: 2 }] }],
  coupons: [],
  expect: 50.0,
});

// 6) 满减只能用一次：4 个汉堡 100 元，拆成 50+50 各用一次是做不到的
//    正确结果 = 一单 50-8=42，另一单原价 50 → 92.00
run('满减券默认只能用一次，不应被重复使用', {
  people: [{ name: 'A', items: [{ id: 'burger', qty: 4 }] }],
  coupons: [{ id: 'f40', type: 'threshold', threshold: 40, discount: 8 }],
  expect: 92.0,
});

// 7) 显式声明有两次可用时，才允许拆成两单各减一次 → 84.00
run('声明 maxUses=2 时应允许用两次', {
  people: [{ name: 'A', items: [{ id: 'burger', qty: 4 }] }],
  coupons: [{ id: 'f40', type: 'threshold', threshold: 40, discount: 8, maxUses: 2 }],
  expect: 84.0,
});

let failed = 0;
for (const c of cases) {
  const ok = c.got === c.expect;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + c.name + '  期望 ' + c.expect + ' / 实得 ' + c.got);
}

// 6) 一致性检查：每件商品恰好出现在一单里，且总价等于各单之和
const demoPeople = require('../data/people.sample.json').people;
const demoMenu = require('../data/menu.sample.json').items;
const demoCoupons = require('../data/coupons.sample.json').coupons;
const r = solve({ people: demoPeople, menu: demoMenu, coupons: demoCoupons });

try {
  const inGroups = r.groups.reduce((s, g) => s + g.units.length, 0);
  assert.strictEqual(inGroups, r.units.length, '有商品在一次拆单里丢了或重复了');
  const sumPaid = r.groups.reduce((s, g) => s + g.paid, 0);
  assert.strictEqual(sumPaid, r.total, '各单之和与总价不一致');
  assert.ok(r.total <= r.base, '拆完比原价还贵');
  console.log('PASS 一致性：' + r.units.length + ' 件商品全部分配，各单合计 ' + toYuan(r.total));
  console.log(
    '     演示场景基准：原价 ' + toYuan(r.base) + ' → 最优 ' + toYuan(r.total) +
    '，省 ' + toYuan(r.saved) + '，共 ' + r.groups.length + ' 单',
    '（README 首屏的数字应与此一致）'
  );
} catch (e) {
  failed++;
  console.log('FAIL 一致性：' + e.message);
}

console.log('');
console.log(failed === 0 ? '全部通过（' + (cases.length + 1) + ' 项）' : failed + ' 项未通过');
process.exit(failed === 0 ? 0 : 1);
