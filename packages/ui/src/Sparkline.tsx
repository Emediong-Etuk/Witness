export function Sparkline({ values, width = 64, height = 18, stroke = 'var(--muted)', label }: { values: number[]; width?: number; height?: number; stroke?: string; label?: string }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - lo) / span) * height).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1} />
    </svg>
  );
}
