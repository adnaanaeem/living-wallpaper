// Generates app icon set + Lively thumbnail/preview from a rendered scene.
const { createCanvas } = require('@napi-rs/canvas');
const _p2i = require('png-to-ico');
const pngToIco = typeof _p2i === 'function' ? _p2i : _p2i.default;
const fs = require('fs');
const path = require('path');
const OUT = require('path').join(__dirname,'..');
fs.mkdirSync(path.join(OUT,'assets'), {recursive:true});

function lerp(a,b,t){return a+(b-a)*t;}
function mix(c1,c2,t){return [lerp(c1[0],c2[0],t),lerp(c1[1],c2[1],t),lerp(c1[2],c2[2],t)];}
function rgb(c){return `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;}

// A compact sunset scene used for both the icon and the thumbnail.
function scene(ctx,W,H,round){
  if(round){ ctx.save(); ctx.beginPath(); ctx.arc(W/2,H/2,Math.min(W,H)/2,0,Math.PI*2); ctx.clip(); }
  // sky
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, rgb([52,74,148]));
  g.addColorStop(0.55, rgb([220,138,108]));
  g.addColorStop(1, rgb([255,150,78]));
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  // sun glow
  const sx=W*0.5, sy=H*0.62, r=Math.min(W,H)*0.5;
  const gl=ctx.createRadialGradient(sx,sy,0,sx,sy,r);
  gl.addColorStop(0,'rgba(255,220,150,0.95)');
  gl.addColorStop(0.35,'rgba(255,170,90,0.5)');
  gl.addColorStop(1,'rgba(255,150,80,0)');
  ctx.fillStyle=gl; ctx.fillRect(0,0,W,H);
  // sun disc
  ctx.beginPath(); ctx.arc(sx,sy,Math.min(W,H)*0.13,0,Math.PI*2);
  ctx.fillStyle=rgb([255,238,200]); ctx.fill();
  // mountains
  function ridge(baseY,amp,col){
    ctx.beginPath(); ctx.moveTo(0,H);
    for(let x=0;x<=W;x+=Math.max(2,W/40)){
      const y=baseY+Math.sin(x/W*Math.PI*2+amp)*amp*0.5+Math.sin(x/W*Math.PI*5)*amp*0.2;
      ctx.lineTo(x,y);
    }
    ctx.lineTo(W,H); ctx.closePath(); ctx.fillStyle=col; ctx.fill();
  }
  ridge(H*0.66, H*0.12, rgb(mix([220,138,108],[60,60,90],0.5)));
  ridge(H*0.74, H*0.14, rgb([40,42,70]));
  ridge(H*0.82, H*0.12, rgb([22,24,44]));
  if(round){ ctx.restore();
    // subtle ring
    ctx.beginPath(); ctx.arc(W/2,H/2,Math.min(W,H)/2-1,0,Math.PI*2);
    ctx.lineWidth=Math.max(2,W*0.02); ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.stroke();
  }
}

// ---- icon PNGs ----
const sizes=[256,128,64,48,32,16];
const pngs={};
for(const s of sizes){
  const c=createCanvas(s,s), ctx=c.getContext('2d');
  scene(ctx,s,s,true);
  const buf=c.toBuffer('image/png');
  pngs[s]=buf;
  if(s===256) fs.writeFileSync(path.join(OUT,'assets','icon-256.png'), buf);
}
// tray icon (square, non-round, crisp small)
{
  const s=32, c=createCanvas(s,s), ctx=c.getContext('2d');
  scene(ctx,s,s,true);
  fs.writeFileSync(path.join(OUT,'assets','tray.png'), c.toBuffer('image/png'));
}

// ---- icon.ico (multi-size) ----
pngToIco(sizes.map(s=>pngs[s])).then(ico=>{
  fs.writeFileSync(path.join(OUT,'assets','icon.ico'), ico);

  // ---- Lively thumbnail (16:9) ----
  const tw=480, th=270, tc=createCanvas(tw,th), tctx=tc.getContext('2d');
  scene(tctx,tw,th,false);
  // JPEG for Lively thumbnail
  const jpg=tc.toBuffer('image/jpeg', 90);
  fs.writeFileSync(path.join(OUT,'lively','thumbnail.jpg'), jpg);
  // reuse the same still as a 1-frame preview.gif substitute -> Lively accepts jpg preview too
  fs.writeFileSync(path.join(OUT,'lively','preview.jpg'), jpg);
  console.log('Assets written: icon.ico, icon-256.png, tray.png, lively/thumbnail.jpg, lively/preview.jpg');
}).catch(e=>{ console.error('ICO error:', e.message); process.exit(1); });
