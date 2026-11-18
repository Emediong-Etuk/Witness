import { useState } from 'react';
import { bridge } from '../bridge';
import { t } from '../strings';

export function KeySetup({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const save = async () => {
    const k = key.trim();
    if (k.length < 8 || /\s/.test(k)) {
      setErr(t('key.invalid'));
      return;
    }
    try {
      const r = await bridge.key.set(k);
      setKey('');
      if (r.stored === 'memory') setNote(t('key.memoryOnly'));
      onSaved();
    } catch {
      setErr(t('key.invalid'));
    }
  };
  return (
    <section className="mx-auto flex h-full max-w-lg flex-col justify-center gap-5 px-6" aria-labelledby="key-title">
      <h1 id="key-title" className="font-display text-4xl">{t('key.title')}</h1>
      <p className="text-muted">{t('key.body')}</p>
      <label className="grid gap-2 text-sm">
        <span className="sr-only">API key</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          className="rounded-lg border border-hairline bg-raised px-4 py-3 font-mono"
          placeholder="Paste key"
          aria-invalid={!!err}
          aria-describedby={err ? 'key-err' : undefined}
        />
      </label>
      {err ? <p id="key-err" role="alert" className="text-sm text-withheld">{err}</p> : null}
      {note ? <p className="text-sm text-warming">{note}</p> : null}
      <div className="flex gap-3">
        <button onClick={() => void save()} className="rounded-full bg-ink px-6 py-3 font-medium text-bg">{t('key.save')}</button>
        <button onClick={() => void bridge.open.external('register')} className="rounded-full border border-hairline px-6 py-3">{t('key.get')}</button>
        <button onClick={onCancel} className="ml-auto px-3 text-muted hover:text-ink">{t('consent.notNow')}</button>
      </div>
    </section>
  );
}
