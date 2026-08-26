'use strict';
// Periodically snapshots the live wallpaper scene and sets it as the Windows
// lock screen picture, via the WinRT LockScreen API - the same mechanism
// apps like Bing Wallpaper use to keep a lock screen "fresh" without being a
// Store app. There is no way to make the LOCK SCREEN ITSELF animate: it
// renders on a separate secure desktop that no regular process (this one
// included) can draw into. This only ever updates a static image, on an
// interval.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let timer = null;

function imagePath() {
  return path.join(app.getPath('userData'), 'lockscreen.png');
}
function scriptPath() {
  return path.join(app.getPath('userData'), 'set-lockscreen.ps1');
}

async function snapshotAndSet(win) {
  if (!win || win.isDestroyed()) return;
  try {
    // This snapshot only refreshes on an interval, so a baked-in clock would
    // visibly drift from Windows' own live lock-screen clock between
    // refreshes - hide just the clock for the capture (rest of the weather
    // HUD is fine slightly stale) via the engine's own suppression flag, so
    // there's no race with updateHUD()'s own periodic redraw.
    const hide = "if(typeof setHudClockSuppressed==='function') setHudClockSuppressed(true);";
    const show = "if(typeof setHudClockSuppressed==='function') setHudClockSuppressed(false);";
    await win.webContents.executeJavaScript(hide).catch(() => {});
    const img = await win.webContents.capturePage();
    await win.webContents.executeJavaScript(show).catch(() => {});
    fs.writeFileSync(imagePath(), img.toPNG());
    setWindowsLockScreen(imagePath());
  } catch (e) { console.warn('[lockscreen] snapshot failed:', e.message); }
}

// WinRT has no plain command-line surface, but PowerShell can activate WinRT
// runtime classes directly (`ContentType=WindowsRuntime`), the same trick
// other lightweight Win32 apps use to reach this API without a native
// module. The naive approach of polling a WinRT IAsyncOperation's `.Status`
// property doesn't work here - PowerShell's late binding hands back a bare
// `System.__ComObject` for the generic async interface with no usable
// `.Status`/`.GetResults()` - so this instead uses
// `System.WindowsRuntimeSystemExtensions.AsTask` (reflection, since it's a
// generic method) to convert it into a real, awaitable .NET Task. Written to
// an actual .ps1 file rather than passed as a `-Command`/`-EncodedCommand`
// string, which was unreliable for a script this size in testing.
const PS_TEMPLATE = [
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  '[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime] | Out-Null',
  '',
  '# IAsyncOperation<T> (e.g. GetFileFromPathAsync) comes back from PowerShell',
  '# late-binding as a bare System.__ComObject with no usable .Status /',
  '# .GetResults() - AsTask is a generic method, so it needs reflection to',
  '# invoke for the right T, unlike the plain IAsyncAction overload below.',
  'function Await($WinRtTask, $ResultType) {',
  '  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {',
  "    \$_.Name -eq 'AsTask' -and \$_.GetParameters().Count -eq 1 -and",
  "    \$_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'",
  '  })[0].MakeGenericMethod($ResultType)',
  '  $netTask = $asTask.Invoke($null, @($WinRtTask))',
  '  $netTask.Wait(-1) | Out-Null',
  '  $netTask.Result',
  '}',
  'function AwaitAction($WinRtAction) {',
  '  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {',
  "    \$_.Name -eq 'AsTask' -and \$_.GetParameters().Count -eq 1 -and",
  "    \$_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'",
  '  })[0]',
  '  $netTask = $asTask.Invoke($null, @($WinRtAction))',
  '  $netTask.Wait(-1) | Out-Null',
  '}',
  '',
  '$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:LW_LOCKSCREEN_IMG)) ([Windows.Storage.StorageFile])',
  'AwaitAction ([Windows.System.UserProfile.LockScreen]::SetImageFileAsync($file))'
].join('\r\n');

function ensureScript() {
  // Regenerated on every call - cheap, and keeps it in sync if this file changes.
  fs.writeFileSync(scriptPath(), PS_TEMPLATE, 'utf8');
}

function setWindowsLockScreen(file) {
  ensureScript();
  execFile('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath()],
    { env: Object.assign({}, process.env, { LW_LOCKSCREEN_IMG: file }) },
    (err, stdout, stderr) => {
      if (err) console.warn('[lockscreen] failed to set lock screen image:', (stderr || err.message).trim());
    });
}

function start(getWindow, intervalMs) {
  stop();
  const iv = intervalMs || 30 * 60 * 1000; // 30 min default
  snapshotAndSet(getWindow());
  timer = setInterval(() => snapshotAndSet(getWindow()), iv);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
