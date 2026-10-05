import { readFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readVersion } from './version.mjs';

const manifest=JSON.parse(await readFile('build/manifest.json','utf8'));
if (manifest.version !== await readVersion()) {
  throw new Error('Built version differs from VERSION. Run npm run build before packaging.');
}
if (!Array.isArray(manifest.host_permissions) || manifest.host_permissions.length!==1) {
  throw new Error('A configured build is required before packaging.');
}
await mkdir('artifacts',{recursive:true});
const output=resolve('artifacts',`safetyreport-extension-${manifest.version}.zip`);
await rm(output,{force:true});
execFileSync('zip',['-q','-r',output,'.'],{cwd:resolve('build')});
console.log(output);
