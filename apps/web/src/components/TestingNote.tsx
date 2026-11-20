import { Link } from '../lib/router';

/**
 * A note from the author to the judges about live-camera testing. Plain facts
 * only: what happened on the author's machine, what was verified without a
 * live camera, and what a judge needs to try it.
 */
export function TestingNote({ compact = false }: { compact?: boolean }) {
  return (
    <aside className="card border-warming/60 p-6" aria-labelledby="testing-note-title" data-testid="testing-note">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-warming">A note to the judges</p>
      <h3 id="testing-note-title" className="mt-2 text-xl font-medium">Please try the live camera on your own device</h3>
      <p className="mt-3 text-[15px] leading-relaxed">
        I couldn't complete a live check-in on my own computer. Its webcam gives about 16 fps at a low resolution, and the SmartSpectra SDK
        stops any session that stays below 25 fps (error 14, <code>kSustainedLowFrameRate</code>). The SDK itself ran on my machine with
        my key. It stopped for frame rate before the first 12-second pulse window could fill. Witness's camera check now catches this
        before the SDK starts, and it tried lower resolutions, but this webcam couldn't reach 25 fps at any of them.
      </p>
      <p className="mt-3 text-[15px] leading-relaxed">
        So this submission has <b>no reading from a real camera yet</b>, and the held-out results on this site say TBD rather than show numbers
        I don't have. Please test Witness on your own laptop or USB webcam. Most give 25 fps or more in normal light, and the camera check
        tells you for free, before any Presage minutes are used.
      </p>
      {!compact ? (
        <>
          <p className="mt-4 text-sm font-medium">What was verified without a live camera</p>
          <ul className="mt-2 grid gap-1.5 text-sm text-muted">
            <li>· The full app on labelled synthetic replays, in the real Electron app and in the browser build (UI tests in CI).</li>
            <li>· The camera check and the hand-off to the SDK, in real Electron with Chromium's simulated camera. A 15 fps feed is held back; a 30 fps feed starts the real SmartSpectra SDK on that stream.</li>
            <li>· The gate, receipts, hash chain and verifier, by the unit and property tests in CI and by the in-browser verifier on this site.</li>
          </ul>
        </>
      ) : null}
      <p className="mt-4 text-sm">
        {compact ? 'To test: option C below' : <>To test: <Link to="/run" className="underline">Run it</Link>, option C</>} (from source, with a free SmartSpectra key). Then Quick → Check in, and sit facing a light.
      </p>
    </aside>
  );
}
