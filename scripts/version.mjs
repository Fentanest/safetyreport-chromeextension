import { readFile } from 'node:fs/promises';

export async function readVersion(path = 'VERSION') {
  const version = (await readFile(path, 'utf8')).trim();
  const parts = version.split('.').map(Number);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(\.(0|[1-9]\d*))?$/.test(version)
      || parts.some(part => part > 65535) || parts.every(part => part === 0)) {
    throw new Error('VERSION must contain a nonzero Chrome product version: 3 or 4 integers from 0 to 65535, without leading zeros.');
  }
  return version;
}
