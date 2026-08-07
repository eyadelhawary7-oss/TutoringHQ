// Capture a live route at 390px: screenshot + RENDERED text.
// Entry 31: mutate the LIVE DOM, never a detached clone — innerText is only
// CSS-aware for attached nodes, or hidden panels read as visible.
// Usage: node .rediff-cap.mjs <route> <outPrefix> [waitMs]
import { chromium } from 'playwright';
const route=process.argv[2], out=process.argv[3], wait=Number(process.argv[4]||6000);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844},storageState:'/tmp/state333.json',deviceScaleFactor:2});
const p=await ctx.newPage(); const errs=[]; const bad=[];
p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
p.on('response',r=>{ if(r.status()>=400) bad.push(`${r.status()} ${r.url().replace('http://localhost:3000','')}`.slice(0,120)); });
await p.goto(`http://localhost:3000${route}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(wait);
await p.screenshot({path:`${out}.png`,fullPage:true});
const text=await p.evaluate(()=>{ for(const el of document.querySelectorAll('nav,aside,header,script,style')) el.remove();
  return document.body.innerText; });
const { writeFileSync }=await import('node:fs');
writeFileSync(`${out}.txt`, text);
console.log(`route ${route} -> ${out}.png / .txt | url=${p.url().replace('http://localhost:3000','')}`);
console.log(`chars=${text.length} pageErrors=${errs.length} httpErrors=${bad.length}`);
if(errs.length) console.log('ERR:',errs.slice(0,2).join(' | '));
if(bad.length) console.log('HTTP:',[...new Set(bad)].slice(0,4).join(' | '));
await b.close();
