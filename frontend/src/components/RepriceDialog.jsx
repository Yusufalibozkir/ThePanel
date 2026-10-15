import { useState } from 'react';
import { productsAPI } from '../api';
import { AlertIcon, CheckIcon, CloseIcon } from './icons';
import './RepriceDialog.css';

// PricePartner-style bulk reprice (C-7, from HomeBase): adjust the selection's
// effective price by ± percent, ± amount, or set to a value. Prices are Shopify
// truth, so this applies *local overrides* (journaled per book, peelable via
// History) — the diff is previewed before anything is committed (C-11).

const MODES = [
  {
    id: 'percent',
    label: 'Adjust by percent',
    hint: 'e.g. 10 raises prices by 10%; -10 lowers them.',
    placeholder: '±10',
  },
  {
    id: 'amount',
    label: 'Adjust by amount ($)',
    hint: 'e.g. 2.50 adds $2.50; -2.50 subtracts it.',
    placeholder: '±2.50',
  },
  {
    id: 'set',
    label: 'Set to value ($)',
    hint: 'Every selected book gets this price.',
    placeholder: '12.99',
  },
];

export default function RepriceDialog({ productIds, onClose, onApplied }) {
  const [mode, setMode] = useState('percent');
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const numericValue = parseFloat(value);
  const validValue = value !== '' && Number.isFinite(numericValue) && (mode !== 'set' || numericValue > 0);

  const run = async (dryRun) => {
    setBusy(true);
    setError(null);
    if (dryRun) setDone(null);
    try {
      const res = await productsAPI.reprice(productIds, mode, numericValue, dryRun);
      if (dryRun) {
        setPreview(res.data);
      } else {
        setDone({ applied: res.data.applied, skipped: res.data.skipped });
        setPreview(null);
        onApplied?.();
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  const commit = () => {
    const changed = preview ? preview.rows.filter((r) => !r.skipped && !r.unchanged).length : 0;
    const ok = confirm(
      `Apply local price overrides to ${changed} book${changed === 1 ? '' : 's'}?\n\n` +
        'Shopify truth stays untouched — every change is journaled and reversible per book from its History tab.'
    );
    if (ok) run(false);
  };

  const changedRows = preview ? preview.rows.filter((r) => !r.skipped && !r.unchanged) : [];
  const skippedRows = preview ? preview.rows.filter((r) => r.skipped) : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="reprice-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="reprice-head">
          <div>
            <h3>Reprice {productIds.length} book{productIds.length === 1 ? '' : 's'}</h3>
            <p className="reprice-sub">
              Local price overrides — Shopify truth untouched, reversible per book via History.
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={17} />
          </button>
        </div>

        <div className="reprice-body">
          <div className="reprice-modes">
            {MODES.map((m) => (
              <label key={m.id} className={`reprice-mode ${mode === m.id ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="reprice-mode"
                  checked={mode === m.id}
                  onChange={() => {
                    setMode(m.id);
                    setPreview(null);
                    setDone(null);
                  }}
                />
                <span className="reprice-mode-text">
                  <span className="reprice-mode-label">{m.label}</span>
                  <span className="reprice-mode-hint">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="reprice-input-row">
            <input
              type="number"
              step={mode === 'percent' ? 1 : 0.01}
              placeholder={MODES.find((m) => m.id === mode).placeholder}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setPreview(null);
                setDone(null);
              }}
              className="reprice-value"
            />
            <button
              className="btn btn-secondary"
              disabled={busy || !validValue}
              onClick={() => run(true)}
            >
              {busy && !done ? 'Previewing…' : 'Preview diff'}
            </button>
          </div>

          {error && (
            <div className="reprice-error">
              <AlertIcon size={14} />
              {error}
            </div>
          )}

          {done && (
            <div className="reprice-done">
              <CheckIcon size={14} />
              Applied — {done.applied} price{done.applied === 1 ? '' : 's'} updated
              {done.skipped > 0 && `, ${done.skipped} skipped`}
              .
            </div>
          )}

          {preview && (
            <div className="reprice-preview">
              <div className="reprice-preview-summary">
                <strong>{changedRows.length}</strong> would change ·{' '}
                <strong>{skippedRows.length}</strong> skipped
                {preview.rows.some((r) => r.unchanged) && (
                  <> · {preview.rows.filter((r) => r.unchanged).length} already at that price</>
                )}
              </div>
              {skippedRows.length > 0 && (
                <details className="reprice-skipped">
                  <summary>Skipped ({skippedRows.length}) — and why</summary>
                  <ul>
                    {skippedRows.map((r) => (
                      <li key={r.product_id}>
                        <strong>{r.title || r.product_id}</strong> — {r.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="reprice-table">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Current</th>
                      <th>New</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changedRows.slice(0, 50).map((r) => {
                      const delta = Number(r.to) - Number(r.from);
                      return (
                        <tr key={r.product_id}>
                          <td>{r.title}</td>
                          <td className="mono">${Number(r.from).toFixed(2)}</td>
                          <td className="mono reprice-new">${Number(r.to).toFixed(2)}</td>
                          <td className={`mono ${delta >= 0 ? 'up' : 'down'}`}>
                            {delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {changedRows.length > 50 && (
                  <div className="reprice-preview-more">Showing first 50 of {changedRows.length} rows.</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="reprice-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !preview || changedRows.length === 0}
            onClick={commit}
            title="Applies local price overrides; journaled per book"
          >
            Apply to {changedRows.length || 0} book{changedRows.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
