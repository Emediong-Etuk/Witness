import { useState } from 'react';

export function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="group relative min-w-0">
      {label ? <p className="mb-1 text-xs text-muted">{label}</p> : null}
      <pre tabIndex={0} aria-label={label ?? 'Command'} className="overflow-x-auto rounded-xl border border-hairline bg-raised-2 p-4 pr-20 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
      <button onClick={copy} className="absolute right-2 top-2 rounded-lg border border-hairline bg-raised px-2.5 py-1 text-xs opacity-70 transition group-hover:opacity-100" aria-label={`Copy: ${code.split('\n')[0]}`} style={label ? { top: 28 } : undefined}>
        {done ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}
