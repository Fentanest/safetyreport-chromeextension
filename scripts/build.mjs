import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = (process.env.SR_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SR_SUPABASE_PUBLISHABLE_KEY || '';
if ((url || key) && (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))) {
  throw new Error('Set both SR_SUPABASE_URL and SR_SUPABASE_PUBLISHABLE_KEY to the existing project public values.');
}
const out = resolve('build');
await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'icons'), { recursive: true });
await mkdir(resolve(out, 'assets'), { recursive: true });
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
manifest.host_permissions = url ? [`${url}/*`] : [];
manifest.description = '개인 safetyreport 서버 또는 클라우드에서 내 신고 조회';
manifest.permissions = ['storage', 'identity', 'clipboardWrite', 'alarms'];
manifest.background = { service_worker: 'background.js', type: 'module' };
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const file of ['popup.html','popup.css','popup.js','options.html','options.css','options.js',
  'content.js','content.css','shared-ui.js','ui-tokens.css','ui-components.css','icon.png']) {
  await copyFile(file, resolve(out, file));
}
for (const file of ['icon16.png','icon48.png','icon128.png']) await copyFile(`icons/${file}`, resolve(out, 'icons', file));
await copyFile('assets/kakao_login_kr_medium.svg', resolve(out, 'assets', 'kakao_login_kr_medium.svg'));
await build({ entryPoints: ['src/background.js'], bundle: true, format: 'esm', platform: 'browser',
  target: 'chrome120', outfile: resolve(out, 'background.js'), legalComments: 'none',
  define: { __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_KEY__: JSON.stringify(key) } });
console.log(`Extension built: ${out} (${url ? 'configured' : 'unconfigured; set public build variables before release'})`);
