// Flicker page: full-screen brightness that varies sinusoidally at a chosen
// rate, to reproduce "flickering illumination" (F1–F3) with a phone.
// Capped at 3 Hz (180/min) and gated behind a photosensitivity warning.
const app = document.getElementById('app')!;
const MAX_PER_MIN = 180;
const q = new URLSearchParams(location.search);
let perMin = Math.min(MAX_PER_MIN, Number(q.get('rate') ?? 72) || 72);
let amp = Math.min(1, Math.max(0, Number(q.get('amp') ?? 0.5)));
let running = false;
let raf = 0;
let t0 = 0;
let wake: { release(): Promise<void> } | null = null;

function warning() {
  app.innerHTML = `
    <h1>Flicker page</h1>
    <p class="warn"><strong>Photosensitivity warning.</strong> This page makes the whole screen brighten and dim repeatedly. Don't use it if you or anyone nearby is sensitive to flashing or flickering light. It is capped at ${MAX_PER_MIN} cycles per minute (3 Hz) and changes brightness smoothly, never in hard flashes.</p>
    <button class="primary" id="ok">I understand</button>`;
  document.getElementById('ok')!.onclick = controls;
}

function controls() {
  app.innerHTML = `
    <h1>Flicker page</h1>
    <p class="muted">Prop the phone so it lights your face and the wall behind you. Start it when the recorder's cue says so.</p>
    <div class="row">
      <button data-rate="72">72/min (1.2 Hz, pulse band)</button>
      <button data-rate="15">15/min (0.25 Hz, breathing band)</button>
      <label class="inline">Custom /min <input id="rate" class="narrow" type="number" min="1" max="${MAX_PER_MIN}" value="${perMin}"></label>
    </div>
    <label>Amplitude <input id="amp" type="range" min="0" max="100" value="${Math.round(amp * 100)}"> <span id="ampv">${Math.round(amp * 100)}%</span></label>
    <p class="next" id="state">${perMin}/min · ready</p>
    <button class="primary" id="go">Start</button>`;
  const rate = document.getElementById('rate') as HTMLInputElement;
  const setRate = (v: number) => {
    perMin = Math.min(MAX_PER_MIN, Math.max(1, v));
    rate.value = String(perMin);
    document.getElementById('state')!.textContent = `${perMin}/min · ready`;
  };
  document.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach((b) => (b.onclick = () => setRate(Number(b.dataset.rate))));
  rate.onchange = () => setRate(Number(rate.value));
  const a = document.getElementById('amp') as HTMLInputElement;
  a.oninput = () => {
    amp = Number(a.value) / 100;
    document.getElementById('ampv')!.textContent = `${a.value}%`;
  };
  document.getElementById('go')!.onclick = start;
}

async function start() {
  running = true;
  app.innerHTML = '';
  document.body.style.cursor = 'none';
  try {
    wake = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
  } catch {
    wake = null;
  }
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    /* fullscreen optional */
  }
  t0 = performance.now();
  const hz = perMin / 60;
  const frame = (now: number) => {
    if (!running) return;
    const s = (now - t0) / 1000;
    const level = 0.5 + 0.5 * amp * Math.sin(2 * Math.PI * hz * s); // 0..1, smooth
    const v = Math.round(255 * level);
    document.body.style.background = `rgb(${v},${v},${v})`;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  document.body.onclick = stop;
  (window as unknown as { __flickerHz: number }).__flickerHz = hz;
}

function stop() {
  running = false;
  cancelAnimationFrame(raf);
  document.body.style.background = '';
  document.body.style.cursor = '';
  document.body.onclick = null;
  void wake?.release();
  if (document.fullscreenElement) void document.exitFullscreen();
  controls();
}

warning();
export {};
