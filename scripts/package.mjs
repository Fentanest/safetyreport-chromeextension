import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const manifest=JSON.parse(await readFile('build/manifest.json','utf8'));
if (!Array.isArray(manifest.host_permissions) || manifest.host_permissions.length!==1) {
  throw new Error('A configured build is required before packaging.');
}
await mkdir('artifacts',{recursive:true});
const output=resolve('artifacts',`safetyreport-extension-${manifest.version}.zip`);
execFileSync('zip',['-q','-r',output,'.'],{cwd:resolve('build')});
console.log(output);
