// Regenerates the production wallpaper HTML from the scene engine + prod-boot layer.
//
//   engine-source.html  (canonical scene engine + live demo UI)
//        +  prod-boot.js (real clock, auto weather, units, scene/photo config, pause)
//        ->  ../src/wallpaper.html   (standalone Electron renderer)
//        ->  ../lively/index.html    (Lively wallpaper)
//
// Run:  node tools/build-wallpaper.js   (from repo root, or from tools/)
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const ROOT = path.join(HERE, '..');

let html = fs.readFileSync(path.join(HERE, 'engine-source.html'), 'utf8');
const prod = fs.readFileSync(path.join(HERE, 'prod-boot.js'), 'utf8');

// 1) Hide the demo control panel + title (this is a wallpaper).
html = html.replace('</style>',
  '  /* production: hide interactive demo chrome */\n  .panel{display:none!important;} .title{display:none!important;}\n</style>');

// 2) Pause guard inside the draw loop (Electron/Lively pause to save resources).
html = html.replace(
  'function draw(now){\n  const dt=Math.min(40, now-t0); t0=now;',
  'function draw(now){\n  if(window.__lwPaused){ t0=now; setTimeout(function(){requestAnimationFrame(draw);},250); return; }\n  const dt=Math.min(40, now-t0); t0=now;'
);

// 3) Inject the production boot script just before </body>.
html = html.replace('</body>', '<script>\n' + prod + '\n</script>\n</body>');

// sanity checks
if (html.indexOf('__lwPaused') === -1) throw new Error('pause guard injection failed');
if (html.indexOf('.panel{display:none') === -1) throw new Error('panel hide injection failed');
if (html.indexOf('livelyPropertyListener') === -1) throw new Error('prod boot injection failed');

fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'lively'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src', 'wallpaper.html'), html);
fs.writeFileSync(path.join(ROOT, 'lively', 'index.html'), html);
console.log('Generated wallpaper.html (' + html.length + ' bytes) -> src/ and lively/');
