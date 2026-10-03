import { serverOrigin } from './backendConfig.js';
import { buildRequest } from './myReportsClient.js';
import { PROTOCOL, verifyCompatibility, compatibilityError } from './selfhostCompat.js';

const text = value => typeof value === 'string' ? value : null;
const officialUrl = id => /^[0-9A-Za-z_-]{1,40}$/.test(String(id ?? ''))
  ? `https://www.safetyreport.go.kr/#mypage/mysafereport/${encodeURIComponent(id)}` : null;
// Project raw server records to an allowlist before crossing into a content script.
export function projectRecord(row, origin, recent = false) {
  const status = text(row.처리상태);
  const disposition = text(row.범칙금_과태료);
  const report_number = text(row.신고번호);
  return { report_number, source_report_id: text(row.id), official_url: officialUrl(row.id),
    detail_url: recent && report_number ? `${origin}/data/all?open=${encodeURIComponent(report_number)}` : null,
    vehicle_number: text(row.차량번호), report_date: text(row.신고일), completed_date: text(row.답변일),
    status: ({ 수용: 'accepted', 일부수용: 'partial', 불수용: 'rejected' })[status] || 'unknown',
    status_label: status, selfhost_disposition: disposition,
    address: text(row.위반장소), agency_name_original: text(row.처리기관), manager_name: text(row.담당자),
    violation_law: text(row.위반법규), rating: Number.isInteger(Number(row.별점)) && Number(row.별점) >= 1 && Number(row.별점) <= 5 ? Number(row.별점) : null };
}
export function searchDto(payload, origin) {
  if (payload?.status !== 'success' || !Array.isArray(payload.data) || payload.count !== payload.data.length) throw new Error('REQUEST_FAILED');
  const items = payload.data.map(row => projectRecord(row, origin));
  const statuses = Object.create(null), dispositions = Object.create(null), managers = new Map();
  for (const item of items) {
    const status = item.status_label || '처리상태 미확인', disposition = item.selfhost_disposition || '처분 미확인';
    statuses[status] = (statuses[status] || 0) + 1;
    dispositions[disposition] = (dispositions[disposition] || 0) + 1;
    if (item.manager_name) {
      const key = JSON.stringify([item.agency_name_original, item.manager_name]);
      const person = managers.get(key) || { manager_name: item.manager_name, agency_name_original: item.agency_name_original, total: 0, accepted: 0 };
      person.total++; if (item.status === 'accepted') person.accepted++; managers.set(key, person);
    }
  }
  return { backend: 'selfhost', summary: { backend: 'selfhost', total: items.length, statuses, dispositions,
      report_number_missing: items.filter(item => !item.report_number).length },
    reports: { backend: 'selfhost', total: items.length, items, next_cursor: null },
    managers: { backend: 'selfhost', items: [...managers.values()], next_cursor: null } };
}
export function dashboardDto(payload, origin) {
  if (payload?.status !== 'success' || !payload.data || !Array.isArray(payload.data.recent_answers)) throw new Error('REQUEST_FAILED');
  const source = payload.data, stats = {};
  for (const key of ['total','acceptCount','partialCount','rejectCount','processingCount','supplementCount','completedCount','withdrawCount','tFineCount','tPenaltyCount','tRejectCount','tUnconfirmedCount']) {
    if (Number.isFinite(source[key])) stats[key] = source[key];
  }
  return { backend: 'selfhost', stats, last_crawl_time: text(source.last_crawl_time),
    recent: source.recent_answers.map(row => projectRecord(row, origin, true)), recent_limit: 200 };
}
export function createSelfhostClient({ fetchImpl = fetch, version, permission }) {
  return async function request(config, operation, message = {}, signal) {
    const queryBody = operation === 'search' || operation === 'numbers' ? buildRequest(operation, message).body : null;
    if (!config.serverUrl || !config.apiKey) throw new Error('SERVER_NOT_CONFIGURED');
    const origin = serverOrigin(config.serverUrl);
    if (!await permission(`${origin}/*`)) throw new Error('SERVER_PERMISSION_REQUIRED');
    const headers = { 'X-API-Key': config.apiKey, 'X-SafetyReport-Client': 'chromeextension',
      'X-SafetyReport-Version': version, 'X-SafetyReport-Protocol': String(PROTOCOL) };
    const send = async (path, body) => {
      let response;
      try { response = await fetchImpl(`${origin}/api/v1/${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store', redirect: 'error', credentials: 'omit' }); }
      catch { throw new Error(signal?.aborted && signal.reason?.message !== 'REQUEST_TIMEOUT' ? 'STALE_SESSION' : 'SERVER_OFFLINE'); }
      let payload; try { payload = await response.json(); } catch { throw new Error('REQUEST_FAILED'); }
      if (!response.ok) throw new Error(compatibilityError(response.status, payload));
      return payload;
    };
    // Every real request (including poll/reconnect) first proves server+protocol compatibility.
    if (signal?.aborted) throw new Error('STALE_SESSION');
    const compatibility = await send('server/version');
    verifyCompatibility(compatibility);
    if (signal?.aborted) throw new Error('STALE_SESSION');
    if (operation === 'version') return { version: compatibility.version };
    if (operation === 'connection') { const state = await send('crawl/status'); if (typeof state.running !== 'boolean') throw new Error('REQUEST_FAILED'); return { version: compatibility.version }; }
    if (operation === 'search' || operation === 'numbers') {
      const body = queryBody;
      if (body.cursor) throw new Error('INVALID_QUERY');
      const raw = await send(body.kind === 'vehicle' ? `vehicle/${encodeURIComponent(body.query)}` : `address?q=${encodeURIComponent(body.query)}`);
      const dto = searchDto(raw, origin);
      if (operation === 'search') return dto;
      const items = [...new Set(dto.reports.items.map(row => row.report_number).filter(Boolean))];
      return { items, matched_reports: dto.summary.total, without_number: dto.summary.report_number_missing,
        unique_numbers: items.length, next_cursor: null, complete: true };
    }
    if (operation === 'summary') return dashboardDto(await send('summary'), origin);
    if (operation === 'crawl-status') {
      const value = await send('crawl/status');
      if (typeof value.running !== 'boolean') throw new Error('REQUEST_FAILED');
      return { running: value.running, pending: Number.isInteger(value.pending) ? value.pending : null };
    }
    if (operation === 'crawl-start' || operation === 'crawl-stop') {
      await send(operation === 'crawl-start' ? 'crawl/start' : 'crawl/kill', operation === 'crawl-start' ? { crawl_mode: 'full' } : {});
      return { success: true };
    }
    if (operation === 'crawl-done') {
      const value = await send('crawl/done/ext');
      return { done: value.done === true, changed_count: Number.isInteger(value.changed_count) ? value.changed_count : null,
        changes: (Array.isArray(value.changes) ? value.changes : []).map(row => ({
          notification_kind: text(row.notification_kind), report_number: text(row.신고번호),
          report_title: text(row.신고명), status_label: text(row.status_label),
          duplicate_change_type: text(row.duplicate_change_type), member_count: Number.isInteger(row.member_count) ? row.member_count : null,
          representative_report_number: text(row.representative_report_number) })) };
    }
    throw new Error('UNKNOWN_MESSAGE');
  };
}
