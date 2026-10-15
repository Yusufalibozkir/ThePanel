import { useEffect, useState } from 'react';
import {
  CloseIcon,
  BookIcon,
  TrashIcon,
  CopyIcon,
  EditIcon,
  HistoryIcon,
} from './icons';
import DescriptionEditor from './DescriptionEditor';
import { sanitizeDescription } from '../descriptionUtils';
import { productsAPI } from '../api';
import './ProductModal.css';

const CHANNELS = [
  { id: 'ebay', name: 'eBay', glyph: 'e' },
  { id: 'abebooks', name: 'AbeBooks', glyph: 'A' },
  { id: 'etsy', name: 'Etsy', glyph: 'E' },
];

const PLATFORM_NAMES = { ebay: 'eBay', abebooks: 'AbeBooks', etsy: 'Etsy' };

const FIELD_LABELS = {
  title: 'Title',
  author: 'Author',
  isbn: 'ISBN',
  price: 'Price',
  cost: 'Cost',
  quantity: 'Quantity',
  condition: 'Condition',
  description: 'Description',
  notes: 'Notes',
  title_override: 'Title override',
};

function getListings(product) {
  return product.platform_listings || product.listings || [];
}

function getPlatformStatus(product, platformId) {
  const listing = getListings(product).find((l) => l.platform === platformId);
  const map = {
    active: { label: 'Active', tone: 'active' },
    draft: { label: 'Draft', tone: 'draft' },
    error: { label: 'Error', tone: 'error' },
  };
  return listing ? map[listing.status] || map.draft : { label: 'Not listed', tone: 'unlisted' };
}

function formatValue(field, value) {
  if (value === null || value === undefined) return '—';
  if (field === 'price' || field === 'cost') return `$${Number(value).toFixed(2)}`;
  if (field === 'quantity') return String(value);
  // Long free-text fields (per-platform notes) get truncated for the inline view
  if (field === 'notes' || field === 'title_override') {
    const text = String(value);
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  }
  return String(value);
}

function renderHtmlDescription(html) {
  return sanitizeDescription(html);
}

