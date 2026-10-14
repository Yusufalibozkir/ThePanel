import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  CloseIcon,
  BookIcon,
  TrashIcon,
  CopyIcon,
  EditIcon,
} from './icons';
import './ProductModal.css';

const CHANNELS = [
  { id: 'ebay', name: 'eBay', glyph: 'e' },
  { id: 'abebooks', name: 'AbeBooks', glyph: 'A' },
  { id: 'etsy', name: 'Etsy', glyph: 'E' },
];

function getPlatformStatus(product, platformId) {
  const listing = product.platform_listings?.find((l) => l.platform === platformId);
  const map = {
    active: { label: 'Active', tone: 'active' },
    draft: { label: 'Draft', tone: 'draft' },
    error: { label: 'Error', tone: 'error' },
  };
  return listing ? map[listing.status] || map.draft : { label: 'Not listed', tone: 'unlisted' };
}

function ProductModal({ product, onClose, onSave, onDelete, onDuplicate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedProduct, setEditedProduct] = useState({ ...product });
  const [selectedImage, setSelectedImage] = useState(0);

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

  const handleSave = () => {
    onSave(editedProduct);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedProduct({ ...product });
    setIsEditing(false);
  };

  const handlePublishToPlatform = (platformName) => {
    alert(`Publishing to ${platformName}...`);
  };

  const formatCondition = (condition) => {
    if (!condition) return '—';
    return condition.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{isEditing ? 'Edit product' : 'Product details'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={17} />
          </button>
        </div>

        <div className="modal-body">
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
                  <label>Title</label>
                  <input
                    type="text"
                    value={editedProduct.title}
                    onChange={(e) => setEditedProduct({ ...editedProduct, title: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Author</label>
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
                    <label>Price ($)</label>
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
                  <label>Description</label>
                  <textarea
                    value={editedProduct.description || ''}
                    onChange={(e) => setEditedProduct({ ...editedProduct, description: e.target.value })}
                    rows="5"
                  />
                </div>
              </>
            ) : (
              <>
                <h3 className="product-title-detail">{product.title}</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">Author</span>
                    <span className="info-value">{product.author || '—'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">ISBN</span>
                    <span className="info-value">
                      <span className="mono">{product.isbn || '—'}</span>
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Price</span>
                    <span className="info-value price">${parseFloat(product.price).toFixed(2)}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Quantity</span>
                    <span className="info-value">{product.quantity}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Condition</span>
                    <span className="info-value">
                      <span className={`condition-badge c-${product.condition || 'none'}`}>
                        {formatCondition(product.condition)}
                      </span>
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">SKU</span>
                    <span className="info-value">
                      <span className="mono">{product.sku || '—'}</span>
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
                {product.description && (
                  <div className="description-section">
                    <h4>Description</h4>
                    <div
                      className="description-html"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(product.description, {
                          ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
                          ALLOWED_ATTR: ['href', 'target', 'rel'],
                        }),
                      }}
                    />
                  </div>
                )}
              </>
            )}

            <div className="platform-section">
              <h4>Channel listings</h4>
              <div className="platform-cards">
                {CHANNELS.map((channel) => {
                  const status = getPlatformStatus(product, channel.id);
                  return (
                    <div key={channel.id} className="platform-card">
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
                      {status.tone === 'unlisted' && (
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => handlePublishToPlatform(channel.name)}
                        >
                          Publish
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <div className="footer-left">
            {!isEditing && (
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
            {isEditing ? (
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductModal;
