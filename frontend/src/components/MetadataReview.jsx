import { useEffect, useState } from 'react';
import { jobsAPI } from '../api';
import { CheckIcon, AlertIcon, SyncIcon, BookIcon } from './icons';
import './MetadataReview.css';

const CONDITIONS = [
  { value: '', label: '—' },
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like New' },
  { value: 'very_good', label: 'Very Good' },
  { value: 'good', label: 'Good' },
  { value: 'acceptable', label: 'Acceptable' },
];

const STATUS_LABEL = {
  unverified: { label: 'Unverified', tone: 'amber' },
  missing: { label: 'Missing', tone: 'clay' },
};

export default function MetadataReview({ onChanged }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await jobsAPI.needsReview();
      setProducts(res.data.products);
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const editFor = (product) =>
    edits[product.id] || {
      author: product.author || '',
      year: product.metadata?.year ?? '',
      condition: product.condition || '',
    };

  const setEdit = (product, patch) => {
    setEdits({ ...edits, [product.id]: { ...editFor(product), ...patch } });
  };

  const confirm = async (product) => {
    const edit = editFor(product);
    setBusy(true);
    setStatus(null);
    try {
      await jobsAPI.confirmMetadata(product.id, {
        author: edit.author.trim() || null,
        condition: edit.condition || null,
        year: edit.year === '' ? null : parseInt(edit.year, 10),
      });
      setProducts(products.filter((p) => p.id !== product.id));
      const remaining = products.length - 1;
      setStatus({
        ok: true,
        message: remaining > 0 ? `Confirmed — ${remaining} left to review` : 'All metadata reviewed',
      });
      onChanged?.();
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || err.message });
    } finally {
      setBusy(false);
    }
  };

  const runBackfill = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await jobsAPI.queueBackfill(true);
      setStatus({ ok: true, message: 'Backfill queued — enrichment runs in a few seconds, then refresh' });
      setTimeout(load, 4000);
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || err.message });
    } finally {
      setBusy(false);
    }
  };

  const counts = products.reduce(
    (acc, p) => {
      acc[p.metadata_status] = (acc[p.metadata_status] || 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <div className="metadata-view">
      <div className="page-head">
        <div>
          <h1 className="page-title">Metadata review</h1>
          <p className="page-desc">
            Books whose author/condition/year come from OpenLibrary (unverified) or are absent (missing). Confirm to
            promote them; Etsy vintage and AbeBooks condition rules skip missing books.
          </p>
        </div>
        <button className="btn btn-secondary" disabled={busy} onClick={runBackfill}>
          <SyncIcon size={14} /> Run enrichment backfill
        </button>
      </div>

      {status && (
        <div className={`settings-status ${status.ok ? 'ok' : 'err'}`}>
          {status.ok ? <CheckIcon size={13} /> : <AlertIcon size={13} />}
          {status.message}
        </div>
      )}

      <div className="meta-counts">
        <span className="meta-count tone-clay">{counts.missing || 0} missing</span>
        <span className="meta-count tone-amber">{counts.unverified || 0} unverified</span>
      </div>

      {loading ? (
        <div className="panel">Loading…</div>
      ) : products.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <div className="empty-icon">
              <CheckIcon size={26} />
            </div>
            <div className="empty-title">Nothing needs review</div>
            <div className="empty-hint">All books have confirmed metadata.</div>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Title</th>
                  <th>Status</th>
                  <th>Author</th>
                  <th>Year</th>
                  <th>Condition</th>
                  <th>ISBN</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const edit = editFor(product);
                  const meta = STATUS_LABEL[product.metadata_status] || STATUS_LABEL.missing;
                  return (
                    <tr key={product.id} className={product.metadata.enriched ? 'row-enriched' : ''}>
                      <td className="thumb-cell">
                        {product.images?.[0] ? (
                          <img src={product.images[0]} alt="" className="product-thumbnail" />
                        ) : (
                          <div className="no-image">
                            <BookIcon size={20} />
                          </div>
                        )}
                      </td>
                      <td className="product-title">{product.title}</td>
                      <td>
                        <span className={`meta-badge tone-${meta.tone}`}>{meta.label}</span>
                      </td>
                      <td>
                        <input
                          className="meta-input"
                          type="text"
                          placeholder="author"
                          value={edit.author}
                          onChange={(e) => setEdit(product, { author: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="meta-input narrow"
                          type="number"
                          placeholder="year"
                          value={edit.year}
                          onChange={(e) => setEdit(product, { year: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="meta-input select"
                          value={edit.condition}
                          onChange={(e) => setEdit(product, { condition: e.target.value })}
                        >
                          {CONDITIONS.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{product.isbn ? <span className="mono">{product.isbn}</span> : '—'}</td>
                      <td>
                        <button className="btn btn-primary btn-small" disabled={busy} onClick={() => confirm(product)}>
                          <CheckIcon size={13} /> Confirm
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
