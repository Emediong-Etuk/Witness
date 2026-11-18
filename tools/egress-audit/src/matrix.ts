/** The §7.6 / §13.7 configurations, fixed before any run. */
export const MATRIX = [
  { label: 'a-full-telemetry-off-listener-on', mode: 'full', telemetry: 'off', listener: 'on', purpose: '§7.6 test (a): count unrequested insights' },
  { label: 'b-full-telemetry-off-listener-off', mode: 'full', telemetry: 'off', listener: 'off', purpose: '§7.6 test (b): does traffic change without a listener?' },
  { label: 'c-quick-telemetry-off-listener-on', mode: 'quick', telemetry: 'off', listener: 'on', purpose: '§7.6 test (c): no breathing requested' },
  { label: 'd-full-telemetry-on-listener-on', mode: 'full', telemetry: 'on', listener: 'on', purpose: 'telemetry endpoint(s)' },
  { label: 'e-quick-telemetry-on-listener-on', mode: 'quick', telemetry: 'on', listener: 'on', purpose: 'telemetry, quick' },
] as const;
