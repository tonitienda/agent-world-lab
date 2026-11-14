import {spawn} from 'node:child_process';
import {copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const [save, output, alternate, skin] = process.argv.slice(2);
if (!save || !output || (alternate && alternate !== 'classic'))
  throw new Error('Usage: node --import tsx scripts/openttd-native-screenshot.ts SAVE OUTPUT.png [classic] [static-skin.grf]');

const runtime = fileURLToPath(new URL('../data/openttd-runtime/', import.meta.url));
const binary = join(runtime, 'OpenTTD.app/Contents/MacOS/openttd');
const assets = resolve(dirname(binary), '../Resources');
const home = await mkdtemp(join(tmpdir(), 'terrarium-openttd-shot-'));
try {
  for (const directory of ['lang', 'baseset', 'game', 'ai'])
    await cp(join(assets, directory), join(home, directory), {recursive: true});
  for (const directory of ['game', 'ai'])
    await cp(fileURLToPath(new URL(`../packages/openttd/${directory}/`, import.meta.url)),
      join(home, directory), {recursive: true});
  const graphics = alternate ? 'OpenGFX2_Classic-0.8.1.tar' : 'opengfx-8.0.tar';
  await copyFile(join(runtime, graphics), join(home, 'baseset', graphics));
  await copyFile(resolve(save), join(home, 'proof.sav'));
  const skinName = 'terrarium_skin.grf';
  if (skin) {
    await mkdir(join(home, 'newgrf'));
    await copyFile(resolve(skin), join(home, 'newgrf', skinName));
  }
  await mkdir(join(home, 'scripts'));
  await writeFile(join(home, 'scripts/game_start.scr'), 'pause\nscreenshot giant native\n');
  await writeFile(join(home, 'openttd.cfg'),
    '[misc]\nresolution = 1280,720\ndisplay_opt = FULL_DETAIL\n[gui]\nautosave_on_exit = false\n'
      + (skin ? `[newgrf-static]\n${skinName} =\n` : ''));
  const child = spawn(binary, ['-c', 'openttd.cfg', '-X', '-x', '-g', 'proof.sav',
    '-I', alternate ? 'OpenGFX2 Classic' : 'OpenGFX', '-s', 'null', '-m', 'null', '-b', skin ? '32bpp-optimized' : '8bpp-optimized',
    '-v', 'cocoa', '-d', skin ? 'driver=1,grf=2' : 'driver=1'], {cwd: home, stdio: ['ignore', 'pipe', 'pipe']});
  let logs = '';
  let failure: Error | undefined;
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.on('error', error => { failure = error; });
  const closed = new Promise<void>(done => child.once('close', () => done()));
  try {
    const source = join(home, 'screenshot/native.png');
    let complete = false;
    for (let attempt = 0; attempt < 75; attempt++) {
      if (failure) throw failure;
      if (child.exitCode !== null) break;
      const bytes = await readFile(source).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (bytes?.subarray(-8, -4).toString() === 'IEND') {
        await mkdir(dirname(resolve(output)), {recursive: true});
        await writeFile(resolve(output), bytes, {flag: 'wx'});
        complete = true;
        break;
      }
      await delay(200);
    }
    if (skin && complete) {
      if (!logs.includes(`[${skinName}:`) || !logs.includes('SpriteReplace:')) throw new Error(`OpenTTD did not report loading the requested skin.\n${logs}`);
      await writeFile(resolve(output) + '.log', logs);
    }
    if (!complete) throw new Error(`OpenTTD did not produce a native screenshot.\n${logs}`);
  } finally {
    child.kill('SIGKILL');
    await closed;
  }
} finally {
  await rm(home, {recursive: true, force: true});
}