function EditedBadge({ field, product, onReset }) {
  const truth = product.shopify_truth?.[field];
  const [showTruth, setShowTruth] = useState(false);

  return (
    <span className="edited-badge-wrap">
      <button
        className="edited-badge"
        title="Edited locally — Shopify truth untouched. Click to compare."
        onClick={(e) => {
          e.stopPropagation();
          setShowTruth((s) => !s);
        }}
      >
        Edited
      </button>
      {showTruth && (
        <div className="truth-compare" onClick={(e) => e.stopPropagation()}>
          <div className="truth-compare-head">
            <span className="truth-compare-title">
              {FIELD_LABELS[field] || field}: local vs Shopify
            </span>
            <button
              className="btn btn-secondary btn-small"
              title="Discard this local edit and go back to the Shopify value"
              onClick={() => onReset(field)}
            >
              Use Shopify value
            </button>
          </div>
          <div className="truth-compare-body">
            <div className="truth-pane">
              <span className="pane-label">Shopify (truth)</span>
              {field === 'description' ? (
                <div className="description-html" dangerouslySetInnerHTML={{ __html: renderHtmlDescription(truth) }} />
              ) : (
                <span className="pane-value">{formatValue(field, truth)}</span>
              )}
            </div>
            <div className="truth-pane local">
              <span className="pane-label">Local edit</span>
              {field === 'description' ? (
                <div className="description-html" dangerouslySetInnerHTML={{ __html: renderHtmlDescription(product[field]) }} />
              ) : (
                <span className="pane-value">{formatValue(field, product[field])}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

function HistoryTab({ product, onProductUpdated }) {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadHistory = async () => {
    try {
      const res = await productsAPI.getChanges(product.id);
      setEntries(res.data.entries);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const handleDeleteEntry = async (entry) => {
    const fields = entry.changes.map((c) => FIELD_LABELS[c.field] || c.field).join(', ');
    const scope = entry.platform ? ` on ${PLATFORM_NAMES[entry.platform] || entry.platform}` : '';
    const message =
      entry.source === 'manual'
        ? `Delete this edit${scope} (${fields})?\n\n` +
          'This only removes the history entry — your current data is NOT reverted unless this was the latest edit for a field. ' +
          'Fields whose newest edit is deleted fall back to the previous value or the Shopify truth, and that protection is gone permanently.'
        : `Delete this sync record${scope} (${fields})?\n\nThis is an informational record of a Shopify-side change. Deleting it does not affect any data.`;
    if (!confirm(message)) return;

    setBusy(true);
    setError(null);
    try {
      await productsAPI.deleteChange(product.id, entry.change_id);
      await loadHistory();
      onProductUpdated();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleResetAll = async () => {
    if (
      !confirm(
        'Remove ALL local base edits for this product?\n\n' +
          'Every base field (title, price, description, …) goes back to the Shopify truth value. ' +
          'Base edit history for this product is deleted. Per-platform notes are kept — reset those individually. This cannot be undone.'
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await productsAPI.resetLocalEdits(product.id);
      await loadHistory();
      onProductUpdated();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  const hasLocalEdits = (product.local_edits || []).length > 0;

  if (loading) return <div className="history-empty">Loading history…</div>;

  return (
    <div className="history-tab">
      <div className="history-head">
        <div>
          <div className="history-title">Change history</div>
          <div className="history-sub">
            Shopify stays the truth — your edits are kept as a local overlay you can compare, peel back, or delete.
          </div>
        </div>
        {hasLocalEdits && (
          <button className="btn btn-secondary btn-small" disabled={busy} onClick={handleResetAll}>
            Reset all to Shopify
          </button>
        )}
      </div>

      {error && <div className="history-error">{error}</div>}

      {!entries || entries.length === 0 ? (
        <div className="history-empty">No changes recorded yet.</div>
      ) : (
        <div className="history-list">
          {entries.map((entry) => (
            <div key={entry.change_id} className={`history-entry src-${entry.source}`}>
              <div className="history-entry-head">
                <span className={`history-source-badge src-${entry.source}`}>
                  {entry.source === 'manual' ? 'Local edit' : 'Shopify sync'}
                </span>
                {entry.platform && (
                  <span className="history-platform-badge">{PLATFORM_NAMES[entry.platform] || entry.platform}</span>
                )}
                <span className="history-time">{new Date(entry.changed_at.replace(' ', 'T') + 'Z').toLocaleString()}</span>
                <button
                  className="btn btn-danger btn-small history-delete"
                  disabled={busy}
                  onClick={() => handleDeleteEntry(entry)}
                  title="Delete this entry"
                >
                  <TrashIcon size={12} />
                  Delete
                </button>
              </div>
              <div className="history-fields">
                {entry.changes.map((c, i) => (
                  <div key={i} className="history-field">
                    <span className="history-field-name">{FIELD_LABELS[c.field] || c.field}</span>
                    {c.field === 'description' ? (
                      <div className="history-desc-diff">
                        <div className="history-desc-pane">
                          <span className="pane-label">Before</span>
                          <div className="description-html" dangerouslySetInnerHTML={{ __html: renderHtmlDescription(c.old_value) }} />
                        </div>
                        <div className="history-desc-pane">
                          <span className="pane-label">After</span>
                          <div className="description-html" dangerouslySetInnerHTML={{ __html: renderHtmlDescription(c.new_value) }} />
                        </div>
                      </div>
                    ) : (
                      <span className="history-field-values">
                        <span className="old">{formatValue(c.field, c.old_value)}</span>
                        <span className="arrow">→</span>
                        <span className="new">{formatValue(c.field, c.new_value)}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelCard({ product, channel, onPublish, onProductUpdated, onNotify }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const listing = getListings(product).find((l) => l.platform === channel.id);
  const status = getPlatformStatus(product, channel.id);
  const currentNotes = listing?.notes || null;

  const startEditing = () => {
    setNotes(currentNotes || '');
    setError(null);
    setEditing(true);
  };

  const saveNotes = async () => {
    setBusy(true);
    setError(null);
    try {
      await productsAPI.updateListingFields(product.id, channel.id, { notes });
      setEditing(false);
      onNotify(`${channel.name} notes saved — versioned in History`);
      onProductUpdated();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="platform-card">
      <div className="platform-card-header">
        <span className={`platform-chip tone-${status.tone}`}>{channel.glyph}</span>
        <div>
          <div className="platform-name">{channel.name}</div>
          <div className={`platform-status tone-${status.tone}`}>
            <span className="status-mini-dot" />
            {status.label}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="platform-notes-editor">
          <label className="platform-notes-label">{channel.name} notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`Platform-specific text for ${channel.name}. The main description still comes from Shopify — these notes are composed in at listing/export time.`}
            rows={5}
            autoFocus
          />
          {error && <div className="platform-notes-error">{error}</div>}
          <div className="platform-notes-actions">
            <button className="btn btn-secondary btn-small" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn btn-primary btn-small" disabled={busy} onClick={saveNotes}>
              Save notes
            </button>
          </div>
        </div>
      ) : (
        <>
          {currentNotes && (
            <div className="platform-notes-preview" title={currentNotes}>
              {currentNotes}
            </div>
          )}
          <div className="platform-card-actions">
            <button className="btn btn-secondary btn-small" onClick={startEditing}>
              <EditIcon size={12} />
              {currentNotes ? 'Edit notes' : `Add ${channel.name} notes`}
            </button>
            {status.tone === 'unlisted' && (
              <button className="btn btn-secondary btn-small" onClick={() => onPublish(channel.name)}>
                Publish
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ProductModal({ product, onClose, onSave, onDelete, onDuplicate, onProductUpdated }) {
  const [activeTab, setActiveTab] = useState('details');
  const [isEditing, setIsEditing] = useState(false);
  const [editedProduct, setEditedProduct] = useState({ ...product });
  const [selectedImage, setSelectedImage] = useState(0);
  const [modalNotice, setModalNotice] = useState(null);

  useEffect(() => {
    if (!modalNotice) return;
    const t = setTimeout(() => setModalNotice(null), 4000);
    return () => clearTimeout(t);
  }, [modalNotice]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Keep the edit form in sync when the parent refreshes the product
  // (history deletions, resets) — but never clobber in-progress edits.
  useEffect(() => {
    if (!isEditing) {
      setEditedProduct({ ...product });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  const handleSave = () => {
    onSave({ ...editedProduct, description: sanitizeDescription(editedProduct.description) });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedProduct({ ...product });
    setIsEditing(false);
  };

  // Discard the local overlay for one field — back to the Shopify truth value
  const handleUseTruth = async (field) => {
    const updated = { ...product, [field]: product.shopify_truth?.[field] };
    try {
      await onSave(updated);
    } catch {
      /* error handled by parent */
    }
  };

  const handlePublishToPlatform = (platformName) => {
    alert(`Publishing to ${platformName}...`);
  };

  const formatCondition = (condition) => {
    if (!condition) return '—';
    return condition.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const isEdited = (field) => (product.local_edits || []).includes(field);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-header-tabs">
            <button
              className={`modal-tab ${activeTab === 'details' ? 'active' : ''}`}
              onClick={() => setActiveTab('details')}
            >
              <BookIcon size={14} />
              Details
            </button>
            <button
              className={`modal-tab ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('history');
                setIsEditing(false);
              }}
            >
              <HistoryIcon size={14} />
              History
              {(() => {
                const platformEdits = getListings(product).filter((l) => l.notes || l.title_override).length;
                const count = (product.local_edits || []).length + platformEdits;
                return count > 0 ? <span className="history-count">{count}</span> : null;
              })()}
            </button>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={17} />
          </button>
        </div>

        <div className="modal-body">
          {modalNotice && activeTab === 'details' && (
            <div className="modal-notice">{modalNotice}</div>
          )}
          {activeTab === 'history' ? (
            <div className="history-body">
              <HistoryTab product={product} onProductUpdated={onProductUpdated} />
            </div>
          ) : (
            <>
              <div className="image-section">
                <div className="main-image">
                  {product.images && product.images.length > 0 ? (
                    <img src={product.images[selectedImage]} alt={product.title} />
                  ) : (
                    <div className="no-image-large">
                      <BookIcon size={44} />
                    </div>
                  )}
                </div>
                {product.images && product.images.length > 1 && (
                  <div className="image-thumbnails">
                    {product.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={img}
                        alt={`${product.title} ${idx + 1}`}
                        className={selectedImage === idx ? 'active' : ''}
                        onClick={() => setSelectedImage(idx)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="info-section">
                {isEditing ? (
                  <>
                    <div className="form-group">
                      <label>
                        Title
                        {isEdited('title') && <span className="edit-hint"> (edited locally)</span>}
                      </label>
                      <input
                        type="text"
                        value={editedProduct.title}
                        onChange={(e) => setEditedProduct({ ...editedProduct, title: e.target.value })}
                      />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>
                          Author
                          {isEdited('author') && <span className="edit-hint"> (edited locally)</span>}
                        </label>
                        <input
                          type="text"
                          value={editedProduct.author || ''}
                          onChange={(e) => setEditedProduct({ ...editedProduct, author: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>ISBN</label>
                        <input
                          type="text"
                          value={editedProduct.isbn || ''}
                          onChange={(e) => setEditedProduct({ ...editedProduct, isbn: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="form-row form-row-3">
                      <div className="form-group">
                        <label>
                          Price ($)
                          {isEdited('price') && <span className="edit-hint"> (edited locally)</span>}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={editedProduct.price}
                          onChange={(e) => setEditedProduct({ ...editedProduct, price: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>Quantity</label>
                        <input
                          type="number"
                          value={editedProduct.quantity}
                          onChange={(e) => setEditedProduct({ ...editedProduct, quantity: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>Condition</label>
                        <select
                          value={editedProduct.condition || ''}
                          onChange={(e) => setEditedProduct({ ...editedProduct, condition: e.target.value })}
                        >
                          <option value="">Select…</option>
                          <option value="new">New</option>
                          <option value="like_new">Like New</option>
                          <option value="very_good">Very Good</option>
                          <option value="good">Good</option>
                          <option value="acceptable">Acceptable</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>
                        Description
                        {isEdited('description') && <span className="edit-hint"> (edited locally)</span>}
                      </label>
                      <DescriptionEditor
                        value={editedProduct.description || ''}
                        onChange={(html) => setEditedProduct({ ...editedProduct, description: html })}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="product-title-detail">
                      {product.title}
                      {isEdited('title') && <EditedBadge field="title" product={product} onReset={handleUseTruth} />}
                    </h3>
                    <div className="info-grid">
                      <div className="info-item">
                        <span className="info-label">Author</span>
                        <span className="info-value">
                          {product.author || '—'}
                          {isEdited('author') && <EditedBadge field="author" product={product} onReset={handleUseTruth} />}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">ISBN</span>
                        <span className="info-value">
                          <span className="mono">{product.isbn || '—'}</span>
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Price</span>
                        <span className="info-value price">
                          ${Number(product.price ?? 0).toFixed(2)}
                          {isEdited('price') && <EditedBadge field="price" product={product} onReset={handleUseTruth} />}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Quantity</span>
                        <span className="info-value">
                          {product.quantity ?? '—'}
                          {isEdited('quantity') && <EditedBadge field="quantity" product={product} onReset={handleUseTruth} />}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Condition</span>
                        <span className="info-value">
                          <span className={`condition-badge c-${product.condition || 'none'}`}>
                            {formatCondition(product.condition)}
                          </span>
                          {isEdited('condition') && <EditedBadge field="condition" product={product} onReset={handleUseTruth} />}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">SKU</span>
                        <span className="info-value">
                          <span className="mono">{product.metadata?.sku || product.sku || '—'}</span>
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Category</span>
                        <span className="info-value">
                          {product.metadata?.category || product.metadata?.product_type || '—'}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Vendor</span>
                        <span className="info-value">{product.metadata?.vendor || '—'}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Publisher</span>
                        <span className="info-value">{product.metadata?.publisher || '—'}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Binding</span>
                        <span className="info-value">{product.metadata?.binding || '—'}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Year</span>
                        <span className="info-value">{product.metadata?.year || '—'}</span>
                      </div>
                    </div>
                    {Array.isArray(product.metadata?.tags) && product.metadata.tags.length > 0 && (
                      <div className="tag-chips">
                        {product.metadata.tags.map((tag) => (
                          <span key={tag} className="tag-chip">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {(product.description || isEdited('description')) && (
                      <div className="description-section">
                        <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          Description
                          {isEdited('description') && (
                            <EditedBadge field="description" product={product} onReset={handleUseTruth} />
                          )}
                        </h4>
                        <div
                          className="description-html"
                          dangerouslySetInnerHTML={{ __html: renderHtmlDescription(product.description) }}
                        />
                      </div>
                    )}
                  </>
                )}

                <div className="platform-section">
                  <h4>Channel listings</h4>
                  <div className="platform-cards">
                    {CHANNELS.map((channel) => (
                      <ChannelCard
                        key={channel.id}
                        product={product}
                        channel={channel}
                        onPublish={handlePublishToPlatform}
                        onProductUpdated={onProductUpdated}
                        onNotify={setModalNotice}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <div className="footer-left">
            {!isEditing && activeTab === 'details' && (
              <>
                <button className="btn btn-danger btn-small" onClick={() => onDelete(product.id)}>
                  <TrashIcon size={14} />
                  Delete
                </button>
                <button className="btn btn-secondary btn-small" onClick={() => onDuplicate(product)}>
                  <CopyIcon size={14} />
                  Duplicate
                </button>
              </>
            )}
          </div>
          <div className="footer-right">
            {activeTab === 'details' &&
              (isEditing ? (
                <>
                  <button className="btn btn-secondary" onClick={handleCancel}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={handleSave}>
                    Save changes
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={onClose}>
                    Close
                  </button>
                  <button className="btn btn-primary" onClick={() => setIsEditing(true)}>
                    <EditIcon size={14} />
                    Edit
                  </button>
                </>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductModal;
