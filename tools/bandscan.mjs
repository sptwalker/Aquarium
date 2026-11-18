import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
const ca=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath=ca.find(p=>existsSync(p));
const b=await puppeteer.launch({executablePath,headless:'new',args:['--no-sandbox','--use-angle=default']});
const p=await b.newPage();
const b64=readFileSync(process.argv[2]).toString('base64');
const r=await p.evaluate(async(url)=>{
  const im=new Image(); await new Promise((s,j)=>{im.onload=s;im.onerror=j;im.src=url;});
  const c=document.createElement('canvas'); c.width=im.naturalWidth; c.height=im.naturalHeight;
  const cx=c.getContext('2d'); cx.drawImage(im,0,0);
  const d=cx.getImageData(0,0,c.width,c.height).data;
  const W=c.width,H=c.height;
  const lum=(i)=>0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
  // body pixels: warm & bright
  const isFish=(i)=>{const rr=d[i],bb=d[i+2];return (rr-bb>25)&&lum(i)>45;};
  // per-column: mean luminance over fish pixels, plus coverage
  const colL=[],colN=[];
  for(let x=0;x<W;x++){let s=0,n=0;for(let y=0;y<H;y++){const i=(y*W+x)*4;if(isFish(i)){s+=lum(i);n++;}}colL.push(n?s/n:0);colN.push(n);}
  return {W,H,colL,colN};
},'data:image/jpeg;base64,'+b64);
await b.close();
const {W,colL,colN}=r;
// body-only x range: columns with substantial coverage
const nx=colN.map((n,i)=>[i,n]).filter(([,n])=>n>60).map(([i])=>i);
const x0=nx[0],x1=nx[nx.length-1];
const seg=colL.slice(x0,x1+1);
// detrend with a wide moving average (the shading gradient), then find dips
const win=Math.round((x1-x0)*0.06);
const smooth=seg.map((_,i)=>{
  let s=0,n=0;
  for(let k=-win;k<=win;k++){const j=i+k; if(j<0||j>=seg.length)continue; s+=seg[j]; n++;}
  return s/n;
});
let rows=[];
for(let i=0;i<seg.length;i++){
  const ratio=seg[i]/Math.max(1e-6,smooth[i]);
  rows.push([x0+i,ratio]);
}
// find local minima below threshold
const dips=[];
for(let i=2;i<rows.length-2;i++){
  if(rows[i][1]<0.955 && rows[i][1]<=rows[i-1][1] && rows[i][1]<=rows[i+1][1]){
    dips.push({x:rows[i][0],ratio:rows[i][1],u:(rows[i][0]-x0)/(x1-x0)});
  }
}
console.log(`body columns ${x0}..${x1}  (length ${x1-x0}px)`);
console.log('column luminance ratio min/max:', Math.min(...rows.map(r=>r[1])).toFixed(3), Math.max(...rows.map(r=>r[1])).toFixed(3));
console.log('dips below 0.955:');
for(const dd of dips.slice(0,20)) console.log(`  x=${dd.x}  u=${dd.u.toFixed(3)}  ratio=${dd.ratio.toFixed(3)}`);
console.log(`total dips ${dips.length}`);
