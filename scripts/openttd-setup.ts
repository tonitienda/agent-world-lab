import {mkdir, writeFile, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve, join} from 'node:path';

// Official, pinned redistributable downloads. Nothing is installed system-wide.
const downloads = [
  {name: 'openttd.zip', url: 'https://cdn.openttd.org/openttd-releases/15.3/openttd-15.3-macos-universal.zip',
    sha256: 'c2ac22ab3ac9ac1e82a8d9029b7e4ab069e425904420076605d860e64460f579'},
  {name: 'opengfx.zip', url: 'https://cdn.openttd.org/opengfx-releases/8.0/opengfx-8.0-all.zip',
    sha256: '43a0c1dabf39cb865394f3a6cc36d4da5c10ecfaaf55652043104806810903be'},
];

async function main() {
  if (process.platform !== 'darwin') throw new Error('Automatic setup currently supports macOS only; see packages/openttd/README.md for manual setup.');
  const out = resolve(process.argv[2] ?? 'data/openttd-runtime');
  await mkdir('data', {recursive: true});
  await mkdir(out, {recursive: false});
  try {
    for (const download of downloads) {
      console.log(`Downloading ${download.url}`);
      const response = await fetch(download.url, {signal: AbortSignal.timeout(120_000)});
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== download.sha256) throw new Error(`SHA-256 mismatch: ${download.name}`);
      const path = join(out, download.name);
      await writeFile(path, bytes);
      execFileSync('unzip', ['-q', path, '-d', out]);
      await rm(path);
    }
    await writeFile(join(out, 'downloads.json'), JSON.stringify(downloads, null, 2));
    console.log(`Ready: ${out}\nRun npm run openttd:spike`);
  } catch (error) {
    // Preserve partial downloads for diagnosis; never remove a user's directory.
    throw new Error(`Setup incomplete in ${out}. Choose a new directory to retry.`, {cause: error});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
