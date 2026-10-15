import { useEffect, useState } from 'react';
import { rulesAPI } from '../api';
import { CheckIcon, BookIcon } from './icons';
import './GettingStarted.css';

// Numbered setup checklist (C-1) that ends at "first export" — every step is
// derived from live state, so completion is honest, not persisted. Hides
// itself once everything is done.

export default function GettingStarted({ products, connectedPlatforms, onNavigate }) {
  const [rules, setRules] = useState([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    rulesAPI
      .getAll()
      .then((res) => setRules(res.data.rules || []))
      .catch(() => setRules([]));
  }, [products]);

  const steps = [
    {
      label: 'Import your catalog',
      hint: 'Sync from Shopify to pull your books into the panel.',
      done: products.length > 0,
      action: { label: 'Overview', tab: 'overview' },
    },
    {
      label: 'Review book metadata',
      hint: 'Authors, years, conditions — clean metadata feeds every channel rule.',
      done:
        products.length > 0 &&
        !products.some((p) => ['missing', 'unverified'].includes(p.metadata_status)),
      action: { label: 'Metadata review', tab: 'metadata' },
    },
    {
      label: 'Configure channel rules',
      hint: 'Pricing multipliers, min prices, and eligibility filters per platform.',
      done: rules.some((r) => r.enabled),
      action: { label: 'Settings', tab: 'settings' },
    },
    {
      label: 'Store channel credentials',
      hint: 'Encrypted at rest (AES-256-GCM); never shown in full again.',
      done: Object.values(connectedPlatforms).some(Boolean),
      action: { label: 'Settings', tab: 'settings' },
    },
    {
      label: 'Generate your first AbeBooks export',
      hint: 'Select books in the overview → "AbeBooks export…".',
      done: products.some((p) =>
        (p.platform_listings || []).some((l) => l.platform === 'abebooks' && l.status === 'exported')
      ),
      action: { label: 'AbeBooks', tab: 'abebooks' },
    },
  ];

  if (dismissed || steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="getting-started">
      <div className="getting-started-head">
        <BookIcon size={16} />
        <h2>
          Getting started
          <span className="getting-started-progress">
            {doneCount}/{steps.length}
          </span>
        </h2>
        <button
          className="getting-started-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss setup guide"
        >
          Hide
        </button>
      </div>
      <ol className="getting-started-steps">
        {steps.map((step, i) => (
          <li key={i} className={step.done ? 'done' : ''}>
            <span className="getting-started-check">
              {step.done ? <CheckIcon size={13} /> : <span className="getting-started-number">{i + 1}</span>}
            </span>
            <span className="getting-started-text">
              <span className="getting-started-label">{step.label}</span>
              <span className="getting-started-hint">{step.hint}</span>
            </span>
            {!step.done && step.action && (
              <button
                className="btn btn-secondary btn-small"
                onClick={() => onNavigate(step.action.tab)}
              >
                {step.action.label} →
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
