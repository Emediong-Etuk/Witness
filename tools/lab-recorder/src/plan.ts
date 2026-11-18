import type { Condition } from '@witness/schema';

export interface Cue {
  atS: number;
  text: string;
  kind: 'start' | 'stop' | 'info';
}

export interface ClipTemplate {
  id: string;
  title: string;
  condition: Condition;
  split: 'calibration' | 'heldout';
  star: boolean;
  durationS: number;
  /** Condition intervals as scheduled by the cues (before reaction padding). */
  scheduled: { condition: Condition; fromS: number; toS: number }[];
  wholeClip: boolean;
  flickerHz?: number;
  pacedBreathingBrpm?: number;
  /** Shown before recording starts. */
  setup: string;
  cues: Cue[];
  /** Text to read aloud (talking clips). */
  reading?: boolean;
  /** Requires a second consenting person. */
  secondPerson?: boolean;
}

/**
 * People react to a cue a moment late and finish a moment late, so each
 * labelled interval is widened by this much on both sides. Wider labels are
 * the conservative choice: more readings count as contaminated, so Witness
 * gets no credit for readings near the edges.
 */
export const REACTION_PAD_S = 1;

export function labelledIntervals(t: ClipTemplate): { condition: Condition; fromS: number; toS: number }[] {
  return t.scheduled.map((i) => ({ condition: i.condition, fromS: Math.max(0, i.fromS - REACTION_PAD_S), toS: Math.min(t.durationS, i.toS + REACTION_PAD_S) }));
}

const STILL = 'Sit about an arm’s length from the camera, face it, keep your shoulders in view. Stay still, quiet and breathe normally unless a cue says otherwise.';
const D = 75;

function interval(condition: Condition, fromS: number, toS: number, start: string, stop: string) {
  return {
    scheduled: [{ condition, fromS, toS }],
    cues: [
      { atS: 0, text: 'Hold still, breathe normally.', kind: 'info' as const },
      { atS: fromS, text: start, kind: 'start' as const },
      { atS: toS, text: stop, kind: 'stop' as const },
    ],
  };
}

function base(id: string, condition: Condition, split: ClipTemplate['split'], star: boolean, title: string, extra: Partial<ClipTemplate>): ClipTemplate {
  return {
    id, title, condition, split, star, durationS: D, scheduled: [], wholeClip: false, setup: STILL,
    cues: [{ atS: 0, text: 'Hold still, breathe normally, stay quiet.', kind: 'info' }], ...extra,
  };
}

