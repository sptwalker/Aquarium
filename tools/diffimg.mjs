import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
const ca=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath=ca.find(p=>existsSync(p));
const b=await puppeteer.launch({executablePath,headless:'new',args:['--no-sandbox','--use-angle=default']});
const p=await b.newPage();
const [a,c]=process.argv.slice(2);
const load=(f)=>'data:image/jpeg;base64,'+readFileSync(f).toString('base64');
const r=await p.evaluate(async(u1,u2)=>{
  const get=async(u)=>{const im=new Image();await new Promise((s,j)=>{im.onload=s;im.onerror=j;im.src=u});
    const cv=document.createElement('canvas');cv.width=im.naturalWidth;cv.height=im.naturalHeight;
    const x=cv.getContext('2d');x.drawImage(im,0,0);return {w:cv.width,h:cv.height,d:x.getImageData(0,0,cv.width,cv.height).data};};
  const A=await get(u1),B=await get(u2);
  if(A.w!==B.w||A.h!==B.h) return {sizeMismatch:[A.w,A.h,B.w,B.h]};
  let diff=0,big=0,n=A.w*A.h;
  for(let i=0;i<n;i++){const o=i*4;
    const d=Math.abs(A.d[o]-B.d[o])+Math.abs(A.d[o+1]-B.d[o+1])+Math.abs(A.d[o+2]-B.d[o+2]);
    if(d>12)diff++; if(d>60)big++;}
  return {w:A.w,h:A.h,pixelsChangedPct:(100*diff/n).toFixed(2),stronglyChangedPct:(100*big/n).toFixed(2)};
},load(a),load(c));
console.log(JSON.stringify(r));
await b.close();
