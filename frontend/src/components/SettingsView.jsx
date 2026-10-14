import { useEffect, useState } from 'react';
import { settingsAPI, rulesAPI } from '../api';
import { CheckIcon, AlertIcon, SyncIcon } from './icons';
import './SettingsView.css';

const PLATFORMS = [
  { id: 'ebay', name: 'eBay', fields: [
    { key: 'client_id', label: 'Client ID (App ID)' },
    { key: 'client_secret', label: 'Client secret (Cert ID)' },
    { key: 'dev_id', label: 'Dev ID' },
    { key: 'refresh_token', label: 'Refresh token' },
  ]},
  { id: 'etsy', name: 'Etsy', fields: [
    { key: 'client_id', label: 'Keystring (client ID)' },
    { key: 'client_secret', label: 'Shared secret' },
    { key: 'refresh_token', label: 'Refresh token' },
  ]},
  { id: 'abebooks', name: 'AbeBooks', fields: [
    { key: 'username', label: 'User ID / Client PIN' },
    { key: 'api_key', label: 'API key' },
  ]},
];

const CONDITIONS = ['new', 'like_new', 'very_good', 'good', 'acceptable'];
const ROUNDINGS = [
  { value: 'up_x99', label: 'Round up to X.99' },
  { value: 'none', label: 'No rounding' },
];

function CredentialsCard({ platform, onChanged }) {
  const [draft, setDraft] = useState({});
  const [stored, setStored] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const res = await settingsAPI.getCredentials();
      const found = res.data.credentials.find((c) => c.platform === platform.id);
      setStored(found && found.preview && Object.keys(found.preview).length > 0 ? found : null);
    } catch {
      /* surfaced via status line on actions */
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform.id]);

  const run = async (fn, okMessage) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await fn();
      setStatus({ ok: true, message: okMessage || result.data?.message || 'Done' });
      await refresh();
      onChanged?.();
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || err.message });
    } finally {
      setBusy(false);
    }
  };

  const hasInput = platform.fields.some((f) => draft[f.key]?.trim());

  return (
    <div className="settings-card">
      <div className="settings-card-head">
        <h3>{platform.name}</h3>
        {stored ? (
          <span className="vault-state stored">
            <CheckIcon size={13} /> Stored
          </span>
        ) : (
          <span className="vault-state empty">No credentials</span>
        )}
      </div>

      {stored && (
        <div className="vault-preview">
          {Object.entries(stored.preview)
            .filter(([k]) => !k.startsWith('_'))
            .map(([key, value]) => (
              <div key={key} className="vault-preview-row">
                <span className="mono">{key}</span>
                <span className="mono">{value}</span>
              </div>
            ))}
          {stored.last_validated_at && (
            <div className="vault-validated">Last validated {new Date(stored.last_validated_at).toLocaleString()}</div>
          )}
        </div>
      )}

      <div className="vault-form">
        {platform.fields.map((field) => (
          <div className="form-group" key={field.key}>
            <label>{field.label}</label>
            <input
              type="password"
              autoComplete="off"
              placeholder={stored?.preview?.[field.key] || '—'}
              value={draft[field.key] || ''}
              onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
            />
          </div>
        ))}
      </div>

      {status && (
        <div className={`settings-status ${status.ok ? 'ok' : 'err'}`}>
          {status.ok ? <CheckIcon size={13} /> : <AlertIcon size={13} />}
          {status.message}
        </div>
      )}

      <div className="settings-actions">
        <button
          className="btn btn-primary btn-small"
          disabled={busy || !hasInput}
          onClick={() =>
            run(
              () =>
                settingsAPI.saveCredentials(
                  platform.id,
                  Object.fromEntries(Object.entries(draft).filter(([, v]) => v?.trim()))
                ),
              'Credentials stored (encrypted)'
            )
          }
        >
          Save encrypted
        </button>
        <button
          className="btn btn-secondary btn-small"
          disabled={busy}
          onClick={() => run(() => settingsAPI.testCredentials(platform.id))}
        >
          Test connection
        </button>
        {stored && (
          <button
            className="btn btn-danger btn-small"
            disabled={busy}
            onClick={() => run(() => settingsAPI.deleteCredentials(platform.id), 'Credentials removed')}
          >
            Remove
          </button>
        )}
      </div>
      <p className="settings-hint">
        {platform.id === 'abebooks'
          ? 'User ID: Members Menu → Account Details → Marketplace Profile. API key: regenerate at abebooks.com/servlet/ApiKey. Test uses the Inventory Update server (port 10027).'
          : platform.id === 'ebay'
            ? 'Keys from developer.ebay.com → Application Keys. Test connection exchanges them for an OAuth token.'
            : 'Etsy OAuth arrives in Phase 4; paste keys manually for now.'}
      </p>
    </div>
  );
}

