import { getPath, renderValue } from '@witness/bench-core';
import { results } from '../lib/data';

/**
 * A number from bench/out/results.json, rendered exactly like the README
 * markers. Before the held-out run there are no results, so it renders a TBD
 * chip. It never shows a placeholder value.
 */
export function Num({ path, format, testId }: { path: string; format: string; testId?: string }) {
  const v = results ? renderValue(getPath(results, path), format) : null;
  if (v === null)
    return (
      <span className="tbd" title="Filled from the held-out bench run (npm run bench:report). Not measured yet." data-testid={testId}>
        TBD
      </span>
    );
  return (
    <span className="font-mono tabular text-verified" data-testid={testId}>
      {v}
    </span>
  );
}
