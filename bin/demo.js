#!/usr/bin/env node
'use strict';

/**
 * 离线演示：不需要 MCP Token、不需要联网、不需要 npm install。
 * 用录制的 mcd-mcp 响应，完整跑通「归一化 → 拆单 → 报告 → 战绩表」。
 *
 *   node bin/demo.js          场景一：4 人拼单，看能省多少
 *   node bin/demo.js --gap    场景二：差一点到门槛，看加购建议
 */

const fs = require('fs');
const path = require('path');
const { solve, toYuan } = require('../src/optimizer');
const { normalizeMenu, normalizeCoupons } = require('../src/normalize');
const { formatReport, renderCardHtml } = require('../src/report');

const ROOT = path.join(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
const GAP_MODE = process.argv.slice(2).indexOf('--gap') !== -1;

function loadInputs() {
  if (GAP_MODE) {
    // 场景二直接读归一化后的 JSON，走的是和 CLI 一样的路径
    const menu = readJson('data/menu.sample.json');
    return {
      store: menu.store,
      menu: menu.items,
      coupons: readJson('data/coupons.gap.json').coupons,
      people: readJson('data/people.gap.json').people,
    };
  }
  // 场景一走 MCP 录制响应，连归一化层一起跑
  const menu = normalizeMenu(readJson('fixtures/mcp-menu-response.json'));
  return {
    store: menu.store,
    menu: menu.items,
    coupons: normalizeCoupons(readJson('fixtures/mcp-coupons-response.json')),
    people: readJson('data/people.sample.json').people,
  };
}

function main() {
  const input = loadInputs();

  console.log(
    '载入完成：' + input.menu.length + ' 个商品 / ' + input.coupons.length + ' 张券 / ' +
    input.people.length + ' 个人' + (GAP_MODE ? '（场景二：差一点到门槛）' : '')
  );
  console.log('');

  const result = solve({ people: input.people, menu: input.menu, coupons: input.coupons });

  const now = new Date();
  const ctx = {
    title: '麦麦拆单官',
    store: input.store.name || '麦当劳',
    time:
      now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
      ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()),
    people: input.people,
  };

  console.log(formatReport(result, ctx));

  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const cardName = GAP_MODE ? 'split-card-gap.html' : 'split-card.html';
  fs.writeFileSync(path.join(outDir, cardName), renderCardHtml(result, ctx), 'utf8');

  const payload = {
    store: input.store,
    people: input.people.map((p) => p.name),
    exact: result.exact,
    base: toYuan(result.base),
    total: toYuan(result.total),
    saved: toYuan(result.saved),
    groups: result.groups.map((g) => ({
      coupon: g.coupon ? g.coupon.note : null,
      paid: toYuan(g.paid),
      items: g.units.map((u) => ({ name: u.name, person: u.person, price: toYuan(u.price) })),
    })),
    perPerson: Array.from(result.perPerson.entries()).map(([name, r]) => ({
      name,
      own: toYuan(r.own),
      pay: toYuan(r.pay),
    })),
    hints: result.hints.map((h) => h.text),
  };
  const jsonName = GAP_MODE ? 'result-gap.json' : 'result.json';
  fs.writeFileSync(path.join(outDir, jsonName), JSON.stringify(payload, null, 2), 'utf8');

  console.log('');
  console.log('已生成 out/' + cardName + '（可直接截图发群）和 out/' + jsonName);
}

try {
  main();
} catch (e) {
  console.error('运行失败：' + e.message);
  console.error(e.stack);
  process.exit(1);
}
