// Dress players as their roster characters (characters/roster.json) in every camera.
//
// Prismarine Viewer draws every player with one shared steve.png and a black
// username sprite. The server is vanilla offline-mode, so there are no skins to
// fetch: the cameras are the only place a skin is ever seen. We therefore patch
// the viewer bundle at two pinned anchors (same approach as the follow and
// observer cameras) to hand each new player mesh to window.__emergentDress, which
// swaps in the character's skin and a readable nametag keyed by username.
const {readFileSync} = require('node:fs');

/** EMERGENCE_CAST JSON → {username: {label, accent, skin: data URL}}; usernames lower-cased. */
function loadCast(json) {
  if (!json) return null;
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  const cast = {};
  for (const [username, member] of Object.entries(raw)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(member.accent ?? '')) throw Error(`Cast ${username}: accent must be #rrggbb`);
    const png = readFileSync(member.skin);
    cast[username.toLowerCase()] = {
      name: member.name, family: member.family, label: member.label || member.name || username, accent: member.accent,
      skin: 'data:image/png;base64,' + png.toString('base64')
    };
  }
  return Object.keys(cast).length ? cast : null;
}

// Minified anchors in the pinned prismarine-viewer 1.33 public/index.js bundle.
// Other entities: right after `new Entity(...)` in getEntityMesh, before the
// default black username sprite. Own player: where the third-person bot mesh is made.
const ENTITY = 'const i=new a("1.16.4",t.name,e);if(void 0!==t.username){';
const SELF = 'e||(e=new a("1.16.4","player",u.scene).mesh,u.scene.add(e))';

function addCast(source) {
  if (source.split(ENTITY).length !== 2 || source.split(SELF).length !== 2)
    throw Error('Unsupported Prismarine Viewer bundle: character skins cannot be applied');
  return source
    .replace(ENTITY, 'const i=new a("1.16.4",t.name,e);if(void 0!==t.username&&window.__emergentDress?.(i.mesh,t.username,t.height))return i.mesh;if(void 0!==t.username){')
    .replace(SELF, 'e||(e=new a("1.16.4","player",u.scene).mesh,window.__emergentDress?.(e,window.__emergentSelf,1.8),u.scene.add(e))');
}

// Runs in the page before the bundle. Uses the bundle's global THREE lazily.
function installCast(cast, self) {
  window.__emergentSelf = self;
  window.__emergentCastTelemetry = {dressed: []};
  const textures = {};
  function skin(member) {
    if (!textures[member.skin]) {
      const t = new THREE.TextureLoader().load(member.skin);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.flipY = false;
      textures[member.skin] = t;
    }
    return textures[member.skin];
  }
  function nametag(member) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 60px system-ui, sans-serif';
    const width = Math.min(500, ctx.measureText(member.label).width + 56);
    const x = (512 - width) / 2;
    ctx.fillStyle = 'rgba(15, 15, 15, 0.78)';
    ctx.beginPath();
    ctx.roundRect(x, 14, width, 100, 22);
    ctx.fill();
    ctx.fillStyle = member.accent;
    ctx.fillRect(x + 18, 32, 8, 64);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(member.label, x + 38, 66, width - 50);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, depthTest: false, transparent: true}));
    sprite.renderOrder = 10;
    sprite.scale.set(2.4, 0.6, 1);
    return sprite;
  }
  // Returns true when the mesh is dressed, so the bundle skips its default sprite.
  window.__emergentDress = (mesh, username, height) => {
    const member = cast[String(username ?? '').toLowerCase()];
    if (!member || typeof THREE === 'undefined') return false;
    mesh.traverse(child => {
      if (child.isSkinnedMesh && child.material) {
        child.material.map = skin(member);
        child.material.needsUpdate = true;
      }
    });
    const tag = nametag(member);
    tag.position.y = (height || 1.8) + 0.55;
    mesh.add(tag);
    window.__emergentCastTelemetry.dressed.push(username);
    return true;
  };
}

/** Camera overlay naming whose seat this recording is (top right). */
function castBadge(member, scale) {
  const badge = document.createElement('div');
  badge.id = 'emergent-character';
  Object.assign(badge.style, {
    position: 'fixed', top: '18px', right: '18px', zIndex: '2147483647', pointerEvents: 'none',
    display: 'flex', alignItems: 'center', gap: '10px', color: '#fff',
    background: 'rgba(15, 15, 15, 0.84)', borderLeft: `6px solid ${member.accent}`,
    borderRadius: '10px', padding: '9px 16px 9px 12px', fontFamily: 'system-ui, sans-serif',
    transform: `scale(${scale})`, transformOrigin: 'top right', boxShadow: '0 3px 16px rgba(0, 0, 0, .35)'
  });
  const name = document.createElement('span');
  name.textContent = member.name;
  Object.assign(name.style, {fontSize: '22px', fontWeight: '700'});
  const family = document.createElement('span');
  family.textContent = member.family;
  Object.assign(family.style, {fontSize: '15px', letterSpacing: '2px', textTransform: 'uppercase', color: member.accent});
  badge.append(name, family);
  document.body.appendChild(badge);
}

module.exports = {loadCast, addCast, installCast, castBadge, ENTITY, SELF};
