const rulesService = require('../services/rulesService');
const { evaluateRule } = require('../engines/rules');
const productService = require('../services/productService');

const getRules = async (req, res) => {
  try {
    res.json({ success: true, rules: rulesService.getAll() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateRule = async (req, res) => {
  try {
    const { platform } = req.params;
    const rule = rulesService.update(platform, req.body);
    if (!rule) {
      return res.status(404).json({ success: false, message: `No rule for platform: ${platform}` });
    }
    res.json({ success: true, message: 'Rule updated', rule });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Dry-run: evaluate a platform's rule against the current catalog.
// Returns eligible products with computed prices plus skip reasons.
const preview = async (req, res) => {
  try {
    const { platform } = req.params;
    const rule = rulesService.getByPlatform(platform);
    if (!rule) {
      return res.status(404).json({ success: false, message: `No rule for platform: ${platform}` });
    }
    const products = await productService.getAll();
    const eligible = [];
    const skipped = {};
    for (const product of products) {
      const result = evaluateRule(product, rule);
      if (result.eligible) {
        eligible.push({
          id: product.id,
          title: product.title,
          isbn: product.isbn,
          base_price: product.price,
          external_price: result.price,
        });
      } else {
        const reason = result.reasons[0] || 'unknown';
        skipped[reason] = (skipped[reason] || 0) + 1;
      }
    }
    res.json({
      success: true,
      platform,
      rule,
      summary: { eligible: eligible.length, total: products.length, skipped },
      eligible,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getRules, updateRule, preview };
