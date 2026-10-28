// Pure controller shared by the browser and deterministic terrain tests.
function createFollowController() {
  let position, angle;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  function clear(p, boxes) {
    const r = .18; // camera body, also protects the near plane
    return !boxes.some(b => p.every((v, i) => v > b[i] - r && v < b[i + 3] + r));
  }
  function sweep(a, b, boxes) {
    const steps = Math.max(1, Math.ceil(distance(a, b) / .06));
    let safe = a;
    for (let i = 0; i <= steps; i++) {
      const p = mix(a, b, i / steps);
      if (!clear(p, boxes)) return safe;
      safe = p;
    }
    return safe;
  }
  return {step(state, dt) {
    const {pos, yaw, boxes} = state;
    dt = Math.min(.1, Math.max(0, dt));
    angle ??= yaw;
    angle += Math.atan2(Math.sin(yaw - angle), Math.cos(yaw - angle)) * (1 - Math.exp(-10 * dt));
    const target = [pos.x, pos.y + 1.25, pos.z];
    const desired = [target[0] + Math.sin(angle) * 4, target[1] + 1.1, target[2] + Math.cos(angle) * 4];
    // Pull in immediately for occlusion; ease out after leaving a wall or ceiling.
    let goal = sweep(target, desired, boxes);
    if (distance(goal, desired) > .1) {
      // A level shoulder view often fits where the raised boom hits a low ceiling.
      const level = sweep(target, [desired[0], target[1], desired[2]], boxes);
      if (distance(target, level) > distance(target, goal)) goal = level;
    }
    // In a one-block tunnel a turn can point the boom directly into a side wall.
    // Prefer a nearby side view along the corridor over putting the lens inside
    // the player mesh. Behind remains preferred whenever there is enough space.
    if (distance(target, goal) < 1.2) {
      let score = distance(target, goal);
      for (const turn of [-Math.PI/4, Math.PI/4, -Math.PI/2, Math.PI/2]) {
        const alternative = sweep(target, [target[0]+Math.sin(angle+turn)*2, target[1], target[2]+Math.cos(angle+turn)*2], boxes);
        const value = distance(target, alternative) - Math.abs(turn)*.25;
        if (value > score + .15) {goal = alternative;score = value;}
      }
    }
    const candidate = position && distance(position, target) < 8
      ? mix(position, goal, 1 - Math.exp(-8 * dt)) : goal;
    // Recheck the smoothed path: interpolation alone can cut corners through walls.
    const visible = sweep(target, candidate, boxes);
    position = position && clear(position, boxes) && distance(position, target) < 8
      ? sweep(position, visible, boxes) : visible;
    position = sweep(target, position, boxes);
    return {position, target, distance: distance(position, target), obstructed: distance(goal, desired) > .1};
  }};
}

function terrainSnapshot(bot) {
  const pos = bot.entity.position;
  const boxes = [];
  // Unknown terrain is solid. Include fractional collision shapes (stairs/slabs/fences).
  for (let x = Math.floor(pos.x) - 5; x <= Math.floor(pos.x) + 5; x++)
    for (let y = Math.floor(pos.y) - 3; y <= Math.floor(pos.y) + 5; y++)
      for (let z = Math.floor(pos.z) - 5; z <= Math.floor(pos.z) + 5; z++) {
        const block = bot.blockAt(pos.floored().offset(x - Math.floor(pos.x), y - Math.floor(pos.y), z - Math.floor(pos.z)));
        const shapes = block ? (block.shapes ?? (block.boundingBox === 'block' ? [[0,0,0,1,1,1]] : [])) : [[0,0,0,1,1,1]];
        for (const s of shapes) boxes.push([s[0]+x,s[1]+y,s[2]+z,s[3]+x,s[4]+y,s[5]+z]);
      }
  return {pos: {x:pos.x,y:pos.y,z:pos.z}, yaw: bot.entity.yaw, boxes};
}

function addFollowCamera(source) {
  const plain = '    if (addMesh) {';
  const minified = 'if(t.y>0&&s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20),h.update(),s=!1),i){';
  const bridge = (camera, controls) => `window.__followBridge={camera:${camera},controls:${controls}};${controls}.enabled=false;${camera}.near=.05;${camera}.updateProjectionMatrix();`;
  if (source.split(minified).length === 2) return source.replace(minified, bridge('u.camera','h') + 's=false;if(i){');
  if (source.includes('firstPositionUpdate') && source.split(plain).length === 2)
    return source.replace(plain, bridge('viewer.camera','controls') + '\n' + plain);
  throw Error('Unsupported Prismarine Viewer follow camera bundle');
}

// Runs before the viewer animation callback so controls.update retains our pose.
function installFollow(factory) {
  const controller = factory();
  let last = performance.now();
  function frame(now) {
    const bridge = window.__followBridge;
    if (bridge && window.__followState) {
      const pose = controller.step(window.__followState, (now-last)/1000);
      bridge.controls.target.set(...pose.target);
      bridge.camera.position.set(...pose.position);
      bridge.camera.lookAt(...pose.target);
      window.__followTelemetry = {
        updates:(window.__followTelemetry?.updates ?? 0)+1,
        obstructedFrames:(window.__followTelemetry?.obstructedFrames ?? 0)+(pose.obstructed ? 1 : 0),
        minimumDistance:Math.min(window.__followTelemetry?.minimumDistance ?? Infinity, pose.distance),
        ...pose
      };
    }
    last = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
module.exports = {createFollowController, terrainSnapshot, addFollowCamera, installFollow};
