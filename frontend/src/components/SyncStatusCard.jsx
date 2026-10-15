import { useEffect, useState } from 'react';
import { statusAPI } from '../api';
import { AlertIcon, CheckIcon, SyncIcon } from './icons';
import './SyncStatusCard.css';

// Sync transparency (C-9): published cadence, next run, last run stats, queue
// health — "we put a number on it". Attention chip (C-10): the aggregated
// needs-attention counts with click-through to the right surface.

const formatTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const lastRunSummary = (lastRun) => {
  if (!lastRun) return 'never synced';
  const d = lastRun.details || {};
  const parts = [];
  if (d.created !== undefined) parts.push(`${d.created} created`);
  if (d.updated !== undefined) parts.push(`${d.updated} updated`);
  if (d.enriched) parts.push(`${d.enriched} enriched`);
  if (d.error_count) parts.push(`${d.error_count} errors`);
  if (parts.length === 0) parts.push(lastRun.status);
  return parts.join(', ');
};

export default function SyncStatusCard({ onOpenAttention }) {
  const [sync, setSync] = useState(null);
  const [attention, setAttention] = useState(null);
  const [error, setError] = useState(null);

  const refresh = async () => {
    try {
      const [syncRes, attentionRes] = await Promise.all([
        statusAPI.getSync(),
        statusAPI.getAttention().catch(() => null),
      ]);
      setSync(syncRes.data);
      if (attentionRes) setAttention(attentionRes.data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, []);

  if (error && !sync) return null;
  if (!sync) return null;

  const scheduler = sync.scheduler || {};
  const queue = sync.queue || {};
  const attentionTotal = attention?.total || 0;

  return (
    <div className="sync-status-card">
      <div className="sync-status-segment">
        <SyncIcon size={14} />
        {scheduler.enabled ? (
          <span className="sync-status-text">
            Shopify poll · every {scheduler.poll_minutes} min · next {formatTime(scheduler.next_run_at)}
          </span>
        ) : (
          <span className="sync-status-text">Shopify polling off — manual sync only</span>
        )}
        {!scheduler.shopify_configured && (
          <span className="sync-status-warn" title="SHOPIFY credentials not set in backend/.env">
            credentials missing
          </span>
        )}
      </div>

      <div className="sync-status-segment">
        <span className="sync-status-text">
          Last run: <strong>{formatTime(sync.last_run?.finished_at)}</strong>
          {sync.last_run && <span className="sync-status-detail"> — {lastRunSummary(sync.last_run)}</span>}
          {sync.last_run?.status === 'failed' && <span className="sync-status-fail"> failed</span>}
        </span>
      </div>

      {queue.failed > 0 && (
        <div className="sync-status-segment sync-status-failed">
          <AlertIcon size={13} />
          <span>
            {queue.failed} failed job{queue.failed === 1 ? '' : 's'} in queue
          </span>
        </div>
      )}

      <button
        className={`sync-attention-chip ${attentionTotal > 0 ? 'has-attention' : 'clear'}`}
        onClick={onOpenAttention}
        title="Error listings, failed jobs, metadata gaps"
      >
        {attentionTotal > 0 ? (
          <>
            <AlertIcon size={13} />
            <span>Needs attention ({attentionTotal})</span>
            <span className="sync-attention-detail">
              {attention.listings_error.count > 0 && `${attention.listings_error.count} listing errors · `}
              {attention.failed_jobs.count > 0 && `${attention.failed_jobs.count} failed jobs · `}
              {attention.metadata_missing.count > 0 && `${attention.metadata_missing.count} missing metadata · `}
              {attention.metadata_unverified.count > 0 && `${attention.metadata_unverified.count} unverified`}
            </span>
          </>
        ) : (
          <>
            <CheckIcon size={13} />
            <span>Everything OK</span>
          </>
        )}
      </button>
    </div>
  );
}
