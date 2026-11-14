import {project, type Position} from './camera.js';

export type FreightSample = {
  day: number;
  balance: number;
  income: number;
  wood: number;
  goods: number;
  trucks: {id: number; position: Position; wood: number; goods: number; speed: number}[];
};
export type FreightTarget = {
  woodDeliveredToSawmill: number;
  goodsFromSawmillDeliveredToTown: number;
  maximumDays: number;
  minimumEndingCash: number;
};

/** The engine income ledger is independent of net cash, which includes costs and borrowing. */
export function freightReceipt(before: FreightSample, after: FreightSample) {
  const amount = after.income - before.income;
  // OpenTTD can count unloaded cargo before posting the transport payment.
  if (after.day <= before.day || amount <= 0) return undefined;
  return {id: `freight-income-${before.day}-${after.day}`, amount, days: after.day - before.day};
}

const number = (value: number) => value.toLocaleString('en-US');
const escape = (value: string) => value.replace(/[&<>"']/g, c =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]!));

/** A frame of the proposed freight treatment using a native screenshot of the same paused save. */
export function freightFrame(source: Buffer, sample: FreightSample, target: FreightTarget, options: {
  focus: Position; heading: string; skin: string; cropWidth?: number; attribution?: string; detail?: string; receipt?: ReturnType<typeof freightReceipt>; receiptAt?: Position; expense?: {amount: number; label: string};
}) {
  const width = 1920, height = 1080;
  const sourceWidth = source.readUInt32BE(16), sourceHeight = source.readUInt32BE(20);
  const centre = project(options.focus, 128, 1);
  const cropWidth = options.cropWidth ?? 448;
  const scale = width / cropWidth;
  const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));
  const x = clamp(centre.x - cropWidth / 2, sourceWidth - cropWidth);
  const y = clamp(centre.y - height / scale * .54, sourceHeight - height / scale);
  const receipt = options.receipt;
  const expense = options.expense;
  const cueColour = receipt ? '#bbf98f' : '#ffc490';
  const subject = options.receiptAt ? project(options.receiptAt, 128, 1) : undefined;
  const anchor = subject ? {x: (subject.x - x) * scale, y: (subject.y - y) * scale} : undefined;
  const cueX = anchor ? clamp(anchor.x + 96, width - 488) : 1430;
  const cueY = anchor ? Math.max(159, Math.min(700, anchor.y - 200)) : 159;
  const accent = receipt ? '#bbf98f' : expense || sample.balance < target.minimumEndingCash ? '#ffc490' : '#e5eeec';
  const meter = (x: number, label: string, value: number, max: number, colour: string) => `
    <text x="${x}" y="977" font-size="18" letter-spacing="2" fill="#b5c9c4">${label}</text>
    <text x="${x}" y="1020" font-size="35" font-weight="700">${number(value)} <tspan font-size="23" fill="#9cafa9">/ ${number(max)}</tspan></text>
    <rect x="${x}" y="1040" width="320" height="7" rx="3.5" fill="#314640"/>
    <rect x="${x}" y="1040" width="${Math.max(0, Math.min(1, value / max)) * 320}" height="7" rx="3.5" fill="${colour}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" font-family="Helvetica Neue, Arial, sans-serif" fill="#f2f5ed">
  <image image-rendering="optimizeSpeed" x="${-x * scale}" y="${-y * scale}" width="${sourceWidth * scale}" height="${sourceHeight * scale}"
    xlink:href="data:image/png;base64,${source.toString('base64')}"/>
  <rect width="1920" height="126" fill="#0d211e" fill-opacity=".97"/>
  <rect x="44" y="27" width="5" height="73" rx="2" fill="#bbf98f"/>
  <text x="70" y="49" font-size="20" letter-spacing="4" fill="#bbf98f">THE AGENT TERRARIUM / OPENTTD</text>
  <text x="70" y="100" font-size="48" font-weight="700">Forest to Market</text>
  <text x="1870" y="49" text-anchor="end" font-size="23" fill="#b5c9c4">DAY ${sample.day} / ${target.maximumDays}</text>
  <text x="1870" y="94" text-anchor="end" font-size="28">${escape(options.heading)}</text>
  ${(receipt || expense) && anchor ? `<path d="M${cueX + 40},${cueY + 145} L${anchor.x},${anchor.y - 28}" fill="none" stroke="#bbf98f" stroke-width="4"/>` : ''}
  ${receipt || expense ? `<g transform="translate(${cueX} ${cueY})">
    <rect width="440" height="145" rx="16" fill="#142921" stroke="${cueColour}" stroke-width="3"/>
    <text x="24" y="38" font-size="20" letter-spacing="2" fill="${cueColour}">${receipt ? 'DELIVERY INCOME' : escape(expense!.label)}</text>
    <text x="24" y="94" font-size="51" font-weight="700" fill="${cueColour}">${receipt ? '+' : '−'}${number(receipt?.amount ?? expense!.amount)}</text>
    <text x="24" y="124" font-size="20" fill="#b5c9c4">${receipt ? `Over the last ${receipt.days === 1 ? "game day" : `${receipt.days} game days`}` : 'Paid from company cash'}</text>
  </g>` : ''}
  <rect y="929" width="1920" height="151" fill="#0d211e" fill-opacity=".97"/>
  ${meter(52, 'WOOD TO SAWMILL · TONNES', sample.wood, target.woodDeliveredToSawmill, '#e3b27d')}
  ${meter(436, 'GOODS TO EASTMERE · CRATES', sample.goods, target.goodsFromSawmillDeliveredToTown, '#a4e2ed')}
  <text x="822" y="977" font-size="18" letter-spacing="2" fill="#b5c9c4">${escape(options.attribution ?? 'SCRIPTED FREIGHT TEST')}</text>
  <text x="822" y="1020" font-size="29">${escape(options.detail ?? options.skin)}</text>
  <rect x="1472" y="946" width="398" height="113" rx="14" fill="#1b332b" stroke="${accent}" stroke-opacity=".76"/>
  <text x="1496" y="978" font-size="18" letter-spacing="2" fill="${accent}">COMPANY CASH</text>
  <text x="1496" y="1031" font-size="44" font-weight="700" fill="${accent}">${number(sample.balance)}</text>
  <text x="1846" y="1031" text-anchor="end" font-size="20" fill="#b5c9c4">${number(target.minimumEndingCash)} reserve</text>
</svg>`;
}

/** Original two-note cash cue with a short metallic attack, mono PCM at 48 kHz. */
export function freightChime(): Buffer {
  const sampleRate = 48_000;
  const count = Math.round(sampleRate * .36);
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    let value = 0;
    for (const [offset, frequency] of [[0, 988], [.073, 1480]] as const) {
      const time = i / sampleRate - offset;
      if (time < 0) continue;
      const envelope = Math.min(1, time / .004) * Math.exp(-19 * time);
      const phase = 2 * Math.PI * frequency * time;
      value += envelope * (.12 * Math.sin(phase) + .033 * Math.sin(2.71 * phase) + .018 * Math.sin(4.19 * phase));
    }
    wav.writeInt16LE(Math.round(value * Math.min(1, (count - i) / 480) * 32767), 44 + i * 2);
  }
  return wav;
}
