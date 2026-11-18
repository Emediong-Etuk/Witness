import { z } from 'zod';

const t = z.number().finite();
const metric = z.enum(['pulse', 'breathing', 'hrv']);
const nullableNum = z.number().finite().nullable();

export const GateEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), t, mode: z.enum(['quick', 'full']) }).strict(),
  z.object({ kind: z.literal('stream_ready'), t }).strict(),
  z.object({ kind: z.literal('validation'), t, code: z.number().int().min(0).max(64) }).strict(),
  z.object({ kind: z.literal('rate'), t, metric, value: z.number().finite(), confidence: z.number().finite(), stable: z.boolean() }).strict(),
  z.object({ kind: z.literal('talking'), t, detected: z.boolean() }).strict(),
  z.object({ kind: z.literal('blink'), t, detected: z.boolean() }).strict(),
  z.object({ kind: z.literal('landmarks_reset'), t }).strict(),
  z.object({ kind: z.literal('face_feature'), t, motion: nullableNum, mouth: nullableNum, jaw: nullableNum }).strict(),
  z.object({ kind: z.literal('frame'), t, bg: z.tuple([z.number().finite(), z.number().finite()]), chest: nullableNum, face: nullableNum }).strict(),
]);

const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const json: z.ZodType<unknown> = z.lazy(() => z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(json), z.record(z.string(), json)]));
const ruleId = z.enum([
  'R1_WARMUP', 'R2_SDK_STABLE', 'R3_RANGE', 'R4_VALIDATION_CLEAN', 'R5_ONE_CONTINUOUS_FACE', 'R6_STILL',
  'R7_QUIET', 'R8_FRAME_RATE', 'R9_STEADY_LIGHT', 'R10_NO_CHEWING', 'R11_LIVE_FACE',
]);

export const CheckSchema = z.object({
  id: ruleId,
  pass: z.boolean(),
  observed: json,
  threshold: json,
  unit: z.string().optional(),
  lastViolationUs: z.number().optional(),
}).strict();

export const ReceiptSchema = z.object({
  v: z.literal(1),
  sessionId: z.string().min(1).max(64),
  metric,
  value: z.number().finite(),
  unit: z.string(),
  window: z.object({ startUs: t, endUs: t, lengthS: z.number().positive() }).strict(),
  sdk: z.object({ confidence: z.number(), stable: z.boolean(), sdkVersion: z.string() }).strict(),
  checks: z.array(CheckSchema),
  verdict: z.enum(['VERIFIED', 'WARMING_UP', 'OUT_OF_RANGE', 'WITHHELD']),
  reasons: z.array(ruleId),
  gateVersion: z.string(),
  gateConfigHash: hash,
  inputsHash: hash,
  prevReceiptHash: hash,
  receiptHash: hash,
}).strict();

/**
 * Session log (JSONL). Every line carries `h`, the running chain hash:
 * h_i = sha256(h_{i-1} ‖ canonical(line_i without h)). Privacy rule: no frames,
 * images, landmark coordinates or expressions — enforced by .strict().
 */
const lineBase = { h: hash, t };
export const SessionLogLineSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session_start'), ...lineBase,
    sessionId: z.string(), appVersion: z.string(), gateVersion: z.string(), sdkVersion: z.string(),
    gateConfigHash: hash, requestedMetrics: z.array(z.number().int()), telemetry: z.boolean(),
    mode: z.enum(['quick', 'full']), source: z.string().regex(/^(camera|corpus:[A-Za-z0-9_-]+)$/),
    aeLocked: z.boolean().nullable(), roiLayout: z.string(),
  }).strict(),
  z.object({ type: z.literal('sdk_status'), ...lineBase, status: z.number().int() }).strict(),
  z.object({ type: z.literal('sdk_validation'), ...lineBase, code: z.number().int(), hint: z.string().max(256) }).strict(),
  z.object({ type: z.literal('sdk_rate'), ...lineBase, metric, value: z.number(), confidence: z.number(), stable: z.boolean() }).strict(),
  z.object({ type: z.literal('sdk_face'), ...lineBase, talking: z.boolean().nullable(), blinking: z.boolean().nullable(), landmarksReset: z.boolean() }).strict(),
  z.object({
    type: z.literal('feature'), ...lineBase,
    fps: nullableNum, motion: nullableNum, mouth: nullableNum, jaw: nullableNum,
    bgLuma: z.tuple([z.number(), z.number()]).nullable(), chestLuma: nullableNum, faceLuma: nullableNum.optional(),
  }).strict(),
  z.object({ type: z.literal('receipt'), ...lineBase, receipt: ReceiptSchema }).strict(),
  z.object({ type: z.literal('session_end'), ...lineBase, chainHead: hash, receiptChainHead: hash }).strict(),
]);

export const ManifestClipSchema = z.object({
  id: z.string().regex(/^[A-Z][0-9]+$/),
  condition: z.string(),
  split: z.enum(['calibration', 'heldout']),
  intervals: z.array(z.object({ label: z.string(), fromS: z.number(), toS: z.number() })),
  wholeClip: z.boolean(),
  groundTruth: z.object({
    device: z.string(),
    pulse: z.array(z.object({ tS: z.number(), bpm: z.number() })),
    breathing: z.array(z.object({ tS: z.number(), brpm: z.number() })).optional(),
  }).nullable(),
  consent: z.object({ attested: z.literal(true), subject: z.string(), at: z.string() }),
  subject: z.object({ fitzpatrick: z.number().int().min(1).max(6).nullable() }),
  camera: z.string(),
  lighting: z.string(),
  resolution: z.string(),
  sha256: z.object({ clip: hash.nullable(), trace: hash.nullable() }),
}).strict();

export const ManifestSchema = z.object({
  v: z.literal(1),
  clips: z.array(ManifestClipSchema),
}).strict();

export type GateEventInput = z.infer<typeof GateEventSchema>;
export type ReceiptInput = z.infer<typeof ReceiptSchema>;
export type SessionLogLine = z.infer<typeof SessionLogLineSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