function RuleEditor({ rule, onSaved }) {
  const [draft, setDraft] = useState(rule);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => setDraft(rule), [rule]);

  const modifier = draft.price_modifier || {};
  const conditions = draft.conditions || {};

  const setModifier = (patch) => setDraft({ ...draft, price_modifier: { ...modifier, ...patch } });
  const setConditions = (patch) => setDraft({ ...draft, conditions: { ...conditions, ...patch } });

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await rulesAPI.update(draft.platform, {
        enabled: draft.enabled,
        auto_sync: draft.auto_sync,
        conditions: draft.conditions,
        price_modifier: draft.price_modifier,
      });
      setStatus({ ok: true, message: 'Rule saved' });
      onSaved(res.data.rule);
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || err.message });
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      const res = await rulesAPI.preview(draft.platform);
      setPreview(res.data);
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || err.message });
    } finally {
      setBusy(false);
    }
  };

  const toggleCondition = (value) => {
    const list = new Set(conditions.conditions || []);
    if (list.has(value)) list.delete(value);
    else list.add(value);
    setConditions({ conditions: [...list] });
  };

  return (
    <div className="settings-card rule-card">
      <div className="settings-card-head">
        <h3>{draft.platform}</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={Boolean(draft.enabled)}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <span>{draft.enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>

      <div className="rule-grid">
        <div className="form-group">
          <label>Multiplier</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={modifier.multiplier ?? 1}
            onChange={(e) => setModifier({ multiplier: parseFloat(e.target.value) })}
          />
        </div>
        <div className="form-group">
          <label>Fixed fee ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={modifier.fixed_fee ?? 0}
            onChange={(e) => setModifier({ fixed_fee: parseFloat(e.target.value) })}
          />
        </div>
        <div className="form-group">
          <label>Min price ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={modifier.min_price ?? 0}
            onChange={(e) => setModifier({ min_price: parseFloat(e.target.value) })}
          />
        </div>
        <div className="form-group">
          <label>Rounding</label>
          <select value={modifier.rounding || 'up_x99'} onChange={(e) => setModifier({ rounding: e.target.value })}>
            {ROUNDINGS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {draft.platform === 'etsy' && (
        <div className="rule-conditions">
          <div className="form-group">
            <label className="toggle">
              <input
                type="checkbox"
                checked={Boolean(conditions.vintage_only)}
                onChange={(e) => setConditions({ vintage_only: e.target.checked })}
              />
              <span>Vintage only (compliance)</span>
            </label>
          </div>
          <div className="form-group">
            <label>Year cutoff (books published before)</label>
            <input
              type="number"
              value={conditions.year_before ?? 2006}
              onChange={(e) => setConditions({ year_before: parseInt(e.target.value, 10) })}
            />
          </div>
          <div className="form-group">
            <label className="toggle">
              <input
                type="checkbox"
                checked={Boolean(conditions.requires_images)}
                onChange={(e) => setConditions({ requires_images: e.target.checked })}
              />
              <span>Require images</span>
            </label>
          </div>
        </div>
      )}

      {draft.platform === 'abebooks' && (
        <div className="rule-conditions">
          <span className="info-label">Conditions allowed</span>
          <div className="condition-toggles">
            {CONDITIONS.map((c) => (
              <label key={c} className={`chip-toggle ${(conditions.conditions || []).includes(c) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={(conditions.conditions || []).includes(c)}
                  onChange={() => toggleCondition(c)}
                />
                {c.replace('_', ' ')}
              </label>
            ))}
          </div>
        </div>
      )}

      {status && (
        <div className={`settings-status ${status.ok ? 'ok' : 'err'}`}>
          {status.ok ? <CheckIcon size={13} /> : <AlertIcon size={13} />}
          {status.message}
        </div>
      )}

      {preview && (
        <div className="rule-preview">
          <strong>{preview.summary.eligible}</strong> of {preview.summary.total} products eligible
          <div className="rule-preview-skips">
            {Object.entries(preview.summary.skipped).map(([reason, count]) => (
              <span key={reason}>
                {count} × {reason.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="settings-actions">
        <button className="btn btn-primary btn-small" disabled={busy} onClick={save}>
          Save rule
        </button>
        <button className="btn btn-secondary btn-small" disabled={busy} onClick={runPreview}>
          <SyncIcon size={13} /> Preview eligible
        </button>
      </div>
    </div>
  );
}

export default function SettingsView({ onShopifyTest }) {
  const [rules, setRules] = useState([]);
  const [shopify, setShopify] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    rulesAPI
      .getAll()
      .then((res) => setRules(res.data.rules))
      .catch(() => setRules([]));
  }, []);

  const testShopify = async () => {
    setBusy(true);
    try {
      const res = await onShopifyTest();
      setShopify({ ok: true, message: `Connected: ${res.shop.name} (${res.shop.domain})` });
    } catch (err) {
      setShopify({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-view">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-desc">Credentials are encrypted at rest (AES-256-GCM) and never shown again in full.</p>
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Shopify connection</h2>
        <div className="settings-card">
          <div className="settings-card-head">
            <h3>Admin API token</h3>
            <button className="btn btn-secondary btn-small" disabled={busy} onClick={testShopify}>
              Test connection
            </button>
          </div>
          <p className="settings-hint">
            Set <code>SHOPIFY_STORE_URL</code> and <code>SHOPIFY_ACCESS_TOKEN</code> in <code>backend/.env</code> (custom
            app with read_products + read_inventory).
          </p>
          {shopify && (
            <div className={`settings-status ${shopify.ok ? 'ok' : 'err'}`}>
              {shopify.ok ? <CheckIcon size={13} /> : <AlertIcon size={13} />}
              {shopify.message}
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Channel credentials</h2>
        <div className="settings-grid">
          {PLATFORMS.map((p) => (
            <CredentialsCard key={p.id} platform={p} />
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Sync rules &amp; pricing</h2>
        <div className="settings-grid">
          {rules.map((rule) => (
            <RuleEditor key={rule.platform} rule={rule} onSaved={(updated) => setRules(rules.map((r) => (r.platform === updated.platform ? updated : r)))} />
          ))}
        </div>
      </div>
    </div>
  );
}
