// Listing composition (pure module — no database access).
//
// One place decides what a channel listing contains:
//   title       = listing.title_override || product.title
//   description = base Shopify description + the platform's own notes
//   price       = computed by the pricing engine (passed in by callers)
//
// AbeBooks gets plain text (TSV export); eBay will get sanitized HTML
// when its adapter lands in Phase 3. Both start from the same base.
//
// Notes templates let the operator apply one text to many books with
// per-book variables ({title}, {author}, …) — rendered per product.

// Our condition enum -> AbeBooks condition grades.
const ABEBOOKS_CONDITIONS = {
  new: 'New',
  like_new: 'Fine',
  very_good: 'Very Good',
  good: 'Good',
  acceptable: 'Fair',
};

// Variables available in notes templates.
const TEMPLATE_VARIABLES = ['title', 'author', 'year', 'condition', 'binding', 'publisher', 'isbn', 'price', 'sku'];

// Render {variable} placeholders against a product (effective view shape:
// metadata parsed, overlay already merged by productService).
// Unknown placeholders are left untouched so literal braces survive.
function applyTemplate(template, product) {
  if (!template) return '';
  const meta = product.metadata || {};
  const values = {
    title: product.title,
    author: product.author,
    year: meta.year,
    condition: product.condition ? String(product.condition).replace(/_/g, ' ') : null,
    binding: meta.binding,
    publisher: meta.publisher,
    isbn: product.isbn,
    price: product.price != null ? Number(product.price).toFixed(2) : null,
    sku: meta.sku,
  };
  return template.replace(/\{(\w+)\}/gi, (match, name) => {
    const key = name.toLowerCase();
    if (!TEMPLATE_VARIABLES.includes(key)) return match;
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

// Strip channel-hostile markup from Shopify HTML descriptions:
// script/style/iframe/embed/object blocks, event handler attributes,
// and javascript: URLs. Conservative allowlist-by-removal — enough for
// eBay description policies and TSV plain-text derivation.
function sanitizeHtmlForChannel(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(iframe|embed|object)[\s\S]*?<\/(iframe|embed|object)>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '');
}

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#039;': "'",
  '&nbsp;': ' ',
};

// HTML -> single-line plain text (for the AbeBooks TSV export).
function htmlToPlainText(html) {
  if (!html) return '';
  let text = sanitizeHtmlForChannel(String(html))
    .replace(/<[^>]*>/g, ' ')
    .replace(/&\w+;|&#\d+;/g, (entity) => HTML_ENTITIES[entity] || ' ');
  return text.replace(/\s+/g, ' ').trim();
}

// A value safe for a tab-separated field: no tabs, no line breaks.
function tsvField(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\t\n\r]+/g, ' ')
    .trim();
}

// Compose one AbeBooks export row. `externalPrice` is the pricing engine
// output; `listing` is the platform_listings row (may be null — notes and
// title_override are then simply absent).
function composeAbebooksRow(product, listing, externalPrice) {
  const meta = product.metadata || {};
  const baseDescription = htmlToPlainText(product.description);
  const notes = listing?.notes || null;
  const description = [baseDescription, notes].filter(Boolean).join(' ');
  const condition = product.condition ? ABEBOOKS_CONDITIONS[product.condition] || product.condition : null;
  // Stable book number: SKU when Shopify provides one, else derived from the
  // local product id (stable across exports).
  const bookNo = meta.sku || `AB-${String(product.id).slice(0, 10)}`;

  return {
    book_no: tsvField(bookNo),
    isbn: tsvField(product.isbn),
    title: tsvField(listing?.title_override || product.title),
    author: tsvField(product.author),
    publisher: tsvField(meta.publisher),
    year: tsvField(meta.year),
    binding: tsvField(meta.binding),
    condition: tsvField(condition),
    price: tsvField(externalPrice != null ? Number(externalPrice).toFixed(2) : ''),
    quantity: 1,
    description: tsvField(description),
  };
}

// Column order of the generated file — one row per book, tab-separated.
const ABEBOOKS_COLUMNS = [
  'BookNo',
  'ISBN',
  'Title',
  'Author',
  'Publisher',
  'Year',
  'Binding',
  'Condition',
  'Price',
  'Qty',
  'Description',
];

function toAbebooksTSV(rows) {
  const lines = [ABEBOOKS_COLUMNS.join('\t')];
  for (const row of rows) {
    lines.push(ABEBOOKS_COLUMNS.map((c) => row[c.toLowerCase()]).join('\t'));
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  ABEBOOKS_CONDITIONS,
  ABEBOOKS_COLUMNS,
  TEMPLATE_VARIABLES,
  applyTemplate,
  sanitizeHtmlForChannel,
  htmlToPlainText,
  tsvField,
  composeAbebooksRow,
  toAbebooksTSV,
};
