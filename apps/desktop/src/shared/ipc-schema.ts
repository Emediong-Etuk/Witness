import { z } from 'zod';
import { ReceiptSchema } from '@witness/schema';

export const SettingsSchema = z.object({
  mode: z.enum(['quick', 'full']),
  retentionDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  saveByDefault: z.boolean(),
  telemetry: z.boolean(),
  aiSummaries: z.boolean(),
  sounds: z.boolean(),
  spokenCoaching: z.boolean(),
  consentCompact: z.boolean(),
  theme: z.enum(['system', 'dark', 'light']),
}).strict();
export type Settings = z.infer<typeof SettingsSchema>;

const metric = z.enum(['pulse', 'breathing', 'hrv']);
const ruleId = ReceiptSchema.shape.reasons.element;

/** What the renderer may ask main to save: verified results + receipts only. */
export const CheckinSchema = z.object({
  id: z.string().regex(/^ses_[A-Za-z0-9_-]{4,40}$/),
  startedAt: z.string().datetime(),
  durationS: z.number().nonnegative().max(600),
  mode: z.enum(['quick', 'full']),
  sourceKind: z.enum(['real', 'replay']),
  sourceLabel: z.string().max(80),
  sdkVersion: z.string().max(40),
  gateConfigHash: z.string().max(80),
  results: z.array(z.object({ metric, value: z.number(), unit: z.string().max(16), receipt: ReceiptSchema }).strict()).max(3),
  withheldStable: z.array(z.object({ metric, value: z.number(), tUs: z.number(), reasons: z.array(ruleId).max(12) }).strict()).max(2000),
  chainHead: z.string().max(80),
  stoppedBy: z.enum(['complete', 'cap', 'user', 'hidden', 'error', 'source_end']),
}).strict();
export type Checkin = z.infer<typeof CheckinSchema>;

export const KeySchema = z.string().trim().min(8).max(512).regex(/^[\x21-\x7e]+$/, 'printable ASCII, no spaces');
export const ExternalIdSchema = z.enum(['register', 'portal', 'repo']);
export const MAX_IPC_BYTES = 2_000_000;
