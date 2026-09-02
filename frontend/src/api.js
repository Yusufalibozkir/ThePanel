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
  getById: (id) => api.get(`/products/${id}`),
  create: (data) => api.post('/products', data),
  update: (id, data) => api.put(`/products/${id}`, data),
  delete: (id) => api.delete(`/products/${id}`),
};

// Sync API
export const syncAPI = {
  syncFromShopify: (limit) => api.post('/sync/shopify', null, { params: { limit } }),
  getLogs: (errors = false, limit) => api.get('/sync/logs', { params: { errors, limit } }),
};

export default api;
