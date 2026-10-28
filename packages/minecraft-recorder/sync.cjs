const {spawnSync} = require('node:child_process');
// A tiny lossless-in-practice optical gate is present in the raw browser video.
// Detect its white-to-black transition instead of guessing when Playwright began capture.
function synchronizationOffset(webm, run = spawnSync) {
  const result = run('ffmpeg', ['-v','info','-i',webm,'-an','-vf',
    'crop=32:32:0:0,blackdetect=d=0.05:pix_th=0.1:pic_th=0.98','-f','null','-'], {encoding:'utf8'});
  if (result.status !== 0) throw Error(`Cannot detect recording synchronization: ${result.stderr}`);
  // The last interval is the permanent gate; ignore black startup/loading frames.
  const match = [...result.stderr.matchAll(/black_start:([\d.]+)/g)].at(-1);
  if (!match) throw Error('Recording synchronization gate missing; raw WebM retained');
  return Number(match[1]);
}
module.exports = {synchronizationOffset};
