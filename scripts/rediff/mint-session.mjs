import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const REF='lczmjpnbuhnsislcvzar', OUT=process.argv[2]||'/tmp/state333.json';
const s=JSON.parse(readFileSync('/tmp/session.json','utf8'));
const session={access_token:s.access_token,refresh_token:s.refresh_token,expires_in:s.expires_in,
  expires_at:s.expires_at??Math.floor(Date.now()/1000)+s.expires_in,token_type:s.token_type||'bearer',user:s.user};
const val='base64-'+Buffer.from(JSON.stringify(session)).toString('base64url');
const CH=3180, parts=[]; for(let i=0;i<val.length;i+=CH) parts.push(val.slice(i,i+CH));
const name=`sb-${REF}-auth-token`;
const cookies=(parts.length===1?[{name,value:val}]:parts.map((v,i)=>({name:`${name}.${i}`,value:v})))
  .map(c=>({...c,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax',expires:session.expires_at}));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844}});
await ctx.addCookies(cookies);
const p=await ctx.newPage();
await p.goto('http://localhost:3000/en/dashboard',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(6000);
const url=p.url(), ok=!url.includes('/login');
console.log('cookies set:',cookies.length,'| final URL:',url,'| AUTH:',ok?'OK':'REDIRECTED TO LOGIN');
const txt=(await p.locator('body').innerText()).replace(/\s+/g,' ');
console.log('page text:', txt.slice(0,220));
if(ok){ await ctx.storageState({path:OUT}); console.log('state saved ->',OUT); }
await b.close(); process.exit(ok?0:1);
