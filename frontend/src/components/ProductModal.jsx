import { useState } from 'react';
import DOMPurify from 'dompurify';
import './ProductModal.css';

function ProductModal({ product, onClose, onSave, onDelete, onDuplicate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedProduct, setEditedProduct] = useState({ ...product });
  const [selectedImage, setSelectedImage] = useState(0);

  const handleSave = () => {
    onSave(editedProduct);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedProduct({ ...product });
    setIsEditing(false);
  };

  const handlePublishToPlatform = (platform) => {
    // TODO: Implement platform publishing
    alert(`Publishing to ${platform}...`);
  };

  const formatCondition = (condition) => {
    if (!condition) return '-';
    return condition.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getPlatformStatus = (platform) => {
    const listing = product.platform_listings?.find(l => l.platform === platform);
    if (!listing) return { icon: '⚪', status: 'Not Listed', color: '#94a3b8' };
    
    const statusMap = {
      'active': { icon: '✅', status: 'Active', color: '#10b981' },
      'draft': { icon: '📝', status: 'Draft', color: '#f59e0b' },
      'error': { icon: '⚠️', status: 'Error', color: '#ef4444' },
    };
    
    return statusMap[listing.status] || statusMap.draft;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEditing ? 'Edit Product' : 'Product Details'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Image Gallery */}
          <div className="image-section">
            <div className="main-image">
              {product.images && product.images.length > 0 ? (
                <img src={product.images[selectedImage]} alt={product.title} />
              ) : (
                <div className="no-image-large">📖</div>
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

          {/* Product Info */}
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
                <div className="form-row">
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
                      <option value="">Select...</option>
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
                    rows="4"
                  />
                </div>
              </>
            ) : (
              <>
                <h3 className="product-title-detail">{product.title}</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">Author</span>
                    <span className="info-value">{product.author || '-'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">ISBN</span>
                    <span className="info-value"><code>{product.isbn || '-'}</code></span>
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
                      <span className="condition-badge">{formatCondition(product.condition)}</span>
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">SKU</span>
                    <span className="info-value"><code>{product.sku || '-'}</code></span>
                  </div>
                </div>
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

            {/* Platform Status */}
            <div className="platform-section">
              <h4>Platform Listings</h4>
              <div className="platform-cards">
                {['ebay', 'abebooks', 'etsy'].map(platform => {
                  const status = getPlatformStatus(platform);
                  return (
                    <div key={platform} className="platform-card">
                      <div className="platform-card-header">
                        <span className="platform-icon-large">{status.icon}</span>
                        <div>
                          <div className="platform-name">{platform.charAt(0).toUpperCase() + platform.slice(1)}</div>
                          <div className="platform-status" style={{ color: status.color }}>
                            {status.status}
                          </div>
                        </div>
                      </div>
                      {status.status === 'Not Listed' && (
                        <button 
                          className="btn btn-small btn-primary"
                          onClick={() => handlePublishToPlatform(platform)}
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

        {/* Modal Footer */}
        <div className="modal-footer">
          <div className="footer-left">
            {!isEditing && (
              <>
                <button className="btn btn-danger" onClick={() => onDelete(product.id)}>
                  Delete
                </button>
                <button className="btn btn-secondary" onClick={() => onDuplicate(product)}>
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
                  Save Changes
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={onClose}>
                  Close
                </button>
                <button className="btn btn-primary" onClick={() => setIsEditing(true)}>
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
