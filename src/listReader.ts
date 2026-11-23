// @ts-nocheck
// Ported from Creatio's app/list-reader.js (0.2.1.6). No AI, no network. Only change: each unit also
// returns `details` (the lines under it: wargear, options), so wargear changes can be matched to the library.
/* Creatio 0.2.1.6: general army-list reader. No AI, no network, any list builder, any game system.
   Input: lines of text, from a paste, a PDF (with font size and weight when known) or text recognition.
   Output: what the app has always imported: {name, system, units:[{slot, name, models, src, countSrc}]}
   plus a check of how the reading went, shown on Check the List.

   How it reads a list:
   1. Units are lines with a points value ("Tribune 250", "Squad [148pts]", "Rhino (60 pts)", "Hurai….145 POINTS").
   2. Headings are lines above units without points. The nearest heading above a unit is its group.
      A heading that carries a points value equal to the units under it (a slot or detachment total) is a heading too.
   3. Model counts come from "6 Custodian Guards", "3× Venatari", "Sergeant + 9 Legionaries", "(10 models)",
      "4x Intercessor"; otherwise 1, marked as a guess.
   4. The list's own total decides doubtful lines: when upgrades carry points too, the reading whose units add up
      to the total wins. */

const num=s=>+String(s).replace(/[,.\s]/g,'');
const PTS='(?:pts?|points?)';
/* a points value in a line, strongest patterns first; returns {pts, name, rest, strong} or null */
function findPoints(t){
  let m;
  // "Name [5 PL, 148pts]: details"  "Name (60 pts)"  "Name [148]"
  if((m=new RegExp('^(.*?)\\s*[\\[(]([^\\])]*?)(\\d[\\d,]*)\\s*'+PTS+'([^\\])]*)[\\])]\\s*[:\\-–]?\\s*(.*)$','i').exec(t)))
    return {pts:num(m[3]),name:m[1],rest:m[5],strong:true};
  if((m=/^(.*?)\s*\[\s*(\d[\d,]*)\s*\]\s*[:\-–]?\s*(.*)$/.exec(t)))return {pts:num(m[2]),name:m[1],rest:m[3],strong:true};
  // "Unit - 120pts"  "Hurai Twice Dead 145 POINTS"
  if((m=new RegExp('^(.*?)[\\s:\\-–—]+(\\d[\\d,]*)\\s*'+PTS+'\\.?$','i').exec(t)))return {pts:num(m[2]),name:m[1],rest:'',strong:true};
  // "250pts: Shield Captain"
  if((m=new RegExp('^(\\d[\\d,]*)\\s*'+PTS+'\\s*[:\\-–]\\s*(.+)$','i').exec(t)))return {pts:num(m[1]),name:m[2],rest:'',strong:true};
  // "Tribune 250" (weak: a bare number at the end)
  if((m=/^(.*[A-Za-z][^\d]*?)\s+(\d{1,3}(?:,\d{3})+|\d{1,5})$/.exec(t))&&!/[×x+&,]\s*$/.test(m[1])&&+num(m[2])>=5)return {pts:num(m[2]),name:m[1],rest:'',strong:false};
  return null;
}
/* rows of stats or rules: many short numeric tokens, or a header like "M WS BS S T" */
function statRow(t){
  const tok=t.split(/\s+/);
  const n=tok.filter(x=>/^(\d+\+?|-|\d+\+\+?|\d+")$/.test(x)).length;
  if(n>=4)return true;
  return tok.length>=4&&tok.every(x=>/^[A-Z]{1,3}$/.test(x));
}
const NOISE=[/^\d{1,2}:\d{2}\b/,/^made with\b/i,/^page \d+( of \d+)?$/i,/^(quartermaster|new recruit|battlescribe)$/i];

function clean(raw){
  return raw.map(l=>{
    let t=String(l.text).replace(/\u00a0/g,' ').replace(/[™®©]+/g,'')
      .replace(/[\s.…·]*[.…]{2,}[\s.…·]*/g,' ')                      // dot leaders "Hurai………145 POINTS"
      .replace(/\b(made|created|exported|generated) (with|by)\b.*$/i,'')   // builder credits
      .replace(/\s+/g,' ').trim();
    let bullet=false;
    const gs=/^\+{1,3}\s*(.*?)\s*\+{1,3}$/.exec(t);          // "++ Heading ++"  "+ HQ +"
    if(gs){t=gs[1];return {...l,text:t,bullet:false,boxed:true}}
    const b=/^(?:[•·▪●◦\-–+*«»›‹°]|\.(?=\s+[A-Z0-9]))\s+(.*)$/.exec(t);if(b){t=b[1];bullet=true}
    t=t.replace(/(\d)\s*[x×X]\s+(?=\S)/g,'$1× ').replace(/\s+@\s*$/,'');
    return {...l,text:t,bullet};
  }).filter(l=>l.text&&/[A-Za-z0-9]/.test(l.text)&&!NOISE.some(r=>r.test(l.text)));
}

/* model count from a unit's own line and its detail lines */
const stem=w=>w.toLowerCase().replace(/(ies)$/,'y').replace(/(es|s)$/,'');
const GENERIC=new Set(['squad','squadron','unit','team','section','detachment','command','force','band','group','pack','cohort']);
const words=s=>String(s).split(/[^A-Za-z]+/).filter(w=>w.length>=4).map(stem).filter(w=>!GENERIC.has(w));
const shares=(a,b)=>a.some(x=>b.some(y=>x===y||(Math.min(x.length,y.length)>=5&&(x.startsWith(y)||y.startsWith(x)))));
const NOT_MODEL=/^(enhancements?|warlord|upgrades?|wargear|options?|rules?|abilities|keywords|prime advantage|traits?|rite of war|selections?|categories)\b/i;
function countModels(name,dets){
  let m;
  const details=dets.map(d=>typeof d==='string'?d:d.t);
  const all=[name,...details].join(', ');
  if((m=/\((\d+)\s*models?\)/i.exec(all)))return {n:+m[1]};
  if((m=/(\d+)\s*models?\b/i.exec(all)))return {n:+m[1]};
  /* in a PDF, text wrapped in a narrow column is interleaved with other columns: rejoin each column first */
  const cols=[];
  for(const d of dets)if(typeof d!=='string'&&d.x!=null){const c=cols.find(c=>Math.abs(c.x-d.x)<2);if(c)c.t+=' '+d.t;else cols.push({x:d.x,t:d.t})}
  for(const d of [...cols.map(c=>c.t),...details]){
    /* "Sergeant + 9 Tactical Legionaries", "Tartaros Chosen Champion + 3 Tartaros Chosen" */
    if(/\+/.test(d)&&!/,/.test(d)&&d.length<90){
      const parts=d.split('+').map(s=>s.trim()).filter(Boolean);
      if(parts.length>=2&&parts.every(p=>/^[A-Za-z0-9 \-']+$/.test(p)))
        return {n:parts.reduce((t,p)=>t+((m=/^(\d+)\s+/.exec(p))?+m[1]:1),0)};
    }
  }
  /* sub-lines naming a model and its wargear: ". 4x Intercessor: 4 with Bolt rifle", ". Intercessor Sergeant: Bolt pistol" */
  const entries=dets.filter(d=>typeof d!=='string'&&d.bullet).map(d=>/^(?:(\d+)×\s*)?([A-Z][^:]{1,40}):\s/.exec(d.t)).filter(x=>x&&!NOT_MODEL.test(x[2]));
  if(entries.length)return {n:entries.reduce((t,x)=>t+(x[1]?+x[1]:1),0)};
  /* items such as "6 Custodian Guards", "4× Intercessor", "15× Legionary, Legion Tactical Sergeant": count the ones
     that name a model of this unit (share a word with its name), or a first numbered item; once a numbered model
     is found, un-numbered items that also name the unit's models count as one each */
  const uw=words(name);
  let n=0,found=false;const loose=[];
  for(const d of details){
    d.split(/,\s*|;\s*/).forEach((it,k)=>{
      it=it.trim();const mm=/^(\d+)\s*(×)?\s*(.+)$/.exec(it);
      if(!mm){if(/^[A-Z]/.test(it)&&it.split(/\s+/).length>=2&&!NOT_MODEL.test(it)&&shares(words(it),uw))loose.push(it);return}
      if(shares(words(mm[3]),uw)||(k===0&&!mm[2]&&/^[A-Z]/.test(mm[3]))){n+=+mm[1];found=true}
    });
  }
  if(found)n+=loose.length;
  return found?{n}:null;
}

/* subset of values summing exactly to target, fewest items, preferring items with lower cost; null if none */
function subsetSum(items,target){
  if(target<=0||target>100000)return null;
  const best=new Map([[0,{c:0,w:0,pick:[]}]]);
  for(const it of items){
    for(const [s,v] of [...best.entries()].sort((a,b)=>b[0]-a[0])){
      const ns=s+it.v;if(ns>target)continue;
      const cand={c:v.c+1,w:v.w+it.w,pick:[...v.pick,it.i]},cur=best.get(ns);
      if(!cur||cand.c<cur.c||(cand.c===cur.c&&cand.w<cur.w))best.set(ns,cand);
    }
  }
  return best.has(target)?best.get(target).pick:null;
}

function detectSystem(text){
  const S=[[/horus heresy|legiones astartes|legio custodes|solar auxilia|mechanicum|questoris|imperialis/i,'Horus Heresy 3.0'],
    [/warhammer 40,?000|\b40k\b|strike force|incursion|onslaught/i,'Warhammer 40,000'],
    [/age of sigmar|\baos\b|spearhead/i,'Warhammer Age of Sigmar'],[/kill team/i,'Kill Team'],[/bolt action/i,'Bolt Action'],
    [/the old world/i,'Warhammer: The Old World'],[/middle-earth|mesbg/i,'Middle-earth Strategy Battle Game']];
  for(const [r,s] of S)if(r.test(text))return s;
  return '';
}

/* lines: [{text, size?, bold?, x?, page?}] */
function read(rawLines,opts={}){
  const L=clean(rawLines);
  const notes=[];
  if(!L.length)return {name:opts.fallbackName||'Imported list',system:'',units:[],check:{notes:['No text found']}};
  const hasFont=L.some(l=>l.size);

  /* header: title, then up to a few lines before the first unit or heading; the army total is a lone number,
     "Faction • 1,700", "[2000pts]" or a "total" line */
  let total=null,ti=0;
  const name=((findPoints(L[0].text)||{name:L[0].text}).name||'').replace(/[\s:\-–—]+$/,'').trim()||L[0].text;
  const fp0=findPoints(L[0].text);
  let first=1;
  for(let i=0;i<Math.min(L.length,6);i++){
    const t=L[i].text;let m;
    if(i>0&&/^(\d{1,3}([.,\s]\d{3})+|\d+)$/.test(t)){total=num(t);first=i+1;break}
    if((m=/^(.+?)\s*[•|·]\s*(\d[\d,.]*)\s*(pts|points)?$/i.exec(t))){total=num(m[2]);first=i+1;break}
  }
  for(const l of L){if(!/\btotal\b/i.test(l.text))continue;
    const fp=findPoints(l.text),m=/\btotal\b[^0-9]{0,20}(\d[\d,]*)/i.exec(l.text);
    const v=fp&&fp.strong?fp.pts:(m?num(m[1]):null);if(v!=null){total=v;l.skip=true}}
  if(total==null&&fp0&&fp0.strong&&L.length>1&&L.slice(1).some(l=>findPoints(l.text))){total=fp0.pts;L[0].skip=true}
  /* lines between the title and the total are the subtitle (faction etc.) */
  for(let i=0;i<first;i++)L[i].skip=true;
  if(first===1&&!(fp0&&!L[0].skip))L[0].skip=true;

  /* in a PDF, headings are at least as large as unit names */
  const ptsSizes=L.filter(l=>!l.skip&&l.size&&findPoints(l.text)&&!statRow(l.text)).map(l=>l.size).sort((a,b)=>a-b);
  const unitSize=ptsSizes.length?ptsSizes[Math.floor(ptsSizes.length/2)]:0;
  /* classify each line */
  const E=[];
  let lastKind=null,lastPts=null;
  for(let i=0;i<L.length;i++){
    const l=L[i];if(l.skip)continue;
    const t=l.text;
    if(statRow(t)){E.push({k:'stat',t,l});continue}
    const fp=findPoints(t);
    if(fp&&fp.name&&/[A-Za-z]/.test(fp.name)&&!/[,;]/.test(fp.name)){
      if(statRow(fp.name))continue;
      if(!fp.strong&&hasFont&&unitSize&&l.size<0.95*unitSize){/* small print with a number: detail, not a unit */}
      else{
      const e={k:'pts',t,l,pts:fp.pts,name:fp.name.replace(/[\s:\-–—•]+$/,'').trim(),details:fp.rest?[{t:fp.rest,bullet:false}]:[],strong:fp.strong};
      E.push(e);lastKind='pts';lastPts=e;continue}}
    const prev=[...E].reverse().find(e=>e.k!=='stat');
    const lastDet=lastPts&&lastPts.details.length?lastPts.details[lastPts.details.length-1].t:null;
    const looksDetail=/^\d/.test(t)||/^[a-z(]/.test(t)||/,/.test(t)||/:\s*\S/.test(t)||(prev&&prev.k==='detail'&&/[,:]$/.test(prev.t))
      ||(prev&&prev.k!=='head'&&lastDet&&/[,:]$/.test(lastDet));
    /* PDF: a heading-styled line right under a unit line, same size and weight, is the rest of a wrapped name */
    if(hasFont&&prev&&prev.k==='pts'&&!prev.details.length&&l.size===prev.l.size&&l.bold===prev.l.bold&&Math.abs((l.x||0)-(prev.l.x||0))<4&&!looksDetail&&!l.bullet){
      prev.name+=' '+t;continue}
    if(looksDetail||l.bullet&&prev&&prev.k!=='head'&&lastPts){
      if(lastPts&&prev&&prev.k!=='head'){
        /* a wrapped line continues the previous detail line instead of starting a new one */
        const ld=lastPts.details[lastPts.details.length-1],sameCol=!ld||ld.x==null||l.x==null||Math.abs(ld.x-l.x)<2;
        if(sameCol&&(lastDet&&/[,:]$/.test(lastDet)||(lastDet&&/^[a-z]/.test(t)&&!l.bullet)))ld.t+=' '+t;
        else lastPts.details.push({t,bullet:!!l.bullet,x:l.x});
      }
      E.push({k:'detail',t,l});lastKind='detail';continue}
    if(t.split(' ').length>10||(hasFont&&l.size&&unitSize&&l.size<0.95*unitSize)){
      if(lastPts&&prev&&prev.k!=='head')lastPts.details.push({t,bullet:!!l.bullet,x:l.x});
      E.push({k:'detail',t,l});continue}
    E.push({k:'head',t,l});lastKind='head';lastPts=null;
  }
  /* attach detail lines to the unit above them (they were pushed both ways above; keep the pts copy) */
  const P=E.filter(e=>e.k==='pts');

  /* 1. headings with totals: a points line followed by points lines that add up to it.
        One covered line is enough only when the line looks like a heading (no bullet over bulleted lines,
        or a bigger or bolder font than the line it covers). */
  for(let a=P.length-1;a>=0;a--){
    const h=P[a];let s=0,c=0,nxt=null;
    for(let b=a+1;b<P.length&&s<h.pts;b++){if(P[b].k!=='pts')continue;if(!nxt)nxt=P[b];s+=P[b].pts;c++;if(s===h.pts)break}
    if(s!==h.pts||!c)continue;
    /* one line under it: a heading only if it looks like one: bigger or bolder, boxed, unbulleted over bulleted,
       or with nothing beneath it while the line it covers has detail */
    const bare=!h.details.length&&nxt.details.length>0;
    const styled=h.l.boxed||(hasFont?(h.l.size>nxt.l.size||(h.l.bold&&!nxt.l.bold)||bare):((!h.l.bullet&&nxt.l.bullet)||(bare&&!h.l.bullet)));
    if(c>=2||styled)h.k='headPts';
  }
  let units=P.filter(p=>p.k==='pts');

  /* 2. the list total decides which points lines are upgrades rather than units */
  let sum=units.reduce((t,u)=>t+u.pts,0);
  if(total!=null&&sum>total){
    const cand=units.map((u,i)=>({i,v:u.pts,w:(u.l.bullet?0:2)+(/^[a-z]/.test(u.name)?0:3)+(u.strong?1:0)}));
    const drop=subsetSum(cand.sort((a,b)=>a.w-b.w),sum-total);
    if(drop){const d=new Set(drop);units.forEach((u,i)=>{if(d.has(i))u.k='upgrade'});
      let owner=null;for(const e of E){if(e.k==='pts')owner=e;else if(e.k==='upgrade'&&owner)owner.details.push({t:e.name,bullet:true},...e.details);else if(e.k==='head'||e.k==='headPts')owner=null}
      units=units.filter(u=>u.k==='pts');sum=total;
      notes.push(`${drop.length} line${drop.length>1?'s':''} with points read as upgrades, not units`)}
  }
  /* text recognition: one misread digit (1/7, 0/8, 5/6, 3/8) in one unit's points that exactly explains the gap
     is corrected; if more than one correction would fit, nothing is changed */
  if(opts.ocr&&total!=null&&sum!==total){
    const SWAP={'1':'7','7':'1','0':'8','8':'0','5':'6','6':'5','3':'8'};
    const fixes=[];
    units.forEach(u=>{const d=String(u.pts);for(let k=0;k<d.length;k++){const alt=SWAP[d[k]];if(!alt)continue;
      const v=+(d.slice(0,k)+alt+d.slice(k+1));if(sum-u.pts+v===total)fixes.push({u,v})}});
    if(fixes.length===1){const f=fixes[0];notes.push(`${f.u.name}: points read as ${f.u.pts}, corrected to ${f.v} to match the total`);sum=sum-f.u.pts+f.v;f.u.pts=f.v}
  }
  if(total!=null&&sum!==total)notes.push(`Units add up to ${sum} points; the list says ${total}`);
  if(total==null)notes.push('No army total found to check against');

  if(!units.length&&fp0&&fp0.strong){
    const e={k:'pts',t:L[0].text,l:L[0],pts:fp0.pts,name:fp0.name.trim(),details:L.slice(1).map(l=>({t:l.text,bullet:!!l.bullet})),strong:true};
    E.unshift(e);units=[e];sum=e.pts;total=null;notes.length=0;notes.push('Read as a single unit card');
  }
  /* 3. groups: the nearest heading above each unit */
  let group=null;const out=[];
  for(const e of E){
    if(e.k==='head'){group=e.t;continue}
    if(e.k==='headPts'){group=e.name;continue}
    if(e.k!=='pts')continue;
    let nm=e.name,lead=/^(\d+)×\s*(.+)$/.exec(nm),cnt=null;
    if(lead){nm=lead[2];cnt={n:+lead[1]}}
    const mm=/^(.*?)\s*\((\d+)\s*models?\)\s*$/i.exec(nm);if(mm){nm=mm[1];cnt={n:+mm[2]}}
    if(!cnt)cnt=countModels(nm,e.details);
    out.push({slot:group||'Units',name:nm.trim(),models:cnt?Math.max(1,cnt.n):1,src:group?'listed':'inferred',countSrc:cnt?'listed':'guessed',pts:e.pts,details:e.details.map(d=>d.t)});
  }
  const sys=opts.system||detectSystem(L.slice(0,6).map(l=>l.text).join(' ')+' '+(opts.hint||''));
  return {name,system:sys,units:out,check:{total,sum,matched:total!=null&&sum===total,notes},...(opts.debug?{debug:E}:{})};
}

/* plain text (a paste, a .txt, or text recognition output) */
function readText(text,opts){return read(String(text).replace(/\r/g,'').split('\n').map(text=>({text})),opts)}

/* pdf.js text items -> lines with font size, weight and x; works with any pdf.js document */
async function pdfLines(doc){
  const out=[];
  const fontUse=new Map();
  const pages=[];
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p);const tc=await page.getTextContent();
    const its=tc.items.filter(i=>i.str&&i.str.trim()).map(i=>({s:i.str,x:i.transform[4],y:i.transform[5],h:Math.round(Math.abs(i.transform[3]||i.height)*10)/10,f:i.fontName,
      bold:/bold|black|heavy|semibold|demi/i.test(((tc.styles||{})[i.fontName]||{}).fontFamily||'')||/bold|black|heavy|semibold/i.test(i.fontName)}));
    its.forEach(i=>fontUse.set(i.f,(fontUse.get(i.f)||0)+i.s.length));
    pages.push(its);
  }
  /* the most used font is body text; others are headings or emphasis */
  const body=[...fontUse.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
  for(const its of pages){
    its.sort((a,b)=>b.y-a.y||a.x-b.x);
    const lines=[];
    for(const i of its){
      const l=lines.find(l=>Math.abs(l.y-i.y)<=Math.max(1.2,0.35*i.h)&&Math.abs(l.h-i.h)<0.8);
      if(l)l.items.push(i);else lines.push({y:i.y,h:i.h,items:[i]});
    }
    /* points printed on their own, a little off the name's baseline, join the closest text line of a similar size */
    const isNum=l=>l.items.every(i=>/^[\d,]+$/.test(i.s.trim()));
    for(const l of lines.filter(l=>l.items.length===1&&isNum(l))){
      const host=lines.filter(o=>o!==l&&!isNum(o)&&Math.abs(o.y-l.y)<=0.8*Math.max(o.h,l.h))
        .sort((a,b)=>(Math.abs(a.h-l.h)-Math.abs(b.h-l.h))||(Math.abs(a.y-l.y)-Math.abs(b.y-l.y)))[0];
      if(host){host.items.push(...l.items);l.items=[]}
    }
    for(const l of lines.filter(l=>l.items.length).sort((a,b)=>b.y-a.y)){
      l.items.sort((a,b)=>a.x-b.x);
      const lead=l.items.find(i=>!/^[\d,+\-×]+$/.test(i.s.trim()))||l.items[0];
      out.push({text:l.items.map(i=>i.s).join(' '),size:lead.h,bold:!!lead.bold,x:lead.x,headFont:lead.f!==body});
    }
  }
  return out;
}

export const ListReader={read,readText,pdfLines,findPoints,countModels};
