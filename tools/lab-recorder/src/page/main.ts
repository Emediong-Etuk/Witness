// Witness lab recorder (dev-only). Records consented corpus clips with scripted cues.
interface Cue { atS: number; text: string; kind: 'start' | 'stop' | 'info' }
interface Template {
  id: string; title: string; condition: string; split: string; star: boolean; durationS: number;
  intervals: { condition: string; fromS: number; toS: number }[]; wholeClip: boolean;
  flickerHz?: number; pacedBreathingBrpm?: number; setup: string; cues: Cue[]; reading?: boolean; secondPerson?: boolean;
}
interface Plan { plan: Template[]; recorded: { id: string; trace: boolean }[]; readingText: string }

const TOKEN = (document.querySelector('meta[name="lab-token"]') as HTMLMetaElement).content;
const app = document.getElementById('app')!;
const api = (path: string, init: RequestInit = {}) =>
  fetch(path, { ...init, headers: { ...(init.headers ?? {}), 'X-Lab-Token': TOKEN } }).then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
    return body;
  });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let plan: Plan;
let stream: MediaStream | null = null;

async function home() {
  stopCamera();
  plan = await api('/api/plan');
  const done = new Map(plan.recorded.map((r) => [r.id, r]));
  app.innerHTML = `
    <h1>Witness lab recorder</h1>
    <p class="muted">Dev-only. Records clips of <strong>you</strong> for the public test corpus, one consent per clip. Video stays in <code>corpus/clips/</code> (gitignored); only clips you mark "publish" are ever uploaded anywhere.</p>
    <p class="muted">Flicker clips need the flicker page on a phone: <a href="/flicker-standalone.html">download it</a> and open it on the phone (or use <a href="/flicker" target="_blank">/flicker</a> on a second screen).</p>
    <table><thead><tr><th>Clip</th><th>Condition</th><th>Labelled</th><th>Split</th><th>Status</th><th></th></tr></thead><tbody>
    ${plan.plan.map((t) => `<tr>
      <td>${t.id}${t.star ? ' ★' : ''} · ${esc(t.title)}</td><td>${t.condition}</td>
      <td class="muted">${t.wholeClip ? 'whole clip' : t.intervals.map((i) => `${i.fromS}–${i.toS} s`).join(', ') || '–'}</td>
      <td>${t.split}</td>
      <td>${done.has(t.id) ? `<span class="ok">✓ recorded${done.get(t.id)!.trace ? ' · traced' : ''}</span>` : '<span class="muted">–</span>'}</td>
      <td><button data-id="${t.id}">${done.has(t.id) ? 'Re-record' : 'Record'}</button></td></tr>`).join('')}
    </tbody></table>`;
  app.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((b) => (b.onclick = () => setup(plan.plan.find((t) => t.id === b.dataset.id)!, done.has(b.dataset.id!))));
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function setup(t: Template, replace: boolean) {
  app.innerHTML = `
    <p><button id="back">← All clips</button></p>
    <h1>${t.id} · ${esc(t.title)}</h1>
    <div class="grid">
      <div><video id="v" autoplay muted playsinline></video><p class="muted" id="cam">Starting camera…</p></div>
      <div class="card">
        <h2>Before you record</h2>
        <p>${esc(t.setup)}</p>
        ${t.flickerHz ? `<p class="warn">Flicker page at <strong>${Math.round(t.flickerHz * 60)}/min</strong>. Photosensitivity warning applies.</p>` : ''}
        <p class="muted">${t.durationS} s · ${t.split} split · labels: ${t.wholeClip ? 'whole clip' : t.intervals.map((i) => `${i.condition} ${i.fromS}–${i.toS} s`).join(', ') || 'none'}</p>
        <label class="row"><input type="checkbox" id="c1" class="inline"> I'm recording myself for Witness's public test corpus.</label>
        ${t.secondPerson ? `<label class="row"><input type="checkbox" id="c2" class="inline"> The second person in this clip is an adult and has agreed to appear in this public test corpus.</label>` : ''}
        <button class="primary" id="go" disabled>Start recording</button>
      </div>
    </div>`;
  el('back').onclick = () => void home();
  const v = el<HTMLVideoElement>('v');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
  } catch (e) {
    el('cam').innerHTML = `<span class="bad">Camera unavailable: ${esc((e as Error).message)}</span>`;
    return;
  }
  v.srcObject = stream;
  const track = stream.getVideoTracks()[0]!;
  // Lock exposure / white balance / focus where the camera allows it (auto-exposure drift would look like flicker).
  let aeLocked = false;
  try {
    await track.applyConstraints({ advanced: [{ exposureMode: 'manual', whiteBalanceMode: 'manual', focusMode: 'manual' } as MediaTrackConstraintSet] });
    const s = track.getSettings() as MediaTrackSettings & { exposureMode?: string };
    aeLocked = s.exposureMode === 'manual';
  } catch {
    aeLocked = false;
  }
  const s = track.getSettings();
  el('cam').textContent = `${track.label || 'camera'} · ${s.width}×${s.height} @ ${s.frameRate ?? '?'} fps · exposure ${aeLocked ? 'locked' : 'auto (could not lock)'}`;
  const boxes = [el<HTMLInputElement>('c1'), ...(t.secondPerson ? [el<HTMLInputElement>('c2')] : [])];
  const go = el<HTMLButtonElement>('go');
  boxes.forEach((b) => (b.onchange = () => (go.disabled = !boxes.every((x) => x.checked))));
  go.onclick = () => void record(t, replace, { label: track.label, width: s.width ?? 0, height: s.height ?? 0, fps: s.frameRate ?? 0, aeLocked }, new Date().toISOString());
}

