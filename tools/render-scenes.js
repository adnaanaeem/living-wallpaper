// Render each illustrated scene to a PNG using the REAL engine + a real canvas.
const fs=require('fs');
const { createCanvas } = require('@napi-rs/canvas');
const html=fs.readFileSync(require('path').join(__dirname,'engine-source.html'),'utf8');
const engine=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');

const Wd=1280, Hd=720;
const real=createCanvas(Wd,Hd);
const realCtx=real.getContext('2d');

global.performance={now:()=>1234};
global.requestAnimationFrame=()=>{};         // we'll drive draw() manually
global.setTimeout=()=>0; global.setInterval=()=>0;
global.fetch=()=>new Promise(()=>{});
global.Image=class{ set src(v){} };
global.navigator={}; global.Date=Date;
global.CustomEvent=class{constructor(n,o){this.type=n;this.detail=o&&o.detail}};
const store={};
function mkEl(id){ return {id,addEventListener:()=>{},classList:{toggle:()=>{},remove:()=>{},add:()=>{}},style:{},
  getContext:()=>realCtx, clientWidth:Wd, clientHeight:Hd, width:Wd, height:Hd, textContent:'', innerHTML:'', value:'mountains', appendChild:()=>{} }; }
global.window={addEventListener:()=>{},dispatchEvent:()=>{},devicePixelRatio:1,innerWidth:Wd,innerHeight:Hd};
global.document={ getElementById:id=>store[id]||(store[id]=mkEl(id)), createElement:()=>mkEl('x'),
  body:{appendChild:()=>{}}, documentElement:{clientWidth:Wd,clientHeight:Hd}, querySelectorAll:()=>[] };
store['c']=mkEl('c'); store['c'].getContext=()=>realCtx;

// Expose setters from INSIDE the engine scope (SCENE/minutes/etc are let-scoped).
const api = '\n;globalThis.__api={setScene:function(s){SCENE=s;},setMin:function(m){minutes=m;},'
  + 'setTemp:function(t){temperature=t;},setRain:function(b){rainOn=b;rainLevel=b?0.9:0;},frame:function(){draw(16);}};';
eval(engine + api);

const shots=[
  { scene:'mountains', min:1110, name:'scene-mountains.png' }, // sunset
  { scene:'city',      min:1290, name:'scene-city.png' },      // night (lit windows)
  { scene:'beach',     min:600,  name:'scene-beach.png' },     // morning
  { scene:'desert',    min:1080, name:'scene-desert.png' }     // golden hour
];
for(const s of shots){
  globalThis.__api.setScene(s.scene);
  globalThis.__api.setMin(s.min);
  globalThis.__api.setTemp(22);
  globalThis.__api.setRain(false);
  globalThis.__api.frame(); globalThis.__api.frame();
  fs.writeFileSync(require('path').join(__dirname,s.name), real.toBuffer('image/png'));
  console.log('rendered', s.name);
}
