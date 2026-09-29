// my-reports-v1 request/response rules for the worker (contracts/my-reports, copied byte-for-byte from the map repo).
// Pure: no chrome.* and no network, so tests/my-reports-client.test.mjs checks it directly.
import { LIMITS, normalizeAddress, normalizeVehicle, validQuery } from '../contracts/my-reports/types.ts';

export const PAGE = { search: 20, managers: 10, summary: 20, numbers: LIMITS.numbers_page_size_max };
const CURSOR = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function cursorOf(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > LIMITS.cursor_chars || !CURSOR.test(value)) throw new Error('INVALID_QUERY');
  return value;
}

/** Message from popup/content → the exact my-reports body. Page sizes are fixed here, not by the page script. */
export function buildRequest(mode, msg) {
  const cursor = cursorOf(msg.cursor);
  if (mode === 'summary') return { route: 'summary', body: { cursor, page_size: PAGE.summary } };
  const kind = msg.kind;
  if (kind !== 'vehicle' && kind !== 'address') throw new Error('INVALID_QUERY');
  if (typeof msg.query !== 'string' || msg.query.length > LIMITS.query_raw_chars) throw new Error('INVALID_QUERY');
  const query = kind === 'vehicle' ? normalizeVehicle(msg.query) : normalizeAddress(msg.query);
  if (!validQuery(kind, query)) throw new Error('INVALID_QUERY');
  if (mode === 'numbers') return { route: 'numbers', body: { kind, query, cursor, page_size: PAGE.numbers } };
  if (mode !== 'search') throw new Error('INVALID_QUERY');
  const part = msg.part === 'managers' ? 'managers' : 'reports';
  return { route: 'search', body: part === 'managers'
    ? { kind, query, part, cursor, managers_page_size: PAGE.managers }
    : { kind, query, part, cursor, page_size: PAGE.search, managers_page_size: PAGE.managers } };
}

/**
 * HTTP failure → the one code popup/content understand (README §7). `refresh` = try one token refresh first.
 * Responses without a contract error code (gateway 401/402/5xx, HTML, empty) are never read as empty results.
 */
export function classifyError(status, body) {
  const code = body && typeof body === 'object' && body.error && typeof body.error.code === 'string' ? body.error.code : null;
  if (status === 401) return { code: 'AUTH_REQUIRED', refresh: code === null || code === 'SESSION_EXPIRED', clear: true };
  if (code === 'ORIGIN_FORBIDDEN') return { code: 'NOT_CONFIGURED', clear: false };
  if (status === 403) return { code: 'ACCESS_DENIED', clear: true };
  if (code === 'DATASET_CHANGED' || code === 'CURSOR_EXPIRED' || code === 'INVALID_CURSOR') return { code: 'DATASET_CHANGED', restart: true };
  if (code === 'NUMBERS_LIMIT_EXCEEDED') return { code: 'NUMBERS_LIMIT_EXCEEDED' };
  if (code === 'QUERY_LENGTH') return { code: 'INVALID_QUERY' };
  if (status === 429) return { code: 'RATE_LIMITED' };
  if (status === 503 || status === 504 || status === 502 || status === 402) return { code: 'UNAVAILABLE' };
  return { code: 'REQUEST_FAILED' };
}

/** Seconds from Retry-After (delta form only), bounded; default 60 for 429. */
export function retryAfterSeconds(value, fallback = 60) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 3600 ? n : fallback;
}
