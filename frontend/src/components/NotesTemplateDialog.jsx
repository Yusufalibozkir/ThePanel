import { useMemo, useState } from 'react';
import { productsAPI } from '../api';
import { AlertIcon, CheckIcon, CloseIcon } from './icons';
import './ExportDialog.css';
import './NotesTemplateDialog.css';

// Bulk notes: write one template, apply it to every selected book. Variables
// ({title}, {author}, {year}, …) render per book, so a template like
// "Ships boxed with tracking. {condition} copy, {year}." reads naturally
// everywhere. Each result is saved through the normal per-platform
// versioning path — nothing is overwritten without a history entry.

const VARIABLES = ['title', 'author', 'year', 'condition', 'binding', 'publisher', 'isbn', 'price', 'sku'];

const PLATFORMS = [
  { id: 'ebay', name: 'eBay' },
  { id: 'abebooks', name: 'AbeBooks' },
  { id: 'etsy', name: 'Etsy' },
];

// Client-side preview of the same rendering the backend applies (the server
// is the source of truth when saving).
const renderPreview = (template, product) => {
  if (!template || !product) return '';
  const meta = product.metadata || {};
  const values = {
    title: product.title,
    author: product.author,
    year: meta.year,
    condition: product.condition ? String(product.condition).replace(/_/g, ' ') : null,
    binding: meta.binding,
    publisher: meta.publisher,
    isbn: product.isbn,
    price: product.price != null ? Number(product.price).toFixed(2) : null,
    sku: meta.sku,
  };
  return template.replace(/\{(\w+)\}/gi, (match, name) => {
    const key = name.toLowerCase();
    if (!VARIABLES.includes(key)) return match;
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  });
};

export default function NotesTemplateDialog({ productIds, products, onClose, onApplied }) {
  const [platform, setPlatform] = useState('ebay');
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const sampleProduct = useMemo(
    () => products.find((p) => productIds.includes(p.id)) || null,
    [products, productIds]
  );

  const preview = renderPreview(template, sampleProduct);

  const insertVariable = (name) => {
    setTemplate((t) => (t ? `${t} {${name}}` : `{${name}}`));
  };

  const handleApply = async () => {
    if (!template.trim()) {
      setError('Write a template first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await productsAPI.applyNotesTemplate(productIds, platform, template);
      setDone({ applied: res.data.applied, failures: res.data.failures || [] });
      onApplied();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="notes-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="export-dialog-head">
          <div>
            <h3>Notes template</h3>
            <p className="export-dialog-sub">
              Apply one note to all {productIds.length} selected books — variables render per book, and every
              result lands in the platform's version history.
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={17} />
          </button>
        </div>

        <div className="export-dialog-body">
          <div className="notes-platform-row">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                className={`notes-platform-chip ${platform === p.id ? 'active' : ''}`}
                onClick={() => setPlatform(p.id)}
              >
                {p.name} notes
              </button>
            ))}
          </div>

          <div className="form-group">
            <label>Template</label>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={4}
              placeholder={'e.g. Ships boxed with tracking. {condition} copy, {year} {binding} edition.'}
              autoFocus
            />
          </div>

          <div className="notes-variables">
            <span className="notes-variables-label">Insert variable:</span>
            {VARIABLES.map((v) => (
              <button key={v} className="notes-var-chip" onClick={() => insertVariable(v)} title={`Insert {${v}}`}>
                {`{${v}}`}
              </button>
            ))}
          </div>

          {sampleProduct && (
            <div className="notes-preview">
              <span className="pane-label">Preview — {sampleProduct.title}</span>
              <div className="notes-preview-text">{preview || <em>Start typing a template…</em>}</div>
            </div>
          )}

          {error && (
            <div className="export-error">
              <AlertIcon size={14} />
              {error}
            </div>
          )}

          {done && (
            <div className="export-done">
              <CheckIcon size={14} />
              <span>
                Applied to {done.applied} of {productIds.length} books
                {done.failures.length > 0 && ` — ${done.failures.length} failed (see console)`}.
              </span>
            </div>
          )}
        </div>

        <div className="export-dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" disabled={busy || !template.trim()} onClick={handleApply}>
            {busy ? 'Applying…' : `Apply to ${productIds.length} books`}
          </button>
        </div>
      </div>
    </div>
  );
}
