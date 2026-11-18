import { GateSession, type GateConfig, type Receipt } from '@witness/gate';
import { GateEventMapper, type SourceEvent, type TraceHeader, type TraceLine } from '@witness/sdk-adapter';

export interface Replayed {
  header: TraceHeader;
  receipts: Receipt[];
  chainHead: string;
  durationS: number;
}

/** Deterministically re-run the gate over a trace. No SDK, no credits. */
export function replayTrace(lines: TraceLine[], cfg: GateConfig, sessionId?: string): Replayed {
  const header = lines.find((l): l is TraceHeader => l.type === 'header');
  if (!header) throw new Error('trace has no header');
  const events = lines.filter((l): l is SourceEvent => l.type !== 'header').sort((a, b) => a.t - b.t);
  const id = sessionId ?? `ses_${header.source.replace(/[^A-Za-z0-9]/g, '_')}`;
  const gate = new GateSession(id, header.sdkVersion, cfg);
  const mapper = new GateEventMapper(header.mode);
  for (const g of mapper.start(0)) gate.push(g);
  for (const e of events) for (const g of mapper.map(e)) gate.push(g);
  return { header, receipts: gate.receipts, chainHead: gate.chainHead, durationS: events.length ? events[events.length - 1]!.t / 1e6 : 0 };
}
