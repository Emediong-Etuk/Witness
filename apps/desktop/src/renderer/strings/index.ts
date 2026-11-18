import en from './en.json';

export type StringKey = keyof typeof en;
export function t(key: StringKey, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
