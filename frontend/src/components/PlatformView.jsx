import { useEffect, useMemo, useState } from 'react';
import { getListing, getListingStatus } from '../platforms';
import { getPageNumbers } from '../pagination';
import {
  SearchIcon,
  BookIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoIcon,
} from './icons';
import './PlatformView.css';

export default function PlatformView({ platform, products, onProductClick }) {
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
      <div className="page-head">
        <div>
          <h1 className="page-title">{platform.name}</h1>
          <p className="page-desc">{platform.description}</p>
        </div>
        <span className={`connection-badge ${platform.connected ? 'connected' : 'disconnected'}`}>
          <span className="connection-dot" />
          {platform.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {!platform.connected && (
        <div className="alert alert-info">
          <InfoIcon size={17} />
          <div className="alert-msg">
            API credentials are not set yet. You can review inventory here — listing, update, and
            delist actions unlock after connecting {platform.name}.
          </div>
        </div>
      )}

      <div className="stats">
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot tone-forest" />
            Listed
          </div>
          <div className="stat-number">{stats.listed}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot" />
            Not listed
          </div>
          <div className="stat-number">{stats.unlisted}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot tone-amber" />
            Drafts
          </div>
          <div className="stat-number">{stats.drafts}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot tone-clay" />
            Errors
          </div>
          <div className="stat-number">{stats.errors}</div>
        </div>
      </div>

      <div className="rules-card">
        <h3 className="rules-title">Sync rules</h3>
        <div className="rules-grid">
          <div className="rule-cell">
            <span className="info-label">Auto-sync</span>
            <span className="rule-value">{platform.rules.autoSync ? 'Enabled' : 'Manual only'}</span>
          </div>
          <div className="rule-cell">
            <span className="info-label">Conditions</span>
            <span className="rule-value">{platform.rules.conditions}</span>
          </div>
          <div className="rule-cell">
            <span className="info-label">Pricing</span>
            <span className="rule-value">{platform.rules.priceModifier}</span>
          </div>
          <div className="rule-cell">
            <span className="info-label">Minimum</span>
            <span className="rule-value">{platform.rules.minPrice}</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>
            {platform.name} listings
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="select"
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
              className="select"
            >
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
        </div>

        {filteredProducts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <BookIcon size={26} />
            </div>
            <div className="empty-title">Nothing here</div>
            <div className="empty-hint">No products match this {platform.name} filter.</div>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Title</th>
                    <th>ISBN</th>
                    <th>Base price</th>
                    <th>{platform.name} price</th>
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
                        <td className="thumb-cell">
                          {product.images?.[0] ? (
                            <img src={product.images[0]} alt={product.title} className="product-thumbnail" />
                          ) : (
                            <div className="no-image">
                              <BookIcon size={20} />
                            </div>
                          )}
                        </td>
                        <td className="product-title">{product.title}</td>
                        <td>{product.isbn ? <span className="mono">{product.isbn}</span> : '—'}</td>
                        <td className="price">${parseFloat(product.price).toFixed(2)}</td>
                        <td className="price">
                          {listing?.external_price
                            ? `$${parseFloat(listing.external_price).toFixed(2)}`
                            : '—'}
                        </td>
                        <td>
                          <span className={`status-badge status-${status}`}>
                            <span className="status-badge-dot" />
                            {formatStatus(status)}
                          </span>
                        </td>
                        <td>
                          {listing?.platform_listing_id ? (
                            <span className="mono">{listing.platform_listing_id}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="synced-cell">
                          {listing?.last_synced_at
                            ? new Date(listing.last_synced_at).toLocaleDateString()
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <div className="pagination-info">
                Showing {startIndex + 1}–{Math.min(startIndex + itemsPerPage, filteredProducts.length)} of{' '}
                {filteredProducts.length}
              </div>
              <div className="pagination-controls">
                <button
                  className="page-btn"
                  onClick={() => setCurrentPage((page) => page - 1)}
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
                  onClick={() => setCurrentPage((page) => page + 1)}
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
    </div>
  );
}
