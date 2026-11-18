import { verifyAll, verifyCheckins, type VerifyInput } from '@witness/verify';
import type { GateConfig } from '@witness/gate';
import { demoCorpus, type Tamper } from './demo-corpus';

type In =
  | { kind: 'all'; input: Omit<VerifyInput, 'onProgress'> }
  | { kind: 'demo'; cfg: GateConfig; tamper: Tamper }
  | { kind: 'checkin'; text: string; cfg: GateConfig };

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  const t0 = performance.now();
  try {
    let report;
    if (m.kind === 'checkin') report = verifyCheckins(m.text, [m.cfg]);
    else {
      if (m.kind === 'demo') post({ type: 'progress', done: 0, total: 1, label: 'building demo corpus' });
      const input = m.kind === 'all' ? m.input : demoCorpus(m.cfg, m.tamper);
      report = verifyAll({ ...input, onProgress: (done, total, label) => post({ type: 'progress', done, total, label }) });
    }
    post({ type: 'done', report, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};
