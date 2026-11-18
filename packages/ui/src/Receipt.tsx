import type { Receipt as R } from '@witness/gate';
import { RULE_CHIP } from '@witness/session';

const fmt = (x: unknown): string => {
  if (x === null || x === undefined) return '–';
  if (typeof x === 'number') return Number.isInteger(x) ? String(x) : Math.abs(x) < 0.01 ? x.toPrecision(2) : x.toFixed(x < 10 ? 3 : 1).replace(/\.?0+$/, '');
  if (typeof x === 'boolean') return x ? 'yes' : 'no';
  if (Array.isArray(x)) return x.length ? x.map(fmt).join('–') : 'none';
  return String(x);
};

const label = (k: string) => k.replace(/([A-Z])/g, ' $1').toLowerCase();

/** "observed / limit" per field, so each line reads as measurement against its threshold. */
export function compare(observed: unknown, threshold: unknown): string[] {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(observed) && isObj(threshold)) {
    const keys = [...new Set([...Object.keys(threshold), ...Object.keys(observed)])];
    return keys.map((k) => (k in threshold ? `${label(k)} ${fmt(observed[k])} / ${fmt(threshold[k])}` : `${label(k)} ${fmt(observed[k])}`));
  }
  if (isObj(observed)) return Object.entries(observed).map(([k, v]) => `${label(k)} ${fmt(v)}`).concat(`limit ${fmt(threshold)}`);
  return [`${fmt(observed)} / ${fmt(threshold)}`];
}

export const shortHash = (h: string) => {
  const hex = h.replace(/^sha256:/, '');
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
};

/** Thermal-receipt card. Monospace lines, perforated top edge, prints upward. */
export function ReceiptCard({ receipt, startedAt }: { receipt: R; startedAt?: string }) {
  const t0 = startedAt ? Date.parse(startedAt) : null;
  const clock = (us: number) => (t0 === null ? `${(us / 1e6).toFixed(1)}s` : new Date(t0 + us / 1000).toLocaleTimeString([], { hour12: false }));
  return (
    <figure
      aria-label={`Evidence receipt for ${receipt.metric}`}
      style={{
        fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, background: 'var(--raised-2)', color: 'var(--ink)',
        padding: '20px 18px 16px', margin: 0, position: 'relative', animation: 'witness-print 420ms steps(12) both',
        maskImage: 'radial-gradient(circle 5px at 8px 0, transparent 98%, #000) 0 0 / 16px 100% repeat-x',
        WebkitMaskImage: 'radial-gradient(circle 5px at 8px 0, transparent 98%, #000) 0 0 / 16px 100% repeat-x',
      }}
    >
      <div style={{ fontWeight: 500 }}>
        {receipt.metric.toUpperCase()} {receipt.value.toFixed(receipt.metric === 'pulse' ? 0 : 1)} {receipt.unit.toUpperCase()} · {receipt.verdict}
      </div>
      <div style={{ color: 'var(--muted)' }}>
        WINDOW {receipt.window.lengthS.toFixed(1)} s {clock(receipt.window.startUs)}–{clock(receipt.window.endUs)}
      </div>
      <div style={{ color: 'var(--muted)' }}>SDK conf {receipt.sdk.confidence.toFixed(1)} · stable {receipt.sdk.stable ? 'yes' : 'no'} · SDK {receipt.sdk.sdkVersion}</div>
      <hr style={{ border: 0, borderTop: '1px dashed var(--hairline)', margin: '8px 0' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '9.5em 1.2em 1fr', gap: 6, color: 'var(--muted)', fontSize: 11 }}>
        <span>CHECK</span>
        <span />
        <span>OBSERVED / LIMIT</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {receipt.checks.map((c) => (
          <li key={c.id} style={{ display: 'grid', gridTemplateColumns: '9.5em 1.2em 1fr', gap: 6 }}>
            <span>{RULE_CHIP[c.id].toUpperCase()}</span>
            <span aria-label={c.pass ? 'passed' : 'failed'} style={{ color: c.pass ? 'var(--verified)' : 'var(--withheld)' }}>{c.pass ? '✓' : '✕'}</span>
            <span style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>
              {compare(c.observed, c.threshold).map((line) => (
                <span key={line} style={{ display: 'block' }}>{line}</span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <hr style={{ border: 0, borderTop: '1px dashed var(--hairline)', margin: '8px 0' }} />
      <div style={{ color: 'var(--muted)' }}>receipt {shortHash(receipt.receiptHash)} · config {shortHash(receipt.gateConfigHash)}</div>
      <div style={{ color: 'var(--muted)' }}>inputs {shortHash(receipt.inputsHash)} · prev {shortHash(receipt.prevReceiptHash)}</div>
    </figure>
  );
}
