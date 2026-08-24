const fs=require('fs');
const { createCanvas } = require('@napi-rs/canvas');
const html=fs.readFileSync(require('path').join(__dirname,'engine-source.html'),'utf8');
const engine=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
const Wd=360,Hd=203;
const real=createCanvas(Wd,Hd); const realCtx=real.getContext('2d');
global.performance={now:()=>1234}; global.requestAnimationFrame=()=>{}; global.setTimeout=()=>0; global.setInterval=()=>0;
global.fetch=()=>new Promise(()=>{}); global.Image=class{set src(v){}}; global.navigator={}; global.Date=Date;
global.CustomEvent=class{constructor(n,o){this.type=n;this.detail=o&&o.detail}};
const store={};
function mkEl(id){return {id,addEventListener:()=>{},classList:{toggle:()=>{},remove:()=>{},add:()=>{}},style:{},getContext:()=>realCtx,clientWidth:Wd,clientHeight:Hd,width:Wd,height:Hd,textContent:'',innerHTML:'',value:'mountains',appendChild:()=>{}}}
global.window={addEventListener:()=>{},dispatchEvent:()=>{},devicePixelRatio:1,innerWidth:Wd,innerHeight:Hd};
global.document={getElementById:id=>store[id]||(store[id]=mkEl(id)),createElement:()=>mkEl('x'),body:{appendChild:()=>{}},documentElement:{clientWidth:Wd,clientHeight:Hd},querySelectorAll:()=>[]};
store['c']=mkEl('c'); store['c'].getContext=()=>realCtx;
const api='\n;globalThis.__api={setScene:function(s){SCENE=s;},setMin:function(m){minutes=m;},setTemp:function(t){temperature=t;},setRain:function(b){rainOn=b;rainLevel=b?0.9:0;},frame:function(){draw(16);}};';
eval(engine+api);
const dir=require('path').join(__dirname,'..','assets','scenes'); fs.mkdirSync(dir,{recursive:true});
const shots=[
 {s:'mountains',m:1110},{s:'city',m:1290},{s:'beach',m:600},{s:'desert',m:1080}
];
for(const o of shots){ globalThis.__api.setScene(o.s); globalThis.__api.setMin(o.m); globalThis.__api.setTemp(22); globalThis.__api.setRain(false); globalThis.__api.frame(); globalThis.__api.frame();
 fs.writeFileSync(dir+'/'+o.s+'.jpg', real.toBuffer('image/jpeg',86)); console.log('thumb',o.s); }
