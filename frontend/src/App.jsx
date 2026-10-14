import { useState, useEffect, useMemo } from 'react';
import { productsAPI, syncAPI, shopifyAPI } from './api';
import ProductModal from './components/ProductModal';
import PlatformView from './components/PlatformView';
import SettingsView from './components/SettingsView';
import MetadataReview from './components/MetadataReview';
import { PLATFORMS } from './platforms';
import { getPageNumbers } from './pagination';
import {
  SearchIcon,
  SyncIcon,
  CloseIcon,
  BookIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  AlertIcon,
  CheckIcon,
} from './components/icons';
import './App.css';

const CHANNEL_IDS = ['ebay', 'abebooks', 'etsy'];
const GLYPHS = { overview: 'S', ebay: 'e', abebooks: 'A', etsy: 'E', metadata: 'M', settings: '⚙' };
const PLATFORM_NAMES = { ebay: 'eBay', abebooks: 'AbeBooks', etsy: 'Etsy' };
const META_STATUS = {
  ok: { label: 'OK', cls: 'ok' },
  partial: { label: 'Partial', cls: 'partial' },
  unverified: { label: 'Unverified', cls: 'unverified' },
  missing: { label: 'Missing', cls: 'missing' },
};

function listingStatus(listings, platform) {
  const listing = listings?.find((l) => l.platform === platform);
  if (!listing) return 'unlisted';
  return listing.status;
}

