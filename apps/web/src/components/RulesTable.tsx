import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { RuleId } from '@witness/gate';
import { RULE_COPY } from '@witness/session';
import { gateConfig } from '../lib/data';

const c = gateConfig;
const RULES: { id: RuleId; name: string; basis: string; source: 'SDK' | 'Witness'; threshold: string; key?: string }[] = [
  { id: 'R1_WARMUP', name: 'Window fully elapsed', basis: 'Confidence is 0 until each window fills (measurement-quality: warm-up).', source: 'SDK', threshold: `${c.windowsS.pulse} / ${c.windowsS.breathing} / ${c.windowsS.hrv} s` },
  { id: 'R2_SDK_STABLE', name: 'SDK says stable and confident', basis: '`stable` thresholds per metric (data-types).', source: 'SDK', threshold: `confidence ≥ ${c.sdkConfidenceMin.pulse} / ${c.sdkConfidenceMin.breathing} / ${c.sdkConfidenceMin.hrv}` },
  { id: 'R3_RANGE', name: 'Inside the validated range', basis: 'Pulse 40–110 bpm, breathing 5–40 br/min (model cards).', source: 'SDK', threshold: `${c.range.pulse.join('–')} bpm · ${c.range.breathing.join('–')} br/min` },
  { id: 'R4_VALIDATION_CLEAN', name: 'No SDK warnings in the window', basis: 'The 14 ValidationStatus codes; brief flicker of codes tolerated.', source: 'SDK', threshold: `≤ ${(c.validation.maxNonOkShare * 100).toFixed(0)}% non-OK, no episode > ${c.validation.maxEpisodeMs} ms`, key: 'validation' },
  { id: 'R5_ONE_CONTINUOUS_FACE', name: 'One continuous face', basis: 'MULTIPLE_FACES / NO_FACE codes and Landmarks.reset.', source: 'SDK', threshold: 'zero tolerance' },
  { id: 'R6_STILL', name: 'Still', basis: 'Large motion gives "deceptively high confidence" (measurement-quality).', source: 'Witness', threshold: `1-s RMS ≤ ${c.still.maxRms} IOD/frame`, key: 'still.maxRms' },
  { id: 'R7_QUIET', name: 'Quiet (breathing)', basis: 'Breathing "does not work when the subject is talking"; the SDK detects talking but has no warning code for it.', source: 'SDK', threshold: `talking < ${c.quiet.maxTalkingS} s`, key: 'quiet.maxTalkingS' },
  { id: 'R8_FRAME_RATE', name: 'Frame rate', basis: 'Camera must sustain ≥ 25 fps.', source: 'Witness', threshold: `every 1-s bin ≥ ${c.frameRate.minFps} fps` },
  { id: 'R9_STEADY_LIGHT', name: 'Steady light', basis: '"Flickering illumination such as TV screens" (model cards). No warning code exists.', source: 'Witness', threshold: `band ratio < ${c.steadyLight.maxBandRatio.pulse} · coincident SNR ≤ ${c.steadyLight.maxCoincidentSnr}`, key: 'steadyLight' },
  { id: 'R10_NO_CHEWING', name: 'No chewing', basis: '"Chewing gum" (model cards). No warning code exists.', source: 'Witness', threshold: `autocorrelation ≤ ${c.chewing.maxPeak}`, key: 'chewing.maxPeak' },
  { id: 'R11_LIVE_FACE', name: 'A live face', basis: 'A pulse from a photo or a screen can’t be the user’s.', source: 'Witness', threshold: `≥ ${c.liveFace.minBlinks} blink / ${c.liveFace.blinkWindowS} s · motion ≥ ${c.liveFace.minMeanMotion}`, key: 'liveFace' },
];

export function RulesTable() {
  const [open, setOpen] = useState<RuleId | null>('R9_STEADY_LIGHT');
  const calibrated = new Set(c.calibration.calibratedKeys);
  return (
    <div className="card divide-y divide-hairline overflow-hidden" data-tour="rules">
      {RULES.map((r) => {
        const isOpen = open === r.id;
        const cal = r.key ? [...calibrated].some((k) => k.startsWith(r.key!)) : null;
        return (
          <div key={r.id}>
            <button className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-raised-2" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
              <span className="w-12 font-mono text-xs text-muted">{r.id.split('_')[0]}</span>
              <span className="flex-1 font-medium">{r.name}</span>
              <span className={`chip hidden sm:inline-flex ${r.source === 'SDK' ? 'text-verified' : 'text-replay'}`}>{r.source === 'SDK' ? 'SDK signal' : 'Witness math'}</span>
              <motion.span animate={{ rotate: isOpen ? 45 : 0 }} className="text-xl text-muted" aria-hidden="true">+</motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                  <div className="grid gap-4 px-5 pb-5 text-sm md:grid-cols-3 md:pl-[4.25rem]">
                    <div><p className="mb-1 text-xs uppercase tracking-wider text-muted">Why</p><p>{r.basis}</p></div>
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wider text-muted">Threshold (gate.v1.json)</p>
                      <p className="font-mono">{r.threshold}</p>
                      {cal === false ? <p className="mt-1 text-xs text-warming">Starting value. Set from the calibration split before the held-out run.</p> : cal ? <p className="mt-1 text-xs text-verified">Calibrated</p> : null}
                    </div>
                    <div><p className="mb-1 text-xs uppercase tracking-wider text-muted">What the user sees</p><p className="text-muted">“{RULE_COPY[r.id]}”</p></div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
