#!/usr/bin/env node
'use strict';

/**
 * 命令行入口：喂归一化后的三份 JSON，出方案。
 *
 *   node bin/split.js \
 *     --menu data/menu.sample.json \
 *     --coupons data/coupons.sample.json \
 *     --people data/people.sample.json \
 *     --out out
 *
 * Skill 在真实链路里的用法：先调 MCP 拿菜单和券，写进临时 JSON，
 * 再调这个脚本算钱——模型只负责解析需求和组织语言。
 */

const fs = require('fs');
const path = require('path');
const { solve, toYuan } = require('../src/optimizer');
const { formatReport, renderCardHtml } = require('../src/report');

function parseArgs(argv) {
  const args = { out: 'out', json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--menu') args.menu = argv[++i];
    else if (a === '--coupons') args.coupons = argv[++i];
    else if (a === '--people') args.people = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const HELP = [
  '麦麦拆单官 CLI',
  '',
  '  --menu    菜单 JSON（items: [{id,name,price,tags}]）',
  '  --coupons 券 JSON（coupons: [...]）',
  '  --people  人 JSON（people: [{name, items:[{id,qty}]}]）',
  '  --out     输出目录，默认 out',
  '  --json    只打印 JSON',
].join('\n');

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.menu || !args.coupons || !args.people) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
  const menuFile = readJson(args.menu);
  const couponFile = readJson(args.coupons);
  const peopleFile = readJson(args.people);

  const menu = menuFile.items || menuFile;
  const coupons = couponFile.coupons || couponFile;
  const people = peopleFile.people || peopleFile;

  const result = solve({ people, menu, coupons });
  const ctx = {
    title: '麦麦拆单官',
    store: (menuFile.store && menuFile.store.name) || '麦当劳',
    time: new Date().toISOString().slice(0, 16).replace('T', ' '),
    people,
  };

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          base: toYuan(result.base),
          total: toYuan(result.total),
          saved: toYuan(result.saved),
          exact: result.exact,
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
        },
        null,
        2
      )
    );
    return;
  }

  console.log(formatReport(result, ctx));

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'split-card.html'), renderCardHtml(result, ctx), 'utf8');
  console.log('\n战绩表已写入 ' + path.join(outDir, 'split-card.html'));
}

try {
  main();
} catch (e) {
  console.error('运行失败：' + e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
}
