// Finds the red circles the user drew and reports their centres in body-length
// units measured from the nose, plus the fish bbox they sit on.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const img = process.argv[2];
const ca=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath=ca.find(p=>existsSync(p));
const b=await puppeteer.launch({executablePath,headless:'new',args:['--no-sandbox','--use-angle=default']});
const p=await b.newPage();
const b64=readFileSync(resolve(img)).toString('base64');
const r=await p.evaluate(async(url)=>{
  const im=new Image(); await new Promise((s,j)=>{im.onload=s;im.onerror=j;im.src=url;});
  const W=im.naturalWidth,H=im.naturalHeight;
  const c=document.createElement('canvas');c.width=W;c.height=H;
  const cx=c.getContext('2d');cx.drawImage(im,0,0);
  const d=cx.getImageData(0,0,W,H).data;
  const isRed=(i)=>d[i]>120&&d[i]-d[i+1]>70&&d[i]-d[i+2]>70;
  const isFish=(i)=>{const r=d[i],g=d[i+1],bl=d[i+2];const l=0.299*r+0.587*g+0.114*bl;return !isRed(i)&&(r-bl>25&&l>60);};
  let fx0=W,fx1=0,fy0=H,fy1=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(isFish(i)){if(x<fx0)fx0=x;if(x>fx1)fx1=x;if(y<fy0)fy0=y;if(y>fy1)fy1=y;}}
  // red components
  const comp=new Int32Array(W*H).fill(-1);const out=[];
  for(let i=0;i<W*H;i++){
    if(!isRed(i*4)||comp[i]>=0)continue;
    const id=out.length;let n=0,sx=0,sy=0,minX=W,maxX=0,minY=H,maxY=0;
    const q=[i];comp[i]=id;
    while(q.length){const pIdx=q.pop();const px=pIdx%W,py=(pIdx-px)/W;n++;sx+=px;sy+=py;
      if(px<minX)minX=px;if(px>maxX)maxX=px;if(py<minY)minY=py;if(py>maxY)maxY=py;
      for(const nn of [pIdx+1,pIdx-1,pIdx+W,pIdx-W]){if(nn<0||nn>=W*H)continue;if(Math.abs((nn%W)-px)>1)continue;
        if(!isRed(nn*4)||comp[nn]>=0)continue;comp[nn]=id;q.push(nn);}}
    if(n>800)out.push({cx:sx/n,cy:sy/n,n,minX,maxX,minY,maxY});
  }
  return {W,H,fish:{fx0,fx1,fy0,fy1},circles:out};
},'data:image/jpeg;base64,'+b64);
await b.close();
const {W,H,fish,circles}=r;
const len=fish.fx1-fish.fx0;
console.log(`image ${W}x${H}  fish x ${fish.fx0}..${fish.fx1} (len ${len}px)  y ${fish.fy0}..${fish.fy1}`);
console.log('circles (u measured from the NOSE = left edge):');
for(const c of circles.sort((a,b)=>a.cx-b.cx)){
  const u=(c.cx-fish.fx0)/len;
  const v=(c.cy-fish.fy0)/(fish.fy1-fish.fy0);
  console.log(`  centre x=${c.cx.toFixed(0)} y=${c.cy.toFixed(0)}  u=${u.toFixed(3)}  v=${v.toFixed(2)} (0=back,1=belly)  r≈${((c.maxX-c.minX)/2).toFixed(0)}px`);
}