interface CamInfo { label: string; width: number; height: number; fps: number; aeLocked: boolean }

function pickMime(): string {
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

async function record(t: Template, replace: boolean, cam: CamInfo, consentAt: string) {
  const mime = pickMime();
  app.innerHTML = `
    <div class="grid">
      <div>
        <video id="v" autoplay muted playsinline></video>
        ${t.reading ? `<div class="card"><p id="reading">${esc(plan.readingText)}</p></div>` : ''}
      </div>
      <div class="card">
        <p class="next">${t.id} · ${esc(t.title)}</p>
        <div class="big" id="clock">3</div>
        <div class="cue" id="cue">Get ready…</div>
        <p class="next" id="next"></p>
        ${t.pacedBreathingBrpm ? `<div class="breath" id="breath"></div><p class="next" id="breathTxt"></p>` : ''}
        <button id="abort">Abort (nothing is saved)</button>
      </div>
    </div>`;
  el<HTMLVideoElement>('v').srcObject = stream;
  let aborted = false;
  let rec: MediaRecorder | null = null;
  el('abort').onclick = () => {
    aborted = true;
    rec?.stop();
  };
  for (const n of [3, 2, 1]) {
    el('clock').textContent = String(n);
    await new Promise((r) => setTimeout(r, 1000));
    if (aborted) return void home();
  }
  const chunks: Blob[] = [];
  const mr = new MediaRecorder(stream!, { mimeType: mime || undefined, videoBitsPerSecond: 25_000_000 });
  rec = mr;
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (mr.onstop = () => r()));
  const started = new Promise<number>((r) => (mr.onstart = () => r(performance.now())));
  mr.start(1000);
  const t0 = await started;
  const cues = [...t.cues].sort((a, b) => a.atS - b.atS);
  const tick = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    el('clock').textContent = `${Math.min(s, t.durationS).toFixed(1)} / ${t.durationS} s`;
    const cur = [...cues].reverse().find((c) => c.atS <= s);
    const nxt = cues.find((c) => c.atS > s);
    const cueEl = el('cue');
    cueEl.textContent = cur?.text ?? '';
    cueEl.className = `cue ${cur?.kind ?? ''}`;
    el('next').textContent = nxt ? `in ${Math.ceil(nxt.atS - s)} s: ${nxt.text}` : '';
    if (t.pacedBreathingBrpm) {
      const phase = ((s * t.pacedBreathingBrpm) / 60) % 1;
      const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
      el('breath').style.transform = `scale(${(0.55 + 0.45 * k).toFixed(3)})`;
      el('breathTxt').textContent = phase < 0.5 ? 'breathe in' : 'breathe out';
    }
    if (s >= t.durationS && mr.state !== 'inactive') mr.stop();
  }, 100);
  await stopped;
  clearInterval(tick);
  if (aborted) return void home();
  stopCamera();
  const blob = new Blob(chunks, { type: mime || 'video/webm' });
  app.innerHTML = `<h1>${t.id} · saving…</h1><p class="muted">${(blob.size / 1e6).toFixed(1)} MB</p>`;
  let up: { file: string; bytes: number; sha256: string };
  try {
    up = await api(`/api/clip${replace ? '?replace=1' : ''}`, { method: 'POST', body: blob, headers: { 'X-Clip-Id': t.id, 'X-Consent': 'attested', 'Content-Type': blob.type } });
  } catch (e) {
    app.innerHTML = `<h1 class="bad">Not saved</h1><p>${esc((e as Error).message)}</p><button id="back">← All clips</button>`;
    el('back').onclick = () => void home();
    return;
  }
  details(t, up, cam, consentAt, mime);
}

