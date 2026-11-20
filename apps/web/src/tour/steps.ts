import type { Route } from '../lib/router';

export interface Step {
  route: Route;
  /** data-tour attribute of the element to spotlight; null = centred card */
  target: string | null;
  title: string;
  body: string;
  /** Optional nudge to interact while the step is open. */
  tryIt?: string;
}

export const STEPS: Step[] = [
  { route: '/', target: null, title: 'Welcome to Witness', body: 'A 90-second tour of this site: the problem, the evidence, and how to check it yourself. Use → / ← or the buttons; Esc leaves the tour at any time.' },
  { route: '/', target: 'problem', title: 'The problem, in one sentence', body: 'SmartSpectra averages 12, 30 and 60 seconds of video, and documents conditions that produce wrong values with high confidence. Only motion has a warning code.' },
  { route: '/', target: 'measured', title: 'Numbers you can check', body: 'These numbers are filled in by the held-out bench and recomputed by the verifier. "TBD" means that run hasn\'t happened yet. Nothing here is typed by hand.' },
  { route: '/', target: 'videos', title: 'Start with the videos', body: 'The 3-minute demo shows the idea and the app. The walkthrough covers the engineering. They play from youtube-nocookie.com, and only when you press play.' },
  { route: '/', target: 'explainer', title: 'Why a short disturbance matters', body: 'Every reading summarises a window. A 3-second disturbance lands inside every reading whose window covers it.', tryIt: 'Drag the red block and switch the condition.' },
  { route: '/', target: 'rules', title: 'The Clean-Window Gate', body: 'Eleven rules. Most are SmartSpectra\'s own signals (validation codes, stable, talking, blinking, landmarks). Witness adds math only where the SDK has no warning: flicker, chewing, motion, a live face.', tryIt: 'Open a rule to see its source and threshold.' },
  { route: '/', target: 'receipt', title: 'Every number has a receipt', body: 'Each shown value carries the checks it passed, the window, and hashes that chain to the previous receipt. A withheld value gets a plain reason instead.' },
  { route: '/', target: 'testing-note', title: 'A note on live-camera testing', body: 'The author\'s webcam gives about 16 fps, below the 25 fps SmartSpectra needs, so there is no real-camera reading in this submission yet. Please try the app on your own device; its camera check is free.' },
  { route: '/', target: 'stage', title: 'Status, in the open', body: 'Thresholds are calibrated on one split, frozen in git, then tested on held-out clips. This tracker shows where that process is right now.' },
  { route: '/replay', target: 'replay-picker', title: 'Replay Lab', body: 'Replays run the real gate in your browser. Synthetic scenarios are labelled as such. Recorded corpus clips appear here as they\'re published.', tryIt: 'Pick "talking" or "flicker72".' },
  { route: '/replay', target: 'replay-timeline', title: 'The SDK alone vs Witness', body: 'Each dot is an SDK reading. Hollow dots are what the SDK marked stable. Mint means Witness verified it, coral means withheld. Bands show where the condition was.', tryIt: 'Click a dot to open its receipt.' },
  { route: '/replay', target: 'replay-scrubber', title: 'Scrub through the session', body: 'Drag the playhead or press play to watch the clean-window rings rewind when a condition starts.' },
  { route: '/verify', target: 'verify-run', title: 'Run the real verifier', body: 'This is the same code as `npm run verify`, running in a Web Worker. It re-runs the gate on every published trace and must reproduce every receipt, chain head, result and embedded number.', tryIt: 'Press "Run the verifier".' },
  { route: '/verify', target: 'verify-tamper', title: 'Try to fool it', body: 'Edit a trace, a receipt, a threshold or a number in the README, and watch the verifier name the check that fails.' },
  { route: '/verify', target: 'verify-checkin', title: 'Check an exported check-in', body: 'Drop a file exported from the Witness app. Its receipts are checked for integrity and for verdicts that follow from their checks.' },
  { route: '/results', target: 'results-status', title: 'Results', body: 'Held-out tables, per-rule attribution and accuracy with confidence intervals appear here after the frozen-threshold run. Until then the page shows the protocol and its current step.' },
  { route: '/run', target: 'run-paths', title: 'Run it yourself', body: 'Four paths: no setup (this site), the desktop app, from source, or reproduce the bench with your own free key.' },
  { route: '/privacy', target: 'privacy-table', title: 'Consent and data', body: 'What leaves the computer, to whom, and how we know, including what the SDK itself sends. Anything not measured yet is labelled pending.' },
  { route: '/tools/flicker', target: 'flicker', title: 'Reproduce the flicker test', body: 'Open this page on a phone to light a room at 72 or 15 cycles per minute, the "flickering illumination" the model cards warn about. There\'s a photosensitivity gate and a 3 Hz cap.' },
  { route: '/', target: 'tour-button', title: 'That\'s the tour', body: 'You can restart it any time from here. Thanks for judging.' },
];
