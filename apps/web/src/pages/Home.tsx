import { useMemo } from 'react';
import { decodeTrace, encodeTrace, replayTrace } from '@witness/bench-core';
import { GATE_V1 } from '@witness/gate';
import { syntheticTrace } from '@witness/sdk-adapter';
import { ReceiptCard } from '@witness/ui';
import { HeroRings } from '../components/HeroRings';
import { Num } from '../components/Num';
import { Reveal, SectionHead } from '../components/Reveal';
import { RulesTable } from '../components/RulesTable';
import { TestingNote } from '../components/TestingNote';
import { VideoCard } from '../components/VideoCard';
import { WindowExplainer } from '../components/WindowExplainer';
import { gateConfig, gateHash, recordedCount, sdkVersion, stage } from '../lib/data';
import { Link } from '../lib/router';
import { SITE } from '../site.config';

const STAGES = [
  { id: 'no-clips', label: 'Record consented clips' },
  { id: 'recording', label: 'Record SDK traces' },
  { id: 'calibrated', label: 'Calibrate, then freeze thresholds' },
  { id: 'results', label: 'Held-out results' },
] as const;

export function Home() {
  const example = useMemo(() => {
    const lines = decodeTrace(encodeTrace(syntheticTrace('clean', { mode: 'quick', durS: 20 })).text).lines;
    return replayTrace(lines, GATE_V1).receipts.filter((r) => r.verdict === 'VERIFIED').at(-1) ?? null;
  }, []);
  const stageIdx = STAGES.findIndex((s) => s.id === stage);
  return (
    <>
      {/* HERO */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-12 md:grid-cols-[1.15fr_1fr] md:pt-20">
        <div>
          <Reveal>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-verified" /> Presage SmartSpectra challenge · Thoughtful Real-World Use
            </p>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="font-display text-6xl leading-[0.95] tracking-tight md:text-7xl">
              Camera vitals that <span className="shine">show their work.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 text-lg leading-relaxed text-muted" data-tour="problem">
              SmartSpectra turns <b className="text-ink">12 s</b> of video into a pulse, <b className="text-ink">30 s</b> into a breathing rate and <b className="text-ink">60 s</b> into HRV, and its own model cards warn that motion, chewing and flickering light can produce wrong values <i>with high confidence</i>. Only motion has one of its 14 warning codes. So an app that trusts <code className="text-ink">stable</code> can show a contaminated reading as reliable.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <p className="mt-5 rounded-2xl border border-hairline bg-raised/60 p-4 text-[15px] leading-relaxed" data-tour="measured">
              On our <Num path="clips.length" format="int" testId="hero-n" />-clip held-out corpus, <Num path="overall.sdkFalseTrust" format="ci-pct" /> of readings the SDK marked <code>stable</code> had a documented-invalid condition inside their window. Witness withheld <Num path="overall.witnessWithheldContaminated" format="ci-pct" /> of those and kept <Num path="overall.cleanVerified" format="ci-pct" /> of the clean ones.
              <span className="mt-2 block text-xs text-muted">Every number here is computed by the held-out bench and recomputed by the verifier. TBD means that run hasn't happened yet.</span>
            </p>
          </Reveal>
          <Reveal delay={0.24}>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#videos" className="btn btn-primary" data-testid="cta-watch">▶ Watch the 3-minute demo</a>
              <Link to="/verify" className="btn" data-testid="cta-verify">Verify our results in your browser →</Link>
            </div>
          </Reveal>
        </div>
        <Reveal delay={0.1}>
          <HeroRings />
        </Reveal>
      </section>

      {/* VIDEOS */}
      <section id="videos" className="mx-auto max-w-6xl px-5 py-16" data-tour="videos">
        <SectionHead eyebrow="Watch" title="Two videos, one for the idea and one for the engineering." />
        <div className="grid gap-6 md:grid-cols-2">
          <Reveal><VideoCard {...SITE.videos.pitch} testId="video-pitch" /></Reveal>
          <Reveal delay={0.08}><VideoCard {...SITE.videos.walkthrough} testId="video-walkthrough" /></Reveal>
        </div>
      </section>

      {/* WHY */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <SectionHead eyebrow="Why stable isn't enough" title={<>A 3-second disturbance spoils <span className="italic">a minute</span> of readings.</>}>
          Three facts about how camera vitals work make this problem specific to SmartSpectra. A fingertip oximeter can't be fooled by talking, a TV, gum, or a sibling walking into frame.
        </SectionHead>
        <div className="mb-8 grid gap-4 md:grid-cols-3">
          {[
            ['Camera sensing', 'A pulse is read from tiny skin-colour changes. Any light that pulses (a TV, a flickering bulb, a generator-fed lamp) can look like a heartbeat.'],
            ['Windowed averaging', 'Every number summarises the last 12, 30 or 60 seconds. A short disturbance lands inside every reading whose window covers it, and the number hides it.'],
            ['Confidence can stay high', 'The model cards say motion, chewing and flicker "may produce inaccurate measurements with high confidence", so `stable` alone is not a guard.'],
          ].map(([h, b], i) => (
            <Reveal key={h} delay={i * 0.06}>
              <div className="card card-hover h-full p-5">
                <p className="mb-3 font-mono text-xs text-verified">0{i + 1}</p>
                <h3 className="mb-2 text-lg font-medium">{h}</h3>
                <p className="text-sm leading-relaxed text-muted">{b}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal><WindowExplainer /></Reveal>
      </section>

      {/* HOW */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <SectionHead eyebrow="How Witness works" title="The Clean-Window Gate.">
          A number is shown only when its <i>entire</i> window passed every documented condition. Each shown number comes with an evidence receipt anyone can recompute. Each withheld number gets a plain reason and a countdown.
        </SectionHead>
        <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
          <Reveal><RulesTable /></Reveal>
          <Reveal delay={0.1}>
            <div className="sticky top-24" data-tour="receipt">
              <p className="mb-2 text-xs text-muted">An evidence receipt (from a labelled synthetic replay, not a measurement)</p>
              {example ? <ReceiptCard receipt={example} /> : null}
              <p className="mt-3 text-xs text-muted">The receipt hashes chain together. The verifier re-runs the gate on the logged evidence and must reproduce every byte.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* PROOF / STATUS */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <SectionHead eyebrow="Status, in the open" title="Where the evidence stands today." />
        <Reveal className="mb-8" y={0}><div data-tour="testing-note"><TestingNote /></div></Reveal>
        <Reveal>
          <ol className="card grid gap-0 overflow-hidden md:grid-cols-4" data-tour="stage" aria-label="Bench progress">
            {STAGES.map((s, i) => {
              const state = i < stageIdx ? 'done' : i === stageIdx ? 'now' : 'next';
              return (
                <li key={s.id} className={`relative border-hairline p-5 md:border-l first:md:border-l-0 ${state === 'now' ? 'bg-raised-2' : ''}`}>
                  <span className={`mb-2 inline-grid h-7 w-7 place-items-center rounded-full border text-xs ${state === 'done' ? 'border-verified text-verified' : state === 'now' ? 'border-warming text-warming' : 'border-hairline text-muted'}`}>
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  <p className={state === 'next' ? 'text-muted' : ''}>{s.label}</p>
                  {state === 'now' ? <p className="mt-1 text-xs text-warming">in progress</p> : null}
                </li>
              );
            })}
          </ol>
        </Reveal>
        <Reveal delay={0.06}>
          <dl className="mt-6 grid gap-3 font-mono text-xs sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['SmartSpectra SDK', `@smartspectra/node-sdk ${sdkVersion}`],
              ['Gate config', `${gateHash.slice(0, 19)}…`],
              ['Calibration', gateConfig.calibration.status],
              ['Corpus traces', `${recordedCount} recorded`],
            ].map(([k, v]) => (
              <div key={k} className="card p-4"><dt className="mb-1 font-sans text-muted">{k}</dt><dd className="break-all">{v}</dd></div>
            ))}
          </dl>
        </Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <Reveal>
          <div className="card relative overflow-hidden p-8 md:p-12">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-verified/10 blur-3xl" aria-hidden="true" />
            <h2 className="font-display text-4xl">See it, check it, run it.</h2>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/replay" className="btn btn-primary">Open the Replay Lab</Link>
              <Link to="/verify" className="btn">Run the verifier</Link>
              <Link to="/run" className="btn">Run it in 5 minutes</Link>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
