import { useEffect, useMemo, useState } from 'react';
import { getListing, getListingStatus } from '../platforms';
import './PlatformView.css';

function PlatformView({ platform, products, onProductClick }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const stats = useMemo(() => {
    let listed = 0;
    let drafts = 0;
    let errors = 0;
    let unlisted = 0;

    for (const product of products) {
      const status = getListingStatus(product, platform.id);
      if (status === 'active') listed += 1;
      else if (status === 'draft') drafts += 1;
      else if (status === 'error') errors += 1;
      else unlisted += 1;
    }

    return { listed, drafts, errors, unlisted, total: products.length };
  }, [products, platform.id]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch =
        !searchTerm ||
        product.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.author?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.isbn?.includes(searchTerm);

      if (!matchesSearch) return false;

      const status = getListingStatus(product, platform.id);
      if (statusFilter === 'all') return true;
      if (statusFilter === 'listed') return status === 'active';
      if (statusFilter === 'unlisted') return status === 'unlisted';
      if (statusFilter === 'drafts') return status === 'draft';
      if (statusFilter === 'errors') return status === 'error';
      return true;
    });
  }, [products, platform.id, searchTerm, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, platform.id]);

  const formatStatus = (status) => {
    const labels = {
      active: 'Active',
      draft: 'Draft',
      error: 'Error',
      sold: 'Sold',
      delisted: 'Delisted',
      unlisted: 'Not listed',
    };
    return labels[status] || status;
  };

  return (
    <div className="platform-view">
      <div className="platform-hero">
        <div>
          <h2>{platform.name}</h2>
          <p>{platform.description}</p>
        </div>
        <div className={`connection-badge ${platform.connected ? 'connected' : 'disconnected'}`}>
          {platform.connected ? 'Connected' : 'Not connected'}
        </div>
      </div>

      {!platform.connected && (
        <div className="platform-banner">
          API credentials are not set yet. You can review inventory here; listing, update, and delist actions will unlock after connecting {platform.name}.
        </div>
      )}

      <div className="stats platform-stats">
        <div className="stat-card">
          <div className="stat-label">Listed</div>
          <div className="stat-number">{stats.listed}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Not listed</div>
          <div className="stat-number">{stats.unlisted}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Drafts</div>
          <div className="stat-number">{stats.drafts}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Errors</div>
          <div className="stat-number">{stats.errors}</div>
        </div>
      </div>

      <div className="rules-card">
        <h3>Sync rules</h3>
        <div className="rules-grid">
          <div>
            <span className="info-label">Auto-sync</span>
            <span>{platform.rules.autoSync ? 'Enabled' : 'Manual only'}</span>
          </div>
          <div>
            <span className="info-label">Conditions</span>
            <span>{platform.rules.conditions}</span>
          </div>
          <div>
            <span className="info-label">Price</span>
            <span>{platform.rules.priceModifier}</span>
          </div>
          <div>
            <span className="info-label">Minimum</span>
            <span>{platform.rules.minPrice}</span>
          </div>
        </div>
      </div>

      <div className="products-container">
        <div className="products-header">
          <h2>{platform.name} listings</h2>
          <div className="products-controls">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search title, author, or ISBN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">All statuses</option>
              <option value="listed">Listed</option>
              <option value="unlisted">Not listed</option>
              <option value="drafts">Drafts</option>
              <option value="errors">Errors</option>
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

        {filteredProducts.length === 0 ? (
          <div className="empty-state">
            <p>No products match this {platform.name} filter.</p>
          </div>
        ) : (
          <>
            <div className="products-table">
              <table>
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Title</th>
                    <th>ISBN</th>
                    <th>Base price</th>
                    <th>Platform price</th>
                    <th>Status</th>
                    <th>Listing ID</th>
                    <th>Last synced</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product) => {
                    const listing = getListing(product, platform.id);
                    const status = getListingStatus(product, platform.id);
                    return (
                      <tr key={product.id} onClick={() => onProductClick(product)}>
                        <td>
                          {product.images?.[0] ? (
                            <img src={product.images[0]} alt={product.title} className="product-thumbnail" />
                          ) : (
                            <div className="no-image">📖</div>
                          )}
                        </td>
                        <td className="product-title">{product.title}</td>
                        <td><code>{product.isbn || '-'}</code></td>
                        <td className="price">${parseFloat(product.price).toFixed(2)}</td>
                        <td className="price">
                          {listing?.platform_price
                            ? `$${parseFloat(listing.platform_price).toFixed(2)}`
                            : '—'}
                        </td>
                        <td>
                          <span className={`status-badge status-${status}`}>
                            {formatStatus(status)}
                          </span>
                        </td>
                        <td><code>{listing?.platform_listing_id || '—'}</code></td>
                        <td>{listing?.last_synced_at ? new Date(listing.last_synced_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <div className="pagination-info">
                Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredProducts.length)} of {filteredProducts.length}
              </div>
              <div className="pagination-controls">
                <button className="btn btn-pagination" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>First</button>
                <button className="btn btn-pagination" onClick={() => setCurrentPage((page) => page - 1)} disabled={currentPage === 1}>Previous</button>
                <span className="page-indicator">Page {currentPage} of {totalPages}</span>
                <button className="btn btn-pagination" onClick={() => setCurrentPage((page) => page + 1)} disabled={currentPage === totalPages}>Next</button>
                <button className="btn btn-pagination" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>Last</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PlatformView;
