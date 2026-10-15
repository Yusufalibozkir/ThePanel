import { useCallback, useEffect, useState } from 'react';
import { logsAPI } from '../api';
import { sanitizeDescription } from '../descriptionUtils';
import {
  SearchIcon,
  TrashIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  SyncIcon,
  AlertIcon,
  CheckIcon,
} from './icons';
import './LogsPanel.css';

const PLATFORM_LABELS = {
  base: 'Base product',
  ebay: 'eBay',
  abebooks: 'AbeBooks',
  etsy: 'Etsy',
  shopify: 'Shopify',
};

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

const PAGE_SIZE = 50;

const formatTime = (ts) => {
  if (!ts) return '—';
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  return new Date(iso).toLocaleString();
};

const stripHtml = (html) => {
  if (html === null || html === undefined) return '—';
  const text = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 140 ? text.slice(0, 140) + '…' : text || '(empty)';
};

const shortValue = (value) => {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 90 ? text.slice(0, 90) + '…' : text;
};

function ChangeCard({ entry, onDelete, onOpenProduct, busy }) {
  const [showDesc, setShowDesc] = useState(false);
  const platformLabel = entry.platform ? PLATFORM_LABELS[entry.platform] || entry.platform : null;

  return (
    <div className={`logs-entry src-${entry.source}`}>
      <div className="logs-entry-head">
        <span className={`logs-source-badge src-${entry.source}`}>
          {entry.source === 'manual' ? 'Local edit' : 'Shopify sync'}
        </span>
        {platformLabel && <span className={`logs-platform-badge p-${entry.platform}`}>{platformLabel}</span>}
        {entry.run_id && (
          <span className="logs-run-badge" title={`Produced by sync run ${entry.run_id}`}>
            run {entry.run_id.slice(-6)}
          </span>
        )}
        <button
          className="logs-product-link"
          title="Open this book"
          onClick={() => onOpenProduct(entry.product_id)}
        >
          {entry.product_title || entry.product_id.slice(0, 8)}
        </button>
        <span className="logs-time">{formatTime(entry.changed_at)}</span>
        <button
          className="btn btn-danger btn-small logs-delete"
          disabled={busy}
          onClick={() => onDelete(entry)}
          title="Delete this entry"
        >
          <TrashIcon size={12} />
          Delete
        </button>
      </div>
      <div className="logs-fields">
        {entry.changes.map((c, i) => {
          const isHtml = c.field === 'description';
          const isLong = c.field === 'notes' || c.field === 'title_override';
          return (
            <div key={i} className="logs-field">
              <span className="logs-field-name">{FIELD_LABELS[c.field] || c.field}</span>
              {isHtml ? (
                <div className="logs-desc-row">
                  <button className="logs-desc-toggle" onClick={() => setShowDesc((s) => !s)}>
                    {showDesc ? 'Hide' : 'Show'} before / after
                  </button>
                  {showDesc && (
                    <div className="logs-desc-diff">
                      <div className="logs-desc-pane">
                        <span className="pane-label">Before</span>
                        <div
                          className="description-html"
                          dangerouslySetInnerHTML={{ __html: sanitizeDescription(c.old_value) }}
                        />
                      </div>
                      <div className="logs-desc-pane">
                        <span className="pane-label">After</span>
                        <div
                          className="description-html"
                          dangerouslySetInnerHTML={{ __html: sanitizeDescription(c.new_value) }}
                        />
                      </div>
                    </div>
                  )}
                  {!showDesc && (
                    <span className="logs-field-values">
                      <span className="old">{stripHtml(c.old_value)}</span>
                      <span className="arrow">→</span>
                      <span className="new">{stripHtml(c.new_value)}</span>
                    </span>
                  )}
                </div>
              ) : isLong ? (
                <span className="logs-field-values logs-field-stacked">
                  <span className="old">{shortValue(c.old_value)}</span>
                  <span className="arrow">→</span>
                  <span className="new">{shortValue(c.new_value)}</span>
                </span>
              ) : (
                <span className="logs-field-values">
                  <span className="old">{shortValue(c.old_value)}</span>
                  <span className="arrow">→</span>
                  <span className="new">{shortValue(c.new_value)}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChangesTab({ initialRunId = null, onOpenProduct, onChanged }) {
  const [data, setData] = useState({ entries: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [offset, setOffset] = useState(0);
  const [platform, setPlatform] = useState('all');
  const [source, setSource] = useState('all');
  const [search, setSearch] = useState('');
  const [runId, setRunId] = useState(initialRunId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: PAGE_SIZE, offset };
      if (platform !== 'all') params.platform = platform;
      if (source !== 'all') params.source = source;
      if (search.trim()) params.search = search.trim();
      if (runId) params.run_id = runId;
      const res = await logsAPI.getChanges(params);
      setData({ entries: res.data.entries, total: res.data.total });
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [offset, platform, source, search, runId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [platform, source, runId]);

  const handleDelete = async (entry) => {
    const fields = entry.changes.map((c) => FIELD_LABELS[c.field] || c.field).join(', ');
    const scope = entry.platform ? ` (${PLATFORM_LABELS[entry.platform] || entry.platform})` : '';
    const message =
      entry.source === 'manual'
        ? `Delete this ${entry.source} entry${scope} (${fields})?\n\n` +
          'Manual entries peel back: affected fields fall to their previous version (or the Shopify truth for base fields).'
        : `Delete this sync record${scope} (${fields})?\n\nInformational only — no data is affected.`;
    if (!confirm(message)) return;

    setBusy(true);
    setError(null);
    try {
      await logsAPI.deleteChange(entry.product_id, entry.change_id);
      setNotice('Entry deleted');
      await load();
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePurge = async () => {
    const scopeParts = [];
    if (runId) scopeParts.push('this sync run');
    if (platform !== 'all') scopeParts.push(PLATFORM_LABELS[platform] || platform);
    if (source !== 'all') scopeParts.push(source === 'manual' ? 'local edits' : 'sync records');
    if (scopeParts.length === 0) {
      setError('Set a platform or source filter before purging (safety guard).');
      return;
    }
    if (!confirm(`Permanently delete ALL ${scopeParts.join(' + ')} history entries?\n\nThis cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {};
      if (runId) body.run_id = runId;
      if (platform !== 'all') body.platform = platform;
      if (source !== 'all') body.source = source;
      const res = await logsAPI.purgeChanges(body);
      setNotice(`Purged ${res.data.deleted_rows} history rows`);
      setOffset(0);
      await load();
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="logs-tab">
      <div className="logs-toolbar">
        <div className="search">
          <SearchIcon size={15} />
          <input
            type="text"
            placeholder="Search by book title…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            className="search-input"
          />
        </div>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="select">
          <option value="all">All scopes</option>
          <option value="base">Base product</option>
          <option value="ebay">eBay</option>
          <option value="abebooks">AbeBooks</option>
          <option value="etsy">Etsy</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="select">
          <option value="all">All sources</option>
          <option value="manual">Local edits</option>
          <option value="sync">Shopify sync</option>
        </select>
        <button className="btn btn-danger btn-small" disabled={busy} onClick={handlePurge}>
          <TrashIcon size={12} />
          Purge filtered…
        </button>
      </div>

      {runId && (
        <div className="logs-run-filter">
          <span className="logs-run-filter-label">
            Sync run <span className="mono">{runId.slice(0, 12)}…</span> — showing only the changes this run
            produced
          </span>
          <button className="logs-run-clear" onClick={() => setRunId(null)} aria-label="Clear run filter">
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="logs-error">
          <AlertIcon size={14} />
          {error}
        </div>
      )}
      {notice && (
        <div className="logs-notice" onClick={() => setNotice(null)}>
          <CheckIcon size={14} />
          {notice}
        </div>
      )}

      {loading ? (
        <div className="logs-empty">Loading history…</div>
      ) : data.entries.length === 0 ? (
        <div className="logs-empty">No change entries match these filters.</div>
      ) : (
        <>
          <div className="logs-list">
            {data.entries.map((entry) => (
              <ChangeCard
                key={entry.change_id}
                entry={entry}
                onDelete={handleDelete}
                onOpenProduct={onOpenProduct}
                busy={busy}
              />
            ))}
          </div>
          <div className="pagination">
            <div className="pagination-info">
              {data.total} entr{data.total === 1 ? 'y' : 'ies'} · showing {offset + 1}–
              {Math.min(offset + PAGE_SIZE, data.total)}
            </div>
            <div className="pagination-controls">
              <button
                className="page-btn"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0}
                aria-label="Previous page"
              >
                <ChevronLeftIcon size={15} />
              </button>
              <button
                className="page-btn"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= data.total}
                aria-label="Next page"
              >
                <ChevronRightIcon size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SyncRunsTab({ onChanged, onViewRun }) {
  const [data, setData] = useState({ logs: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [offset, setOffset] = useState(0);
  const [platform, setPlatform] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: PAGE_SIZE, offset };
      if (platform !== 'all') params.platform = platform;
      if (status !== 'all') params.status = status;
      if (search.trim()) params.search = search.trim();
      const res = await logsAPI.getSyncLogs(params);
      setData({ logs: res.data.logs, total: res.data.total });
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [offset, platform, status, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [platform, status]);

  const handleDelete = async (log) => {
    if (!confirm('Delete this sync run record?\n\nInformational only — no data is affected.')) return;
    setBusy(true);
    setError(null);
    try {
      await logsAPI.deleteSyncLog(log.id);
      setNotice('Sync record deleted');
      await load();
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePurge = async () => {
    const scopeParts = [];
    if (platform !== 'all') scopeParts.push(PLATFORM_LABELS[platform] || platform);
    if (status !== 'all') scopeParts.push(status);
    if (scopeParts.length === 0) {
      setError('Set a platform or status filter before purging (safety guard).');
      return;
    }
    if (!confirm(`Permanently delete ALL ${scopeParts.join(' + ')} sync records?\n\nThis cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {};
      if (platform !== 'all') body.platform = platform;
      if (status !== 'all') body.status = status;
      const res = await logsAPI.purgeSyncLogs(body);
      setNotice(`Purged ${res.data.deleted} sync records`);
      setOffset(0);
      await load();
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="logs-tab">
      <div className="logs-toolbar">
        <div className="search">
          <SearchIcon size={15} />
          <input
            type="text"
            placeholder="Search title or error…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            className="search-input"
          />
        </div>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="select">
          <option value="all">All platforms</option>
          <option value="shopify">Shopify</option>
          <option value="ebay">eBay</option>
          <option value="abebooks">AbeBooks</option>
          <option value="etsy">Etsy</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="select">
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
        <button className="btn btn-danger btn-small" disabled={busy} onClick={handlePurge}>
          <TrashIcon size={12} />
          Purge filtered…
        </button>
      </div>

      {error && (
        <div className="logs-error">
          <AlertIcon size={14} />
          {error}
        </div>
      )}
      {notice && (
        <div className="logs-notice" onClick={() => setNotice(null)}>
          <CheckIcon size={14} />
          {notice}
        </div>
      )}

      {loading ? (
        <div className="logs-empty">Loading sync records…</div>
      ) : data.logs.length === 0 ? (
        <div className="logs-empty">No sync records match these filters.</div>
      ) : (
        <>
          <div className="logs-list">
            {data.logs.map((log) => {
              const d = log.details || {};
              const summary = [
                d.created !== undefined ? `${d.created} created` : null,
                d.updated !== undefined ? `${d.updated} updated` : null,
                d.enriched ? `${d.enriched} enriched` : null,
                d.error_count !== undefined ? `${d.error_count} errors` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              const isOpen = expanded === log.id;
              return (
                <div key={log.id} className={`logs-entry src-${log.status === 'failed' ? 'failed' : 'sync'}`}>
                  <div className="logs-entry-head">
                    <span className={`logs-source-badge st-${log.status}`}>{log.status}</span>
                    <span className="logs-platform-badge">{PLATFORM_LABELS[log.platform] || log.platform}</span>
                    <span className="logs-action">{log.action}</span>
                    {log.product_title && <span className="logs-product-inline">{log.product_title}</span>}
                    <span className="logs-time">{formatTime(log.timestamp)}</span>
                    <button
                      className="btn btn-danger btn-small logs-delete"
                      disabled={busy}
                      onClick={() => handleDelete(log)}
                      title="Delete this record"
                    >
                      <TrashIcon size={12} />
                      Delete
                    </button>
                  </div>
                  <div className="logs-run-body">
                    {summary && <div className="logs-run-summary">{summary}</div>}
                    {log.error_message && <div className="logs-run-error">{log.error_message}</div>}
                    {log.change_count > 0 && (
                      <button
                        className="logs-run-changes-link"
                        onClick={() => onViewRun(log.id)}
                        title="Show the field changes this run produced"
                      >
                        View {log.change_count} field {log.change_count === 1 ? 'change' : 'changes'}
                      </button>
                    )}
                    {(summary || d.errors?.length > 0) && (
                      <button className="logs-desc-toggle" onClick={() => setExpanded(isOpen ? null : log.id)}>
                        {isOpen ? 'Hide details' : 'Details'}
                      </button>
                    )}
                    {isOpen && d.errors?.length > 0 && (
                      <ul className="logs-error-list">
                        {d.errors.map((e, i) => (
                          <li key={i}>
                            <span className="mono">{e.shopifyId}</span> — {e.error}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="pagination">
            <div className="pagination-info">
              {data.total} records · showing {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)}
            </div>
            <div className="pagination-controls">
              <button
                className="page-btn"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0}
                aria-label="Previous page"
              >
                <ChevronLeftIcon size={15} />
              </button>
              <button
                className="page-btn"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= data.total}
                aria-label="Next page"
              >
                <ChevronRightIcon size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function LogsPanel({ onOpenProduct, onRefreshProducts }) {
  const [subTab, setSubTab] = useState('changes');
  const [runFilter, setRunFilter] = useState(null);

  // Cross-link: jump from a sync run to its field changes
  const handleViewRun = (runId) => {
    setRunFilter(runId);
    setSubTab('changes');
  };

  return (
    <div className="logs-panel">
      <div className="page-head">
        <div>
          <h1 className="page-title">Logs</h1>
          <p className="page-desc">
            Every sync run and every field change across the catalog — review, retrieve, or remove, universally
            and per platform. Manual entries peel back to the previous version when deleted.
          </p>
        </div>
      </div>

      <div className="logs-subtabs">
        <button
          className={`logs-subtab ${subTab === 'changes' ? 'active' : ''}`}
          onClick={() => setSubTab('changes')}
        >
          <HistoryIcon size={14} />
          Field changes
        </button>
        <button
          className={`logs-subtab ${subTab === 'sync' ? 'active' : ''}`}
          onClick={() => setSubTab('sync')}
        >
          <SyncIcon size={14} />
          Sync runs
        </button>
      </div>

      <div className="panel">
        {subTab === 'changes' ? (
          <ChangesTab
            initialRunId={runFilter}
            onOpenProduct={onOpenProduct}
            onChanged={onRefreshProducts}
          />
        ) : (
          <SyncRunsTab onChanged={onRefreshProducts} onViewRun={handleViewRun} />
        )}
      </div>
    </div>
  );
}
