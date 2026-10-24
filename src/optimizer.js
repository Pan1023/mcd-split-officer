'use strict';

/**
 * 拆单核心：把"一桌人要吃的 N 件商品"拆成 M 张订单，使得总价最低。
 *
 * 设计原则：钱只由代码算，不由模型算。
 *   - 所有价格用「分」做整数运算，避免浮点误差
 *   - 拆单是精确解（子集枚举 + 划分 DP），不是贪心近似
 *   - 一张订单最多用一张券（与线下规则一致）
 */

const MAX_EXACT_UNITS = 12; // 3^12 ≈ 53 万次枚举，纯 JS 也在毫秒级

const toCents = (v) => Math.round(Number(v) * 100);
const toYuan = (cents) => (cents / 100).toFixed(2);

function tagHit(unit, tags) {
  if (!tags || tags.length === 0) return false;
  return unit.tags.some((t) => tags.indexOf(t) !== -1);
}

/**
 * 券金额统一换成「分」。
 * 输入数据（MCP / JSON）里的金额都是元，这里一次性转换，
 * 之后所有比较和加减都在分上做整数运算，不会出现 21.900000001 这种鬼东西。
 */
function prepareCoupons(coupons) {
  return coupons.map((c) => {
    const n = Object.assign({}, c);
    if (c.type === 'threshold') {
      n.threshold = toCents(c.threshold);
      n.discount = toCents(c.discount);
    } else if (c.type === 'bundle' || c.type === 'item') {
      n.price = toCents(c.price);
    }
    return n;
  });
}


/**
 * 计算一个篮子（若干件商品）在各种券下的最低实付。
 * 返回 { paid, coupon }，paid 单位为分。
 */
function basketCost(units, coupons) {
  let base = 0;
  for (const u of units) base += u.price;

  let paid = base;
  let coupon = null;

  for (const c of coupons) {
    let candidate = null;

    if (c.type === 'threshold') {
      // 满减：整单门槛
      if (base >= c.threshold) candidate = base - c.discount;

    } else if (c.type === 'bundle') {
      // 组合价（如 1+1 随心配）：挑 pick 件符合范围的商品，按打包价结算
      const prices = [];
      for (const u of units) if (tagHit(u, c.eligibleTags)) prices.push(u.price);
      if (prices.length >= c.pick) {
        prices.sort((a, b) => b - a); // 用最贵的去凑，最划算
        let replaced = 0;
        for (let i = 0; i < c.pick; i++) replaced += prices[i];
        candidate = base - replaced + c.price;
      }

    } else if (c.type === 'item') {
      // 单品券：该商品一份按券价结算
      const hit = units.find((u) => u.itemId === c.itemId);
      if (hit) candidate = base - hit.price + c.price;
    }

    if (candidate !== null && candidate < paid) {
      paid = candidate;
      coupon = c;
    }
  }

  return { base, paid, coupon };
}

function buildUnits(people, menuIndex) {
  const units = [];
  people.forEach((p, pi) => {
    (p.items || []).forEach((it, ii) => {
      const meta = menuIndex[it.id];
      if (!meta) throw new Error('菜单里找不到商品 id: ' + it.id);
      const qty = it.qty || 1;
      for (let k = 0; k < qty; k++) {
        units.push({
          key: pi + '-' + ii + '-' + k,
          person: p.name,
          personIndex: pi,
          itemId: it.id,
          name: meta.name,
          price: toCents(meta.price),
          tags: meta.tags || [],
        });
      }
    });
  });
  return units;
}

/** 默认可用次数：满减/单品券一人一张只能用一次，组合价（1+1）可以反复点 */
function defaultMaxUses(type) {
  return type === 'bundle' ? 99 : 1;
}

/**
 * 把券分成「限量」和「不限次」两组。
 * 限量券按可用次数复制成多份，每份在 DP 里占一个状态位——
 * 这样"满减只能用一次"和"有两张同类券"都能被准确表达。
 * 最多跟踪 4 个状态位，超出的当不限次处理，避免状态爆炸。
 */
function splitCoupons(coupons) {
  const free = [];
  const limited = [];
  for (const c of coupons) {
    const max = c.maxUses == null ? defaultMaxUses(c.type) : c.maxUses;
    if (max >= 99) {
      free.push(c);
      continue;
    }
    let placed = 0;
    for (let i = 0; i < max && limited.length < 4; i++) {
      limited.push(Object.assign({}, c, { _copy: i }));
      placed++;
    }
    if (placed < max) free.push(c); // 状态位用完了，剩余次数按不限次处理
  }
  return { free, limited };
}

