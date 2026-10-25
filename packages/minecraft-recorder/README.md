# Experimental native Minecraft recorder

Independent npm package: no root workspaces, no hoisting, and no graphics
packages installed by `npm install` at repository root.

Install only when capturing:
```sh
npm install --prefix packages/minecraft-recorder --no-audit --no-fund
```

The main adapter loads `index.cjs` only when `RECORD_MP4` is present.
Native OpenGL dependencies may still need special system packages and a
compatible Node version. Rendering remains experimental until an MP4 passes CI.
