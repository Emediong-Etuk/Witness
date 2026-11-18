import { setup } from 'xstate';

export type FlowEvent =
  | { type: 'CHECK_IN' }
  | { type: 'ACCEPT' }
  | { type: 'DECLINE' }
  | { type: 'RUNNING' }
  | { type: 'FACES_MULTIPLE' }
  | { type: 'FACES_OK' }
  | { type: 'DONE' }
  | { type: 'STOP' }
  | { type: 'HIDE' }
  | { type: 'ERROR' }
  | { type: 'AGAIN' }
  | { type: 'DISMISS' };

/**
 * The check-in flow. The camera can only be started from `acquiring`, and
 * `acquiring` is only reachable from `consent` via ACCEPT: that's the
 * "camera never starts before consent" guarantee, in one place.
 */
export const flowMachine = setup({
  types: { events: {} as FlowEvent },
}).createMachine({
  id: 'checkin',
  initial: 'idle',
  states: {
    idle: { on: { CHECK_IN: 'consent' } },
    consent: { on: { ACCEPT: 'acquiring', DECLINE: 'idle', HIDE: 'idle' } },
    acquiring: {
      on: { RUNNING: 'measuring', ERROR: 'error', STOP: 'complete', HIDE: 'complete', FACES_MULTIPLE: 'paused' },
    },
    measuring: {
      on: { FACES_MULTIPLE: 'paused', DONE: 'complete', STOP: 'complete', HIDE: 'complete', ERROR: 'error' },
    },
    paused: { on: { FACES_OK: 'measuring', DONE: 'complete', STOP: 'complete', HIDE: 'complete', ERROR: 'error' } },
    complete: { on: { AGAIN: 'consent', DISMISS: 'idle', CHECK_IN: 'consent' } },
    error: { on: { AGAIN: 'consent', DISMISS: 'idle', CHECK_IN: 'consent' } },
  },
});

export type Phase = 'idle' | 'consent' | 'acquiring' | 'measuring' | 'paused' | 'complete' | 'error';
