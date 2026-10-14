const axios = require('axios');

const OPEN_LIBRARY_BASE = 'https://openlibrary.org';
const HTTP_TIMEOUT = 15000;

const extractYear = (publishDate) => {
  if (!publishDate) return null;
  const match = String(publishDate).match(/\b(\d{4})\b/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  return year > 0 && year < 3000 ? year : null;
};

const authorNameCache = new Map();

const fetchAuthorName = async (key) => {
  if (authorNameCache.has(key)) return authorNameCache.get(key);
  const response = await axios.get(`${OPEN_LIBRARY_BASE}${key}.json`, { timeout: HTTP_TIMEOUT });
  const name = response.data?.name || null;
  if (name) authorNameCache.set(key, name);
  return name;
};

// Look up book data by ISBN. Returns { author, year, publisher } with nulls for
// anything unavailable; returns nulls (never throws) when the ISBN is unknown.
const enrichByIsbn = async (isbn) => {
  const empty = { author: null, year: null, publisher: null };
  const clean = String(isbn || '').replace(/[^0-9Xx]/g, '');
  if (!clean || clean.length < 10) return empty;

  try {
    const response = await axios.get(`${OPEN_LIBRARY_BASE}/isbn/${clean}.json`, {
      timeout: HTTP_TIMEOUT,
    });
    const book = response.data || {};

    let author = null;
    const authorKey = book.authors?.[0]?.key || book.authors?.[0];
    if (authorKey) {
      try {
        author = await fetchAuthorName(typeof authorKey === 'string' ? authorKey : authorKey.key);
      } catch {
        author = null;
      }
    }

    return {
      author,
      year: extractYear(book.publish_date),
      publisher: book.publishers?.[0] || null,
    };
  } catch (error) {
    if (error.response?.status === 404) return empty;
    throw error;
  }
};

module.exports = {
  enrichByIsbn,
  extractYear,
};