function details(t: Template, up: { file: string; bytes: number; sha256: string }, cam: CamInfo, consentAt: string, mime: string) {
  app.innerHTML = `
    <h1>${t.id} saved · details</h1>
    <p class="muted">${up.file} · ${(up.bytes / 1e6).toFixed(1)} MB · ${up.sha256.slice(0, 23)}…</p>
    <div class="card">
      <div class="cols">
        <label>Subject label (not your name)<input id="subject" value="S1"></label>
        <label>Skin type, self-reported (Fitzpatrick)<select id="fitz"><option value="">prefer not to say</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option>${n}</option>`).join('')}</select></label>
        <label>Camera<input id="camera" value="${esc(cam.label || 'camera')}"></label>
        <label>Lighting<input id="lighting" placeholder="e.g. evening, LED desk lamp"></label>
      </div>
      <label>Ground-truth device<input id="device" value="fingertip pulse oximeter (display filmed by phone)"></label>
      <label>Oximeter readings: one "seconds bpm" pair per line, read off the phone video (clip time)
        <textarea id="pulse" rows="5" placeholder="5 71&#10;15 72&#10;25 72"></textarea></label>
      <label class="row"><input type="checkbox" id="publish" class="inline"> Publish this video clip (GitHub Release asset). Unchecked = traces only.</label>
      <label>Notes<textarea id="notes" rows="2">mime ${esc(mime)}; ${cam.width}x${cam.height}@${cam.fps}; exposure ${cam.aeLocked ? 'locked' : 'auto'}</textarea></label>
      <p id="err" class="bad"></p>
      <button class="primary" id="save">Save manifest entry</button>
    </div>`;
  el('save').onclick = async () => {
    const pulse: { tS: number; bpm: number }[] = [];
    for (const line of el<HTMLTextAreaElement>('pulse').value.split('\n')) {
      if (!line.trim()) continue;
      const m = /^\s*([0-9.]+)[\s,;]+([0-9.]+)\s*$/.exec(line);
      if (!m) {
        el('err').textContent = `Can't read "${line}". Use "seconds bpm", e.g. "15 72".`;
        return;
      }
      pulse.push({ tS: Number(m[1]), bpm: Number(m[2]) });
    }
    const fz = el<HTMLSelectElement>('fitz').value;
    try {
      const r = await api('/api/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: t.id, file: up.file, clipSha256: up.sha256, consentAt,
          subject: el<HTMLInputElement>('subject').value.trim(), fitzpatrick: fz ? Number(fz) : null,
          camera: el<HTMLInputElement>('camera').value, lighting: el<HTMLInputElement>('lighting').value || 'not noted',
          resolution: `${cam.width}x${cam.height}`, publishVideo: el<HTMLInputElement>('publish').checked,
          notes: el<HTMLTextAreaElement>('notes').value, pulse, device: el<HTMLInputElement>('device').value,
        }),
      });
      app.innerHTML = `
        <h1 class="ok">${t.id} is in the manifest</h1>
        <p>Labelled intervals: ${r.entry.wholeClip ? 'whole clip' : r.entry.intervals.map((i: { condition: string; fromS: number; toS: number }) => `${i.condition} ${i.fromS}–${i.toS} s`).join(', ') || 'none'} (cue times ±1 s).</p>
        <p class="muted">Next, when you are ready to spend credits:</p>
        <pre class="card">npm run bench:estimate -- --clip ${t.id}\nnpm run bench:record -- --clip ${t.id} --yes\nnpm run bench:replay -- --write\nnpm run verify</pre>
        <button id="back">← All clips</button>`;
      el('back').onclick = () => void home();
    } catch (e) {
      el('err').textContent = (e as Error).message;
    }
  };
}

void home();
export {};
