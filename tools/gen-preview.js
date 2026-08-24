// Renders a looping day-cycle GIF for the Lively library tile.
const { createCanvas } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const fs = require('fs');
const path = require('path');
const OUT = require('path').join(__dirname,'..','lively');

const W = 480, H = 270;

function lerp(a,b,t){return a+(b-a)*t;}
function mix(c1,c2,t){return [lerp(c1[0],c2[0],t),lerp(c1[1],c2[1],t),lerp(c1[2],c2[2],t)];}
function rgb(c){return `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;}
function rgba(c,a){return `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;}
function clamp(v,a,b){return v<a?a:v>b?b:v;}

// Sky keyframes: [top, mid, horizon]
const KEYS = [
  { t:0,    top:[6,10,26],   mid:[12,17,40],   hor:[22,26,52] },
  { t:300,  top:[14,20,48],  mid:[34,38,74],   hor:[70,60,96] },
  { t:375,  top:[70,110,182],mid:[190,168,178],hor:[255,180,110] },
  { t:435,  top:[86,140,208],mid:[170,200,232],hor:[248,220,178] },
  { t:720,  top:[48,120,224],mid:[120,186,242],hor:[196,226,246] },
  { t:1080, top:[70,108,190],mid:[204,168,150],hor:[252,196,120] },
  { t:1125, top:[52,74,148], mid:[220,138,108],hor:[255,150,78] },
  { t:1170, top:[36,44,102], mid:[150,86,116], hor:[214,104,86] },
  { t:1260, top:[18,24,60],  mid:[54,44,90],   hor:[92,58,92] },
  { t:1440, top:[6,10,26],   mid:[12,17,40],   hor:[22,26,52] }
];
function skyAt(m){
  let a=KEYS[0], b=KEYS[KEYS.length-1];
  for(let i=0;i<KEYS.length-1;i++){ if(m>=KEYS[i].t&&m<=KEYS[i+1].t){a=KEYS[i];b=KEYS[i+1];break;} }
  const t=(m-a.t)/((b.t-a.t)||1);
  return { top:mix(a.top,b.top,t), mid:mix(a.mid,b.mid,t), hor:mix(a.hor,b.hor,t) };
}
const HOR = H*0.66;
function sun(m){ const rise=360,set=1125,up=m>=rise&&m<=set,fr=(m-rise)/(set-rise),an=Math.PI*fr;
  return {up,x:W*0.1+Math.cos(Math.PI-an)*W*0.8,y:HOR+H*0.04-Math.sin(an)*H*0.6,alt:Math.sin(an)}; }
function moon(m){ let mm=m; if(mm<360)mm+=1440; const rise=1125,set=1800,up=mm>=rise&&mm<=set,fr=(mm-rise)/(set-rise),an=Math.PI*fr;
  return {up,x:W*0.14+Math.cos(Math.PI-an)*W*0.74,y:HOR+H*0.02-Math.sin(an)*H*0.56,alt:Math.sin(an)}; }

// static stars + ridges
const stars=[]; for(let i=0;i<90;i++) stars.push({x:Math.random()*W,y:Math.random()*HOR*0.95,r:Math.random()*1.2+0.3});
function ridge(seed,baseY,amp){ const p=[]; for(let x=0;x<=W;x+=6){ const y=baseY+Math.sin(x*0.02+seed)*amp*0.5+Math.sin(x*0.05+seed*2)*amp*0.25; p.push([x,y]); } return p; }
const R=[ {p:ridge(1.3,HOR-H*0.10,H*0.10),d:0.82}, {p:ridge(4.7,HOR-H*0.05,H*0.13),d:0.55}, {p:ridge(8.1,HOR-0,H*0.16),d:0.30} ];

