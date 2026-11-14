/** Editorial cameras reframe captured world images; they never control gameplay. */
export type Position = {x: number; y: number};
export type Station = {id: number; name: string; position: Position; waiting: number};
export type Observation = {
  date: number; width: number; height: number; balance: number; delivered: number;
  vehicles: {id: number; position: Position; load: number; capacity: number; profit: number}[];
  towns?: {id: number; name: string; position: Position; population: number}[];
};
export type Capture = {
  image: string; snapshot: Observation; stations: Station[];
  kind: 'overview' | 'construction' | 'operation' | 'outcome';
  focus?: Position; label?: string;
};
export type Recording = {
  version: 1; sampleEconomyDays: number; northHeight: number; southHeight: number;
  captures: Capture[];
  actorLabel?: string;
  episode?: string;
  goal?: {passengers: number; days: number; minimumCash: number};
};
export type Shot = {
  capture: number; camera: 'wide' | 'network' | 'construction' | 'queue' | 'follow' | 'delivery' | 'boarding';
  focus?: Position; subject?: number; reason: string; duration: number;
  vehicle?: number;
  narrationHeading?: string;
  narrationEvent?: number;
  inset?: {target: VisualTarget; label: string};
};
export type VisualTarget = {kind: 'town' | 'station' | 'vehicle'; id: number} | {kind: 'position'; position: Position};
export type CameraPlan = {version: 1; width: number; height: number; fps: number; shots: Shot[]};

/** 15.3 screenshot.cpp + landscape.h, normal zoom, freeform edges, flat fixture only. */
export function project(position: Position, mapWidth: number, northHeight: number): Position {
  const groundY = 16 * (position.x + position.y) + 16 - 8 * northHeight;
  const screenshotTop = 32 - 8 * northHeight - 150;
  return {
    x: 32 * (position.y - position.x + mapWidth - 2),
    y: groundY - screenshotTop,
    // Ground and north-edge height cancel on this flat map (8px per height level).
  };
}

export function cropFor(shot: Shot, mapWidth: number, northHeight: number,
  source: {width: number; height: number}): {x: number; y: number; width: number; height: number} {
  const desired = shot.camera === 'wide' ? source.width : shot.camera === 'network' ? 1900 : shot.camera === 'follow' ? 1120 : 760;
  const width = Math.min(desired, source.width, source.height * 16 / 9);
  const height = width * 9 / 16;
  const point = shot.focus ? project(shot.focus, mapWidth, northHeight) : {x: source.width / 2, y: source.height / 2};
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
  return {x: clamp(point.x - width / 2, source.width - width),
    y: clamp(point.y - height * 0.43, source.height - height), width, height};
}

/** Event priority + minimum dwell avoids cutting to every small queue change. */
export function direct(recording: Recording): CameraPlan {
  const shots: Shot[] = [];
  let active: Shot | undefined;
  let lastCutDay = -Infinity;
  let lastPriority = 0;
  const firstDate = recording.captures[0]?.snapshot.date ?? 0;
  for (const [index, capture] of recording.captures.entries()) {
    const previous = recording.captures[index - 1];
    const previousBuses = new Map(previous?.snapshot.vehicles.map(v => [v.id, v]) ?? []);
    const earner = [...capture.snapshot.vehicles].sort((a, b) =>
      (b.profit - (previousBuses.get(b.id)?.profit ?? 0)) - (a.profit - (previousBuses.get(a.id)?.profit ?? 0)))[0];
    const boarding = capture.snapshot.vehicles.find(v => v.load > (previousBuses.get(v.id)?.load ?? 0));
    const bus = capture.snapshot.vehicles.find(v => v.id === active?.vehicle) ?? capture.snapshot.vehicles[0];
    const day = capture.snapshot.date - firstDate;
    let candidate: Shot;
    let priority = 0;
    if (capture.kind !== 'operation') {
      candidate = {capture: index, camera: capture.kind === 'construction' ? 'construction' : 'wide',
        focus: capture.focus, reason: capture.label ?? capture.kind,
        duration: capture.kind === 'construction' ? 1.5 : 2.5};
      active = undefined;
    } else {
      candidate = {capture: index, camera: 'follow', focus: bus?.position, vehicle: bus?.id,
        reason: 'Follow the bus between stops', duration: 0.25};
      if (capture.snapshot.delivered > (previous?.snapshot.delivered ?? 0)) {
        const deliveredBus = earner ?? bus;
        const near = deliveredBus && [...capture.stations].sort((a, b) => distance(a.position, deliveredBus.position) - distance(b.position, deliveredBus.position))[0];
        candidate = {...candidate, camera: 'delivery', focus: near?.position ?? deliveredBus?.position, vehicle: deliveredBus?.id,
          subject: near?.id, reason: `${capture.snapshot.delivered - (previous?.snapshot.delivered ?? 0)} passengers delivered`};
        priority = 100;
      } else if (boarding) {
        candidate = {...candidate, camera: 'boarding', focus: boarding.position, vehicle: boarding.id,
          reason: `Passengers board — bus ${boarding.load}/${boarding.capacity}`};
        priority = 80;
      } else {
        const growing = capture.stations.filter(station => {
          const earlier = previous?.stations.find(s => s.id === station.id)?.waiting ?? 0;
          return station.waiting >= 25 && Math.floor(station.waiting / 25) > Math.floor(earlier / 25);
        }).sort((a, b) => b.waiting - a.waiting)[0];
        if (growing) {
          candidate = {...candidate, camera: 'queue', focus: growing.position, subject: growing.id,
            reason: `${growing.waiting} passengers waiting`};
          priority = 60;
        }
      }
      // Stay on an event for at least eight sampled days, except for a higher-priority event.
      if (active && day - lastCutDay < 8 && priority <= lastPriority) {
        candidate = {...active, capture: index, duration: 0.25};
        if (candidate.camera === 'follow') candidate.focus = bus?.position;
      } else if (!active || candidate.camera !== active.camera || candidate.subject !== active.subject || priority > 0) {
        lastCutDay = day;
        lastPriority = priority;
      }
      active = candidate;
    }
    shots.push(candidate);
  }
  return {version: 1, width: 1920, height: 1080, fps: 30, shots};
}

