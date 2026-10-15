import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Shopify API
export const shopifyAPI = {
  testConnection: () => api.get('/shopify/test'),
  getProducts: (limit) => api.get('/shopify/products', { params: { limit } }),
  getProductById: (id) => api.get(`/shopify/products/${id}`),
  getInventory: () => api.get('/shopify/inventory'),
};

// Products API
export const productsAPI = {
  getAll: (filters) => api.get('/products', { params: filters }),
  getFacets: () => api.get('/products/facets'),
  getById: (id) => api.get(`/products/${id}`),
  create: (data) => api.post('/products', data),
  update: (id, data) => api.put(`/products/${id}`, data),
  delete: (id) => api.delete(`/products/${id}`),
  markSold: (id, soldVia) => api.post(`/products/${id}/sold`, { sold_via: soldVia }),
  getChanges: (id, limit) => api.get(`/products/${id}/changes`, { params: { limit } }),
  deleteChange: (id, changeId) => api.delete(`/products/${id}/changes/${changeId}`),
  resetLocalEdits: (id) => api.delete(`/products/${id}/local-edits`),
  // Per-platform listing fields (notes, title_override) — versioned per platform
  updateListingFields: (id, platform, data) => api.put(`/products/${id}/listings/${platform}/fields`, data),
  // Bulk-apply a notes template ({title}, {author}, …) to a selection of books
  applyNotesTemplate: (productIds, platform, template) =>
    api.post('/products/notes-template', { product_ids: productIds, platform, template }),
};

// AbeBooks export-file channel (no live API: preview + generate TSV)
export const abebooksAPI = {
  exportPreview: (data) => api.post('/abebooks/export/preview', data),
  exportGenerate: (data) => api.post('/abebooks/export/generate', data),
};

// Universal logs (change history + sync runs) for the Logs panel
export const logsAPI = {
  getChanges: (params) => api.get('/logs/changes', { params }),
  deleteChange: (productId, changeId) => api.delete(`/logs/changes/${productId}/${changeId}`),
  purgeChanges: (data) => api.post('/logs/changes/purge', data),
  getSyncLogs: (params) => api.get('/logs/sync', { params }),
  deleteSyncLog: (id) => api.delete(`/logs/sync/${id}`),
  purgeSyncLogs: (data) => api.post('/logs/sync/purge', data),
};

// Sync API
export const syncAPI = {
  syncFromShopify: (limit) => api.post('/sync/shopify', null, { params: { limit } }),
  getLogs: (errors = false, limit) => api.get('/sync/logs', { params: { errors, limit } }),
};

// Settings / credentials vault (responses are masked server-side)
export const settingsAPI = {
  getCredentials: () => api.get('/settings/credentials'),
  saveCredentials: (platform, credentials) => api.put(`/settings/credentials/${platform}`, credentials),
  deleteCredentials: (platform) => api.delete(`/settings/credentials/${platform}`),
  testCredentials: (platform) => api.post(`/settings/credentials/${platform}/test`),
};

// Sync rules
export const rulesAPI = {
  getAll: () => api.get('/rules'),
  update: (platform, rule) => api.put(`/rules/${platform}`, rule),
  preview: (platform) => api.get(`/rules/${platform}/preview`),
};

// Jobs + metadata pipeline
export const jobsAPI = {
  list: (params) => api.get('/jobs', { params }),
  retry: (id) => api.post(`/jobs/${id}/retry`),
  queueBackfill: (force = false) => api.post('/jobs/metadata/backfill', { force }),
  needsReview: () => api.get('/jobs/metadata/needs-review'),
  confirmMetadata: (id, fields) => api.post(`/jobs/products/${id}/metadata/confirm`, fields),
};

export default api;
