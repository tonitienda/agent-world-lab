// Patch the specific Prismarine Viewer third-person position handler.
// Upstream lib/index.js sets the OrbitControls target only at spawn.
// The browserified index.js bundle preserves this anchor in our pinned viewer.
// Fail loudly if it ever changes: silently recording an empty field is worse.
function addObserverFollow(source) {
  const anchor = '    if (addMesh) {';
  // CI / published prismarine-viewer bundles are minified by webpack.
  // Match the observed camera initialization exactly; keep the transform
  // anchored to the position handler rather than injecting into arbitrary JS.
  const minified = 'if(t.y>0&&s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20),h.update(),s=!1),i){';
  if (source.includes(minified)) {
    const followed = 'if(t.y>0&&s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20),h.update(),s=!1),h&&!s&&(u.camera.position.x+=t.x-h.target.x,u.camera.position.y+=t.y-h.target.y,u.camera.position.z+=t.z-h.target.z,h.target.set(t.x,t.y,t.z),h.update(),window.__emergentObserverFollow={updates:(window.__emergentObserverFollow?.updates||0)+1,target:{x:t.x,y:t.y,z:t.z}}),i){';
    return source.replace(minified, followed);
  }
  const occurrences = source.split(anchor).length - 1;
  if (occurrences !== 1 || !source.includes('firstPositionUpdate')) {
    const at=source.indexOf('addMesh');
    throw new Error('Unsupported Prismarine Viewer browser bundle: ' + JSON.stringify({
      length: source.length, markers: occurrences,
      firstPositionUpdate: source.includes('firstPositionUpdate'),
      aroundAddMesh: at<0?'absent':source.slice(Math.max(0,at-350),at+450),
      head: source.slice(0,160)
    }));
  }
  return source.replace(anchor, `    // Emergent recorder: translate the camera and its target together as the bot moves.
    // Retain camera orbit angle and zoom, and do not interfere with first-person mode.
    if (controls && !firstPositionUpdate) {
      const dx = pos.x - controls.target.x
      const dy = pos.y - controls.target.y
      const dz = pos.z - controls.target.z
      if (Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dz)) {
        controls.target.set(pos.x, pos.y, pos.z)
        viewer.camera.position.x += dx
        viewer.camera.position.y += dy
        viewer.camera.position.z += dz
        controls.update()
        window.__emergentObserverFollow = {updates: (window.__emergentObserverFollow?.updates || 0) + 1, target: {x: pos.x, y: pos.y, z: pos.z}}
      }
    }
${anchor}`);
}
module.exports = {addObserverFollow};
