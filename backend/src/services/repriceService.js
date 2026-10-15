const productService = require('./productService');

// PricePartner-style bulk reprice (C-7, learned from HomeBase): adjust the
// *effective* (overlay) price of a selection by ± percent, ± amount, or set to
// a value. Prices are Shopify truth — so a reprice never writes products.price;
// it applies local overlay edits (journaled in product_changes, peelable per
// book). Two-phase: dry_run returns the diff; commit applies it.

const MODES = new Set(['percent', 'amount', 'set']);
const MAX_IDS = 1000;

const round2 = (n) => Math.round(n * 100) / 100;

const computeNewPrice = (currentPrice, mode, value) => {
  const base = Number(currentPrice);
  if (!Number.isFinite(base) || base < 0) {
    return { ok: false, reason: `invalid current price: ${currentPrice}` };
  }
  const v = Number(value);
  if (!Number.isFinite(v)) {
    return { ok: false, reason: `invalid value: ${value}` };
  }
  let next;
  if (mode === 'percent') next = base * (1 + v / 100);
  else if (mode === 'amount') next = base + v;
  else next = v;
  next = round2(next);
  if (!Number.isFinite(next) || next <= 0) {
    return { ok: false, reason: `computed price ${next} is not positive` };
  }
  return { ok: true, price: next };
};

// Returns { rows, applied, skipped } — rows always carry the diff for preview.
const reprice = async (productIds, mode, value, { dryRun = false } = {}) => {
  const ids = Array.isArray(productIds) ? productIds : [];
  if (ids.length === 0) throw new Error('no products selected');
  if (ids.length > MAX_IDS) throw new Error(`too many products (max ${MAX_IDS})`);
  if (!MODES.has(mode)) throw new Error(`invalid mode: ${mode}`);

  const rows = [];
  let applied = 0;
  let skipped = 0;

  for (const id of ids) {
    const product = await productService.getById(id);
    if (!product) {
      skipped++;
      rows.push({ product_id: id, title: null, from: null, to: null, skipped: true, reason: 'not found' });
      continue;
    }
    const computed = computeNewPrice(product.price, mode, value);
    if (!computed.ok) {
      skipped++;
      rows.push({ product_id: id, title: product.title, from: product.price, to: null, skipped: true, reason: computed.reason });
      continue;
    }
    if (computed.price === Number(product.price)) {
      rows.push({ product_id: id, title: product.title, from: product.price, to: computed.price, skipped: false, unchanged: true });
      continue;
    }
    if (!dryRun) {
      await productService.applyEdit(id, { price: computed.price });
      applied++;
    }
    rows.push({ product_id: id, title: product.title, from: product.price, to: computed.price, skipped: false, unchanged: false, applied: !dryRun });
  }

  return { rows, applied, skipped, dry_run: dryRun };
};

module.exports = { reprice, computeNewPrice, MODES, MAX_IDS };
