import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readVersion } from '../scripts/version.mjs';

test('release version accepts product versions and rejects invalid Chrome/tag values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sr-version-'));
  const path = join(dir, 'VERSION');
  try {
    for (const version of ['1.2.2', '3.0.0.0', '0.0.1', '65535.65535.65535.65535']) {
      await writeFile(path, ` ${version}\n`);
      assert.equal(await readVersion(path), version);
    }
    for (const version of ['', '1.2', '1.2.3.4.5', '01.2.3', '1.2.3-dev', '65536.1.1', '0.0.0', '0.0.0.0', '1.2.3\ntag=other']) {
      await writeFile(path, version);
      await assert.rejects(readVersion(path), /VERSION must contain/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release build follows VERSION, includes cloud config, and replaces ZIP without stale files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sr-release-build-'));
  const run = script => execFileSync(process.execPath, [`scripts/${script}.mjs`], {
    cwd: dir,
    env: { ...process.env, SR_SUPABASE_URL: 'https://release-fixture.supabase.co', SR_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_release_fixture' },
    stdio: 'pipe',
  });
  try {
    const files = (await readdir('.')).filter(name => /\.(json|js|css|html|png)$/.test(name));
    for (const path of [...files, 'src', 'scripts', 'icons', 'assets', 'contracts']) {
      await cp(path, join(dir, path), { recursive: true });
    }
    await symlink(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
    await writeFile(join(dir, 'VERSION'), '9.8.7.6\n');
    run('build');
    const manifest = JSON.parse(await readFile(join(dir, 'build/manifest.json'), 'utf8'));
    assert.equal(manifest.version, '9.8.7.6');
    assert.deepEqual(manifest.host_permissions, ['https://release-fixture.supabase.co/*']);
    const bundle = await readFile(join(dir, 'build/background.js'), 'utf8');
    assert.ok(bundle.includes('https://release-fixture.supabase.co'));
    assert.ok(bundle.includes('sb_publishable_release_fixture'));
    await writeFile(join(dir, 'build/obsolete.txt'), 'previous build file');
    run('package');
    await rm(join(dir, 'build/obsolete.txt'));
    run('package');
    const zip = join(dir, 'artifacts/safetyreport-extension-9.8.7.6.zip');
    const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n');
    assert.ok(entries.includes('manifest.json'));
    assert.ok(entries.includes('background.js'));
    assert.ok(!entries.includes('obsolete.txt'));
    assert.ok(!entries.some(name => name.startsWith('build/') || name.startsWith('node_modules/')));
    assert.equal(JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' })).version, '9.8.7.6');
    await writeFile(join(dir, 'VERSION'), '9.8.8\n');
    assert.throws(() => run('package'), /Built version differs from VERSION/);
    await writeFile(join(dir, 'VERSION'), '9.8.7.6\n');
    const unconfigured = { ...process.env, SR_SUPABASE_URL: '', SR_SUPABASE_PUBLISHABLE_KEY: '' };
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: dir, env: unconfigured, stdio: 'pipe' });
    assert.throws(() => run('package'), /A configured build is required/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
