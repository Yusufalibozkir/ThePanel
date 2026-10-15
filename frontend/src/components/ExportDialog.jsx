import { useState } from 'react';
import { abebooksAPI } from '../api';
import { AlertIcon, CheckIcon, CloseIcon } from './icons';
import './ExportDialog.css';

// AbeBooks export flow: pick a mode (all eligible / only changed since last
// export / current selection), preview the composed rows plus the skip report,
// then generate the TSV. Generating commits the export baseline — every
// included book is marked 'exported', so the next delta starts clean.

const MODES = [
  {
    id: 'full',
    label: 'All eligible books',
    hint: 'Every book that passes the AbeBooks rule (condition filter, price floor, in stock).',
  },
  {
    id: 'delta',
    label: 'Only new / changed since last export',
    hint: 'Books never exported or changed since their last export — never resends an unchanged catalog.',
  },
  {
    id: 'selection',
    label: 'Current selection',
    hint: 'The books you picked. Your selection overrides the rule conditions, but never the stock check.',
  },
];

export default function ExportDialog({ initialProductIds = null, onClose, onExported }) {
  const hasSelection = Array.isArray(initialProductIds) && initialProductIds.length > 0;
  const [mode, setMode] = useState(hasSelection ? 'selection' : 'delta');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const requestBody = () => {
    const body = { mode };
    if (mode === 'selection') body.productIds = initialProductIds;
    return body;
  };

  const handlePreview = async () => {
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const res = await abebooksAPI.exportPreview(requestBody());
      setPreview(res.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await abebooksAPI.exportGenerate(requestBody());
      const { filename, content } = res.data;

      // Download the file
      const blob = new Blob([content], { type: 'text/tab-separated-values' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDone({
        count: res.data.count,
        skipped: res.data.skipped.length,
        filename,
      });
      setPreview(null);
      onExported();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="export-dialog-head">
          <div>
            <h3>Generate AbeBooks export</h3>
            <p className="export-dialog-sub">
              Composes eligible books into a bulk-upload file — upload it through your AbeBooks bookseller account.
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={17} />
          </button>
        </div>

        <div className="export-dialog-body">
          <div className="export-modes">
            {MODES.map((m) => (
              <label
                key={m.id}
                className={`export-mode ${mode === m.id ? 'active' : ''} ${
                  m.id === 'selection' && !hasSelection ? 'disabled' : ''
                }`}
              >
                <input
                  type="radio"
                  name="export-mode"
                  checked={mode === m.id}
                  disabled={m.id === 'selection' && !hasSelection}
                  onChange={() => setMode(m.id)}
                />
                <span className="export-mode-text">
                  <span className="export-mode-label">
                    {m.label}
                    {m.id === 'selection' && hasSelection && ` (${initialProductIds.length} books)`}
                  </span>
                  <span className="export-mode-hint">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>

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
                Export generated — {done.count} books included, {done.skipped} skipped. File{' '}
                <span className="mono">{done.filename}</span> downloaded. Included books are marked 'exported';
                future deltas only pick up changes.
              </span>
            </div>
          )}

          {preview && (
            <div className="export-preview">
              <div className="export-preview-summary">
                <strong>{preview.summary.included}</strong> books included ·{' '}
                <strong>{preview.summary.skipped}</strong> skipped
              </div>
              {preview.skipped.length > 0 && (
                <details className="export-skipped">
                  <summary>Skipped books ({preview.skipped.length}) — blocked and why</summary>
                  <ul>
                    {preview.skipped.map((s) => (
                      <li key={s.product_id}>
                        <span className="export-skipped-title">{s.title}</span>
                        <span className="export-skipped-reasons">{s.reasons.join('; ')}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="export-preview-table">
                <table>
                  <thead>
                    <tr>
                      <th>BookNo</th>
                      <th>Title</th>
                      <th>ISBN</th>
                      <th>Condition</th>
                      <th>Price</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 50).map((r) => (
                      <tr key={r.book_no}>
                        <td className="mono">{r.book_no}</td>
                        <td>{r.title}</td>
                        <td className="mono">{r.isbn || '—'}</td>
                        <td>{r.condition || '—'}</td>
                        <td>{r.price ? `$${r.price}` : '—'}</td>
                        <td className="export-desc-cell" title={r.description}>
                          {r.description ? r.description.slice(0, 90) + (r.description.length > 90 ? '…' : '') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows.length > 50 && (
                  <div className="export-preview-more">Showing first 50 of {preview.rows.length} rows.</div>
                )}
              </div>
              {preview.rows.some((r) => r.warnings) && (
                <div className="export-warnings">
                  {preview.rows
                    .filter((r) => r.warnings)
                    .slice(0, 5)
                    .map((r) => (
                      <div key={r.book_no}>
                        <strong>{r.title}</strong> — rule would skip: {r.warnings.join('; ')}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="export-dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <div className="export-dialog-footer-right">
            <button className="btn btn-secondary" disabled={loading || busy} onClick={handlePreview}>
              {loading ? 'Previewing…' : 'Preview'}
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || (mode === 'selection' && !hasSelection)}
              onClick={handleGenerate}
              title="Generates and downloads the file; marks included books as exported"
            >
              Generate &amp; download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
