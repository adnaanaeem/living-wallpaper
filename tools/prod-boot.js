/* ============================================================
   Living Wallpaper — production boot layer
   Runs on top of the validated scene engine. Drives real time,
   auto weather (IP -> Open-Meteo), units, photo & HUD config,
   and pause hooks. Works in Electron (window.LW_CONFIG injected)
   and in Lively Wallpaper (livelyPropertyListener).
   ============================================================ */
(function(){
  var DEFAULTS = {
    units:   { temp:'C', wind:'kmh' },  // 'C'|'F' , 'kmh'|'mph'
    clock:   '12',                       // '12' or '24' hour clock
    clockStyle: 'digital',               // 'digital' or 'analog'
    scene:   'mountains',                // mountains|city|beach|desert|forest|aurora|village|waterfall|rotate|random
    showHud: true,
    hudPosition: 'top-right',            // top-right|top-left|bottom-right|bottom-left
    photo:   null,                       // file:// URL or null
    location:null,                       // {lat,lon,name} or null -> auto (IP)
    theme:   'auto',
    sound:   false                       // ambient rain/wind/cricket audio, off by default
  };
  var CONFIG = Object.assign({}, DEFAULTS, (typeof window!=='undefined' && window.LW_CONFIG) || {});
  window.__lwPaused = false;

  // ---- clock format (12h / 24h) — override the engine's fmt() ----
  if(typeof fmt === 'function'){
    fmt = function(m){
      m = ((m % 1440) + 1440) % 1440;
      var h = Math.floor(m / 60), mn = Math.floor(m % 60);
      var mm = (mn < 10 ? '0' : '') + mn;
      if((CONFIG.clock || '12') === '24'){
        return (h < 10 ? '0' : '') + h + ':' + mm;
      }
      var ap = h < 12 ? 'AM' : 'PM';
      var h12 = h % 12; if(h12 === 0) h12 = 12;
      return h12 + ':' + mm + ' ' + ap;
    };
  }

  // ---- unit conversions layered over the engine's metric HUD ----
  function cToF(c){ return c*9/5+32; }
  function kmhToMph(k){ return k*0.621371; }
  function mmToIn(m){ return m/25.4; }
  function applyUnits(){
    try{
      var u = CONFIG.units || DEFAULTS.units;
      if(u.temp==='F'){
        hudTemp.textContent = Math.round(cToF(temperature))+'°';
        hudFeels.textContent = Math.round(cToF(liveWeather? (liveWeather.feels!=null?liveWeather.feels:temperature) : temperature))+'°';
      }
      if(liveWeather){
        if(u.wind==='mph' && liveWeather.wind!=null)
          hudWind.textContent = Math.round(kmhToMph(liveWeather.wind))+' mph '+compass(liveWeather.windDir);
        if(liveWeather.precip!=null)
          hudPrec.textContent = (u.temp==='F')
            ? mmToIn(liveWeather.precip).toFixed(2)+' in'
            : liveWeather.precip+' mm';
      }
    }catch(e){}
  }
  // wrap the engine HUD so unit formatting always re-applies
  if(typeof updateHUD==='function'){
    var _origHUD = updateHUD;
    updateHUD = function(){ _origHUD(); applyUnits(); };
  }

  // ---- real system time drives the scene ----
  function tick(){
    var d = new Date();
    minutes = d.getHours()*60 + d.getMinutes() + d.getSeconds()/60;
    syncUI();
  }

  // ---- auto weather: IP geolocation (no key) -> Open-Meteo ----
  async function resolveLocation(){
    if(CONFIG.location && CONFIG.location.lat!=null){
      return { lat:CONFIG.location.lat, lon:CONFIG.location.lon, name:CONFIG.location.name||'My location' };
    }
    try{
      var g = await fetch('https://ipwho.is/').then(function(r){return r.json();});
      if(g && g.success!==false && g.latitude!=null){
        return { lat:g.latitude, lon:g.longitude, name:(g.city?g.city+', ':'')+(g.country_code||'') };
      }
    }catch(e){}
    return null;
  }
  async function refreshWeather(){
    try{
      var loc = await resolveLocation();
      if(!loc) return;
      if(typeof calcSunTimes === 'function'){
        var st = calcSunTimes(loc.lat, loc.lon, new Date());
        if(st) setSunTimes(st.riseMin, st.setMin);
      }
      var url = 'https://api.open-meteo.com/v1/forecast?latitude='+loc.lat.toFixed(3)
        +'&longitude='+loc.lon.toFixed(3)
        +'&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover&timezone=auto';
      var j = await fetch(url).then(function(r){return r.json();});
      var cur = j.current || {};
      var code = cur.weather_code, precip = cur.precipitation||0, temp = cur.temperature_2m;
      var raining = precip>0 || (code>=51 && code<=99);
      liveWeather = {
        rain: raining? Math.min(1, 0.5+precip*0.2) : 0,
        code: code, place: loc.name, condition: describe(code), precip: precip,
        feels: cur.apparent_temperature, humidity: cur.relative_humidity_2m,
        wind: cur.wind_speed_10m, windDir: cur.wind_direction_10m,
        cloudCover: cur.cloud_cover,
        text: describe(code)+' · '+temp+'°C · '+precip+'mm'
      };
      if(typeof temp==='number'){ temperature = temp; syncTemp(); }
      if(typeof cur.cloud_cover==='number'){ cloudiness = clamp(cur.cloud_cover/100, 0, 1); }
      updateHUD();
    }catch(e){}
  }

  // ---- small on-screen notice (helps diagnose photo path problems) ----
  function toast(msg){
    var el = document.getElementById('lw-toast');
    if(!el){
      el = document.createElement('div'); el.id = 'lw-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);'
        + 'background:rgba(18,24,38,0.9);color:#fff;padding:10px 14px;border-radius:12px;'
        + 'font:13px -apple-system,Segoe UI,Roboto,sans-serif;z-index:99999;max-width:82%;'
        + 'text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.4);';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(el.__t); el.__t = setTimeout(function(){ el.style.display = 'none'; }, 7000);
  }

  // ---- photo background (single, or multi-photo day cross-fade) ----
  function loadSingle(src){
    var img = new Image();
    img.onload = function(){ photoImg = img; photoReady = true; };
    img.onerror = function(){ photoImg = null; photoReady = false;
      toast("Couldn't load image:\n" + src + "\nCheck the path (no quotes) and that the file exists."); };
    img.src = src;
  }
  function loadPhotoSet(arr){
    // arr = ordered file URLs; anchor each to an evenly spaced time of day
    var n = arr.length, loaded = [], failed = 0;
    arr.forEach(function(src, i){
      var img = new Image();
      img.onload = function(){
        loaded.push({ img: img, t: Math.round(i * 1440 / n) });
        loaded.sort(function(a,b){ return a.t - b.t; });
        window.__lwPhotos = loaded.slice();
        photoImg = img; photoReady = true;
      };
      img.onerror = function(){ failed++; if(failed === n) toast("Couldn't load any of the photos — check the paths."); };
      img.src = src;
    });
  }
  function applyPhoto(){
    window.__lwPhotos = null; photoImg = null; photoReady = false;
    if(CONFIG.photos && CONFIG.photos.length > 1){ loadPhotoSet(CONFIG.photos); }
    else if(CONFIG.photos && CONFIG.photos.length === 1){ loadSingle(CONFIG.photos[0]); }
    else if(CONFIG.photo){ loadSingle(CONFIG.photo); }
  }

  // Override the engine's photo renderer to support cross-fading a photo set.
  // Real photos already carry their own lighting, so the day/night grade is
  // applied more gently in multi-photo mode; weather grades + sun bloom stay.
  if(typeof drawPhotoScene === 'function'){
    drawPhotoScene = function(sky, sun, moon, night, rainK, cold, heat){
      var set = window.__lwPhotos, multi = set && set.length > 1;
      if(multi){
        var m = ((minutes % 1440) + 1440) % 1440;
        var a = set[set.length-1], b = set[0], frac = 0;
        for(var i=0;i<set.length;i++){
          var cur = set[i], nxt = set[(i+1) % set.length];
          var t0 = cur.t, t1 = nxt.t; if(t1 <= t0) t1 += 1440;
          var mm = (m < t0) ? m + 1440 : m;
          if(mm >= t0 && mm <= t1){ a = cur; b = nxt; frac = (mm - t0) / (t1 - t0); break; }
        }
        ctx.globalAlpha = 1;             coverDraw(a.img);
        ctx.globalAlpha = clamp(frac,0,1); coverDraw(b.img);
        ctx.globalAlpha = 1;
      } else if(photoImg){
        coverDraw(photoImg);
      } else { return; }

      var k = multi ? 0.45 : 1;          // gentler grade over real day/night photos
      var gr = gradeAt(minutes);
      // 1) brightness/temperature (multiply) — softened toward neutral in multi mode
      var mulN = mix([255,255,255], stormy(gr.mul, rainK*0.32), k);
      var mulB = [mulN[0]*0.92, mulN[1]*0.92, mulN[2]*0.92];
      ctx.globalCompositeOperation = 'multiply';
      var g = ctx.createLinearGradient(0,0,0,H);
      g.addColorStop(0, rgb(mulN)); g.addColorStop(1, rgb(mulB));
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
      // 2) golden-hour wash (soft-light)
      ctx.globalCompositeOperation = 'soft-light';
      g = ctx.createLinearGradient(0,0,0,H);
      g.addColorStop(0, rgb(gr.ov, gr.ovA*0.5*k)); g.addColorStop(1, rgb(gr.ov, gr.ovA*k));
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
      if(cold>0.02){ ctx.fillStyle = rgb([120,175,255], cold*0.26); ctx.fillRect(0,0,W,H); }
      if(heat>0.02){ ctx.fillStyle = rgb([255,150,60], heat*0.22); ctx.fillRect(0,0,W,H); }
      // 3) sun / moon light bloom (screen)
      ctx.globalCompositeOperation = 'screen';
      if(sun.up && sun.altitude>-0.05){
        var low = 1 - clamp(sun.altitude,0,1);
        var warm = mix([255,250,235],[255,150,80], low);
        var gl = ctx.createRadialGradient(sun.x,sun.y,0, sun.x,sun.y, Math.min(W,H)*(0.42+low*0.4));
        gl.addColorStop(0, rgb(warm,(0.4+low*0.22)*(1-rainK*0.7)));
        gl.addColorStop(0.4, rgb(warm,0.10*(1-rainK*0.7)));
        gl.addColorStop(1, rgb(warm,0));
        ctx.fillStyle = gl; ctx.fillRect(0,0,W,H);
      } else if(moon.up && moon.altitude>-0.05){
        var gm = ctx.createRadialGradient(moon.x,moon.y,0, moon.x,moon.y, Math.min(W,H)*0.26);
        gm.addColorStop(0, rgb([190,205,240],0.22*(1-rainK*0.6))); gm.addColorStop(1, rgb([190,205,240],0));
        ctx.fillStyle = gm; ctx.fillRect(0,0,W,H);
      }
      ctx.globalCompositeOperation = 'source-over';
    };
  }

  function applyHudVisibility(){
    var hud = document.getElementById('hud');
    if(hud) hud.style.display = CONFIG.showHud ? '' : 'none';
  }

  function applySound(){
    if(typeof Sound !== 'undefined') Sound.setEnabled(!!CONFIG.sound);
  }

  function applyClockStyle(){
    if(typeof setClockStyle === 'function') setClockStyle(CONFIG.clockStyle);
  }

  function applyHudPosition(){
    if(typeof setHudPosition === 'function') setHudPosition(CONFIG.hudPosition);
  }

  // ---- scene selection (SCENE is an engine global) ----
  var SCENE_LIST = ['mountains','city','beach','desert','forest','aurora','village','waterfall'];
  function resolveScene(v){
    if(v === 'random') return SCENE_LIST[Math.floor(Math.random()*SCENE_LIST.length)];
    if(v === 'rotate'){
      var d = new Date();
      var doy = Math.floor((d - new Date(d.getFullYear(),0,0)) / 86400000);
      return SCENE_LIST[doy % SCENE_LIST.length];
    }
    return SCENE_LIST.indexOf(v) >= 0 ? v : 'mountains';
  }
  function applyScene(){ if(typeof SCENE !== 'undefined') SCENE = resolveScene(CONFIG.scene || 'mountains'); }

  // ---- apply a config patch at runtime ----
  function applyConfig(patch){
    var locChanged = patch && ('location' in patch);
    Object.assign(CONFIG, patch||{});
    applyScene();
    applyPhoto();
    applyHudVisibility();
    applyHudPosition();
    applySound();
    applyClockStyle();
    syncUI();       // re-render clock (picks up new format)
    updateHUD();
    if(locChanged) refreshWeather();
  }
  // Electron pushes config updates via this event
  window.addEventListener('lw-config', function(e){ applyConfig(e.detail||{}); });
  // Electron pause/resume
  window.addEventListener('lw-pause',  function(){ window.__lwPaused = true; });
  window.addEventListener('lw-resume', function(){ window.__lwPaused = false; });

  // ---- Lively Wallpaper property bridge ----
  function toFileUrl(p){
    p = String(p || '').trim();
    // Strip wrapping quotes from Windows "Copy as path" and stray whitespace.
    p = p.replace(/^["'“”]+|["'“”]+$/g, '').trim();
    if(!p) return null;
    if(/^(file|https?):/i.test(p)) return p;         // already a URL
    p = p.replace(/\\/g, '/');                       // Windows backslashes -> slashes
    // encode spaces/special chars but keep the drive-colon and slashes
    return 'file:///' + encodeURI(p).replace(/^file:\/{3}/i, '');
  }
  async function geocodeCity(name){
    try{
      var j = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(name)).then(function(r){return r.json();});
      var h = j.results && j.results[0];
      if(h) applyConfig({ location: { lat:h.latitude, lon:h.longitude, name: h.name + (h.country_code ? ', ' + h.country_code : '') } });
    }catch(e){}
  }
  // Lively's folderDropdown returns a RELATIVE path (Chromium loads it same-origin).
  // Keep it relative; only convert to file:// for absolute Windows paths / URLs.
  function photoSrc(v){
    v = String(v == null ? '' : v).trim();
    if(!v || v === 'null') return null;
    if(/^[a-zA-Z]:[\\/]/.test(v) || /^(file|https?):/i.test(v)) return toFileUrl(v); // absolute
    return v.replace(/\\/g, '/');                                                     // relative
  }
  var lastPhotoRel = null, usePhotoBg = false;
  function refreshPhoto(){ applyConfig({ photo: (usePhotoBg && lastPhotoRel) ? photoSrc(lastPhotoRel) : null }); }

  window.livelyPropertyListener = function(name, val){
    if(name==='showHud')       applyConfig({ showHud: !!val });
    else if(name==='units')    applyConfig({ units: (val==='Fahrenheit'||val===1) ? {temp:'F',wind:'mph'} : {temp:'C',wind:'kmh'} });
    else if(name==='clock')    applyConfig({ clock: (val==='24-hour'||val===1) ? '24' : '12' });
    else if(name==='scene'){   var sc=['mountains','city','beach','desert','forest','aurora','village','waterfall','rotate','random']; var si=(typeof val==='number')?val:parseInt(val,10)||0; applyConfig({ scene: sc[si]||'mountains' }); }
    else if(name==='usePhoto'){ usePhotoBg = !!val; refreshPhoto(); }
    else if(name==='photo'){    lastPhotoRel = (val==null ? '' : String(val)).trim() || null; refreshPhoto(); }
    else if(name==='cityName'){ var s=String(val||'').trim(); if(s) geocodeCity(s); else applyConfig({ location:null }); }
    else if(name==='sound')    applyConfig({ sound: !!val });
    else if(name==='clockStyle'){ var cs=['Digital','Analog']; var ci=(typeof val==='number')?val:parseInt(val,10)||0; applyConfig({ clockStyle: (cs[ci]||'Digital').toLowerCase() }); }
    else if(name==='hudPosition'){ var hp=['top-right','top-left','bottom-right','bottom-left']; var hi=(typeof val==='number')?val:parseInt(val,10)||0; applyConfig({ hudPosition: hp[hi]||'top-right' }); }
  };
  // Lively lifecycle (pause when a fullscreen app is focused)
  window.livelyWallpaperPlaybackChanged = function(e){
    try{ var p = (typeof e==='object') ? e.IsPaused : e; window.__lwPaused = !!p; }catch(_){}
  };

  // ---- boot ----
  applyScene();
  applyPhoto();
  applyHudVisibility();
  applyHudPosition();
  applySound();
  applyClockStyle();
  applyUnits();
  tick();
  refreshWeather();
  setInterval(tick, 15000);            // keep clock/scene current
  setInterval(refreshWeather, 600000); // weather every 10 min
})();
