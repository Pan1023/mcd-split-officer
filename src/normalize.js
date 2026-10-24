'use strict';

/**
 * 归一化层：把 mcd-mcp 的原始响应转成拆单器认识的统一结构。
 *
 * 为什么要这一层？
 *   MCP 的字段名/枚举值会变，但"菜单、价格、券规则"的业务语义不会变。
 *   换版本时只改这个文件，optimizer / report 一行都不用动。
 *   如果控制台返回的字段名不一样，在这里加一个别名即可。
 */

const CATEGORY_TO_TAG = {
  burger: 'burger',
  汉堡: 'burger',
  汉堡包: 'burger',
  chicken: 'chicken',
  鸡肉: 'chicken',
  side: 'side',
  snack: 'side',
  小食: 'side',
  配餐: 'side',
  drink: 'drink',
  beverage: 'drink',
  饮料: 'drink',
  dessert: 'dessert',
  甜品: 'dessert',
  冰淇淋: 'dessert',
};

const COUPON_TYPE = {
  FULL_REDUCTION: 'threshold',
  THRESHOLD: 'threshold',
  FULL_CUT: 'threshold',
  满减: 'threshold',
  BUNDLE: 'bundle',
  COMBO: 'bundle',
  PAIR: 'bundle',
  组合: 'bundle',
  随心配: 'bundle',
  ITEM: 'item',
  SINGLE: 'item',
  单品: 'item',
  单品券: 'item',
};

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function inferTags(it) {
  const raw = pick(it, ['category', 'categoryName', 'type', 'class']);
  if (!raw) return [];
  return CATEGORY_TO_TAG[raw] ? [CATEGORY_TO_TAG[raw]] : [];
}

function normalizeMenu(raw) {
  const res = raw.result || raw.data || raw;
  const list = res.items || res.products || res.menu || [];
  const store = res.store || {};

  const items = list.map((it) => {
    const price = Number(pick(it, ['price', 'salePrice', 'currentPrice', 'unitPrice']));
    if (!isFinite(price)) throw new Error('菜单项缺价格: ' + JSON.stringify(it).slice(0, 80));
    return {
      id: String(pick(it, ['itemCode', 'itemId', 'id', 'code', 'sku'])),
      name: String(pick(it, ['itemName', 'name', 'title'])),
      price,
      tags: it.tags || inferTags(it),
      calories: pick(it, ['energyKcal', 'calories', 'kcal']) || null,
    };
  });

  return {
    store: { code: store.code || store.storeCode || '', name: store.name || store.storeName || '' },
    items,
  };
}

function normalizeCoupons(raw) {
  const res = raw.result || raw.data || raw;
  const list = res.coupons || res.list || res.vouchers || [];

  return list
    .map((c) => {
      const typeRaw = pick(c, ['couponType', 'type', 'kind']) || '';
      const type = COUPON_TYPE[typeRaw] || (c.itemId ? 'item' : c.threshold ? 'threshold' : 'bundle');
      const base = {
        id: String(pick(c, ['couponId', 'id', 'code']) || ''),
        type,
        note: pick(c, ['couponName', 'name', 'title']) || '',
      };

      const maxUses = pick(c, ['maxUses', 'useLimit', 'limitCount']);
      if (maxUses !== undefined) base.maxUses = Number(maxUses);

      if (type === 'threshold') {
        base.threshold = Number(pick(c, ['threshold', 'minAmount', 'condition']) || 0);
        base.discount = Number(pick(c, ['discount', 'offAmount', 'reduce']) || 0);
      } else if (type === 'bundle') {
        base.price = Number(pick(c, ['packagePrice', 'bundlePrice', 'price']) || 0);
        base.pick = Number(pick(c, ['pick', 'pickCount', 'quantity']) || 2);
        base.eligibleTags = pick(c, ['eligibleTags', 'tags']) || ['side', 'drink', 'dessert'];
      } else if (type === 'item') {
        base.itemId = String(pick(c, ['itemId', 'targetItem', 'sku']) || '');
        base.price = Number(pick(c, ['couponPrice', 'price', 'specialPrice']) || 0);
      }
      return base;
    })
    .filter((c) => {
      if (c.type === 'threshold') return c.threshold > 0 && c.discount > 0;
      if (c.type === 'bundle') return c.price > 0;
      if (c.type === 'item') return !!c.itemId && c.price > 0;
      return false;
    });
}

module.exports = { normalizeMenu, normalizeCoupons };