export default function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [syncMessage, setSyncMessage] = useState(null);

  const [selectedProduct, setSelectedProduct] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterCondition, setFilterCondition] = useState('all');
  const [filterMetaStatus, setFilterMetaStatus] = useState('all');
  const [activeTab, setActiveTab] = useState('overview');

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await productsAPI.getAll();
      setProducts(response.data.products);
    } catch (err) {
      setError('Failed to fetch products: ' + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    setError(null);
    try {
      const response = await syncAPI.syncFromShopify(250);
      const r = response.data.results;
      setSyncMessage(
        `Sync completed — ${r.created} created, ${r.updated} updated, ${r.errors} errors${
          r.enriched ? `, ${r.enriched} enriched via OpenLibrary` : ''
        }`
      );
      await fetchProducts();
    } catch (err) {
      setError('Sync failed: ' + err.message);
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    if (!syncMessage) return;
    const t = setTimeout(() => setSyncMessage(null), 5000);
    return () => clearTimeout(t);
  }, [syncMessage]);

  const filteredProducts = useMemo(() => {
    let filtered = products;

    if (searchTerm) {
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.author?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.isbn?.includes(searchTerm)
      );
    }

    if (filterCondition !== 'all') {
      filtered = filtered.filter((p) => p.condition === filterCondition);
    }

    if (filterMetaStatus !== 'all') {
      filtered = filtered.filter((p) => (p.metadata_status || 'missing') === filterMetaStatus);
    }

    return filtered;
  }, [products, searchTerm, filterCondition, filterMetaStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterCondition, filterMetaStatus, activeTab]);

  const testShopify = async () => {
    try {
      const res = await shopifyAPI.testConnection();
      if (!res.data.success) throw new Error(res.data.message);
      return res.data;
    } catch (err) {
      throw new Error(err.response?.data?.message || err.message);
    }
  };

  const handleProductClick = (product) => setSelectedProduct(product);

  const handleSaveProduct = async (updatedProduct) => {
    try {
      await productsAPI.update(updatedProduct.id, updatedProduct);
      await fetchProducts();
      setSelectedProduct(null);
      setSyncMessage('Product updated successfully');
    } catch (err) {
      setError('Failed to update product: ' + err.message);
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    try {
      await productsAPI.delete(productId);
      await fetchProducts();
      setSelectedProduct(null);
      setSyncMessage('Product deleted successfully');
    } catch (err) {
      setError('Failed to delete product: ' + err.message);
    }
  };

  const handleDuplicateProduct = async (product) => {
    try {
      const duplicated = {
        ...product,
        title: product.title + ' (Copy)',
        id: undefined,
        shopify_product_id: undefined,
      };
      await productsAPI.create(duplicated);
      await fetchProducts();
      setSelectedProduct(null);
      setSyncMessage('Product duplicated successfully');
    } catch (err) {
      setError('Failed to duplicate product: ' + err.message);
    }
  };

  const activePlatform = PLATFORMS[activeTab];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span className="brand-glyph">P</span>
            <span className="brand-name">ThePanel</span>
          </div>
          <div className="brand-sub">Book Inventory</div>
        </div>

        <nav className="nav">
          <div className="nav-section">Catalog</div>
          <button
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <span className="nav-glyph">{GLYPHS.overview}</span>
            <span className="nav-label">
              <span className="nav-name">{PLATFORMS.overview.name}</span>
              <span className="nav-desc">{PLATFORMS.overview.description}</span>
            </span>
          </button>

          <div className="nav-section">Channels</div>
          {CHANNEL_IDS.map((id) => (
            <button
              key={id}
              className={`nav-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <span className="nav-glyph">{GLYPHS[id]}</span>
              <span className="nav-label">
                <span className="nav-name">{PLATFORM_NAMES[id]}</span>
                <span className="nav-desc">
                  {PLATFORMS[id].connected ? 'Connected' : 'Not connected'}
                </span>
              </span>
              <span className={`nav-dot ${PLATFORMS[id].connected ? 'on' : ''}`} />
            </button>
          ))}

          <div className="nav-section">Panel</div>
          <button
            className={`nav-item ${activeTab === 'metadata' ? 'active' : ''}`}
            onClick={() => setActiveTab('metadata')}
          >
            <span className="nav-glyph">{GLYPHS.metadata}</span>
            <span className="nav-label">
              <span className="nav-name">Metadata review</span>
              <span className="nav-desc">
                {products.filter((p) => ['unverified', 'missing'].includes(p.metadata_status)).length} need attention
              </span>
            </span>
          </button>
          <button
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <span className="nav-glyph">{GLYPHS.settings}</span>
            <span className="nav-label">
              <span className="nav-name">Settings</span>
              <span className="nav-desc">Credentials &amp; rules</span>
            </span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleSync} disabled={syncing} className="btn btn-primary btn-block">
            {syncing ? <span className="spinner" /> : <SyncIcon size={15} />}
            {syncing ? 'Syncing…' : 'Sync from Shopify'}
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">
          {error && (
            <div className="alert alert-error" role="alert">
              <AlertIcon size={17} />
              <div className="alert-msg">{error}</div>
              <button className="alert-close" onClick={() => setError(null)} aria-label="Dismiss">
                <CloseIcon size={13} />
              </button>
            </div>
          )}

          {syncMessage && (
            <div className="alert alert-success" role="status">
              <CheckIcon size={17} />
              <div className="alert-msg">{syncMessage}</div>
              <button className="alert-close" onClick={() => setSyncMessage(null)} aria-label="Dismiss">
                <CloseIcon size={13} />
              </button>
            </div>
          )}

          {activeTab === 'settings' ? (
            <SettingsView onShopifyTest={testShopify} />
          ) : activeTab === 'metadata' ? (
            <MetadataReview onChanged={fetchProducts} />
          ) : activeTab !== 'overview' ? (
            <PlatformView
              platform={activePlatform}
              products={products}
              onProductClick={handleProductClick}
            />
          ) : (
            <>
              <div className="page-head">
                <div>
                  <h1 className="page-title">Overview</h1>
                  <p className="page-desc">{PLATFORMS.overview.description}</p>
                </div>
              </div>

              <div className="stats">
                <div className="stat-card">
                  <div className="stat-label">
                    <span className="stat-dot" />
                    Total products
                  </div>
                  <div className="stat-number">{products.length}</div>
                </div>
                {CHANNEL_IDS.map((id) => (
                  <div className="stat-card" key={id}>
                    <div className="stat-label">
                      <span className="stat-dot tone-forest" />
                      {PLATFORM_NAMES[id]} listings
                    </div>
                    <div className="stat-number">
                      {
                        products.filter(
                          (p) =>
                            p.platform_listings?.some(
                              (l) => l.platform === id && l.status === 'active'
                            )
                        ).length
                      }
                    </div>
                  </div>
                ))}
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h2>
                    Products
                    <span className="count-chip">{filteredProducts.length}</span>
                  </h2>
                  <div className="panel-tools">
                    <div className="search">
                      <SearchIcon size={15} />
                      <input
                        type="text"
                        placeholder="Search title, author, or ISBN…"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                      />
                    </div>
                    <select
                      value={filterCondition}
                      onChange={(e) => setFilterCondition(e.target.value)}
                      className="select"
                    >
                      <option value="all">All conditions</option>
                      <option value="new">New</option>
                      <option value="like_new">Like New</option>
                      <option value="very_good">Very Good</option>
                      <option value="good">Good</option>
                      <option value="acceptable">Acceptable</option>
                    </select>
                    <select
                      value={filterMetaStatus}
                      onChange={(e) => setFilterMetaStatus(e.target.value)}
                      className="select"
                    >
                      <option value="all">All metadata</option>
                      <option value="ok">Metadata: OK</option>
                      <option value="partial">Metadata: Partial</option>
                      <option value="unverified">Metadata: Unverified</option>
                      <option value="missing">Metadata: Missing</option>
                    </select>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => setItemsPerPage(Number(e.target.value))}
                      className="select"
                    >
                      <option value={10}>10 / page</option>
                      <option value={25}>25 / page</option>
                      <option value={50}>50 / page</option>
                      <option value={100}>100 / page</option>
                    </select>
                  </div>
                </div>

                {loading ? (
                  <div className="loading">
                    <span className="spinner" style={{ borderTopColor: 'var(--brass)' }} />
                    Loading products…
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <BookIcon size={26} />
                    </div>
                    <div className="empty-title">
                      {products.length === 0 ? 'No products yet' : 'No matches found'}
                    </div>
                    <div className="empty-hint">
                      {products.length === 0
                        ? 'Use "Sync from Shopify" in the sidebar to import your catalog.'
                        : 'Try a different search or filter.'}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th />
                            <th>Title</th>
                            <th>Author</th>
                            <th>ISBN</th>
                            <th>Price</th>
                            <th>Qty</th>
                            <th>Condition</th>
                            <th>Meta</th>
                            <th>Channels</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedProducts.map((product) => (
                            <tr key={product.id} onClick={() => handleProductClick(product)}>
                              <td className="thumb-cell">
                                {product.images && product.images.length > 0 ? (
                                  <img
                                    src={product.images[0]}
                                    alt={product.title}
                                    className="product-thumbnail"
                                  />
                                ) : (
                                  <div className="no-image">
                                    <BookIcon size={20} />
                                  </div>
                                )}
                              </td>
                              <td className="product-title">{product.title}</td>
                              <td>{product.author || '—'}</td>
                              <td>
                                {product.isbn ? <span className="mono">{product.isbn}</span> : '—'}
                              </td>
                              <td className="price">${parseFloat(product.price).toFixed(2)}</td>
                              <td className="quantity">{product.quantity}</td>
                              <td>
                                <span className={`condition-badge c-${product.condition || 'none'}`}>
                                  {product.condition ? product.condition.replace('_', ' ') : '—'}
                                </span>
                              </td>
                              <td>
                                {(() => {
                                  const meta = META_STATUS[product.metadata_status] || META_STATUS.missing;
                                  return (
                                    <span className={`meta-status-badge ms-${meta.cls}`} title={`Metadata ${meta.cls}`}>
                                      {meta.label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td>
                                <div className="chip-row">
                                  {CHANNEL_IDS.map((id) => {
                                    const status = listingStatus(product.platform_listings, id);
                                    return (
                                      <span
                                        key={id}
                                        className={`chip tone-${status}`}
                                        title={`${PLATFORM_NAMES[id]} — ${
                                          status.charAt(0).toUpperCase() + status.slice(1)
                                        }`}
                                      >
                                        {GLYPHS[id]}
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="pagination">
                      <div className="pagination-info">
                        Showing {startIndex + 1}–{Math.min(endIndex, filteredProducts.length)} of{' '}
                        {filteredProducts.length} products
                      </div>
                      <div className="pagination-controls">
                        <button
                          className="page-btn"
                          onClick={() => setCurrentPage((p) => p - 1)}
                          disabled={currentPage === 1}
                          aria-label="Previous page"
                        >
                          <ChevronLeftIcon size={15} />
                        </button>
                        {getPageNumbers(currentPage, totalPages).map((p, i) =>
                          typeof p === 'number' ? (
                            <button
                              key={i}
                              className={`page-btn ${p === currentPage ? 'active' : ''}`}
                              onClick={() => setCurrentPage(p)}
                            >
                              {p}
                            </button>
                          ) : (
                            <span key={i} className="page-ellipsis">
                              …
                            </span>
                          )
                        )}
                        <button
                          className="page-btn"
                          onClick={() => setCurrentPage((p) => p + 1)}
                          disabled={currentPage === totalPages}
                          aria-label="Next page"
                        >
                          <ChevronRightIcon size={15} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {selectedProduct && (
            <ProductModal
              product={selectedProduct}
              onClose={() => setSelectedProduct(null)}
              onSave={handleSaveProduct}
              onDelete={handleDeleteProduct}
              onDuplicate={handleDuplicateProduct}
            />
          )}
        </div>
      </main>
    </div>
  );
}
