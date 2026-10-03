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

// Transport projection: preserve contract nulls and copy only the public DTO fields.
// The contract copy itself remains byte-identical to the map repository.
const pick = (value, fields) => {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('REQUEST_FAILED');
  return Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => {
    const field = value[key];
    if (field !== null && !['string','number','boolean'].includes(typeof field)) throw new Error('REQUEST_FAILED');
    return [key, field];
  }));
};
const counts = (value, fields) => {
  if (!value || fields.some(key => !Number.isInteger(value[key]) || value[key] < 0)) throw new Error('REQUEST_FAILED');
};
const statusFields = ['accepted','partial','rejected','completed_unknown'];
const dispositionFields = ['fine','warning','penalty','none','unknown'];
const fineFields = ['fine_count','confirmed_count','confirmed_sum_won','unconfirmed_count','other_count'];
const reportFields = ['report_number','source_report_id','official_url','vehicle_number','report_date','completed_date','category','status','status_label','disposition','amount_kind','confirmed_amount_won','penalty_points','address','lat','lng','agency_key','agency_name_original','agency_name_current','manager_key','manager_name','violation_law','rating'];
function summaryDto(value) {
  if (value == null) return null;
  counts(value, ['total','completed_date_missing','report_number_missing']);
  counts(value.status, statusFields); counts(value.disposition, dispositionFields);
  counts(value.fine_amount, fineFields.filter(key => key !== 'confirmed_sum_won'));
  counts(value.category, ['traffic','parking','other']);
  if (value.accept_rate !== null && (!Number.isFinite(value.accept_rate) || value.accept_rate < 0 || value.accept_rate > 100)) throw new Error('REQUEST_FAILED');
  if (value.fine_amount.confirmed_sum_won !== null && (!Number.isFinite(value.fine_amount.confirmed_sum_won) || value.fine_amount.confirmed_sum_won < 0)) throw new Error('REQUEST_FAILED');
  return { ...pick(value, ['total','accept_rate','completed_date_missing','report_number_missing']),
    status: pick(value.status, statusFields), disposition: pick(value.disposition, dispositionFields),
    fine_amount: pick(value.fine_amount, fineFields), category: pick(value.category, ['traffic','parking','other']) };
}
function reportDto(row) {
  if (!row || reportFields.some(key => !Object.hasOwn(row, key))) throw new Error('REQUEST_FAILED');
  const numbers = ['confirmed_amount_won','penalty_points','lat','lng','rating'];
  const required = ['source_report_id','category','status','status_label','disposition','amount_kind'];
  for (const key of reportFields) {
    if (numbers.includes(key)) { if (row[key] !== null && !Number.isFinite(row[key])) throw new Error('REQUEST_FAILED'); }
    else if (!(row[key] === null && !required.includes(key)) && typeof row[key] !== 'string') throw new Error('REQUEST_FAILED');
  }
  return pick(row, reportFields);
}
function reportPage(value) {
  if (value == null) return null;
  if (!Array.isArray(value.items)) throw new Error('REQUEST_FAILED');
  counts(value, ['total','page_size','offset']);
  if (value.next_cursor !== null && typeof value.next_cursor !== 'string') throw new Error('REQUEST_FAILED');
  return { ...pick(value, ['total','page_size','offset','next_cursor']), items: value.items.map(reportDto) };
}
function managerPage(value) {
  if (value == null) return null;
  if (!Array.isArray(value.items)) throw new Error('REQUEST_FAILED');
  counts(value, ['total_managers','unassigned_count','page_size','offset']);
  for (const row of value.items) { counts(row, ['total']); counts(row.status, statusFields); counts(row.disposition, dispositionFields); counts(row.fine_amount, fineFields.filter(key => key !== 'confirmed_sum_won')); }
  return { ...pick(value, ['total_managers','unassigned_count','page_size','offset','next_cursor']), items: value.items.map(row => ({
    ...pick(row, ['agency_key','manager_key','manager_name','agency_name_original','agency_name_current','total','accept_rate']),
    status: pick(row.status, statusFields), disposition: pick(row.disposition, dispositionFields), fine_amount: pick(row.fine_amount, fineFields) })) };
}
export function projectCloudDto(value, route) {
  if (!value || value.contract !== 'my-reports-v1' || value.route !== route) throw new Error('REQUEST_FAILED');
  const common = { ...pick(value, ['contract','route','kind','query_normalized','data_version','queried_at']), account: pick(value.account, ['contributor']) };
  if (route === 'numbers') {
    if (!Array.isArray(value.items) || !value.items.every(item => typeof item === 'string')) throw new Error('REQUEST_FAILED');
    counts(value, ['matched_reports','without_number','unique_numbers','page_size','offset']);
    if (typeof value.complete !== 'boolean' || (value.next_cursor !== null && typeof value.next_cursor !== 'string')) throw new Error('REQUEST_FAILED');
    return { ...common, ...pick(value, ['matched_reports','without_number','unique_numbers','page_size','offset','next_cursor','complete']), items: [...value.items] };
  }
  if (route === 'search') return { ...common, summary: summaryDto(value.summary), reports: reportPage(value.reports), managers: managerPage(value.managers) };
  return { ...common, ...pick(value, ['timezone','recent_start','recent_end']), summary: summaryDto(value.summary), recent_summary: summaryDto(value.recent_summary), recent: reportPage(value.recent) };
}
