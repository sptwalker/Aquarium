// Factor experiment: which subsystem produces the vertical dark bands?
// Renders 4 variants of ?species=koi and measures column-luminance dips.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const variants = {
  base: '',
  nogeo: '&ab=nogeo',
  noshade: '&ab=noshade',
  noscale: '&ab=noscale',
};
const ca=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath=ca.find(p=>existsSync(p));
const b=await puppeteer.launch({executablePath,headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=default'],defaultViewport:{width:1400,height:800}});

for (const [name, q] of Object.entries(variants)) {
  const p = await b.newPage();
  await p.goto('http://localhost:5173/showcase.html?species=koi'+q,{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForFunction('window.__ready===true',{timeout:60000});
  await new Promise(r=>setTimeout(r,1200));
  const r = await p.evaluate(()=>{
    const cv=document.getElementById('view');
    const W=cv.width,H=cv.height;
    const t=document.createElement('canvas');t.width=W;t.height=H;
    const x=t.getContext('2d');x.drawImage(cv,0,0);
    const d=x.getImageData(0,0,W,H).data;
    const lum=i=>0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const colL=[],colN=[];
    for(let xx=0;xx<W;xx++){let s=0,n=0;for(let y=0;y<H;y++){const i=(y*W+xx)*4;
      if(lum(i)>50 && d[i]-d[i+2]>20){s+=lum(i);n++;}}colL.push(n?s/n:0);colN.push(n);}
    const xs=colN.map((n,i)=>[i,n]).filter(([,n])=>n>50).map(([i])=>i);
    const x0=xs[0],x1=xs[xs.length-1];
    const seg=colL.slice(x0,x1+1);
    const win=Math.round((x1-x0)*0.06);
    const sm=seg.map((_,i)=>{let s=0,n=0;for(let k=-win;k<=win;k++){const j=i+k;if(j<0||j>=seg.length)continue;s+=seg[j];n++;}return s/n;});
    let minR=9, dips=[];
    for(let i=2;i<seg.length-2;i++){
      const r=seg[i]/Math.max(1e-6,sm[i]);
      if(r<minR)minR=r;
      if(r<0.93 && r<=seg[i-1]/Math.max(1e-6,sm[i-1]) && r<=seg[i+1]/Math.max(1e-6,sm[i+1]))
        dips.push({u:+((x0+i-x0)/(x1-x0)).toFixed(3),r:+r.toFixed(3)});
    }
    return {minR:+minR.toFixed(3),dips:dips.slice(0,8),n:dips.length};
  });
  console.log(name.padEnd(8),'minRatio',r.minR,'dips<0.93',r.n, JSON.stringify(r.dips.slice(0,6)));
  await p.close();
}
await b.close();
