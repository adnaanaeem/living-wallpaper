// Regenerates the production wallpaper HTML from the scene engine + prod-boot layer.
//
//   engine-source.html  (canonical scene engine + live demo UI)
//        +  prod-boot.js (real clock, auto weather, units, scene/photo config, pause)
//        ->  ../src/wallpaper.html   (standalone Electron renderer)
//        ->  ../lively/index.html    (Lively wallpaper)
//        ->  ../src/preview.html     (interactive preview window, opened from the tray)
//        ->  ../docs/index.html      (public live demo, served by GitHub Pages)
//
// Run:  node tools/build-wallpaper.js   (from repo root, or from tools/)
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const ROOT = path.join(HERE, '..');

const engineSrc = fs.readFileSync(path.join(HERE, 'engine-source.html'), 'utf8');
let html = engineSrc;
const prod = fs.readFileSync(path.join(HERE, 'prod-boot.js'), 'utf8');

// 0) Preview window: the engine's own demo panel (seek bar, temp slider, scene
// picker, rain toggle) is already the interactive preview end users want — ship
// it as-is, just retitled so it doesn't read like a dev tool.
const previewHtml = engineSrc.replace(
  '<title>Living Wallpaper — Day Cycle Demo</title>',
  '<title>Living Wallpaper — Preview</title>'
);
if (previewHtml === engineSrc) throw new Error('preview title replacement failed');
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src', 'preview.html'), previewHtml);
console.log('Generated preview.html (' + previewHtml.length + ' bytes) -> src/');

// 0.5) Public live demo (GitHub Pages): same panel, retitled, plus a small
// link back to the repo since visitors may land here from search/shares.
const demoHtml = engineSrc
  .replace('<title>Living Wallpaper — Day Cycle Demo</title>', '<title>Living Wallpaper — Live Demo</title>')
  .replace(
    '<div class="title">\n  <h1>Living Wallpaper</h1>\n  <p>One scene · sunrise → noon → sunset → night · live rain</p>\n</div>',
    '<div class="title">\n  <h1>Living Wallpaper</h1>\n  <p>One scene · sunrise → noon → sunset → night · live rain</p>\n  ' +
    '<p style="margin-top:4px"><a href="https://github.com/adnaanaeem/living-wallpaper" target="_blank" rel="noopener" ' +
    'style="color:#9db4e0;text-decoration:none">★ View on GitHub / Download ↗</a></p>\n</div>'
  );
if (demoHtml === engineSrc) throw new Error('docs demo html replacement failed');
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), demoHtml);
console.log('Generated docs/index.html (' + demoHtml.length + ' bytes) for GitHub Pages');

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
