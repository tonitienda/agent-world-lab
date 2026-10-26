// Patch the specific Prismarine Viewer third-person position handler.
// Upstream lib/index.js sets the OrbitControls target only at spawn.
// The browserified index.js bundle preserves this anchor in our pinned viewer.
// Fail loudly if it ever changes: silently recording an empty field is worse.
function addObserverFollow(source) {
  const anchor = '    if (addMesh) {';
  const occurrences = source.split(anchor).length - 1;
  if (occurrences !== 1 || !source.includes('firstPositionUpdate')) {
    throw new Error('Unsupported Prismarine Viewer browser bundle: observer follow hook not found exactly once');
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
      }
    }
${anchor}`);
}
module.exports = {addObserverFollow};
