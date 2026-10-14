const { db, query } = require('../config/database');

class RulesService {
  getAll() {
    const rows = query('SELECT * FROM sync_rules ORDER BY platform').rows;
    return rows.map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
      auto_sync: Boolean(row.auto_sync),
      conditions: JSON.parse(row.conditions || '{}'),
      price_modifier: JSON.parse(row.price_modifier || '{}'),
    }));
  }

  getByPlatform(platform) {
    const row = query('SELECT * FROM sync_rules WHERE platform = ?', [platform]).rows[0];
    if (!row) return null;
    return {
      ...row,
      enabled: Boolean(row.enabled),
      auto_sync: Boolean(row.auto_sync),
      conditions: JSON.parse(row.conditions || '{}'),
      price_modifier: JSON.parse(row.price_modifier || '{}'),
    };
  }

  // Validate + persist a rule update. Unknown keys are rejected.
  update(platform, { enabled, auto_sync, conditions, price_modifier }) {
    const existing = this.getByPlatform(platform);
    if (!existing) return null;

    const nextConditions = conditions === undefined ? existing.conditions : conditions;
    const nextModifier = price_modifier === undefined ? existing.price_modifier : price_modifier;

    if (!this.validateConditions(nextConditions) || !this.validatePriceModifier(nextModifier)) {
      throw new Error('invalid rule payload');
    }

    query(
      `UPDATE sync_rules
       SET enabled = ?, auto_sync = ?, conditions = ?, price_modifier = ?
       WHERE platform = ?`,
      [
        enabled === undefined ? existing.enabled : enabled ? 1 : 0,
        auto_sync === undefined ? existing.auto_sync : auto_sync ? 1 : 0,
        JSON.stringify(nextConditions),
        JSON.stringify(nextModifier),
        platform,
      ]
    );
    return this.getByPlatform(platform);
  }

  validateConditions(c = {}) {
    const allowed = new Set([
      'min_price',
      'max_price',
      'conditions',
      'year_before',
      'year_after',
      'vintage_only',
      'tags_any',
      'tags_all',
      'category_any',
      'requires_images',
    ]);
    for (const key of Object.keys(c)) {
      if (!allowed.has(key)) return false;
    }
    if (c.conditions !== undefined && !Array.isArray(c.conditions)) return false;
    if (c.tags_any !== undefined && !Array.isArray(c.tags_any)) return false;
    if (c.tags_all !== undefined && !Array.isArray(c.tags_all)) return false;
    if (c.category_any !== undefined && !Array.isArray(c.category_any)) return false;
    for (const key of ['min_price', 'max_price', 'year_before', 'year_after']) {
      if (c[key] !== undefined && !Number.isFinite(Number(c[key]))) return false;
    }
    return true;
  }

  validatePriceModifier(m = {}) {
    const allowed = new Set(['multiplier', 'fixed_fee', 'min_price', 'rounding']);
    for (const key of Object.keys(m)) {
      if (!allowed.has(key)) return false;
    }
    for (const key of ['multiplier', 'fixed_fee', 'min_price']) {
      if (m[key] !== undefined && !Number.isFinite(Number(m[key]))) return false;
    }
    if (m.multiplier !== undefined && Number(m.multiplier) < 0) return false;
    if (m.rounding !== undefined && !['none', 'up_x99'].includes(m.rounding)) return false;
    return true;
  }
}

module.exports = new RulesService();
