// PC-owned wire contract: contracts/selfhost-compat (copied without edits).
// Product version, API path version and protocol version are independent.
export const PROTOCOL = 3;
const VERSION = /^v?(\d+)\.\d+\.\d+(?:\.\d+)?(?:-(?:dev|alpha|beta|rc)[.\w-]*)?(?:\+[\w.-]+)?$/;
export function productMajor(value) {
  const match = typeof value === 'string' && VERSION.exec(value);
  return match ? Number(match[1]) : null;
}
export function verifyCompatibility(payload) {
  if (!payload || payload.status !== 'success' || typeof payload.version !== 'string') throw new Error('COMPAT_INFO_MISSING');
  const major = productMajor(payload.version);
  if (major === null || major < 3) throw new Error('SERVER_UPGRADE_REQUIRED');
  if (!Number.isInteger(payload.protocol_version) || !Array.isArray(payload.supported_client_protocols) ||
      !payload.supported_client_protocols.every(Number.isInteger) || !Number.isInteger(payload.minimum_server_major)) throw new Error('COMPAT_INFO_MISSING');
  if (major < payload.minimum_server_major) throw new Error('SERVER_UPGRADE_REQUIRED');
  if (!payload.supported_client_protocols.includes(PROTOCOL)) throw new Error('CLIENT_PROTOCOL_UNSUPPORTED');
  return payload;
}
export function compatibilityError(status, payload) {
  const code = payload?.code;
  if (status === 409 && ['CLIENT_UPGRADE_REQUIRED', 'CLIENT_PROTOCOL_UNSUPPORTED', 'SERVER_UPGRADE_REQUIRED'].includes(code)) return code;
  if (status === 401) return 'SERVER_AUTH_REQUIRED';
  if (status === 403) return 'SERVER_ACCESS_DENIED';
  if (status === 409) return 'SERVER_CONFLICT';
  if ([502, 503, 504].includes(status)) return 'UNAVAILABLE';
  return 'REQUEST_FAILED';
}
