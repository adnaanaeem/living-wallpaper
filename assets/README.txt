Add two icon files here before building the installer:

  icon.ico   – app + installer icon (256x256 recommended; multi-size .ico)
  tray.png   – system tray icon (16–32 px PNG, transparent background)

The app runs without them (a tiny placeholder tray icon is used), but a real
icon.ico is recommended for `npm run dist`.

Tip: export a sun/sunset glyph from your favourite editor, or convert a PNG to
.ico at https://icoconvert.com or with ImageMagick:
  magick convert icon-256.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