const distance = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function resolveTarget(capture: Capture, target: VisualTarget): Position {
  if (target.kind === 'position') return target.position;
  const item = target.kind === 'station' ? capture.stations.find(s => s.id === target.id)
    : target.kind === 'vehicle' ? capture.snapshot.vehicles.find(v => v.id === target.id)
    : capture.snapshot.towns?.find(t => t.id === target.id);
  if (!item) throw new Error(`Camera target ${target.kind} ${target.id} is absent from this capture`);
  return item.position;
}

/** SVG overlay and isometric crop; raw PNG is retained separately. */
export function renderCamera(capture: Capture, shot: Shot, recording: Recording, source: Buffer,
  width = 1920, height = 1080): string {
  const sourceSize = {width: source.readUInt32BE(16), height: source.readUInt32BE(20)};
  const crop = cropFor(shot, capture.snapshot.width, recording.northHeight, sourceSize);
  const scale = width / crop.width;
  const screen = (p: Position) => {
    const point = project(p, capture.snapshot.width, recording.northHeight);
    return {x: (point.x - crop.x) * scale, y: (point.y - crop.y) * scale};
  };
  const bus = capture.snapshot.vehicles.find(v => v.id === shot.vehicle) ?? capture.snapshot.vehicles[0];
  const day = capture.snapshot.date - recording.captures[0]!.snapshot.date;
  const badges = capture.stations.map(station => {
    const point = screen(station.position);
    if (point.x < 110 || point.x > width - 110 || point.y < 240 || point.y > height - 130) return '';
    return `<g transform="translate(${point.x},${point.y})"><path d="M0,-15 L0,-45" stroke="#6de2c7" stroke-width="3"/>
      <rect x="-105" y="-92" width="210" height="47" rx="12" fill="#112b2b" stroke="#6de2c7"/>
      <text x="0" y="-61" text-anchor="middle" font-size="24" fill="#dffff4">${station.waiting} waiting</text></g>`;
  }).join('');
  const marker = bus && shot.camera !== 'wide' ? (() => {
    const p = screen(bus.position);
    return `<ellipse cx="${p.x}" cy="${p.y}" rx="26" ry="14" fill="none" stroke="#ffd17c" stroke-width="3"/>`;
  })() : '';
  const construction = shot.camera === 'construction' && shot.focus ? (() => {
    const p = screen(shot.focus!);
    const rx = 30 * scale, ry = 15 * scale;
    return `<path d="M${p.x - rx},${p.y} L${p.x},${p.y - ry} L${p.x + rx},${p.y} L${p.x},${p.y + ry} Z" fill="#6de2c7" fill-opacity="0.1" stroke="#6de2c7" stroke-width="3"/>`;
  })() : '';
  const waiting = capture.stations.reduce((sum, s) => sum + s.waiting, 0);
  const fleetLoad = capture.snapshot.vehicles.reduce((sum, v) => sum + v.load, 0);
  const fleetCapacity = capture.snapshot.vehicles.reduce((sum, v) => sum + v.capacity, 0);
  const fleetProfit = capture.snapshot.vehicles.reduce((sum, v) => sum + v.profit, 0);
  const reason = shot.narrationHeading ?? (shot.camera === 'queue' ? `${capture.stations.find(s => s.id === shot.subject)?.waiting ?? 0} passengers waiting`
    : shot.camera === 'boarding' ? `Passengers aboard — bus ${bus?.load ?? 0}/${bus?.capacity ?? 0}`
    : shot.camera === 'delivery' ? `${capture.snapshot.delivered} passengers delivered in total` : shot.reason);
  const insetScale = 350 / sourceSize.width;
  let inset = shot.camera === 'wide' ? '' : `<g transform="translate(${width - 398},160)">
    <rect x="-10" y="-10" width="370" height="232" rx="12" fill="#08131b" fill-opacity="0.95" stroke="#38515e"/>
    <g transform="scale(${insetScale})"><use xlink:href="#world"/>
      <rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}" fill="none" stroke="#6de2c7" stroke-width="22"/></g>
    <text x="0" y="214" font-size="16" fill="#acc4cf">MAP / CAMERA VIEW</text></g>`;
  if (shot.inset) {
    const target = shot.inset.target;
    const focus = resolveTarget(capture, target);
    const p = project(focus, capture.snapshot.width, recording.northHeight);
    const w = 540, h = 304, zoom = w / 440;
    const x = Math.max(0, Math.min(sourceSize.width - w / zoom, p.x - w / zoom / 2));
    const y = Math.max(0, Math.min(sourceSize.height - h / zoom, p.y - h / zoom * 0.55));
    const station = target.kind === 'station' ? capture.stations.find(s => s.id === target.id) : undefined;
    const vehicle = target.kind === 'vehicle' ? capture.snapshot.vehicles.find(v => v.id === target.id) : undefined;
    const label = shot.inset.label + (station ? ` · ${station.waiting} waiting` : vehicle ? ` · ${vehicle.load}/${vehicle.capacity} aboard` : '');
    inset = `<g transform="translate(${width - 588},160)">
      <defs><clipPath id="detail"><rect width="${w}" height="${h}" rx="8"/></clipPath></defs>
      <rect x="-8" y="-8" width="${w + 16}" height="${h + 70}" rx="12" fill="#08131b" stroke="#6de2c7" stroke-width="2"/>
      <g clip-path="url(#detail)"><g transform="translate(${-x * zoom},${-y * zoom}) scale(${zoom})"><use xlink:href="#world"/></g>
      <ellipse cx="${(p.x - x) * zoom}" cy="${(p.y - y) * zoom}" rx="23" ry="12" fill="none" stroke="#6de2c7" stroke-width="3"/></g>
      <text x="16" y="${h + 36}" font-size="22" fill="#dffff4">${esc(label)}</text></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica Neue, Arial, sans-serif">
    <defs><clipPath id="screen"><rect width="${width}" height="${height}"/></clipPath>
    <image id="world" width="${sourceSize.width}" height="${sourceSize.height}" xlink:href="data:image/png;base64,${source.toString('base64')}"/>
    <linearGradient id="top" x2="0" y2="1"><stop stop-color="#08131b"/><stop offset="1" stop-color="#08131b" stop-opacity="0.86"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="#08131b"/>
    <g clip-path="url(#screen)"><g transform="translate(${-crop.x * scale},${-crop.y * scale}) scale(${scale})"><use xlink:href="#world"/></g>${construction}${marker}${badges}</g>${inset}
    <rect width="${width}" height="132" fill="url(#top)"/>
    <text x="48" y="46" font-size="22" letter-spacing="3" fill="#8ddbc9">THE AGENT TERRARIUM / OPENTTD</text>
    <text x="48" y="96" font-size="34" font-weight="600" fill="#ffffff">${esc(reason)}</text>
    <text x="${width - 48}" y="51" text-anchor="end" font-size="25" fill="#ffffff">DAY ${day}${recording.goal ? ' / ' + recording.goal.days : ''}</text>
    <text x="${width - 48}" y="96" text-anchor="end" font-size="20" fill="#acc4cf">${shot.camera.toUpperCase()} CAMERA</text>
    <rect y="${height - 100}" width="${width}" height="100" fill="#08131b" fill-opacity="0.95"/>
    <text x="48" y="${height - 57}" font-size="25" fill="#ffffff">Waiting ${waiting}   ·   ${recording.actorLabel ? `On buses ${fleetLoad}/${fleetCapacity}` : `On bus ${bus ? `${bus.load}/${bus.capacity}` : '—'}`}   ·   Delivered ${capture.snapshot.delivered}${recording.goal ? ' / ' + recording.goal.passengers : ''}</text>
    <text x="48" y="${height - 24}" font-size="19" fill="#a6bdc8">${capture.kind === 'operation' ? 'TIME-LAPSE · daily game samples' : capture.kind === 'construction' ? 'PAUSED CONSTRUCTION · real action captures' : 'PAUSED WORLD VIEW'} · ${esc(recording.actorLabel ?? 'Scripted integration test')}</text>
    <text x="${width - 48}" y="${height - 57}" text-anchor="end" font-size="23" fill="${recording.goal && capture.snapshot.balance < recording.goal.minimumCash ? '#ff9285' : '#ffd17c'}">${recording.actorLabel ? `Cash ${capture.snapshot.balance.toLocaleString('en-US')}${recording.goal ? ` / ${recording.goal.minimumCash.toLocaleString('en-US')} min` : ''}` : `Bus profit ${bus?.profit ?? 0}`}</text>
    ${recording.actorLabel ? `<text x="${width - 48}" y="${height - 24}" text-anchor="end" font-size="19" fill="#acc4cf">Fleet operating profit ${fleetProfit}</text>` : ''}
    </svg>`;
}
