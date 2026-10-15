import { useEffect, useMemo, useState } from 'react';
import { getListing, getListingStatus } from '../platforms';
import { getPageNumbers } from '../pagination';
import { rulesAPI } from '../api';
import ExportDialog from './ExportDialog';
import {
  SearchIcon,
  BookIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoIcon,
} from './icons';
import './PlatformView.css';

export default function PlatformView({
  platform,
  products,
  facets,
  onProductClick,
  connected,
  onProductsChanged,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [readiness, setReadiness] = useState(null);
  const [showExport, setShowExport] = useState(false);

  const isAbebooks = platform.id === 'abebooks';
  const isConnected = connected !== undefined ? connected : platform.connected;

  // Readiness: rule evaluation over the whole catalog — how many books would
  // list here today, and what blocks the rest. The pre-flight report.
  useEffect(() => {
    let cancelled = false;
    rulesAPI
      .preview(platform.id)
      .then((res) => {
        if (!cancelled) setReadiness(res.data);
      })
      .catch(() => setReadiness(null));
    return () => {
      cancelled = true;
    };
  }, [platform.id, products.length]);

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

      const tags = Array.isArray(product.metadata?.tags) ? product.metadata.tags : [];
      if (tagFilter !== 'all' && !tags.includes(tagFilter)) return false;

      if (categoryFilter !== 'all') {
        const category = product.metadata?.category || product.metadata?.product_type || '';
        if (category.toLowerCase() !== categoryFilter.toLowerCase()) return false;
      }

      if (vendorFilter !== 'all') {
        const vendor = product.metadata?.vendor || '';
        if (vendor.toLowerCase() !== vendorFilter.toLowerCase()) return false;
      }

      const status = getListingStatus(product, platform.id);
      if (statusFilter === 'all') return true;
      if (statusFilter === 'listed') return status === 'active';
      if (statusFilter === 'unlisted') return status === 'unlisted';
      if (statusFilter === 'drafts') return status === 'draft';
      if (statusFilter === 'errors') return status === 'error';
      return true;
    });
  }, [products, platform.id, searchTerm, statusFilter, tagFilter, categoryFilter, vendorFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, tagFilter, categoryFilter, vendorFilter, platform.id]);

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
        <div className="page-head-actions">
          {isAbebooks && (
            <button
              className="btn btn-primary"
              onClick={() => setShowExport(true)}
              title="Compose a bulk-upload file from the eligible catalog"
            >
              Generate export…
            </button>
          )}
          <span className={`connection-badge ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className="connection-dot" />
            {isConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
      </div>

      {isAbebooks && (
        <div className="alert alert-info">
          <InfoIcon size={17} />
          <div className="alert-msg">
            AbeBooks is an export-file channel: the panel composes a bulk-upload file, you upload it via your
            bookseller account. No API connection needed — use "Generate export".
          </div>
        </div>
      )}

      {!isAbebooks && !isConnected && (
        <div className="alert alert-info">
          <InfoIcon size={17} />
          <div className="alert-msg">
            API credentials are not set yet. You can review inventory and readiness here — listing actions
            unlock after connecting {platform.name} (Phase 3).
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

      {readiness && (
        <div className="readiness-card">
          <div className="readiness-head">
            <h3 className="rules-title">Readiness</h3>
            <span className="readiness-number">
              <strong>{readiness.summary.eligible}</strong> of {readiness.summary.total} books eligible
            </span>
          </div>
          <div className="readiness-reasons">
            {Object.entries(readiness.summary.skipped).map(([reason, count]) => (
              <span key={reason} className="readiness-reason-chip" title={reason}>
                {reason} · {count}
              </span>
            ))}
          </div>
        </div>
      )}

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
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="select"
            >
              <option value="all">All tags</option>
              {(facets?.tags || []).map((t) => (
                <option key={t.value} value={t.value}>
                  {t.value} ({t.count})
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="select"
            >
              <option value="all">All categories</option>
              {(facets?.categories || []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} ({c.count})
                </option>
              ))}
            </select>
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="select"
            >
              <option value="all">All vendors</option>
              {(facets?.vendors || []).map((v) => (
                <option key={v.value} value={v.value}>
                  {v.value} ({v.count})
                </option>
              ))}
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
                         <td className="product-title">
                           {product.title}
                           {listing?.notes && (
                             <span className="notes-chip" title={listing.notes}>
                               ✎ notes
                             </span>
                           )}
                         </td>
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

      {showExport && (
        <ExportDialog
          onClose={() => setShowExport(false)}
          onExported={() => onProductsChanged && onProductsChanged()}
        />
      )}
    </div>
  );
}
