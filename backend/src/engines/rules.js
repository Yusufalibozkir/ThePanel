// Rules evaluation engine (pure).
//
// A sync rule has:
//   enabled        — master switch
//   conditions     — product filters (see matchesConditions)
//   price_modifier — inputs for the pricing engine
//
// Metadata-dependent conditions (conditions[], year_before/year_after,
// vintage_only) cause products with metadata_status = 'missing' to be skipped
// with reason 'metadata_missing' so they surface in the Needs-metadata view.

const { computePrice } = require('./pricing');

const METADATA_DEPENDENT_KEYS = ['conditions', 'year_before', 'year_after', 'vintage_only'];

const productYear = (product) => {
  const meta = typeof product.metadata === 'string' ? safeParse(product.metadata) : product.metadata || {};
  const year = meta.year ?? product.year;
  const parsed = parseInt(year, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const productTags = (product) => {
  const meta = typeof product.metadata === 'string' ? safeParse(product.metadata) : product.metadata || {};
  const tags = meta.tags ?? product.tags ?? [];
  return Array.isArray(tags) ? tags.map((t) => String(t).toLowerCase()) : [];
};

const safeParse = (json) => {
  try {
    return JSON.parse(json || '{}');
  } catch {
    return {};
  }
};

const matchesConditions = (product, conditions = {}) => {
  const reasons = [];

  if (conditions.min_price !== undefined) {
    if (!(product.price >= Number(conditions.min_price))) {
      reasons.push(`base price ${product.price} < min_price ${conditions.min_price}`);
    }
  }
  if (conditions.max_price !== undefined) {
    if (!(product.price <= Number(conditions.max_price))) {
      reasons.push(`base price ${product.price} > max_price ${conditions.max_price}`);
    }
  }
  if (Array.isArray(conditions.conditions) && conditions.conditions.length > 0) {
    if (!conditions.conditions.includes(product.condition)) {
      reasons.push(`condition '${product.condition || 'none'}' not in [${conditions.conditions.join(', ')}]`);
    }
  }
  if (conditions.year_before !== undefined) {
    const year = productYear(product);
    if (year === null || !(year <= Number(conditions.year_before))) {
      reasons.push(`year ${year ?? 'unknown'} not <= ${conditions.year_before}`);
    }
  }
  if (conditions.year_after !== undefined) {
    const year = productYear(product);
    if (year === null || !(year >= Number(conditions.year_after))) {
      reasons.push(`year ${year ?? 'unknown'} not >= ${conditions.year_after}`);
    }
  }
  if (conditions.vintage_only) {
    // vintage_only requires year_before to be set (default 20 years back is
    // applied by the caller/seeder; here we just enforce cutoff compliance)
    if (conditions.year_before === undefined) {
      reasons.push('vintage_only requires year_before');
    }
    // year_before check above already enforces the cutoff
  }
  if (Array.isArray(conditions.tags_any) && conditions.tags_any.length > 0) {
    const tags = productTags(product);
    const wanted = conditions.tags_any.map((t) => String(t).toLowerCase());
    if (!wanted.some((t) => tags.includes(t))) {
      reasons.push(`none of tags_any [${wanted.join(', ')}] present`);
    }
  }
  if (Array.isArray(conditions.tags_all) && conditions.tags_all.length > 0) {
    const tags = productTags(product);
    const wanted = conditions.tags_all.map((t) => String(t).toLowerCase());
    const missing = wanted.filter((t) => !tags.includes(t));
    if (missing.length > 0) {
      reasons.push(`missing tags_all [${missing.join(', ')}]`);
    }
  }
  if (conditions.requires_images) {
    const images = Array.isArray(product.images) ? product.images : safeParseArray(product.images);
    if (!images || images.length === 0) {
      reasons.push('no images');
    }
  }

  return reasons;
};

const safeParseArray = (json) => {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const isMetadataDependent = (conditions = {}) =>
  METADATA_DEPENDENT_KEYS.some((key) => conditions[key] !== undefined);

// Evaluate a rule against a product.
// Returns { eligible, price, reasons } — never throws.
const evaluateRule = (product, rule) => {
  const conditions = rule.conditions || {};
  const reasons = [];

  if (!rule.enabled) {
    return { eligible: false, price: null, reasons: ['rule disabled'] };
  }

  if (product.quantity <= 0) {
    return { eligible: false, price: null, reasons: ['not in stock (single-copy model)'] };
  }

  if (isMetadataDependent(conditions) && product.metadata_status === 'missing') {
    return { eligible: false, price: null, reasons: ['metadata_missing'] };
  }

  reasons.push(...matchesConditions(product, conditions));
  if (reasons.length > 0) {
    return { eligible: false, price: null, reasons };
  }

  const priced = computePrice(product.price, rule.price_modifier);
  if (!priced.ok) {
    return { eligible: false, price: null, reasons: [priced.reason] };
  }

  return { eligible: true, price: priced.price, reasons: [] };
};

module.exports = {
  evaluateRule,
  matchesConditions,
  isMetadataDependent,
};
