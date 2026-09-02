import { useState, useEffect, useMemo } from 'react';
import { productsAPI, syncAPI } from './api';
import ProductModal from './components/ProductModal';
import PlatformView from './components/PlatformView';
import { PLATFORMS } from './platforms';
import './App.css';
import './components/PlatformView.css';

function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [syncMessage, setSyncMessage] = useState(null);
  
  // Modal state
  const [selectedProduct, setSelectedProduct] = useState(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  
  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCondition, setFilterCondition] = useState('all');
  const [activeTab, setActiveTab] = useState('overview');

  // Fetch products from database
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

  // Sync products from Shopify
  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    setError(null);
    try {
      const response = await syncAPI.syncFromShopify(250);
      setSyncMessage(
        `Sync completed: ${response.data.results.created} created, ${response.data.results.updated} updated, ${response.data.results.errors} errors`
      );
      // Refresh products list
      await fetchProducts();
    } catch (err) {
      setError('Sync failed: ' + err.message);
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  // Load products on mount
  useEffect(() => {
    fetchProducts();
  }, []);

  // Filter and search products
  const filteredProducts = useMemo(() => {
    let filtered = products;

    // Apply search
    if (searchTerm) {
      filtered = filtered.filter(p => 
        p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.author?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.isbn?.includes(searchTerm)
      );
    }

    // Apply condition filter
    if (filterCondition !== 'all') {
      filtered = filtered.filter(p => p.condition === filterCondition);
    }

    return filtered;
  }, [products, searchTerm, filterCondition]);

  // Pagination
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterCondition, activeTab]);

  // Handle product actions
  const handleProductClick = (product) => {
    setSelectedProduct(product);
  };

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

  // Get platform status icon
  const getPlatformIcon = (listings, platform) => {
    const listing = listings.find(l => l.platform === platform);
    if (!listing) return '⚪';
    if (listing.status === 'active') return '✅';
    if (listing.status === 'error') return '⚠️';
    if (listing.status === 'draft') return '📝';
    return '⚪';
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>ThePanel</h1>
          <p className="header-subtitle">Book Inventory Manager</p>
        </div>
        <div className="header-actions">
          <button 
            onClick={handleSync} 
            disabled={syncing}
            className="btn btn-primary"
          >
            {syncing ? 'Syncing...' : 'Sync from Shopify'}
          </button>
        </div>
      </header>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {syncMessage && (
        <div className="alert alert-success">
          {syncMessage}
        </div>
      )}

      <nav className="platform-tabs">
        {Object.values(PLATFORMS).map((platform) => (
          <button
            key={platform.id}
            className={`platform-tab ${activeTab === platform.id ? 'active' : ''}`}
            onClick={() => setActiveTab(platform.id)}
          >
            {platform.name}
          </button>
        ))}
      </nav>

      {activeTab !== 'overview' ? (
        <PlatformView
          platform={PLATFORMS[activeTab]}
          products={products}
          onProductClick={handleProductClick}
        />
      ) : (
      <>
      <div className="stats">
        <div className="stat-card">
          <div className="stat-label">Total Products</div>
          <div className="stat-number">{products.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">eBay Listings</div>
          <div className="stat-number">
            {products.filter(p => p.platform_listings?.some(l => l.platform === 'ebay' && l.status === 'active')).length}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">AbeBooks Listings</div>
          <div className="stat-number">
            {products.filter(p => p.platform_listings?.some(l => l.platform === 'abebooks' && l.status === 'active')).length}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Etsy Listings</div>
          <div className="stat-number">
            {products.filter(p => p.platform_listings?.some(l => l.platform === 'etsy' && l.status === 'active')).length}
          </div>
        </div>
      </div>

      <div className="products-container">
        <div className="products-header">
          <h2>Products</h2>
          <div className="products-controls">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search by title, author, or ISBN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
            <select
              value={filterCondition}
              onChange={(e) => setFilterCondition(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Conditions</option>
              <option value="new">New</option>
              <option value="like_new">Like New</option>
              <option value="very_good">Very Good</option>
              <option value="good">Good</option>
              <option value="acceptable">Acceptable</option>
            </select>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="per-page-select"
            >
              <option value="10">10 per page</option>
              <option value="25">25 per page</option>
              <option value="50">50 per page</option>
              <option value="100">100 per page</option>
            </select>
          </div>
        </div>
        
        {loading ? (
          <div className="loading">Loading products...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="empty-state">
            {products.length === 0 ? (
              <p>No products found. Click "Sync from Shopify" to import products.</p>
            ) : (
              <p>No products match your search criteria.</p>
            )}
          </div>
        ) : (
          <>
            <div className="products-table">
              <table>
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Title</th>
                    <th>Author</th>
                    <th>ISBN</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>Condition</th>
                    <th>Platforms</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product) => (
                    <tr key={product.id} onClick={() => handleProductClick(product)} style={{ cursor: 'pointer' }}>
                      <td>
                        {product.images && product.images.length > 0 ? (
                          <img 
                            src={product.images[0]} 
                            alt={product.title}
                            className="product-thumbnail"
                          />
                        ) : (
                          <div className="no-image">📖</div>
                        )}
                      </td>
                      <td className="product-title">{product.title}</td>
                      <td>{product.author || '-'}</td>
                      <td><code>{product.isbn || '-'}</code></td>
                      <td className="price">${parseFloat(product.price).toFixed(2)}</td>
                      <td className="quantity">{product.quantity}</td>
                      <td>
                        <span className="condition-badge">
                          {product.condition ? product.condition.replace('_', ' ') : '-'}
                        </span>
                      </td>
                      <td className="platforms">
                        <div className="platform-icons">
                          <span className="platform-icon" title="eBay">
                            {getPlatformIcon(product.platform_listings || [], 'ebay')}
                          </span>
                          <span className="platform-icon" title="AbeBooks">
                            {getPlatformIcon(product.platform_listings || [], 'abebooks')}
                          </span>
                          <span className="platform-icon" title="Etsy">
                            {getPlatformIcon(product.platform_listings || [], 'etsy')}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <div className="pagination-info">
                Showing {startIndex + 1}-{Math.min(endIndex, filteredProducts.length)} of {filteredProducts.length} products
              </div>
              <div className="pagination-controls">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="btn btn-pagination"
                >
                  First
                </button>
                <button
                  onClick={() => setCurrentPage(p => p - 1)}
                  disabled={currentPage === 1}
                  className="btn btn-pagination"
                >
                  Previous
                </button>
                <span className="page-indicator">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={currentPage === totalPages}
                  className="btn btn-pagination"
                >
                  Next
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="btn btn-pagination"
                >
                  Last
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      </>
      )}

      {/* Product Modal */}
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
  );
}

export default App;
