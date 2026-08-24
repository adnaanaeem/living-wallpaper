# tools/ — dev & asset pipeline

The **scene engine** lives in `engine-source.html`. It's also a **standalone live
preview** — open it directly in a browser to scrub the day, switch scenes, toggle rain,
and test weather. All visual/scene work happens here.

`prod-boot.js` is the production layer bolted on top of the engine for the shipped
wallpaper (real system clock, IP-based auto weather, unit/scene/photo config, Lively +
Electron bridges, pause hooks).

## Regenerate the wallpaper after editing the engine
```bash
node tools/build-wallpaper.js
```
This injects `prod-boot.js` into `engine-source.html` and writes both
`../src/wallpaper.html` (Electron) and `../lively/index.html` (Lively). **Always run this
after editing `engine-source.html` or `prod-boot.js`** — the two output files are
generated, not edited by hand.

## Regenerate art (optional — needs its own deps)
```bash
cd tools
npm install                 # @napi-rs/canvas, png-to-ico, gif-encoder-2
node gen-assets.js          # ../assets/icon.ico, icon-256.png, tray.png + lively thumbnail
node gen-scene-thumbs.js    # ../assets/scenes/*.jpg  (settings picker thumbnails)
node gen-preview.js         # ../lively/preview.gif   (animated library tile)
node render-scenes.js       # ./scene-*.png           (full-size scene previews to eyeball)
```

## Add a new scene (quick guide)
In `engine-source.html`:
1. Add `buildYourScene()` (seeded geometry) and call it inside `buildScenes()`.
2. Add `drawYourScene(sky,sun,moon,night,rainK,snowCover,heat)`.
3. Add a branch in `drawLandscape()` for your scene id.
4. Add the id to `SCENE_LIST` in `prod-boot.js`, the Lively `scene` dropdown
   (`../lively/LivelyProperties.json`), and the settings picker (`../src/settings.html`
   + thumbnail in `gen-scene-thumbs.js`).
5. `node tools/build-wallpaper.js` to regenerate.
