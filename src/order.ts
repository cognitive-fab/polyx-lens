// Code-unit string ordering. Every sort whose result is persisted or feeds
// an identity uses this, never `localeCompare`: ICU collation depends on
// the process locale and the Node build, and a rule id that differs between
// two machines orphans every adjudication silently (TS §7.5).
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