/**
 * 精确解。
 *
 * 难点：满减券只能用一次，所以不能简单地"每堆都配最省的券"——
 * 那样会算出"同一张券用了三遍"的假方案。
 * 于是 DP 的状态是 (已分配的商品集合, 已用掉的限量券集合)，
 * 逐堆枚举、按状态转移，保证结果一定能真的下出来。
 */
function solveExact(units, coupons) {
  const n = units.length;
  const size = 1 << n;
  const { free, limited } = splitCoupons(coupons);
  const L = limited.length;
  const S = 1 << L;
  const INF = Number.POSITIVE_INFINITY;

  const base = new Float64Array(size);
  const optPaid = new Array(size);
  const optCoupon = new Array(size);

  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    const idx = 31 - Math.clz32(low);
    base[mask] = base[mask ^ low] + units[idx].price;

    const members = [];
    for (let i = 0; i < n; i++) if ((mask >> i) & 1) members.push(units[i]);

    // 方案 0 = 不用券；1..L = 用第 j 张限量券；L+1 = 用最优的不限次券
    const paid = new Float64Array(L + 2).fill(INF);
    const cps = new Array(L + 2).fill(null);
    paid[0] = base[mask];

    for (let j = 0; j < L; j++) {
      const r = basketCost(members, [limited[j]]);
      paid[j + 1] = r.paid;
      cps[j + 1] = r.coupon;
    }
    if (free.length) {
      const r = basketCost(members, free);
      paid[L + 1] = r.paid;
      cps[L + 1] = r.coupon;
    }

    optPaid[mask] = paid;
    optCoupon[mask] = cps;
  }

  const dp = new Float64Array(size * S).fill(INF);
  const pickSub = new Int32Array(size * S);
  const pickOpt = new Int16Array(size * S);
  for (let used = 0; used < S; used++) dp[used] = 0; // 空集合，任何用量状态都合法

  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    for (let sub = mask; sub; sub = (sub - 1) & mask) {
      if (!(sub & low)) continue; // 固定最低位，避免同一划分被重复枚举
      const rest = mask ^ sub;
      const paid = optPaid[sub];
      for (let oi = 0; oi < paid.length; oi++) {
        const p = paid[oi];
        if (!isFinite(p)) continue;
        const isLimited = oi >= 1 && oi <= L;
        const bit = isLimited ? 1 << (oi - 1) : 0;
        for (let used = 0; used < S; used++) {
          if (isLimited && used & bit) continue; // 这张券已经用过了
          const prevUsed = isLimited ? used ^ bit : used;
          const prev = dp[rest * S + prevUsed];
          if (!isFinite(prev)) continue;
          const v = prev + p;
          const k = mask * S + used;
          if (v < dp[k]) {
            dp[k] = v;
            pickSub[k] = sub;
            pickOpt[k] = oi;
          }
        }
      }
    }
  }

  const full = size - 1;
  let bestUsed = 0;
  let bestTotal = INF;
  for (let used = 0; used < S; used++) {
    const v = dp[full * S + used];
    if (v < bestTotal) {
      bestTotal = v;
      bestUsed = used;
    }
  }

  const groups = [];
  let mask = full;
  let used = bestUsed;
  while (mask) {
    const k = mask * S + used;
    const sub = pickSub[k];
    const oi = pickOpt[k];
    const memberIdx = [];
    for (let i = 0; i < n; i++) if ((sub >> i) & 1) memberIdx.push(i);
    groups.push({
      units: memberIdx.map((i) => units[i]),
      base: base[sub],
      paid: optPaid[sub][oi],
      coupon: optCoupon[sub][oi],
    });
    const isLimited = oi >= 1 && oi <= L;
    if (isLimited) used ^= 1 << (oi - 1);
    mask ^= sub;
  }

  return { groups, exact: true, total: bestTotal };
}

/** 降级解：件数过多时按最贵优先分桶，保证永不崩 */
function solveGreedy(units, coupons) {
  const sorted = units.slice().sort((a, b) => b.price - a.price);
  const groups = [];
  const chunk = 4;
  for (let i = 0; i < sorted.length; i += chunk) {
    const part = sorted.slice(i, i + chunk);
    const best = basketCost(part, coupons);
    groups.push({ units: part, base: best.base, paid: best.paid, coupon: best.coupon });
  }
  const total = groups.reduce((s, g) => s + g.paid, 0);
  return { groups, exact: false, total };
}

/** 公平 AA：每单的优惠按「本人商品原价」占比分摊 */
function allocate(groups, people) {
  const pay = new Map();
  people.forEach((p) => pay.set(p.name, { own: 0, discount: 0, pay: 0 }));

  for (const g of groups) {
    const discount = g.base - g.paid;
    const ownSum = new Map();
    for (const u of g.units) {
      ownSum.set(u.person, (ownSum.get(u.person) || 0) + u.price);
    }
    for (const [name, own] of ownSum.entries()) {
      const share = g.base > 0 ? Math.round((discount * own) / g.base) : 0;
      const row = pay.get(name);
      row.own += own;
      row.discount += share;
      row.pay += own - share;
    }
  }
  return pay;
}

