// Loaded only when RECORD_MP4 is set. Dependencies are installed locally in
// this package so core tests and Minecraft actions never install native GL.
const { headless } = require("prismarine-viewer");
module.exports = { start(bot, options) { return headless(bot, options); } };