function frame(ctx,m){
  const s=skyAt(m);
  const g=ctx.createLinearGradient(0,0,0,HOR);
  g.addColorStop(0,rgb(s.top)); g.addColorStop(0.55,rgb(s.mid)); g.addColorStop(1,rgb(s.hor));
  ctx.fillStyle=g; ctx.fillRect(0,0,W,HOR+2);
  const su=sun(m), mo=moon(m), night=1-clamp(su.alt*1.5,0,1);
  // stars
  const sa=clamp((night-0.32)*1.6,0,1);
  if(sa>0.02){ for(const st of stars){ ctx.fillStyle=rgba([255,250,236],sa*0.9); ctx.beginPath(); ctx.arc(st.x,st.y,st.r,0,Math.PI*2); ctx.fill(); } }
  // horizon glow
  const gs = su.alt>-0.1?su:(mo.alt>-0.1?mo:null);
  if(gs){ const warm=su.alt>-0.1?mix([255,230,180],[255,140,70],1-clamp(su.alt,0,1)):[150,170,210];
    const st=su.alt>-0.1?(0.5*(1-su.alt)+0.15):0.14; const gg=ctx.createRadialGradient(gs.x,HOR,0,gs.x,HOR,W*0.6);
    gg.addColorStop(0,rgba(warm,st)); gg.addColorStop(1,rgba(warm,0)); ctx.fillStyle=gg; ctx.fillRect(0,0,W,HOR+2); }
  // sun
  if(su.up&&su.alt>-0.05){ const low=1-clamp(su.alt,0,1),warm=mix([255,252,236],[255,138,66],low);
    const gl=ctx.createRadialGradient(su.x,su.y,0,su.x,su.y,Math.min(W,H)*(0.3+low*0.35));
    gl.addColorStop(0,rgba(warm,0.55)); gl.addColorStop(0.35,rgba(warm,0.18)); gl.addColorStop(1,rgba(warm,0));
    ctx.fillStyle=gl; ctx.fillRect(0,0,W,HOR+30);
    ctx.beginPath(); ctx.arc(su.x,su.y,Math.min(W,H)*(0.035+low*0.03),0,Math.PI*2); ctx.fillStyle=rgb(warm); ctx.fill(); }
  // moon
  if(mo.up&&mo.alt>-0.05){ const mr=Math.min(W,H)*0.032;
    const gl=ctx.createRadialGradient(mo.x,mo.y,0,mo.x,mo.y,mr*7); gl.addColorStop(0,rgba([214,226,255],0.3)); gl.addColorStop(1,rgba([214,226,255],0));
    ctx.fillStyle=gl; ctx.fillRect(0,0,W,HOR+30);
    ctx.beginPath(); ctx.arc(mo.x,mo.y,mr,0,Math.PI*2); ctx.fillStyle=rgb([238,242,252]); ctx.fill();
    ctx.beginPath(); ctx.arc(mo.x+mr*0.4,mo.y-mr*0.22,mr*0.92,0,Math.PI*2); ctx.fillStyle=rgb(s.top); ctx.fill(); }
  // mountains
  for(const r of R){ let col=mix([18,24,44],s.hor,r.d*0.55); col=mix(col,s.mid,r.d*0.25);
    ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(r.p[0][0],r.p[0][1]); for(const q of r.p) ctx.lineTo(q[0],q[1]); ctx.lineTo(W,H); ctx.closePath(); ctx.fillStyle=rgb(col); ctx.fill(); }
  // water
  const wy=HOR; const wg=ctx.createLinearGradient(0,wy,0,H); wg.addColorStop(0,rgb(mix(s.hor,s.mid,0.3))); wg.addColorStop(1,rgb([8,14,30]));
  ctx.fillStyle=wg; ctx.fillRect(0,wy,W,H-wy);
  if(gs&&gs.y<wy){ ctx.fillStyle=rgba(su.up?[255,220,150]:[200,215,255],0.35*(su.alt>0?su.alt:0.3)); ctx.fillRect(gs.x-6,wy,12,H-wy); }
  // vignette
  const vg=ctx.createRadialGradient(W/2,H*0.5,H*0.3,W/2,H*0.5,H*0.9); vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,0.28)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
}

const enc = new GIFEncoder(W,H,'neuquant',true);
enc.setDelay(110); enc.setRepeat(0); enc.setQuality(10); enc.start();
const canvas = createCanvas(W,H), ctx = canvas.getContext('2d');
const N = 36;
for(let i=0;i<N;i++){
  const m = (i/N)*1440;
  frame(ctx,m);
  enc.addFrame(ctx);
}
enc.finish();
fs.writeFileSync(path.join(OUT,'preview.gif'), enc.out.getData());
console.log('preview.gif written:', fs.statSync(path.join(OUT,'preview.gif')).size, 'bytes,', N, 'frames');