/**
 * 加购探测：只在两种"真的可能更划算"的情况下试探，不盲目枚举。
 *   A. 差一点到满减门槛（gap 在 8 元内）—— 补一件最便宜的够门槛商品
 *   B. 组合价还差一件配对 —— 补一件最便宜的合规商品
 */
function probeAdditions(units, coupons, menu, currentTotal) {
  const hints = [];
  if (units.length + 1 > MAX_EXACT_UNITS) return hints;

  const inOrder = new Set(units.map((u) => u.itemId));
  const pool = menu
    .filter((m) => !inOrder.has(m.id))
    .slice()
    .sort((a, b) => a.price - b.price);
  if (!pool.length) return hints;

  const unitOf = (m) => ({
    key: 'probe',
    person: '(加购)',
    personIndex: -1,
    itemId: m.id,
    name: m.name,
    price: toCents(m.price),
    tags: m.tags || [],
  });

  // A. 差一点到门槛
  let gap = null;
  for (const c of coupons) {
    if (c.type !== 'threshold') continue;
    const d = c.threshold - currentTotal;
    if (d > 0 && d <= 800 && (!gap || d < gap.d)) gap = { d, c };
  }
  if (gap) {
    const m = pool.find((p) => toCents(p.price) >= gap.d);
    if (m) {
      const r = solveExact(units.concat([unitOf(m)]), coupons);
      const delta = r.total - currentTotal;
      if (delta < 0) {
        hints.push({
          type: 'cheaper',
          saves: -delta,
          text:
            '再加 ¥' + toYuan(gap.d) + ' 就够「' + (gap.c.note || '满减') + '」：补 1 份「' +
            m.name + '」（¥' + toYuan(toCents(m.price)) + '），总价反而少 ¥' + toYuan(-delta) +
            '，变成 ¥' + toYuan(r.total),
        });
      } else {
        hints.push({
          type: 'gap',
          saves: 0,
          text:
            '还差 ¥' + toYuan(gap.d) + ' 到「' + (gap.c.note || '满减') + '」，最便宜的补法是加 1 份「' +
            m.name + '」（¥' + toYuan(toCents(m.price)) + '），补完总价 ¥' + toYuan(r.total) +
            '，比现在多花 ¥' + toYuan(delta),
        });
      }
    }
  }

  // B. 组合价差一件配对
  for (const c of coupons) {
    if (c.type !== 'bundle') continue;
    const cnt = units.filter((u) => tagHit(u, c.eligibleTags)).length;
    if (cnt % c.pick === 0) continue;
    const candidates = pool.filter((m) => (m.tags || []).some((t) => (c.eligibleTags || []).indexOf(t) !== -1));
    if (!candidates.length) continue;
    const m = candidates[0];
    const r = solveExact(units.concat([unitOf(m)]), coupons);
    const delta = r.total - currentTotal;
    if (delta < 0) {
      hints.push({
        type: 'cheaper',
        saves: -delta,
        text:
          '加 1 份「' + m.name + '」（¥' + toYuan(toCents(m.price)) + '）刚好再凑一个「' +
          (c.note || '组合价') + '」，总价反而少 ¥' + toYuan(-delta),
      });
    }
  }

  hints.sort((a, b) => b.saves - a.saves);
  return hints.slice(0, 3);
}

function solve({ people, menu, coupons }) {
  const menuIndex = {};
  for (const m of menu) menuIndex[m.id] = m;

  const cps = prepareCoupons(coupons);
  const units = buildUnits(people, menuIndex);
  if (units.length === 0) {
    return { groups: [], exact: true, total: 0, base: 0, saved: 0, units: [], perPerson: new Map(), hints: [] };
  }

  const raw = units.length <= MAX_EXACT_UNITS ? solveExact(units, cps) : solveGreedy(units, cps);
  const baseTotal = units.reduce((s, u) => s + u.price, 0);

  return {
    groups: raw.groups.map((g) => ({ ...g, saved: g.base - g.paid })),
    exact: raw.exact,
    total: raw.total,
    base: baseTotal,
    saved: baseTotal - raw.total,
    units,
    perPerson: allocate(raw.groups, people),
    hints: probeAdditions(units, cps, menu, raw.total),
  };
}

module.exports = { solve, toCents, toYuan, basketCost, prepareCoupons, buildUnits, MAX_EXACT_UNITS };