/** BUILD_PROMPT §13.2 clip plan. Each condition has ≥ 1 calibration and ≥ 1 held-out clip where the plan allows. */
export const PLAN: ClipTemplate[] = [
  base('B1', 'baseline', 'calibration', true, 'Baseline, daylight', { setup: `Daylight. ${STILL}` }),
  base('B2', 'baseline', 'heldout', true, 'Baseline, daylight', { setup: `Daylight. ${STILL}` }),
  base('B3', 'baseline', 'calibration', false, 'Baseline, evening lamp', { setup: `Evening, steady lamp (not a TV). ${STILL}` }),
  base('B4', 'baseline', 'heldout', false, 'Baseline, evening lamp', { setup: `Evening, steady lamp (not a TV). ${STILL}` }),
  ...(['T1', 'T2', 'T3'] as const).map((id, i) =>
    base(id, 'talking', i === 0 ? 'calibration' : 'heldout', i === 0, 'Read aloud 25–45 s', { reading: true, ...interval('talking', 25, 45, 'Start reading the text aloud now.', 'Stop reading. Stay still and quiet.') })),
  ...(['G1', 'G2', 'G3'] as const).map((id, i) =>
    base(id, 'chewing', i === 0 ? 'calibration' : 'heldout', i === 0, 'Chew gum 20–45 s', { setup: `Have a piece of gum ready in your hand. ${STILL}`, ...interval('chewing', 20, 45, 'Put the gum in and chew steadily.', 'Stop chewing (hold the gum still or remove it).') })),
  ...(['M1', 'M2', 'M3'] as const).map((id, i) =>
    base(id, 'motion', i === 0 ? 'calibration' : 'heldout', i === 0, 'Head motion 20–30 s and 45–55 s', {
      scheduled: [{ condition: 'motion', fromS: 20, toS: 30 }, { condition: 'motion', fromS: 45, toS: 55 }],
      cues: [
        { atS: 0, text: 'Hold still, breathe normally.', kind: 'info' },
        { atS: 20, text: 'Nod and turn your head left and right.', kind: 'start' },
        { atS: 30, text: 'Stop. Hold still.', kind: 'stop' },
        { atS: 45, text: 'Nod and turn your head again.', kind: 'start' },
        { atS: 55, text: 'Stop. Hold still.', kind: 'stop' },
      ],
    })),
  ...(['F1', 'F2'] as const).map((id, i) =>
    base(id, 'flicker', i === 0 ? 'calibration' : 'heldout', true, 'Phone flicker at 72/min, 20–60 s', {
      flickerHz: 1.2,
      setup: `Open the flicker page (link below) on a phone at 72/min, full brightness, propped so it lights your face and the wall behind you. Room otherwise dim but steady. ${STILL}`,
      ...interval('flicker', 20, 60, 'Start the flicker page now (tap Start on the phone).', 'Stop the flicker page.'),
    })),
  base('F3', 'flicker', 'heldout', false, 'Phone flicker at 15/min, 20–60 s', {
    flickerHz: 0.25,
    setup: `Open the flicker page on a phone at 15/min, propped so it lights your face and the wall. ${STILL}`,
    ...interval('flicker', 20, 60, 'Start the flicker page now (15/min).', 'Stop the flicker page.'),
  }),
  base('F4', 'tv_light', 'heldout', true, 'TV as the main light', { wholeClip: true, setup: `Dark room, a TV playing normal content is the main light on your face. ${STILL}` }),
  base('F5', 'generator_light', 'heldout', false, 'Generator- or inverter-powered bulb', { wholeClip: true, setup: `Light from a generator- or inverter-fed bulb only. ${STILL}` }),
  base('P1', 'photo', 'calibration', true, 'Printed photo, steady light', { wholeClip: true, setup: 'Prop a printed photo of a face (your own, or a consenting person’s) where your face would be, then step out of view. Steady light.', cues: [{ atS: 0, text: 'Photo only in view. Stay out of frame.', kind: 'info' }] }),
  base('P2', 'photo', 'heldout', false, 'Printed photo lit by the flicker page', { wholeClip: true, flickerHz: 1.2, setup: 'Same printed photo, lit by the phone flicker page at 72/min. Step out of view.', cues: [{ atS: 0, text: 'Photo only in view. Stay out of frame.', kind: 'info' }] }),
  base('X1', 'second_person', 'heldout', false, 'Second person enters 30–40 s', { secondPerson: true, setup: `A second consenting adult stands ready just out of frame. ${STILL}`, ...interval('second_person', 30, 40, 'Second person: step into view, behind or beside the subject.', 'Second person: step out of view.') }),
  ...([['R1', 6, 'calibration', true], ['R2', 10, 'heldout', true], ['R3', 15, 'heldout', false]] as const).map(([id, brpm, split, star]) =>
    base(id, 'paced_breathing', split, star, `Paced breathing ${brpm}/min`, { wholeClip: false, pacedBreathingBrpm: brpm, setup: `Follow the breathing circle: in as it grows, out as it shrinks (${brpm} breaths/min). ${STILL}`, cues: [{ atS: 0, text: `Breathe with the circle (${brpm}/min).`, kind: 'info' }] })),
  base('E1', 'exercise', 'heldout', false, 'After 60 s of jumping jacks', { setup: `Do 60 s of jumping jacks (only if that is comfortable and safe for you), then sit and start recording straight away. ${STILL}` }),
  base('L1', 'low_light', 'heldout', false, 'Low light', { setup: `Dim but steady light. ${STILL}` }),
  base('D1', 'dark_clothing', 'heldout', false, 'Dark shirt', { wholeClip: true, setup: `Wear a plain dark shirt. Steady light. ${STILL}` }),
];

/** Short template used only by tests (WITNESS_LAB_TEST=1). */
export const TEST_TEMPLATE: ClipTemplate = base('Z1', 'talking', 'calibration', false, 'Test clip (4 s)', {
  durationS: 4, reading: true, ...interval('talking', 1, 3, 'Start reading.', 'Stop.'),
});

export const READING_TEXT =
  'The quick brown fox jumps over the lazy dog. A clean window means every second behind a number passed every check. ' +
  'Talking moves the chest and the face, which is exactly why breathing cannot be measured while you speak. ' +
  'Keep reading at a normal pace until the cue tells you to stop.';
