'use strict';

const { toYuan } = require('./optimizer');

function y(cents) {
  return '¥' + toYuan(cents);
}

function couponLabel(c) {
  if (!c) return '无券';
  if (c.type === 'threshold') return c.note || '满' + toYuan(c.threshold) + '减' + toYuan(c.discount);
  if (c.type === 'bundle') return c.note || '组合价' + toYuan(c.price);
  if (c.type === 'item') return c.note || '单品券' + toYuan(c.price);
  return c.id;
}

function formatReport(result, ctx) {
  const lines = [];
  const bar = '─'.repeat(46);
  const savedRate = result.base > 0 ? ((result.saved / result.base) * 100).toFixed(1) : '0.0';

  lines.push(bar);
  lines.push('  ' + (ctx.title || '麦麦拆单官') + ' · ' + ctx.people.length + ' 人拼单');
  lines.push(bar);
  if (ctx.store) lines.push('门店：' + ctx.store);
  if (ctx.time) lines.push('时间：' + ctx.time);

  lines.push('');
  lines.push('原价合计   ' + y(result.base));
  lines.push('拆单后     ' + y(result.total) + '    省 ' + y(result.saved) + '（' + savedRate + '%）');
  lines.push('解法       ' + (result.exact ? '精确最优（子集枚举 + 划分 DP）' : '件数过多，已降级为贪心近似'));

  lines.push('');
  lines.push('【拆单方案】共 ' + result.groups.length + ' 单');
  result.groups.forEach((g, i) => {
    lines.push('');
    lines.push(' 单 ' + (i + 1) + '  ' + couponLabel(g.coupon));
    for (const u of g.units) {
      lines.push('   ' + u.name + '        ' + y(u.price) + '   [' + u.person + ']');
    }
    const save = g.base - g.paid;
    lines.push('   小计 ' + y(g.paid) + (save > 0 ? '（省 ' + y(save) + '）' : ''));
  });

  lines.push('');
  lines.push('【每人应付】优惠按各自商品金额占比分摊');
  if (result.perPerson && result.perPerson.size) {
    for (const [name, row] of result.perPerson.entries()) {
      lines.push(
        '  ' + name + '   原 ' + y(row.own) + ' → 付 ' + y(row.pay) + '（摊到 ' + y(row.discount) + ' 优惠）'
      );
    }
  }

  if (result.hints && result.hints.length) {
    lines.push('');
    lines.push('【还能再省？】');
    for (const h of result.hints) lines.push('  · ' + h.text);
  }

  lines.push('');
  lines.push('提示：价格与优惠以到店/小程序实际结算为准。非麦当劳官方产品。');
  return lines.join('\n');
}

const CARD_CSS = `
  :root{--red:#DA291C;--yellow:#FFC72C;--ink:#14161B;--line:#2A2E38;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#0E1014;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
       padding:24px;display:flex;justify-content:center;}
  .card{width:420px;background:var(--ink);border:2px solid var(--line);border-radius:14px;
        padding:22px 20px 18px;color:#F2F4F8;box-shadow:6px 6px 0 #000;}
  .top{display:flex;align-items:baseline;justify-content:space-between;}
  .brand{font-size:15px;font-weight:600;letter-spacing:.5px;}
  .brand i{display:inline-block;width:8px;height:8px;background:var(--yellow);border-radius:2px;
           margin-right:7px;vertical-align:middle;}
  .meta{font-size:11px;color:#7C8496;}
  .hero{margin:16px 0 4px;padding:14px 16px;background:#1A1D24;border-radius:10px;
        border-left:4px solid var(--yellow);}
  .hero .k{font-size:11px;color:#8B93A5;}
  .hero .v{font-size:30px;font-weight:700;color:var(--yellow);line-height:1.25;}
  .hero .sub{font-size:11px;color:#8B93A5;margin-top:2px;}
  .sec{margin-top:16px;font-size:11px;color:#7C8496;letter-spacing:1px;}
  .grp{margin-top:8px;border:1px solid var(--line);border-radius:10px;overflow:hidden;}
  .grp .hd{background:#1A1D24;padding:7px 12px;font-size:11px;color:var(--yellow);
           display:flex;justify-content:space-between;}
  .row{display:flex;justify-content:space-between;padding:6px 12px;font-size:12.5px;}
  .row span:last-child{color:#C9D0DC;}
  .who{color:#6E7686;font-size:11px;margin-left:6px;}
  .tot{display:flex;justify-content:space-between;padding:8px 12px;border-top:1px dashed var(--line);
       font-size:12px;color:#F2F4F8;}
  .pp{display:flex;justify-content:space-between;font-size:12.5px;padding:5px 2px;}
  .pp b{color:var(--yellow);font-weight:600;}
  .hint{margin-top:14px;background:#241B1A;border:1px solid #4A2724;border-radius:10px;
        padding:10px 12px;font-size:11.5px;color:#F0B8B2;line-height:1.7;}
  .foot{margin-top:14px;font-size:10px;color:#5B6272;display:flex;justify-content:space-between;}
`;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderCardHtml(result, ctx) {
  const savedRate = result.base > 0 ? ((result.saved / result.base) * 100).toFixed(1) : '0.0';

  const groups = result.groups
    .map((g, i) => {
      const rows = g.units
        .map(
          (u) =>
            '<div class="row"><span>' +
            esc(u.name) +
            '<span class="who">' +
            esc(u.person) +
            '</span></span><span>' +
            y(u.price) +
            '</span></div>'
        )
        .join('');
      const save = g.base - g.paid;
      return (
        '<div class="grp"><div class="hd"><span>单 ' +
        (i + 1) +
        ' · ' +
        esc(couponLabel(g.coupon)) +
        '</span><span>' +
        (save > 0 ? '省 ' + y(save) : '') +
        '</span></div>' +
        rows +
        '<div class="tot"><span>小计</span><span>' +
        y(g.paid) +
        '</span></div></div>'
      );
    })
    .join('');

  let perPerson = '';
  if (result.perPerson && result.perPerson.size) {
    perPerson =
      '<div class="sec">每人应付</div>' +
      Array.from(result.perPerson.entries())
        .map(
          ([name, row]) =>
            '<div class="pp"><span>' +
            esc(name) +
            '<span class="who">原 ' +
            y(row.own) +
            '</span></span><b>' +
            y(row.pay) +
            '</b></div>'
        )
        .join('');
  }

  const hints =
    result.hints && result.hints.length
      ? '<div class="hint">' +
        result.hints.map((h) => '· ' + esc(h.text)).join('<br>') +
        '</div>'
      : '';

  return (
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>拼单战绩表</title><style>' +
    CARD_CSS +
    '</style></head><body><div class="card">' +
    '<div class="top"><div class="brand"><i></i>拼单战绩表</div><div class="meta">' +
    esc(ctx.people.length) +
    ' 人 · ' +
    esc(ctx.store || '麦当劳') +
    '</div></div>' +
    '<div class="hero"><div class="k">这一单总共省下</div><div class="v">' +
    y(result.saved) +
    '</div><div class="sub">原价 ' +
    y(result.base) +
    ' → 拆单后 ' +
    y(result.total) +
    '　省 ' +
    savedRate +
    '%</div></div>' +
    '<div class="sec">拆单方案 · ' +
    result.groups.length +
    ' 单</div>' +
    groups +
    perPerson +
    hints +
    '<div class="foot"><span>麦麦拆单官 · 非官方项目</span><span>' +
    esc(ctx.time || '') +
    '</span></div>' +
    '</div></body></html>'
  );
}

module.exports = { formatReport, renderCardHtml, couponLabel };
