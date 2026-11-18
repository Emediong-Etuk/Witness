import type { Metric, RuleId } from '@witness/gate';

/**
 * Every user-facing string lives here (and in the app's strings file), so the
 * compliance lint can scan them. Wording is neutral: wellness information,
 * never a medical claim.
 */
export const RULE_COPY: Record<RuleId, string> = {
  R1_WARMUP: 'Still filling the window…',
  R2_SDK_STABLE: "The SDK isn't confident yet.",
  R3_RANGE: 'Outside the range a camera can measure reliably.',
  R4_VALIDATION_CLEAN: 'Framing or lighting needed adjusting.',
  R5_ONE_CONTINUOUS_FACE: 'Someone else came into view (or you left the frame). Paused so we only measure you.',
  R6_STILL: 'You moved. Hold still for a moment.',
  R7_QUIET: "You spoke. Breathing can't be measured while you talk.",
  R8_FRAME_RATE: 'Your camera slowed down. More light usually helps.',
  R9_STEADY_LIGHT: 'Your light is flickering in the same rhythm as this reading. Withheld.',
  R10_NO_CHEWING: "Looks like you're chewing. Pause for a few seconds.",
  R11_LIVE_FACE: "We can't confirm a live face in view.",
};

export const RULE_CHIP: Record<RuleId, string> = {
  R1_WARMUP: 'Window full',
  R2_SDK_STABLE: 'SDK confident',
  R3_RANGE: 'In range',
  R4_VALIDATION_CLEAN: 'Framing',
  R5_ONE_CONTINUOUS_FACE: 'One face',
  R6_STILL: 'Still',
  R7_QUIET: 'Quiet',
  R8_FRAME_RATE: 'Frame rate',
  R9_STEADY_LIGHT: 'Steady light',
  R10_NO_CHEWING: 'No chewing',
  R11_LIVE_FACE: 'Live',
};

export const METRIC_LABEL: Record<Metric, string> = { pulse: 'Pulse', breathing: 'Breathing', hrv: 'HRV' };
export const METRIC_UNIT_LABEL: Record<Metric, string> = { pulse: 'bpm', breathing: 'br/min', hrv: 'ms RMSSD' };

export function flickerCopy(perMin: number | null): string {
  return perMin === null
    ? RULE_COPY.R9_STEADY_LIGHT
    : `Your light is flickering at about ${Math.round(perMin)}/min, the same rhythm as this reading. Withheld.`;
}

export function restartCopy(windowS: number): string {
  return `Restarting the ${windowS}-s window.`;
}

export const ERROR_COPY: Record<number, { text: string; action: string | null }> = {
  2: { text: 'Witness couldn’t check this key with Presage. Check that it was pasted in full.', action: 'Change key' },
  4: { text: 'This key is out of free minutes.', action: 'Open portal' },
  5: { text: "Can't reach Presage to check your key.", action: 'Retry' },
  7: { text: 'Camera busy or blocked.', action: 'Pick camera' },
  14: { text: 'Your camera dropped below 25 fps. More light usually fixes this.', action: 'Start fresh' },
};

export const DISCLAIMER =
  'General wellness information, not medical advice. Camera readings can be wrong. If you feel unwell, contact a health professional.';
