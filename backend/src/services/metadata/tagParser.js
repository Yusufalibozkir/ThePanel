// Book metadata parsed from Shopify tags using the prefix convention:
//   author:jrr-tolkien, condition:vg, publisher:penguin, year:1965, binding:hardcover
// Condition shorthand maps onto the canonical DB enum.

const CONDITION_MAP = {
  new: 'new',
  ln: 'like_new',
  'like-new': 'like_new',
  likenew: 'like_new',
  vg: 'very_good',
  'very-good': 'very_good',
  g: 'good',
  acc: 'acceptable',
  acceptable: 'acceptable',
};

const canonicalCondition = (value) => CONDITION_MAP[value] || CONDITION_MAP[value?.toLowerCase?.()] || null;

// Normalize an arbitrary tag token (slugify, collapse separators).
const slug = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const parseTagValue = (value) =>
  String(value || '')
    .trim()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Accept tags as a REST-style comma string, a GraphQL string array, or both.
const normalizeTagInput = (tags) => {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
};

const parseProductTags = (tags) => {
  const out = {
    author: null,
    condition: null,
    publisher: null,
    year: null,
    binding: null,
    other: [],
  };

  const list = normalizeTagInput(tags);
  for (const raw of list) {
    const token = String(raw).trim();
    if (!token) continue;

    const colon = token.indexOf(':');
    if (colon === -1) {
      out.other.push(slug(token));
      continue;
    }

    const key = token.slice(0, colon).trim().toLowerCase();
    const value = token.slice(colon + 1).trim();
    if (!value) continue;

    switch (key) {
      case 'author':
        out.author = parseTagValue(value);
        break;
      case 'condition': {
        const cond = canonicalCondition(value);
        if (cond) out.condition = cond;
        break;
      }
      case 'publisher':
        out.publisher = parseTagValue(value);
        break;
      case 'year': {
        const year = parseInt(value, 10);
        if (!Number.isNaN(year) && year > 0 && year < 3000) out.year = year;
        break;
      }
      case 'binding':
        out.binding = parseTagValue(value);
        break;
      default:
        out.other.push(slug(token));
    }
  }

  return out;
};

module.exports = {
  parseProductTags,
  canonicalCondition,
  normalizeTagInput,
};
