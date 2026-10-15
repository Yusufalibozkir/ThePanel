// Pricing engine (pure).
//
//   platform_price = max( base_price * multiplier + fixed_fee , min_price )
//   then apply rounding rule (default: round up to X.99)
//
// Guardrails: never list below min_price; skip (with reason) if the computed
// price is below cost or above max_price.

const ROUNDING_RULES = {
  none: (price) => price,
  // Round up to the next whole-dollar .99 (6.20 -> 6.99, 7.00 -> 7.99).
  // Never lands below the input price.
  up_x99: (price) => {
    if (!Number.isFinite(price) || price <= 0) return price;
    const cents = Math.round(price * 100);
    if (cents % 100 === 99) return cents / 100;
    return Math.floor(cents / 100) + 1 - 0.01;
  },
};

const round2 = (price) => Math.round(price * 100) / 100;

// Returns { ok: true, price } or { ok: false, reason } — never throws.
const computePrice = (basePrice, priceModifier = {}) => {
  const base = Number(basePrice);
  if (!Number.isFinite(base) || base < 0) {
    return { ok: false, reason: `invalid base price: ${basePrice}` };
  }

  const multiplier = priceModifier.multiplier === undefined ? 1 : Number(priceModifier.multiplier);
  const fixedFee = Number(priceModifier.fixed_fee || 0);
  const minPrice = Number(priceModifier.min_price || 0);
  const rounding = priceModifier.rounding || 'up_x99';

  if (!Number.isFinite(multiplier) || multiplier < 0) {
    return { ok: false, reason: `invalid multiplier: ${priceModifier.multiplier}` };
  }
  const rule = ROUNDING_RULES[rounding];
  if (!rule) {
    return { ok: false, reason: `unknown rounding rule: ${rounding}` };
  }

  let price = base * multiplier + fixedFee;
  if (Number.isFinite(minPrice) && minPrice > 0) {
    price = Math.max(price, minPrice);
  }
  price = rule(price);
  // min_price is a floor; rounding up can only exceed it
  if (Number.isFinite(minPrice) && minPrice > 0 && price < minPrice) {
    price = minPrice;
  }
  price = round2(price);

  const cost = Number(priceModifier.cost);
  if (Number.isFinite(cost) && cost > 0 && price < cost) {
    return { ok: false, reason: `computed price ${price.toFixed(2)} is below cost ${cost.toFixed(2)}` };
  }

  // Ceiling guardrail: a corrupt source price or bad multiplier surfaces as a
  // skip-with-reason, never as a live absurd listing (competitor failure F-3:
  // prices silently pushed to zero / nonsense at channel).
  const maxPrice = Number(priceModifier.max_price);
  if (Number.isFinite(maxPrice) && maxPrice > 0 && price > maxPrice) {
    return { ok: false, reason: `computed price ${price.toFixed(2)} exceeds max_price ${maxPrice.toFixed(2)}` };
  }

  return { ok: true, price };
};

module.exports = {
  computePrice,
  ROUNDING_RULES,
};
