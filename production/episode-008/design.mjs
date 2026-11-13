// Adapt the supplied artboards to the recorded cast and result. The design
// bundle stays untouched and remains the source for cards and character art.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '../../packages/minecraft-recorder/node_modules/playwright/index.mjs';

const root = resolve(import.meta.dirname, '../..');
const design = resolve(root, 'packages/detonarium/design/Detonarium Redesign.html');
const generated = resolve(root, 'production/public/episode-008/generated');
const stats = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : null;
await mkdir(generated, {recursive: true});
const browser = await chromium.launch({args: ['--allow-file-access-from-files']});
try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 2});
  await page.goto(pathToFileURL(design).href);
  async function artboard(title) {
    const node = page.locator(`iframe[title="${title}"]`);
    const frame = node.contentFrame();
    await frame.locator('#dc-root svg').first().waitFor({state: 'attached'});
    await frame.locator('body').evaluate(() => document.fonts.ready.then(() => null));
    return {frame, surface: frame.locator('#dc-root > .sc-host > div').first()};
  }
  const intro = await artboard('Game intro card');
  const sprites = await intro.frame.locator('#dc-root svg').evaluateAll(nodes =>
    [nodes[0], nodes[2], nodes[1], nodes[3]].map(node => node.innerHTML));
  await writeFile(resolve(generated, 'cast-sprites.json'), JSON.stringify(sprites));
  await intro.frame.locator('#dc-root').evaluate(root => {
    const leaf = text => [...root.querySelectorAll('*')].find(node => !node.children.length && node.textContent === text);
    leaf('GAME 2').textContent = 'FOUR-WAY SHOWDOWN';
    leaf('FREE FOR ALL · 4 PLAYERS · EVERY BOMB FOR ITSELF').textContent = 'FREE FOR ALL · 15 × 15 ARENA';
    leaf('CLAUDE OPUS 5.5').textContent = 'CLAUDE SONNET 5.5';
    leaf('A fresh arena. The same objective.').textContent = 'Ada, Bram, and two Hunters enter the arena.';
  });
  await intro.surface.screenshot({path: resolve(generated, 'opening.png'), animations: 'disabled'});
  if (stats) {
    const ending = await artboard('Victory / end card');
    await ending.frame.locator('#dc-root').evaluate((root, {stats, sprites}) => {
      const leaf = text => [...root.querySelectorAll('*')].find(node => !node.children.length && node.textContent === text);
      const [hero, ...loserSprites] = root.querySelectorAll('svg');
      const names = ['Ada', 'Bram', 'Hunter 1', 'Hunter 2'];
      const labels = ['CLAUDE SONNET 5.5', 'CODEX', 'HUNTER BOT', 'HUNTER BOT'];
      const colors = ['#d97757', '#10a37f', '#b99df0', '#f2c84b'];
      const result = leaf('CLAUDE OPUS 5.5');
      const heading = result.parentElement.previousElementSibling;
      const podiumLabel = leaf('1ST');
      const podium = podiumLabel.parentElement;
      const markers = ['Bram', 'Hunter 1', 'Hunter 2'].map(leaf);
      leaf('GAME 1 · LAST STANDING').textContent = stats.winner === null ? 'FREE FOR ALL · FINAL RESULT' : 'FREE FOR ALL · LAST STANDING';
      leaf('[TICK]').textContent = stats.ticks;
      for (const value of [stats.knockouts, stats.bombs]) leaf('[N]').textContent = value;
      if (stats.winner === null) {
        heading.textContent = 'DRAW';
        result.textContent = 'NO WINNER';
        podiumLabel.textContent = 'DRAW';
        hero.closest('.hop').remove();
        root.querySelectorAll('.conf').forEach(node => node.remove());
        const extra = markers[0].parentElement.cloneNode(true);
        extra.querySelector('svg').innerHTML = sprites[0];
        extra.lastElementChild.textContent = names[0];
        markers[0].parentElement.before(extra);
      } else {
        const winner = stats.winner;
        heading.innerHTML = `${names[winner].toUpperCase()}<br>WINS`;
        if (winner !== 0) hero.innerHTML = sprites[winner];
        if (winner > 1) heading.style.fontSize = '106px';
        result.textContent = labels[winner];
        result.style.background = colors[winner];
        podium.style.background = colors[winner];
        podium.style.boxShadow = 'inset 0 12px rgba(255,255,255,.24), inset 0 -18px rgba(0,0,0,.24), 0 22px rgba(0,0,0,.35)';
        names.map((_, i) => i).filter(i => i !== winner).forEach((id, i) => {
          loserSprites[i].innerHTML = sprites[id];
          markers[i].textContent = names[id];
        });
      }
    }, {stats, sprites});
    await ending.surface.screenshot({path: resolve(generated, 'ending.png'), animations: 'disabled'});
  }
} finally {
  await browser.close();
}
