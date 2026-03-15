// ── constants ──
const CW=300, HEADER_H=58, ROW_H=20, SEC_T=17, PADV=8, PADH=14;
const TEXT_INDENT=18;
const ACOL={extends:'#e53e3e',implements:'#3182ce',has:'#38a169',uses:'#805ad5'};
const CCOL={
  class:    {h:'#c6f6d5',dk:'#276749',bd:'#68d391',tx:'#1a4731'},
  interface:{h:'#bee3f8',dk:'#2a4365',bd:'#63b3ed',tx:'#1a365d'},
  abstract: {h:'#feebc8',dk:'#7b341e',bd:'#f6ad55',tx:'#652b19'},
  enum:     {h:'#e9d8fd',dk:'#44337a',bd:'#b794f4',tx:'#322659'},
};

// ── state ──
let files=[],codes=[],classes=[],rels=[],nodes=[];
let mode='diagram',sc=1,px=0,py=0;
let pan=false,ds={x:0,y:0},ps={x:0,y:0},moved=false;
let hNode=null,selNode=null,hRel=null;
let hItem=null; 

// Modal state
let mNodes=[], mRels=[], msc=1, mpx=0, mpy=0, mPan=false, mds={x:0,y:0}, mps={x:0,y:0}, mMoved=false;

// ── file handling (Drag & Drop) ──
const dz = document.getElementById('dz');
window.addEventListener('dragenter', e => { e.preventDefault(); dz.classList.add('drag'); });
window.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dz.classList.add('drag'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) dz.classList.remove('drag'); });
window.addEventListener('drop', async e => {
  e.preventDefault(); dz.classList.remove('drag');
  if (!e.dataTransfer) return;
  const dropFiles = [];
  if (e.dataTransfer.items) {
    const traversals = [];
    for (const item of Array.from(e.dataTransfer.items)) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry) traversals.push(traverseEntry(entry, dropFiles));
      else { const f = item.getAsFile(); if (f) dropFiles.push(f); }
    }
    await Promise.all(traversals);
  } else if (e.dataTransfer.files) {
    dropFiles.push(...e.dataTransfer.files);
  }
  if (dropFiles.length > 0) go(dropFiles);
});

async function traverseEntry(entry,out){
  if(entry.isFile){
    await new Promise(r=>{entry.file(f=>{out.push(f);r();},r);});
  } else if(entry.isDirectory){
    const reader=entry.createReader();
    await new Promise(r=>{
      function readAll(){
        reader.readEntries(async entries=>{
          if(!entries.length){r();return;}
          await Promise.all(entries.map(e=>traverseEntry(e,out)));
          readAll();
        });
      }
      readAll();
    });
  }
}
document.getElementById('fi').addEventListener('change',e=>go([...e.target.files]));

async function go(fs){
  const v=fs.filter(f=>f.name.endsWith('.java')||f.name.endsWith('.kt')||f.name.endsWith('.dart'));
  if(!v.length){toast('לא נמצאו קבצי Java/Kotlin/Dart');return;}
  files=v; codes=await Promise.all(v.map(readF));
  classes=[];codes.forEach((c,i)=>classes.push(...parse(c,v[i].name)));
  rels=buildRels();
  buildInternalMethodRels(); 
  
  document.getElementById('es').style.display='none';
  document.getElementById('stBox').style.display='block';
  document.getElementById('lgBox').style.display='block';
  document.getElementById('clBox').style.display='block';
  document.getElementById('mtog').style.display='flex';
  document.getElementById('sF').textContent=v.length;
  document.getElementById('sC').textContent=classes.filter(c=>c.type==='class').length;
  document.getElementById('sI').textContent=classes.filter(c=>c.type==='interface').length;
  document.getElementById('sR').textContent=rels.length;
  document.getElementById('cpBtn').disabled=false;
  document.getElementById('pdfBtn').disabled=false;
  document.getElementById('dlDiagBtn').disabled=false;
  document.getElementById('dlFlowBtn').disabled=false;
  
  renderList();
  mode = null; setMode('diagram');
}
function readF(f){return new Promise(r=>{const fr=new FileReader();fr.onload=e=>r(e.target.result);fr.readAsText(f);})}

// ── Smart Parser ──
function getCommentBefore(text, index) {
    let i = index - 1;
    while (i >= 0 && /[ \t\r\n]/.test(text[i])) i--;
    if (i < 0) return '';

    let comments = [];
    while (i >= 0) {
        if (text[i] === '/' && text[i-1] === '*') {
            let j = i - 2;
            while (j > 0 && !(text[j] === '*' && text[j-1] === '/')) j--;
            const raw = text.slice(Math.max(0, j+1), i-1).trim();
            const cleaned = raw.split('\n').map(l => l.replace(/^[ \t]*\*+/, '').trim()).filter(Boolean).join('\n');
            comments.unshift(cleaned);
            i = j - 2;
            while (i >= 0 && /[ \t\r\n]/.test(text[i])) i--;
        } else if (text[i] !== '\n' && text[i] !== '\r') {
            let lineStart = i;
            while(lineStart > 0 && text[lineStart-1] !== '\n' && text[lineStart-1] !== '\r') lineStart--;
            const lineText = text.slice(lineStart, i+1);
            const match = lineText.match(/^[ \t]*\/\/\/?(.*)$/);
            if (match) {
                comments.unshift(match[1].trim());
                i = lineStart - 1;
                while (i >= 0 && /[ \t\r\n]/.test(text[i])) i--;
            } else { break; }
        } else { break; }
    }
    return comments.join('\n');
}

function parse(code,fn){
  const kt=fn.endsWith('.kt'), dt=fn.endsWith('.dart');
  const clean = code.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
                    .replace(/\/\/.*/g, m => ' '.repeat(m.length));
  const res=[];
  
  function xbodyIdx(c,s){let d=0,i=s,st=-1;while(i<c.length){if(c[i]==='{'){d++;if(st<0)st=i;}else if(c[i]==='}'){d--;if(d===0)return {st:st+1,en:i};}i++;}return {st:st+1,en:c.length};}

  if(dt){
    const re = /(?:^|\n)\s*(abstract\s+)?(class|mixin|enum|extension)\s+(\w+)(.*?)\{/g;
    let m;while((m=re.exec(clean))!==null){
       const name=m[3], sig=m[4]||''; let par=[];
       const exM=sig.match(/extends\s+([\w<>]+)/); if(exM)par.push(exM[1].replace(/<.*/,'').trim());
       const wiM=sig.match(/with\s+([\w<>, ]+)/); if(wiM)par.push(...wiM[1].split(',').map(s=>s.trim().replace(/<.*/,'')));
       const imM=sig.match(/implements\s+([\w<>, ]+)/); if(imM)par.push(...imM[1].split(',').map(s=>s.trim().replace(/<.*/,'')));
       const idxs=xbodyIdx(clean,m.index+m[0].length-1); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
       res.push({
          name,par:par.filter(Boolean),file:fn,
          type:/abstract/.test(m[1]||'')?'abstract':m[2]==='enum'?'enum':(m[2]==='mixin'||m[2]==='extension')?'interface':'class',
          fields:dtF(bC,bO),methods:dtM(bC,bO,name), comment: getCommentBefore(code, m.index), rawBody:bO
       });
    }
  } else if(kt){
    const re=/(?:^|\n)\s*((?:(?:public|private|protected|internal|open|abstract|sealed|data|enum)\s+)*)(class|interface|object|enum\s+class)\s+(\w+)(?:\s*<[^>]*>)?\s*(?::\s*([^{(]+))?\s*\{/g;
    let m;while((m=re.exec(clean))!==null){
      const name=m[3], par=m[4]?m[4].split(',').map(s=>s.trim().replace(/[(<].*/,'').trim()).filter(Boolean):[];
      const idxs=xbodyIdx(clean,m.index+m[0].length-1); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
      res.push({
         name,par,file:fn,
         type:/abstract/.test(m[1]||'')?'abstract':/enum/.test(m[2])?'enum':m[2]==='interface'?'interface':'class',
         fields:ktF(bC,bO),methods:ktM(bC,bO), comment: getCommentBefore(code, m.index), rawBody:bO
      });
    }
  } else {
    const re=/(?:^|\n)\s*((?:(?:public|private|protected|static|final|abstract)\s+)*)(enum\s*class|enum|interface|@interface|class)\s+(\w+)(?:\s*<[^>]*>)?\s*(?:extends\s+([\w.<>, ]+?))?\s*(?:implements\s+([\w.<>, ]+?))?\s*\{/g;
    let m;while((m=re.exec(clean))!==null){
      const name=m[3], ext=m[4]?[m[4].trim().replace(/<.*/,'')]:[], impl=m[5]?m[5].split(',').map(s=>s.trim().replace(/<.*/,'')):[];
      const idxs=xbodyIdx(clean,m.index+m[0].length-1); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
      res.push({
         name,par:[...ext,...impl].filter(Boolean),file:fn,
         type:/abstract/.test(m[1]||'')?'abstract':m[2].includes('enum')?'enum':m[2].includes('interface')?'interface':'class',
         fields:jvF(bC,bO),methods:jvM(bC,bO,name), comment: getCommentBefore(code, m.index), rawBody:bO
      });
    }
  }
  return res;
}

function xbody(c,s){let d=0,i=s,st=-1;while(i<c.length){if(c[i]==='{'){d++;if(st<0)st=i;}else if(c[i]==='}'){d--;if(d===0)return c.slice(st+1,i);}i++;}return c.slice(st+1);}
function gv(s){return /private/.test(s)?'-':/protected/.test(s)?'#':'+';}
function sp(p){if(!p)return'';return p.split(',').map(s=>{const t=s.trim().split(/[\s:]+/);return t[t.length-1];}).join(', ');}

function jvF(bC,bO){const re=/^\s*((?:(?:public|private|protected|static|final|volatile|transient)\s+)+)([\w<>\[\],.? ]+?)\s+(\w+)\s*(?:=.*?)?;/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15)r.push({v:gv(m[1]),t:m[2].trim(),n:m[3],comment:getCommentBefore(bO,m.index)});return r;}
function jvM(bC,bO,cn){const re=/^\s*((?:(?:public|private|protected|static|abstract|final|synchronized|override)\s+)*)([\w<>\[\],.? ]+?)\s+(\w+)\s*\(([^)]*)\)(?:.*?\{)/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15){const n=m[3];if(['if','while','for','switch','catch'].includes(n))continue;const idx=bC.indexOf('{',m.index);r.push({v:gv(m[1]),ret:n===cn?'':m[2].trim(),n,p:sp(m[4].trim()),ctor:n===cn,body:idx!==-1?xbody(bO,idx):'',comment:getCommentBefore(bO,m.index)});}return r;}
function ktF(bC,bO){const re=/^\s*((?:(?:public|private|protected|internal|override|lateinit)\s+)*)(val|var)\s+(\w+)\s*:\s*([\w<>?,. ]+)/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15)r.push({v:gv(m[1]),t:m[4].trim(),n:m[3],comment:getCommentBefore(bO,m.index)});return r;}
function ktM(bC,bO){const re=/^\s*((?:(?:public|private|protected|internal|override|open|abstract|suspend)\s+)*)fun\s+(?:[\w<>?,. ]+\.)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([\w<>?,. ]+))?(?:.*?\{|=)/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15){const n=m[2];const idx=bC.indexOf('{',m.index);r.push({v:gv(m[1]),ret:(m[4]||'Unit').trim(),n,p:sp(m[3].trim()),ctor:false,body:idx!==-1?xbody(bO,idx):'',comment:getCommentBefore(bO,m.index)});}return r;}
function dtF(bC,bO){const re=/^\s*(?:@.*?^\s*)?(?:(?:late|final|const|static)\s+)*([\w<>?]+)?\s+(_?\w+)\s*(?:=.*?)?;/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15){const n=m[2];if(['return','continue','break'].includes(n))continue;r.push({v:n.startsWith('_')?'-':'+',t:(m[1]&&m[1].trim()!=='var')?m[1].trim().replace('?',''):'dynamic',n,comment:getCommentBefore(bO,m.index)});}return r;}
function dtM(bC,bO,cn){const re=/^\s*(?:@override\s*)?(?:(?:static|factory)\s+)*((?:[\w<>?]+\s+)?)(_?\w+)\s*\(([^)]*)\)(?:.*?\{|=>)/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15){const n=m[2];if(['if','switch','while','for','catch'].includes(n))continue;const idx=bC.indexOf('{',m.index);r.push({v:n.startsWith('_')?'-':'+',ret:m[1]?m[1].trim().replace('?',''):'',n,p:sp(m[3].trim()),ctor:n===cn,body:idx!==-1?xbody(bO,idx):'',comment:getCommentBefore(bO,m.index)});}return r;}

// ── relations with Deep Scan ──
function buildRels(){
  const r=[],ns=new Set(classes.map(c=>c.name));
  classes.forEach(cls=>{
    cls.par.forEach(p=>{
      if(ns.has(p)){const tgt=classes.find(c=>c.name===p);r.push({from:cls.name,to:p,kind:tgt?.type==='interface'?'implements':'extends',label:tgt?.type==='interface'?'מממש':'יורש מ',fld:null,mth:null});}
    });
    cls.fields.forEach(f=>{
      const tn=f.t.replace(/[<>\[\]]/g,' ').split(/\s+/).find(t=>ns.has(t));
      if(tn&&tn!==cls.name&&!r.find(x=>x.from===cls.name&&x.to===tn&&x.kind==='has'))
        r.push({from:cls.name,to:tn,kind:'has',label:`מחזיק: ${f.n}`,fld:f,mth:null});
    });
    cls.methods.forEach(m=>{
      [m.ret,...m.p.split(',')].forEach(t=>{
        const tn=(t||'').replace(/[<>\[\]]/g,' ').split(/\s+/).find(n=>ns.has(n));
        if(tn&&tn!==cls.name&&!r.find(x=>x.from===cls.name&&x.to===tn&&x.kind==='uses'))
          r.push({from:cls.name,to:tn,kind:'uses',label:`משתמש ב‑${tn}`,fld:null,mth:m});
      });
      if (m.body) {
        ns.forEach(tn => {
          if (tn !== cls.name) {
            const regex = new RegExp(`\\b${tn}\\b`);
            if (regex.test(m.body) && !r.find(x=>x.from===cls.name&&x.to===tn&&x.kind==='uses')) {
                  r.push({from:cls.name,to:tn,kind:'uses',label:`משתמש ב‑${tn} (בגוף הפונקציה)`,fld:null,mth:m});
            }
          }
        });
      }
    });
  });
  return r;
}

function buildInternalMethodRels(){
   classes.forEach(cls=>{
      cls.internalCalls = [];
      cls.methods.forEach(caller => {
         cls.methods.forEach(callee => {
            if(caller.n === callee.n || !caller.body) return;
            const regex = new RegExp(`\\b${callee.n}\\s*\\(`, 'g');
            if(regex.test(caller.body)){ cls.internalCalls.push({ from: caller, to: callee }); }
         });
      });
   });
}

// ── Layouts & Sizing ──
function ch(cls){
  let h=HEADER_H+PADV;
  if(cls.par.length) h+=14;
  if(cls.fields.length) h+=SEC_T+cls.fields.length*ROW_H+PADV;
  if(cls.methods.length) h+=SEC_T+cls.methods.length*ROW_H+PADV;
  return Math.max(h, HEADER_H+20);
}
function getCurH(n){ return (mode === 'flow' && selNode !== n) ? n.colH : n.h; }

function layout(){
  const ord=['interface','enum','abstract','class'];
  const srt=[...classes].sort((a,b)=>ord.indexOf(a.type)-ord.indexOf(b.type));
  
  if (mode === 'diagram') {
    const cols=Math.max(2,Math.ceil(Math.sqrt(srt.length*1.4))), gx=80, gy=80, rowH=[];
    srt.forEach((cls,i)=>{const row=Math.floor(i/cols);const h=ch(cls);rowH[row]=Math.max(rowH[row]||0,h);});
    const rowY=[60]; for(let r=1;r<rowH.length;r++) rowY[r]=rowY[r-1]+rowH[r-1]+gy;
    nodes=srt.map((cls,i)=>{
      const colH = HEADER_H + (cls.par.length ? 14 : 0) + PADV;
      return {cls, x:(i%cols)*(CW+gx)+60, y:rowY[Math.floor(i/cols)], w:CW, h:ch(cls), colH};
    });
  } else {
    nodes=srt.map((cls,i)=>{
      let ring = 0, passed = 0, cap = 8;
      while (i >= passed + cap) { passed += cap; ring++; cap += 8; }
      const indexInRing = i - passed, totalInRing = Math.min(cap, srt.length - passed), rRatio = 1 + ring * 1.1; 
      const rx = 650 * rRatio, ry = 400 * rRatio, angle = (indexInRing / totalInRing) * Math.PI * 2 - Math.PI / 2;
      const w = CW, colH = HEADER_H + (cls.par.length ? 14 : 0) + PADV;
      return {cls, x: rx*Math.cos(angle) - w/2, y: ry*Math.sin(angle) - colH/2, w: w, h: ch(cls), colH: colH};
    });
  }
  rv();
}

function rv(){
  if(!nodes.length)return;
  const minX=Math.min(...nodes.map(n=>n.x))-80, maxX=Math.max(...nodes.map(n=>n.x+n.w))+80;
  const minY=Math.min(...nodes.map(n=>n.y))-80, maxY=Math.max(...nodes.map(n=>n.y+getCurH(n)))+80;
  const tw=maxX-minX, th=maxY-minY;
  sc=Math.min(cv.width/tw,cv.height/th,.95); px=(cv.width-tw*sc)/2 - minX*sc; py=(cv.height-th*sc)/2 - minY*sc;
  draw();
}

// ── Main Canvas events ──
const cv=document.getElementById('cv'), cw=document.getElementById('cw');
function sizeCV(){cv.width=cw.clientWidth;cv.height=cw.clientHeight;}
window.addEventListener('resize',()=>{ sizeCV(); if(nodes.length)rv(); if(mNodes.length) sizeMCV(); });
sizeCV();

cv.addEventListener('mousedown',e=>{pan=true;moved=false;ds={x:e.clientX,y:e.clientY};ps={x:px,y:py};});

window.addEventListener('mousemove',e=>{
  // --- שומר הסף שמונע מהקנבס הראשי לפעול בזמן שהמודאל פתוח! ---
  if (document.getElementById('methodModal') && document.getElementById('methodModal').style.display === 'flex') return;

  if(pan){const dx=e.clientX-ds.x,dy=e.clientY-ds.y;if(Math.abs(dx)+Math.abs(dy)>3){moved=true;px=ps.x+dx;py=ps.y+dy;draw();}return;}
  const r=cv.getBoundingClientRect(),wx=(e.clientX-r.left-px)/sc,wy=(e.clientY-r.top-py)/sc;
  
  const hn=nodes.find(n=>wx>=n.x&&wx<=n.x+n.w&&wy>=n.y&&wy<=n.y+getCurH(n))||null;
  let hi=null, hr=null;
  
  if(hn && (mode!=='flow' || hn===selNode)){ hi=findItemAt(hn,wy); }
  if(!hn){ hr=findRel(wx,wy); }

  if(hn!==hNode || hi!==hItem || hr!==hRel){
     hNode=hn; hItem=hi; hRel=hr;
     cv.style.cursor=hn||hr?'pointer':'grab'; draw();
  }
  
  if(hr&&mode==='flow'){ showTip(e.clientX,e.clientY,{title:`${hr.from} → ${hr.to}`,subtitle:relKindHe(hr.kind),body:hr.label}); }
  else if(hi){ showTip(e.clientX,e.clientY,{title:hi.n, subtitle: hi.t ? `שדה: ${hi.t}` : `מתודה: ${hi.ctor?'Constructor':''}`, body: hi.comment}); }
  else { hideTip(); }
});

function findItemAt(node, wy){
   const cls=node.cls; let cy = node.y + HEADER_H;
   if(cls.par.length) cy+=14; cy+=PADV;
   if(cls.fields.length){
      cy+=SEC_T; if(wy>=cy && wy<=cy+cls.fields.length*ROW_H){ return cls.fields[Math.floor((wy-cy)/ROW_H)]; } cy+=cls.fields.length*ROW_H+PADV;
   }
   if(cls.methods.length){
      cy+=SEC_T; if(wy>=cy && wy<=cy+cls.methods.length*ROW_H){ return cls.methods[Math.floor((wy-cy)/ROW_H)]; }
   }
   return null;
}

window.addEventListener('mouseup',e=>{
  if(!pan)return; pan=false;
  if(!moved){
    const r=cv.getBoundingClientRect(),wx=(e.clientX-r.left-px)/sc,wy=(e.clientY-r.top-py)/sc;
    const hn=nodes.find(n=>wx>=n.x&&wx<=n.x+n.w&&wy>=n.y&&wy<=n.y+getCurH(n))||null;
    if(hn) {
       if(mode === 'flow' && selNode === hn) { openMethodModal(hn.cls); } 
       else { clickNode(hn); }
    } else if(!findRel(wx,wy)){ selNode=null; closeFP(); draw(); }
  }
});
cv.addEventListener('wheel',e=>{e.preventDefault();const r=cv.getBoundingClientRect();za(e.deltaY<0?1.1:.91,e.clientX-r.left,e.clientY-r.top);},{passive:false});
function zb(f){za(f,cv.width/2,cv.height/2);}
function za(f,cx,cy){const wx=(cx-px)/sc,wy=(cy-py)/sc;sc=Math.min(Math.max(sc*f,.08),4);px=cx-wx*sc;py=cy-wy*sc;draw();}

// ── Common Drawing Tools ──
function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}
function rrT(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}
function trunc(ctx,txt,maxW){if(ctx.measureText(txt).width<=maxW)return txt;while(txt.length>1&&ctx.measureText(txt+'…').width>maxW)txt=txt.slice(0,-1);return txt+'…';}
function related(a,b){return rels.some(r=>(r.from===a&&r.to===b)||(r.from===b&&r.to===a));}
function relKindHe(k){ return {extends:'ירושה',implements:'מימוש',has:'הכלה',uses:'שימוש'}[k]; }

function drawGrid(ctx, w, h, _px, _py, _sc) {
  ctx.save();ctx.strokeStyle='#e8edf2';ctx.lineWidth=1;
  const gs=40*_sc,ox=((_px%gs)+gs)%gs,oy=((_py%gs)+gs)%gs;
  for(let x=ox;x<w;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let y=oy;y<h;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  ctx.restore();
}

// ── Core Draw (Main) ──
function edgePt(n,tx,ty,isModal=false){
  const h = isModal ? n.h : getCurH(n);
  const cx=n.x+n.w/2,cy=n.y+h/2,dx=tx-cx,dy=ty-cy;
  if(!dx&&!dy)return{x:cx,y:cy};
  const t=Math.min(Math.abs(n.w/2/(dx||1e-9)),Math.abs(h/2/(dy||1e-9)));
  return{x:cx+dx*t,y:cy+dy*t};
}
function relMP(rel){
  const fn=nodes.find(n=>n.cls.name===rel.from),tn=nodes.find(n=>n.cls.name===rel.to);
  if(!fn||!tn)return null;
  const fH=getCurH(fn), tH=getCurH(tn);
  const fp=edgePt(fn,tn.x+tn.w/2,tn.y+tH/2),tp=edgePt(tn,fn.x+fn.w/2,fn.y+fH/2);
  const cx=(fp.x+tp.x)/2-(tp.y-fp.y)*.15,cy=(fp.y+tp.y)/2+(tp.x-fp.x)*.15;
  return{fp,tp,cx,cy};
}
function findRel(wx,wy){
  for(const rel of rels){
    const mp=relMP(rel);if(!mp)continue;
    for(let t=0;t<=1;t+=.04){
      const bx=(1-t)*(1-t)*mp.fp.x+2*(1-t)*t*mp.cx+t*t*mp.tp.x;
      const by=(1-t)*(1-t)*mp.fp.y+2*(1-t)*t*mp.cy+t*t*mp.tp.y;
      if(Math.abs(wx-bx)<9&&Math.abs(wy-by)<9)return rel;
    }
  }return null;
}

function draw(){
  const ctx=cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); 
  ctx.clearRect(0,0,cv.width,cv.height);
  drawGrid(ctx, cv.width, cv.height, px, py, sc);
  
  ctx.save();ctx.translate(px,py);ctx.scale(sc,sc);
  if (mode === 'flow') {
    nodes.forEach(n=>{ if(n!==selNode){ drawCard(ctx,n,false,n===hNode,selNode&&!related(selNode.cls.name,n.cls.name)); } });
    drawArrows(ctx);
    if(selNode){ drawCard(ctx,selNode,true,selNode===hNode,false); }
  } else {
    drawArrows(ctx); nodes.forEach(n=>{ drawCard(ctx,n,n===selNode,n===hNode,false); });
  }
  ctx.restore();
}

function drawArrows(ctx){
  rels.forEach(rel=>{
    if(mode==='flow'&&selNode&&rel.from!==selNode.cls.name&&rel.to!==selNode.cls.name)return;
    const mp=relMP(rel);if(!mp)return;
    const col=ACOL[rel.kind],isH=rel===hRel; ctx.save();
    if(mode==='flow'){ ctx.shadowColor='rgba(0,0,0,0.4)'; ctx.shadowBlur=3; }
    ctx.strokeStyle=col;ctx.fillStyle=col; ctx.lineWidth=isH?3:1.8;
    if(rel.kind==='uses'||rel.kind==='implements')ctx.setLineDash([5,4]);else ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(mp.fp.x,mp.fp.y);ctx.quadraticCurveTo(mp.cx,mp.cy,mp.tp.x,mp.tp.y);ctx.stroke(); ctx.setLineDash([]);
    const ang=Math.atan2(mp.tp.y-mp.cy,mp.tp.x-mp.cx),sz=10;
    if(rel.kind==='extends'||rel.kind==='implements'){
      ctx.beginPath();ctx.moveTo(mp.tp.x,mp.tp.y);ctx.lineTo(mp.tp.x-sz*Math.cos(ang-.4),mp.tp.y-sz*Math.sin(ang-.4));ctx.lineTo(mp.tp.x-sz*Math.cos(ang+.4),mp.tp.y-sz*Math.sin(ang+.4));ctx.closePath();ctx.fillStyle='white';ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.stroke();
    } else {
      ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(mp.tp.x,mp.tp.y);ctx.lineTo(mp.tp.x-sz*Math.cos(ang-.35),mp.tp.y-sz*Math.sin(ang-.35));ctx.lineTo(mp.tp.x-sz*Math.cos(ang+.35),mp.tp.y-sz*Math.sin(ang+.35));ctx.closePath();ctx.fill();
    }
    if(isH||(mode==='flow'&&selNode)){
      const lx=(mp.fp.x+mp.cx)/2, ly=(mp.fp.y+mp.cy)/2; 
      ctx.font='9px Segoe UI';ctx.fillStyle=col;ctx.fillText(rel.label,lx,ly-4); 
    }
    ctx.restore();
  });
}

function drawCard(ctx,n,sel,hov,dim){
  const expand = !(mode === 'flow') || sel, {cls,x,y,w}=n, col=CCOL[cls.type]||CCOL.class; const h = expand ? n.h : n.colH;
  ctx.save(); ctx.direction='ltr'; if(dim)ctx.globalAlpha=.18;
  ctx.shadowColor='rgba(0,0,0,.1)';ctx.shadowBlur=sel?18:7;ctx.shadowOffsetY=sel?5:2;
  rr(ctx,x,y,w,h,11);ctx.fillStyle='white';ctx.fill(); ctx.shadowBlur=0;ctx.shadowOffsetY=0; 
  ctx.strokeStyle=sel?col.dk:hov?col.bd:col.bd+'99';ctx.lineWidth=sel?2.5:hov?2:1.5;ctx.stroke();
  if(expand || cls.par.length){ rrT(ctx,x,y,w,HEADER_H,11);ctx.fillStyle=col.h;ctx.fill(); } else { rr(ctx,x,y,w,h,11);ctx.fillStyle=col.h;ctx.fill(); }
  
  ctx.font='italic 9px Segoe UI';ctx.fillStyle=col.dk+'bb'; ctx.fillText({class:'class',interface:'«interface»',abstract:'«abstract»',enum:'«enum»'}[cls.type]||'',x+PADH,y+15);
  ctx.font='bold 14px Segoe UI';ctx.fillStyle=col.tx; ctx.fillText(trunc(ctx,cls.name,w-PADH*2),x+PADH,y+36);
  let cy=y+HEADER_H; if(cls.par.length){ ctx.font='9px Segoe UI';ctx.fillStyle=col.dk; ctx.fillText(trunc(ctx,'▲ '+cls.par.slice(0,2).join(', '),w-PADH*2),x+PADH,cy+12); cy+=14; } cy+=PADV;

  if (expand) {
    function section(label,rows,drawFn){
      ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,cy);ctx.lineTo(x+w,cy);ctx.stroke();
      ctx.font='bold 8px Segoe UI';ctx.fillStyle='#a0aec0';ctx.fillText(label,x+PADH,cy+11);cy+=SEC_T;
      rows.forEach(row=>{drawFn(row,cy);cy+=ROW_H;}); cy+=PADV;
    } 
    section('FIELDS',cls.fields,(f,ry)=>{
      if(f===hItem) { ctx.fillStyle='#edf2f7'; ctx.fillRect(x+1,ry,w-2,ROW_H); }
      const vc={'+':'#38a169','-':'#e53e3e','#':'#d69e2e'}[f.v]||'#4a5568'; ctx.font='bold 11px Courier New';ctx.fillStyle=vc;ctx.fillText(f.v,x+PADH,ry+14);
      ctx.font='11px Courier New';ctx.fillStyle='#2d3748';ctx.fillText(trunc(ctx,`${f.n}: ${f.t}`,w-PADH-TEXT_INDENT-PADH),x+PADH+TEXT_INDENT,ry+14);
    }); 
    section('METHODS',cls.methods,(m,ry)=>{
      if(m===hItem) { ctx.fillStyle='#edf2f7'; ctx.fillRect(x+1,ry,w-2,ROW_H); }
      const vc={'+':'#38a169','-':'#e53e3e','#':'#d69e2e'}[m.v]||'#4a5568'; ctx.font='bold 11px Courier New';ctx.fillStyle=vc;ctx.fillText(m.v,x+PADH,ry+14);
      ctx.font='11px Courier New';ctx.fillStyle=m.ctor?'#805ad5':'#2d3748';ctx.fillText(trunc(ctx,`${m.n}(${m.p})${m.ret?': '+m.ret:''}`,w-PADH-TEXT_INDENT-PADH),x+PADH+TEXT_INDENT,ry+14);
    });
  }
  if(mode === 'flow' && sel){ ctx.font='bold 10px Segoe UI'; ctx.fillStyle='#3182ce'; ctx.textAlign='center'; ctx.fillText('לחץ שוב לזרימה פנימית', x+w/2, y+h-10); ctx.textAlign='left'; }
  ctx.restore();
}

// ==========================================
// ── Internal Method Flow (MODAL) ──
// ==========================================
const mcv = document.getElementById('mcv');

function openMethodModal(cls) {
   if(!cls.methods.length) { toast('אין פונקציות במחלקה זו'); return; }
   
   hideTip(); // נקיון - מוחק הייליטים פתוחים מהחלון הראשי לפני שהמודאל נפתח!
   
   document.getElementById('mmTitle').textContent = `זרימה פנימית: ${cls.name}`;
   document.getElementById('methodModal').style.display = 'flex';
   
   const mw = 220, mh = 40;
   mNodes = cls.methods.map((m, i) => {
      let ring = 0, passed = 0, cap = 8;
      while (i >= passed + cap) { passed += cap; ring++; cap += 6; }
      const indexInRing = i - passed, totalInRing = Math.min(cap, cls.methods.length - passed);
      const rRatio = 1 + ring * 1.1, rx = 350 * rRatio, ry = 200 * rRatio;
      const angle = (indexInRing / totalInRing) * Math.PI * 2 - Math.PI / 2;
      return { m: m, x: rx*Math.cos(angle) - mw/2, y: ry*Math.sin(angle) - mh/2, w: mw, h: mh };
   });
   
   mRels = cls.internalCalls || []; sizeMCV();
   
   const minX=Math.min(...mNodes.map(n=>n.x))-60, maxX=Math.max(...mNodes.map(n=>n.x+n.w))+60;
   const minY=Math.min(...mNodes.map(n=>n.y))-60, maxY=Math.max(...mNodes.map(n=>n.y+n.h))+60;
   const tw=maxX-minX, th=maxY-minY;
   msc=Math.min(mcv.width/tw, mcv.height/th, 1); mpx=(mcv.width-tw*msc)/2 - minX*msc; mpy=(mcv.height-th*msc)/2 - minY*msc;
   drawMethodCanvas();
}

function closeMethodModal() { document.getElementById('methodModal').style.display = 'none'; hideTip(); }
function sizeMCV() { mcv.width = document.getElementById('mmBody').clientWidth; mcv.height = document.getElementById('mmBody').clientHeight; }

mcv.addEventListener('mousedown',e=>{mPan=true;mds={x:e.clientX,y:e.clientY};mps={x:mpx,y:mpy};});
mcv.addEventListener('mousemove',e=>{
   if(mPan){ mpx=mps.x+(e.clientX-mds.x);mpy=mps.y+(e.clientY-mds.y);drawMethodCanvas(); return; }
   const r=mcv.getBoundingClientRect(), wx=(e.clientX-r.left-mpx)/msc, wy=(e.clientY-r.top-mpy)/msc;
   const hn = mNodes.find(n => wx>=n.x && wx<=n.x+n.w && wy>=n.y && wy<=n.y+n.h) || null;
   if(hn) {
      mcv.style.cursor = 'pointer';
      showTip(e.clientX, e.clientY, {title: hn.m.n, subtitle: 'מתודה', body: hn.m.comment});
   } else {
      mcv.style.cursor = 'grab'; hideTip();
   }
});
window.addEventListener('mouseup',()=>{mPan=false;});
mcv.addEventListener('wheel',e=>{e.preventDefault();const r=mcv.getBoundingClientRect();const f=e.deltaY<0?1.1:.91,wx=(e.clientX-r.left-mpx)/msc,wy=(e.clientY-r.top-mpy)/msc;msc=Math.min(Math.max(msc*f,.1),4);mpx=e.clientX-r.left-wx*msc;mpy=e.clientY-r.top-wy*msc;drawMethodCanvas();},{passive:false});

function drawMethodCanvas() {
   const ctx = mcv.getContext('2d'); 
   ctx.setTransform(1, 0, 0, 1, 0, 0);
   ctx.clearRect(0,0,mcv.width,mcv.height);
   drawGrid(ctx, mcv.width, mcv.height, mpx, mpy, msc);
   ctx.save(); ctx.translate(mpx, mpy); ctx.scale(msc, msc);
   
   mNodes.forEach(n => {
      ctx.save(); ctx.direction = 'ltr'; rr(ctx, n.x, n.y, n.w, n.h, 6); ctx.fillStyle = n.m.ctor ? '#faf5ff' : '#ffffff'; ctx.fill();
      ctx.strokeStyle = n.m.ctor ? '#b794f4' : '#cbd5e0'; ctx.lineWidth = 1.5; ctx.stroke();
      const vc={'+':'#38a169','-':'#e53e3e','#':'#d69e2e'}[n.m.v] || '#4a5568';
      ctx.font='bold 12px Courier New'; ctx.fillStyle=vc; ctx.fillText(n.m.v, n.x+10, n.y+24);
      ctx.font='12px Courier New'; ctx.fillStyle='#2d3748'; ctx.fillText(trunc(ctx, `${n.m.n}(${n.m.p})`, n.w - 30), n.x+22, n.y+24); ctx.restore();
   });
   
   mRels.forEach(rel => {
      const fn = mNodes.find(n => n.m.n === rel.from.n), tn = mNodes.find(n => n.m.n === rel.to.n);
      if(!fn || !tn) return;
      const fp = edgePt(fn, tn.x+tn.w/2, tn.y+tn.h/2, true), tp = edgePt(tn, fn.x+fn.w/2, fn.y+fn.h/2, true);
      const cx=(fp.x+tp.x)/2-(tp.y-fp.y)*.2, cy=(fp.y+tp.y)/2+(tp.x-fp.x)*.2;
      ctx.strokeStyle = 'rgba(128, 90, 213, 0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.quadraticCurveTo(cx, cy, tp.x, tp.y); ctx.stroke();
      const ang=Math.atan2(tp.y-cy,tp.x-cx),sz=8; ctx.fillStyle='rgba(128, 90, 213, 0.7)'; ctx.beginPath(); ctx.moveTo(tp.x,tp.y);ctx.lineTo(tp.x-sz*Math.cos(ang-.35),tp.y-sz*Math.sin(ang-.35));ctx.lineTo(tp.x-sz*Math.cos(ang+.35),tp.y-sz*Math.sin(ang+.35));ctx.closePath(); ctx.fill();
   });
   ctx.restore();
}

// ── Sidebar, Tooltip & Helpers ──
function renderList(){
  const el=document.getElementById('clList');el.innerHTML='';
  classes.forEach(cls=>{
    const d=document.createElement('div'); d.className='cit';d.dataset.n=cls.name;
    d.innerHTML=`<span class="badge b${cls.type[0]}">${{class:'C',interface:'I',abstract:'A',enum:'E'}[cls.type]}</span>${cls.name}`;
    d.onclick=()=>{ if(mode !== 'flow') setMode('diagram'); const n=nodes.find(x=>x.cls.name===cls.name); if(n){ px=cv.width/2-n.x*sc-n.w*sc/2; py=cv.height/2-n.y*sc-getCurH(n)*sc/2; clickNode(n); } };el.appendChild(d);
  });
}
function clickNode(node){
  selNode=node; document.querySelectorAll('.cit').forEach(e=>e.classList.remove('on'));
  const el=document.querySelector(`.cit[data-n="${node.cls.name}"]`); if(el){el.classList.add('on');el.scrollIntoView({block:'nearest'});}
  const cls=node.cls; document.getElementById('fpT').textContent=cls.name; document.getElementById('fpS').textContent=`📁 ${cls.file}`;
  const co=document.getElementById('fpComment'); co.style.display=cls.comment?'block':'none'; co.textContent=cls.comment;
  const out=rels.filter(r=>r.from===cls.name),inn=rels.filter(r=>r.to===cls.name); let html='';
  if(cls.par.length){html+=`<div class="fpsec"><h4>יורש / מממש</h4>`;cls.par.forEach(p=>{html+=`<div class="fpr">▲ ${p}</div>`;});html+=`</div>`;}
  if(out.length){html+=`<div class="fpsec"><h4>מוציא קשרים</h4>`;out.forEach(r=>{html+=`<div class="fpr"><span style="color:${ACOL[r.kind]}">■</span> ${relKindHe(r.kind)} &rarr; <b>${r.to}</b></div>`;});html+=`</div>`;}
  if(inn.length){html+=`<div class="fpsec"><h4>מקבל קשרים</h4>`;inn.forEach(r=>{html+=`<div class="fpr"><span style="color:${ACOL[r.kind]}">■</span> <b>${r.from}</b> &rarr; ${relKindHe(r.kind)}</div>`;});html+=`</div>`;}
  document.getElementById('fpB').innerHTML=html; document.getElementById('fp').style.display='block'; draw();
}
function showTip(mx,my,content){
  const t=document.getElementById('atip'); t.innerHTML=`<b>${content.title}</b><i>${content.subtitle}</i>`;
  if(content.body){ const b=document.createElement('div'); b.className='atip-comment'; b.textContent=content.body; t.appendChild(b); }
  t.style.display='block';t.style.left=(mx+12)+'px';t.style.top=(my-8)+'px';
}
function hideTip(){document.getElementById('atip').style.display='none';}
function closeFP(){document.getElementById('fp').style.display='none';}
function setMode(m){if(mode===m)return; mode=m; document.querySelectorAll('.mtab').forEach((t,i)=>t.classList.toggle('on',i===(m==='diagram'?0:1)));
if(m==='flow') document.getElementById('hint').textContent='לחץ על מחלקה להרחבה, ושוב לזרימה פנימית'; selNode=null;closeFP(); if(classes.length) layout();}
async function copyCode(){try{await navigator.clipboard.writeText(files.map((f,i)=>`// ===== ${f.name} =====\n${codes[i]}`).join('\n\n'));toast('✅ הועתק');}catch{toast('❌ שגיאה');}}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),3000);}

// ── Export Functions ──
async function exportPDF(){
  const prog=document.getElementById('prog');
  prog.style.display='flex';
  await new Promise(r=>setTimeout(r,60));
  try{
    const {jsPDF}=window.jspdf;
    const A4W=794, A4H=1123;
    const marginX=40, marginTop=36, marginBot=24;
    const cntW=A4W-marginX*2;
    const cntH=A4H-marginTop-marginBot;

    const gx=30, gy=30;
    const cols=Math.max(1, Math.floor((cntW+gx)/(CW+gx)));
    const colW=CW;
    const ord=['interface','enum','abstract','class'];
    const sorted=[...nodes].sort((a,b)=>ord.indexOf(a.cls.type)-ord.indexOf(b.cls.type));

    const pdfNodes=[];
    let pageIndex=0, col=0, rowX=marginX, rowY=marginTop, rowH=0;

    sorted.forEach(n=>{
      const cardH=n.h; 
      if(col>=cols){col=0; rowX=marginX; rowY+=rowH+gy; rowH=0;}
      if(rowY+cardH>A4H-marginBot && col===0){pageIndex++; rowY=marginTop; rowH=0;}
      pdfNodes.push({n, page:pageIndex, px:rowX, py:rowY, w:colW, h:cardH});
      rowH=Math.max(rowH,cardH);
      rowX+=colW+gx; col++;
    });
    const totalPages=pageIndex+1;

    const pdf=new jsPDF({orientation:'portrait',unit:'px',format:[A4W,A4H],hotfixes:['px_scaling']});

    // ── Cover page: Circular / Flow layout ──
    {
      const cc=document.createElement('canvas');
      cc.width=A4W; cc.height=A4H;
      const cctx=cc.getContext('2d');
      cctx.direction='ltr';

      cctx.fillStyle='#1a1a2e'; cctx.fillRect(0,0,A4W,A4H);
      cctx.save();
      cctx.translate(A4W,0); cctx.rotate(Math.PI/2);
      const LW=A4H, LH=A4W; 

      const grad=cctx.createLinearGradient(0,0,LW,LH);
      grad.addColorStop(0,'#1a1a2e'); grad.addColorStop(1,'#0f3460');
      cctx.fillStyle=grad; cctx.fillRect(0,0,LW,LH);

      cctx.fillStyle='white'; cctx.font='bold 28px Segoe UI';
      cctx.fillText('Project Flow Overview',32,52);
      cctx.font='14px Segoe UI'; cctx.fillStyle='rgba(255,255,255,.55)';
      cctx.fillText(`${files[0]?.name?.replace(/\.[^.]+$/,'')||'Project'}  ·  ${classes.length} classes  ·  ${rels.length} relations  ·  ${new Date().toLocaleDateString('he-IL')}`,32,76);

      const allNodes={};
      const BFONT=12;
      
      function breakIdentifier(ctx, text, maxW) {
          if (ctx.measureText(text).width <= maxW) return [text];
          const res = [];
          let cur = '';
          const parts = text.split(/(?=[A-Z])|\./); 
          for(let p of parts) {
              if(!p) continue;
              if(ctx.measureText(cur + p).width <= maxW) cur += p;
              else { if(cur) res.push(cur); cur = p; }
          }
          if(cur) res.push(cur);
          return res.length ? res : [text];
      }

      const cx = LW / 2;
      const cy = LH / 2 + 20;
      const baseRx = LW / 2 - 120;
      const baseRy = LH / 2 - 100;

      cctx.font = `bold ${BFONT}px Segoe UI`;
      classes.forEach((c, i) => {
          const ring = Math.floor(i / 18);
          const totalInRing = Math.min(18, classes.length - ring * 18);
          const indexInRing = i % 18;
          const rRatio = Math.max(0.3, 1 - (ring * 0.3));
          const rx = baseRx * rRatio;
          const ry = baseRy * rRatio;
          const angle = (indexInRing / totalInRing) * Math.PI * 2 - Math.PI / 2;

          const lines = breakIdentifier(cctx, c.name, 110);
          const maxTextW = Math.max(...lines.map(l => cctx.measureText(l).width));
          const bw = Math.max(70, maxTextW + 16);
          const bh = 14 + lines.length * 14;

          const bx = cx + rx * Math.cos(angle) - bw/2;
          const by = cy + ry * Math.sin(angle) - bh/2;
          allNodes[c.name] = {x: bx, y: by, w: bw, h: bh, type: c.type, lines: lines};
      });

      Object.entries(allNodes).forEach(([name,nd])=>{
        const col=CCOL[nd.type]||CCOL.class;
        const r=8;
        cctx.save();
        cctx.shadowColor=col.bd+'88'; cctx.shadowBlur=10;
        cctx.fillStyle=col.h;
        cctx.strokeStyle=col.bd; cctx.lineWidth=1.5;
        cctx.beginPath();
        cctx.moveTo(nd.x+r,nd.y); cctx.lineTo(nd.x+nd.w-r,nd.y);
        cctx.arcTo(nd.x+nd.w,nd.y,nd.x+nd.w,nd.y+r,r);
        cctx.lineTo(nd.x+nd.w,nd.y+nd.h-r);
        cctx.arcTo(nd.x+nd.w,nd.y+nd.h,nd.x+nd.w-r,nd.y+nd.h,r);
        cctx.lineTo(nd.x+r,nd.y+nd.h);
        cctx.arcTo(nd.x,nd.y+nd.h,nd.x,nd.y+nd.h-r,r);
        cctx.lineTo(nd.x,nd.y+r);
        cctx.arcTo(nd.x,nd.y,nd.x+r,nd.y,r);
        cctx.closePath();
        cctx.fill(); cctx.shadowBlur=0; cctx.stroke();

        cctx.font=`bold ${BFONT}px Segoe UI`; cctx.fillStyle=col.tx;
        cctx.textAlign='center';
        let textY = nd.y + (nd.h - (nd.lines.length * 14)) / 2 + 10;
        nd.lines.forEach(l => {
            cctx.fillText(l, nd.x+nd.w/2, textY);
            textY += 14;
        });
        cctx.textAlign='start';
        cctx.restore();
      });

      rels.forEach(rel=>{
        const fn=allNodes[rel.from],tn=allNodes[rel.to];
        if(!fn||!tn)return;
        const col=ACOL[rel.kind];
        const fn2={x:fn.x,y:fn.y,w:fn.w,h:fn.h};
        const tn2={x:tn.x,y:tn.y,w:tn.w,h:tn.h};
        
        const ep = (n,tx,ty) => {
           const cx=n.x+n.w/2,cy=n.y+n.h/2,dx=tx-cx,dy=ty-cy;
           if(!dx&&!dy)return{x:cx,y:cy};
           const t=Math.min(Math.abs(n.w/2/(dx||1e-9)),Math.abs(n.h/2/(dy||1e-9)));
           return{x:cx+dx*t,y:cy+dy*t};
        };

        const fp=ep(fn2,tn.x+tn.w/2,tn.y+tn.h/2);
        const tp=ep(tn2,fn.x+fn.w/2,fn.y+fn.h/2);
        const cxm=(fp.x+tp.x)/2+(tp.y-fp.y)*.15;
        const cym=(fp.y+tp.y)/2+(fp.x-tp.x)*.15;

        cctx.save();
        cctx.shadowColor='rgba(0,0,0,0.6)'; cctx.shadowBlur=3;
        cctx.strokeStyle=col; cctx.lineWidth=2;
        if(rel.kind==='uses'||rel.kind==='implements') cctx.setLineDash([5,4]); else cctx.setLineDash([]);
        cctx.beginPath(); cctx.moveTo(fp.x,fp.y); cctx.quadraticCurveTo(cxm,cym,tp.x,tp.y); cctx.stroke();
        cctx.setLineDash([]);
        
        const ang=Math.atan2(tp.y-cym,tp.x-cxm),sz=8;
        cctx.fillStyle=col;
        cctx.beginPath(); cctx.moveTo(tp.x,tp.y);
        cctx.lineTo(tp.x-sz*Math.cos(ang-.4),tp.y-sz*Math.sin(ang-.4));
        cctx.lineTo(tp.x-sz*Math.cos(ang+.4),tp.y-sz*Math.sin(ang+.4));
        cctx.closePath();
        if(rel.kind==='extends'||rel.kind==='implements'){
            cctx.fillStyle='white';cctx.fill();cctx.strokeStyle=col;cctx.lineWidth=1.5;cctx.stroke();
        } else {
            cctx.fill();
        }
        cctx.restore();
      });

      cctx.font='10px Segoe UI'; cctx.textAlign='start';
      let lx=32; const ly2=LH-14;
      cctx.fillStyle='rgba(255,255,255,.4)'; cctx.fillText('Relations:',lx,ly2); lx+=64;
      Object.entries({extends:'Extends',implements:'Implements',has:'Has-a',uses:'Uses'}).forEach(([k,v])=>{
        cctx.fillStyle=ACOL[k]; cctx.fillText(`■ ${v}`,lx,ly2); lx+=80;
      });

      cctx.restore();
      pdf.addImage(cc.toDataURL('image/jpeg',.93),'JPEG',0,0,A4W,A4H);
      pdf.addPage();
    }

    for(let p=0;p<totalPages;p++){
      if(p>0) pdf.addPage();
      const pc=document.createElement('canvas');
      pc.width=A4W; pc.height=A4H;
      const pctx=pc.getContext('2d');
      pctx.direction='ltr';
      pctx.fillStyle='#f8fafc'; pctx.fillRect(0,0,A4W,A4H);
      pctx.fillStyle='white';
      pctx.fillRect(marginX,marginTop,cntW,cntH);

      pctx.fillStyle='#1a1a2e';
      pctx.fillRect(0,0,A4W,marginTop-2);
      pctx.fillStyle='white'; pctx.font='bold 12px Segoe UI'; pctx.direction='ltr';
      pctx.fillText(`Class Diagram  —  page ${p+1} / ${totalPages}`, marginX, 22);
      pctx.font='10px Segoe UI'; pctx.fillStyle='#aaaacc';
      pctx.fillText(new Date().toLocaleDateString('he-IL'), A4W-marginX-60, 22);

      const pageCards=pdfNodes.filter(pn=>pn.page===p);

      pageCards.forEach(pn=>{
        const fake={cls:pn.n.cls, x:pn.px, y:pn.py, w:pn.w, h:pn.h};
        drawCard(pctx, fake, true, false, false);
      });

      if(p===totalPages-1){
        const ly=A4H-marginBot+4;
        pctx.strokeStyle='#e2e8f0'; pctx.lineWidth=1;
        pctx.beginPath(); pctx.moveTo(marginX,ly); pctx.lineTo(A4W-marginX,ly); pctx.stroke();
        pctx.font='9px Segoe UI'; pctx.direction='ltr';
        let lx=marginX;
        pctx.fillStyle='#555'; pctx.fillText('Legend:',lx,ly+14); lx+=46;
        Object.entries({extends:'Extends',implements:'Implements',has:'Has',uses:'Uses'}).forEach(([k,v])=>{
          const col=ACOL[k];
          pctx.fillStyle=col; pctx.fillText(`■ ${v}`,lx,ly+14); lx+=68;
        });
      }

      const img=pc.toDataURL('image/jpeg',0.93);
      pdf.addImage(img,'JPEG',0,0,A4W,A4H);
    }

    pdf.save(`class-diagram-${new Date().toLocaleDateString('he-IL').replace(/\//g,'-')}.pdf`);
    toast(`✅ PDF נשמר — ${totalPages} עמודים`);
  } catch(e){
    console.error(e); toast('❌ שגיאה: '+e.message);
  }
  prog.style.display='none';
}

function downloadHTML(exportMode){
  const origMode = mode;
  const origSel = selNode;
  
  if (mode !== exportMode) {
     mode = exportMode;
     selNode = null;
     layout();
  } else {
     selNode = null;
     rv(); 
  }

  const date=new Date().toLocaleDateString('he-IL');
  const projectName=files[0]?.name?.replace(/\.[^.]+$/,'')||'project';

  let bodyContent='';
  let extraScript='';

  if(exportMode==='diagram'){
    const minX=Math.min(...nodes.map(n=>n.x))-80;
    const maxX=Math.max(...nodes.map(n=>n.x+n.w))+80;
    const minY=Math.min(...nodes.map(n=>n.y))-80;
    const maxY=Math.max(...nodes.map(n=>n.y+getCurH(n)))+80;
    const tw=maxX-minX, th=maxY-minY;
    
    const oc=document.createElement('canvas');
    oc.width=tw; oc.height=th;
    const octx=oc.getContext('2d');
    octx.direction='ltr';
    octx.fillStyle='white'; octx.fillRect(0,0,tw,th);
    octx.translate(-minX, -minY);

    drawArrows(octx);
    nodes.forEach(n => drawCard(octx,n,false,false,false));

    const imgData=oc.toDataURL('image/png');

    bodyContent=`
      <div class="toolbar">
        <span class="logo">🗺️ תרשים מחלקות</span>
        <span class="meta">${projectName} · ${date} · ${classes.length} מחלקות · ${rels.length} קשרים</span>
        <div class="legend">
          ${Object.entries({extends:'Extends',implements:'Implements',has:'Has',uses:'Uses'})
            .map(([k,v])=>`<span style="color:${ACOL[k]}">■ ${v}</span>`).join('')}
        </div>
        <div class="zoom-btns">
          <button onclick="z(1.2)">+</button>
          <button onclick="z(0.83)">−</button>
          <button onclick="reset()">⌂</button>
        </div>
      </div>
      <div class="canvas-wrap" id="wrap">
        <img id="img" src="${imgData}" draggable="false">
      </div>`;
      
    extraScript=`
      let sc=1,ox=0,oy=0,pan=false,ds={x:0,y:0},ps={x:0,y:0};
      const img=document.getElementById('img');
      const wrap=document.getElementById('wrap');
      function applyT(){img.style.transform='translate('+ox+'px,'+oy+'px) scale('+sc+')';}
      function z(f){sc=Math.min(Math.max(sc*f,0.05),8);applyT();}
      function reset(){
        const r=wrap.getBoundingClientRect();
        sc=Math.min(r.width/img.naturalWidth,r.height/img.naturalHeight,1);
        ox=(r.width-img.naturalWidth*sc)/2; oy=(r.height-img.naturalHeight*sc)/2; applyT();
      }
      wrap.addEventListener('mousedown',e=>{pan=true;ds={x:e.clientX,y:e.clientY};ps={x:ox,y:oy};});
      window.addEventListener('mousemove',e=>{if(pan){ox=ps.x+(e.clientX-ds.x);oy=ps.y+(e.clientY-ds.y);applyT();}});
      window.addEventListener('mouseup',()=>pan=false);
      wrap.addEventListener('wheel',e=>{e.preventDefault();z(e.deltaY<0?1.1:0.91);},{passive:false});
      window.addEventListener('load',reset);`;
      
  } else {
    const relJSON=JSON.stringify(rels);
    const nodesJSON=JSON.stringify(nodes);
    
    bodyContent=`
      <div class="toolbar">
        <span class="logo">⚡ תרשים זרימה אינטראקטיבי</span>
        <span class="meta">${projectName} · ${date}</span>
        <span class="hint">לחץ על קופסה להרחבה, ולחץ שוב לזרימה פנימית</span>
        <div class="zoom-btns" style="margin-right:auto; display:flex; gap:4px;">
          <button onclick="zb(1.2)">+</button>
          <button onclick="zb(0.83)">−</button>
          <button onclick="rv()" title="איפוס">⌂</button>
        </div>
      </div>
      <div class="canvas-wrap" id="wrap">
        <canvas id="cv"></canvas>
        <div class="atip" id="atip"></div>
        
        <div class="modal-overlay" id="methodModal">
          <div class="modal-box">
            <div class="modal-header">
              <h2 id="mmTitle" style="font-size:1rem;margin:0;">זרימה פנימית</h2>
              <button class="modal-close" onclick="closeMethodModal()">✕</button>
            </div>
            <div class="modal-body" id="mmBody"><canvas id="mcv"></canvas></div>
          </div>
        </div>
      </div>`;
      
    extraScript=`
      const CW=300, HEADER_H=58, ROW_H=20, SEC_T=17, PADV=8, PADH=14, TEXT_INDENT=18;
      const ACOL={extends:'#e53e3e',implements:'#3182ce',has:'#38a169',uses:'#805ad5'};
      const CCOL={
        class:    {h:'#c6f6d5',dk:'#276749',bd:'#68d391',tx:'#1a4731'},
        interface:{h:'#bee3f8',dk:'#2a4365',bd:'#63b3ed',tx:'#1a365d'},
        abstract: {h:'#feebc8',dk:'#7b341e',bd:'#f6ad55',tx:'#652b19'},
        enum:     {h:'#e9d8fd',dk:'#44337a',bd:'#b794f4',tx:'#322659'},
      };
      
      let nodes = ${nodesJSON};
      let rels = ${relJSON};
      
      let sc=1, px=0, py=0, pan=false, ds={x:0,y:0}, ps={x:0,y:0}, moved=false;
      let selNode=null, hNode=null, hRel=null, hItem=null;
      
      let mNodes=[], mRels=[], msc=1, mpx=0, mpy=0, mPan=false, mds={x:0,y:0}, mps={x:0,y:0};

      const cv = document.getElementById('cv');
      const wrap = document.getElementById('wrap');
      const mcv = document.getElementById('mcv');

      function sizeCV(){ cv.width = wrap.clientWidth; cv.height = wrap.clientHeight; }
      window.addEventListener('resize', ()=>{ sizeCV(); rv(); if(mNodes.length) sizeMCV(); });

      function getCurH(n){ return (n !== selNode) ? n.colH : n.h; }

      function rv(){
        if(!nodes.length)return;
        const minX=Math.min(...nodes.map(n=>n.x))-80;
        const maxX=Math.max(...nodes.map(n=>n.x+n.w))+80;
        const minY=Math.min(...nodes.map(n=>n.y))-80;
        const maxY=Math.max(...nodes.map(n=>n.y+getCurH(n)))+80;
        const tw=maxX-minX, th=maxY-minY;
        sc=Math.min(cv.width/tw, cv.height/th, 0.95);
        px=(cv.width-tw*sc)/2 - minX*sc;
        py=(cv.height-th*sc)/2 - minY*sc;
        draw();
      }

      function zb(f){ za(f, cv.width/2, cv.height/2); }
      function za(f,cx,cy){
        const wx=(cx-px)/sc, wy=(cy-py)/sc;
        sc=Math.min(Math.max(sc*f, 0.08), 4);
        px=cx-wx*sc; py=cy-wy*sc;
        draw();
      }

      function findItemAt(node, wy){
         const cls=node.cls; let cy = node.y + HEADER_H;
         if(cls.par.length) cy+=14; cy+=PADV;
         if(cls.fields.length){
            cy+=SEC_T; if(wy>=cy && wy<=cy+cls.fields.length*ROW_H){ return cls.fields[Math.floor((wy-cy)/ROW_H)]; } cy+=cls.fields.length*ROW_H+PADV;
         }
         if(cls.methods.length){
            cy+=SEC_T; if(wy>=cy && wy<=cy+cls.methods.length*ROW_H){ return cls.methods[Math.floor((wy-cy)/ROW_H)]; }
         }
         return null;
      }

      cv.addEventListener('mousedown',e=>{pan=true;moved=false;ds={x:e.clientX,y:e.clientY};ps={x:px,y:py};});
      
      window.addEventListener('mousemove',e=>{
        // --- שומר הסף בקובץ המיוצא! ---
        if (document.getElementById('methodModal') && document.getElementById('methodModal').style.display === 'flex') return;
      
        if(pan){const dx=e.clientX-ds.x,dy=e.clientY-ds.y;if(Math.abs(dx)+Math.abs(dy)>3){moved=true;px=ps.x+dx;py=ps.y+dy;draw();}return;}
        const r=cv.getBoundingClientRect(),wx=(e.clientX-r.left-px)/sc,wy=(e.clientY-r.top-py)/sc;
        const hn=nodes.find(n=>wx>=n.x&&wx<=n.x+n.w&&wy>=n.y&&wy<=n.y+getCurH(n))||null;
        let hi=null, hr=null;
        
        if(hn && hn===selNode){ hi=findItemAt(hn,wy); }
        if(!hn){ hr=findRel(wx,wy); }
        
        if(hn!==hNode || hi!==hItem || hr!==hRel){
           hNode=hn; hItem=hi; hRel=hr;
           cv.style.cursor=hn||hr?'pointer':'grab'; draw();
        }
        
        if(hr){ 
            const kh={extends:'ירושה',implements:'מימוש',has:'הכלה',uses:'שימוש'}[hr.kind];
            showTip(e.clientX,e.clientY,{title:hr.from+' &rarr; '+hr.to, subtitle:kh, body:hr.label}); 
        } else if(hi){ 
            showTip(e.clientX,e.clientY,{title:hi.n, subtitle:hi.t?'שדה: '+hi.t:'מתודה: '+(hi.ctor?'Constructor':''), body:hi.comment}); 
        } else { hideTip(); }
      });
      
      window.addEventListener('mouseup',e=>{
        if(!pan)return; pan=false;
        if(!moved){
          const r=cv.getBoundingClientRect(),wx=(e.clientX-r.left-px)/sc,wy=(e.clientY-r.top-py)/sc;
          const hn=nodes.find(n=>wx>=n.x&&wx<=n.x+n.w&&wy>=n.y&&wy<=n.y+getCurH(n))||null;
          if(hn){
            if(selNode === hn) { openMethodModal(hn.cls); } 
            else { selNode = hn; draw(); }
          } else if(!findRel(wx,wy)){ selNode = null; draw(); }
        }
      });
      cv.addEventListener('wheel',e=>{e.preventDefault();const r=cv.getBoundingClientRect();za(e.deltaY<0?1.1:.91,e.clientX-r.left,e.clientY-r.top);},{passive:false});

      function edgePt(n,tx,ty,isModal=false){
        const h = isModal ? n.h : getCurH(n);
        const cx=n.x+n.w/2,cy=n.y+h/2,dx=tx-cx,dy=ty-cy;
        if(!dx&&!dy)return{x:cx,y:cy};
        const t=Math.min(Math.abs(n.w/2/(dx||1e-9)),Math.abs(h/2/(dy||1e-9)));
        return{x:cx+dx*t,y:cy+dy*t};
      }
      function relMP(rel){
        const fn=nodes.find(n=>n.cls.name===rel.from),tn=nodes.find(n=>n.cls.name===rel.to);
        if(!fn||!tn)return null;
        const fH=getCurH(fn), tH=getCurH(tn);
        const fp=edgePt(fn,tn.x+tn.w/2,tn.y+tH/2),tp=edgePt(tn,fn.x+fn.w/2,fn.y+fH/2);
        const cx=(fp.x+tp.x)/2-(tp.y-fp.y)*.15,cy=(fp.y+tp.y)/2+(tp.x-fp.x)*.15;
        return{fp,tp,cx,cy};
      }
      function findRel(wx,wy){
        for(const rel of rels){
          const mp=relMP(rel);if(!mp)continue;
          for(let t=0;t<=1;t+=.04){
            const bx=(1-t)*(1-t)*mp.fp.x+2*(1-t)*t*mp.cx+t*t*mp.tp.x;
            const by=(1-t)*(1-t)*mp.fp.y+2*(1-t)*t*mp.cy+t*t*mp.tp.y;
            if(Math.abs(wx-bx)<9&&Math.abs(wy-by)<9)return rel;
          }
        }return null;
      }

      function related(a,b){return rels.some(r=>(r.from===a&&r.to===b)||(r.from===b&&r.to===a));}

      function showTip(mx,my,content){
        const t=document.getElementById('atip');
        t.innerHTML='<b>'+content.title+'</b><i>'+content.subtitle+'</i>';
        if(content.body){ const b=document.createElement('div'); b.className='atip-comment'; b.textContent=content.body; t.appendChild(b); }
        t.style.display='block';t.style.left=(mx+12)+'px';t.style.top=(my-8)+'px';
      }
      function hideTip(){document.getElementById('atip').style.display='none';}

      function draw(){
        const ctx=cv.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0); 
        ctx.clearRect(0,0,cv.width,cv.height);
        
        ctx.save();ctx.strokeStyle='#e8edf2';ctx.lineWidth=1;
        const gs=40*sc,ox=((px%gs)+gs)%gs,oy=((py%gs)+gs)%gs;
        for(let x=ox;x<cv.width;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,cv.height);ctx.stroke();}
        for(let y=oy;y<cv.height;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(cv.width,y);ctx.stroke();}
        ctx.restore();
        
        ctx.save();ctx.translate(px,py);ctx.scale(sc,sc);
        nodes.forEach(n=>{
          if(n!==selNode){
            const dim=selNode&&!related(selNode.cls.name,n.cls.name);
            drawCard(ctx,n,false,n===hNode,dim);
          }
        });
        drawArrows(ctx);
        if(selNode){ drawCard(ctx,selNode,true,selNode===hNode,false); }
        ctx.restore();
      }

      function drawArrows(ctx){
        const seen=new Set();
        rels.forEach(rel=>{
          if(selNode&&rel.from!==selNode.cls.name&&rel.to!==selNode.cls.name)return;
          const key=rel.from+'|'+rel.to+'|'+rel.kind;if(seen.has(key))return;seen.add(key);
          const mp=relMP(rel);if(!mp)return;
          const col=ACOL[rel.kind],isH=rel===hRel;
          ctx.save();
          ctx.shadowColor='rgba(0,0,0,0.4)'; ctx.shadowBlur=3;
          ctx.strokeStyle=col;ctx.fillStyle=col; ctx.lineWidth=isH?3:1.8;
          if(rel.kind==='uses'||rel.kind==='implements')ctx.setLineDash([5,4]);else ctx.setLineDash([]);
          ctx.beginPath();ctx.moveTo(mp.fp.x,mp.fp.y);ctx.quadraticCurveTo(mp.cx,mp.cy,mp.tp.x,mp.tp.y);ctx.stroke(); ctx.setLineDash([]);
          const ang=Math.atan2(mp.tp.y-mp.cy,mp.tp.x-mp.cx),sz=10;
          if(rel.kind==='extends'||rel.kind==='implements'){
            ctx.beginPath();ctx.moveTo(mp.tp.x,mp.tp.y);ctx.lineTo(mp.tp.x-sz*Math.cos(ang-.4),mp.tp.y-sz*Math.sin(ang-.4));ctx.lineTo(mp.tp.x-sz*Math.cos(ang+.4),mp.tp.y-sz*Math.sin(ang+.4));ctx.closePath();ctx.fillStyle='white';ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.stroke();
          } else {
            ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(mp.tp.x,mp.tp.y);ctx.lineTo(mp.tp.x-sz*Math.cos(ang-.35),mp.tp.y-sz*Math.sin(ang-.35));ctx.lineTo(mp.tp.x-sz*Math.cos(ang+.35),mp.tp.y-sz*Math.sin(ang+.35));ctx.closePath();ctx.fill();
          }
          if(isH||selNode){
            const lx=(mp.fp.x+mp.cx)/2,ly=(mp.fp.y+mp.cy)/2;
            ctx.font='9px Segoe UI';ctx.fillStyle=col;ctx.fillText(rel.label,lx,ly-4);
          }
          ctx.restore();
        });
      }

      function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}
      function rrT(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}
      function trunc(ctx,txt,maxW){if(ctx.measureText(txt).width<=maxW)return txt;while(txt.length>1&&ctx.measureText(txt+'…').width>maxW)txt=txt.slice(0,-1);return txt+'…';}

      function drawCard(ctx,n,sel,hov,dim){
        const expand = sel, cls=n.cls, x=n.x, y=n.y, w=n.w, col=CCOL[cls.type]||CCOL.class, h = expand ? n.h : n.colH;
        
        ctx.save(); ctx.direction='ltr'; if(dim)ctx.globalAlpha=.18;
        ctx.shadowColor='rgba(0,0,0,.1)';ctx.shadowBlur=sel?18:7;ctx.shadowOffsetY=sel?5:2;
        rr(ctx,x,y,w,h,11);ctx.fillStyle='white';ctx.fill();
        ctx.shadowBlur=0;ctx.shadowOffsetY=0;
        ctx.strokeStyle=sel?col.dk:hov?col.bd:col.bd+'99';ctx.lineWidth=sel?2.5:hov?2:1.5;ctx.stroke();
        
        if(expand || cls.par.length){ rrT(ctx,x,y,w,HEADER_H,11);ctx.fillStyle=col.h;ctx.fill(); } 
        else { rr(ctx,x,y,w,h,11);ctx.fillStyle=col.h;ctx.fill(); }

        ctx.font='italic 9px Segoe UI';ctx.fillStyle=col.dk+'bb'; ctx.fillText({class:'class',interface:'«interface»',abstract:'«abstract»',enum:'«enum»'}[cls.type]||'',x+PADH,y+15);
        ctx.font='bold 14px Segoe UI';ctx.fillStyle=col.tx; ctx.fillText(trunc(ctx,cls.name,w-PADH*2),x+PADH,y+36);
        
        let cy=y+HEADER_H;
        if(cls.par.length){ ctx.font='9px Segoe UI';ctx.fillStyle=col.dk; ctx.fillText(trunc(ctx,'▲ '+cls.par.slice(0,2).join(', '),w-PADH*2),x+PADH,cy+12); cy+=14; }
        cy+=PADV;

        if (expand) {
          function section(label,rows,drawFn){
            ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,cy);ctx.lineTo(x+w,cy);ctx.stroke();
            ctx.font='bold 8px Segoe UI';ctx.fillStyle='#a0aec0';ctx.fillText(label,x+PADH,cy+11);cy+=SEC_T;
            rows.forEach(row=>{drawFn(row,cy);cy+=ROW_H;}); cy+=PADV;
          }

          if(cls.fields.length){
            section('FIELDS',cls.fields,(f,ry)=>{
              if(f===hItem) { ctx.fillStyle='#edf2f7'; ctx.fillRect(x+1,ry,w-2,ROW_H); }
              const vc={'+':'#38a169','-':'#e53e3e','#':'#d69e2e'}[f.v]||'#4a5568';
              ctx.font='bold 11px Courier New';ctx.fillStyle=vc;ctx.fillText(f.v,x+PADH,ry+14);
              ctx.font='11px Courier New';ctx.fillStyle='#2d3748'; ctx.fillText(trunc(ctx,f.n+': '+f.t,w-PADH-TEXT_INDENT-PADH),x+PADH+TEXT_INDENT,ry+14);
            });
          }
          if(cls.methods.length){
            section('METHODS',cls.methods,(m,ry)=>{
              if(m===hItem) { ctx.fillStyle='#edf2f7'; ctx.fillRect(x+1,ry,w-2,ROW_H); }
              const vc={'+':'#38a169','-':'#e53e3e','#':'#d69e2e'}[m.v]||'#4a5568';
              ctx.font='bold 11px Courier New';ctx.fillStyle=vc;ctx.fillText(m.v,x+PADH,ry+14);
              ctx.font='11px Courier New';ctx.fillStyle=m.ctor?'#805ad5':'#2d3748';
              const sig=m.n+'('+m.p+')'+(m.ret?': '+m.ret:'');
              ctx.fillText(trunc(ctx,sig,w-PADH-TEXT_INDENT-PADH),x+PADH+TEXT_INDENT,ry+14);
            });
          }
        }
        ctx.restore();
      }

      // --- לוגיקת המודאל בקובץ המיוצא ---
      function openMethodModal(cls) {
         if(!cls.methods.length) return;
         hideTip(); // נקיון!
         document.getElementById('mmTitle').textContent = 'זרימה פנימית: ' + cls.name;
         document.getElementById('methodModal').style.display = 'flex';
         
         const mw = 220, mh = 40;
         mNodes = cls.methods.map((m, i) => {
            let ring = 0, passed = 0, cap = 8;
            while (i >= passed + cap) { passed += cap; ring++; cap += 6; }
            const indexInRing = i - passed, totalInRing = Math.min(cap, cls.methods.length - passed);
            const rRatio = 1 + ring * 1.1, rx = 350 * rRatio, ry = 200 * rRatio;
            const angle = (indexInRing / totalInRing) * Math.PI * 2 - Math.PI / 2;
            return { m: m, x: rx*Math.cos(angle) - mw/2, y: ry*Math.sin(angle) - mh/2, w: mw, h: mh };
         });
         mRels = cls.internalCalls || []; sizeMCV();
         const minX=Math.min(...mNodes.map(n=>n.x))-60, maxX=Math.max(...mNodes.map(n=>n.x+n.w))+60;
         const minY=Math.min(...mNodes.map(n=>n.y))-60, maxY=Math.max(...mNodes.map(n=>n.y+n.h))+60;
         const tw=maxX-minX, th=maxY-minY;
         msc=Math.min(mcv.width/tw, mcv.height/th, 1); mpx=(mcv.width-tw*msc)/2 - minX*msc; mpy=(mcv.height-th*msc)/2 - minY*msc;
         drawMethodCanvas();
      }

      function closeMethodModal() { document.getElementById('methodModal').style.display = 'none'; hideTip(); }
      function sizeMCV() { mcv.width = document.getElementById('mmBody').clientWidth; mcv.height = document.getElementById('mmBody').clientHeight; }

      mcv.addEventListener('mousedown',e=>{mPan=true;mds={x:e.clientX,y:e.clientY};mps={x:mpx,y:mpy};});
      mcv.addEventListener('mousemove',e=>{
         if(mPan){ mpx=mps.x+(e.clientX-mds.x);mpy=mps.y+(e.clientY-mds.y);drawMethodCanvas(); return; }
         const r=mcv.getBoundingClientRect(), wx=(e.clientX-r.left-mpx)/msc, wy=(e.clientY-r.top-mpy)/msc;
         const hn = mNodes.find(n => wx>=n.x && wx<=n.x+n.w && wy>=n.y && wy<=n.y+n.h) || null;
         if(hn) {
            mcv.style.cursor = 'pointer';
            showTip(e.clientX, e.clientY, {title: hn.m.n, subtitle: 'מתודה', body: hn.m.comment});
         } else { mcv.style.cursor = 'grab'; hideTip(); }
      });
      window.addEventListener('mouseup',()=>{mPan=false;});
      mcv.addEventListener('wheel',e=>{e.preventDefault();const r=mcv.getBoundingClientRect();const f=e.deltaY<0?1.1:.91,wx=(e.clientX-r.left-mpx)/msc,wy=(e.clientY-r.top-mpy)/msc;msc=Math.min(Math.max(msc*f,.1),4);mpx=e.clientX-r.left-wx*msc;mpy=e.clientY-r.top-wy*msc;drawMethodCanvas();},{passive:false});

      function drawMethodCanvas() {
         const ctx = mcv.getContext('2d'); 
         ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0,0,mcv.width,mcv.height);
         ctx.save(); ctx.strokeStyle='#e8edf2'; ctx.lineWidth=1;
         const gs=40*msc,ox=((mpx%gs)+gs)%gs,oy=((mpy%gs)+gs)%gs;
         for(let x=ox;x<mcv.width;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,mcv.height);ctx.stroke();}
         for(let y=oy;y<mcv.height;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(mcv.width,y);ctx.stroke();}
         ctx.restore();
         
         ctx.save(); ctx.translate(mpx, mpy); ctx.scale(msc, msc);
         mNodes.forEach(n => {
            ctx.save(); ctx.direction = 'ltr'; rr(ctx, n.x, n.y, n.w, n.h, 6); ctx.fillStyle = n.m.ctor ? '#faf5ff' : '#ffffff'; ctx.fill();
            ctx.strokeStyle = n.m.ctor ? '#b794f4' : '#cbd5e0'; ctx.lineWidth = 1.5; ctx.stroke();
            const vc={'+':'#38a169','-':'#e53e3e','#':'#d69e2e'}[n.m.v] || '#4a5568';
            ctx.font='bold 12px Courier New'; ctx.fillStyle=vc; ctx.fillText(n.m.v, n.x+10, n.y+24);
            ctx.font='12px Courier New'; ctx.fillStyle='#2d3748'; ctx.fillText(trunc(ctx, n.m.n+'('+n.m.p+')', n.w - 30), n.x+22, n.y+24); ctx.restore();
         });
         mRels.forEach(rel => {
            const fn = mNodes.find(n => n.m.n === rel.from.n), tn = mNodes.find(n => n.m.n === rel.to.n);
            if(!fn || !tn) return;
            const fp = edgePt(fn, tn.x+tn.w/2, tn.y+tn.h/2, true), tp = edgePt(tn, fn.x+fn.w/2, fn.y+fn.h/2, true);
            const cx=(fp.x+tp.x)/2-(tp.y-fp.y)*.2, cy=(fp.y+tp.y)/2+(tp.x-fp.x)*.2;
            ctx.strokeStyle = 'rgba(128, 90, 213, 0.6)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.quadraticCurveTo(cx, cy, tp.x, tp.y); ctx.stroke();
            const ang=Math.atan2(tp.y-cy,tp.x-cx),sz=8; ctx.fillStyle='rgba(128, 90, 213, 0.7)'; ctx.beginPath(); ctx.moveTo(tp.x,tp.y);ctx.lineTo(tp.x-sz*Math.cos(ang-.35),tp.y-sz*Math.sin(ang-.35));ctx.lineTo(tp.x-sz*Math.cos(ang+.35),tp.y-sz*Math.sin(ang+.35));ctx.closePath(); ctx.fill();
         });
         ctx.restore();
      }

      window.addEventListener('load', ()=>{ sizeCV(); rv(); });
    `;
  }

  mode = origMode;
  selNode = origSel;
  layout();

  const diagramCSS=exportMode==='diagram'?`
    .canvas-wrap{flex:1;overflow:hidden;position:relative;cursor:grab;background:#f8fafc;border-radius:10px;}
    #img{position:absolute;top:0;left:0;transform-origin:top left;user-select:none;}
    .zoom-btns button{background:#edf2f7;border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:1rem;font-weight:700;margin-right:4px;}
  `:`
    .canvas-wrap{flex:1;position:relative;overflow:hidden;background:#f8fafc;}
    #cv{display:block;width:100%;height:100%;cursor:grab;}
    #cv:active{cursor:grabbing;}
    .atip{position:absolute;background:rgba(26, 32, 44, 0.95);color:white;padding:10px 14px;border-radius:8px;font-size:.74rem;pointer-events:none;display:none;max-width:350px;box-shadow:0 4px 14px rgba(0,0,0,.22);line-height:1.5;z-index:2000;direction:ltr;text-align:left}
    .atip b{color:#63b3ed;display:block;margin-bottom:4px}
    .atip-comment{color:#a0aec0;font-style:italic;margin-top:6px;border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;white-space:pre-wrap}
    .zoom-btns button{background:#edf2f7;border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:1rem;font-weight:700;margin-right:4px;}
    
    .modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.7); display: none; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px); animation: fadeIn 0.2s ease-out; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .modal-box { background: #f8fafc; width: 92vw; height: 88vh; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); border: 1px solid #e2e8f0; animation: slideUp 0.3s ease-out; }
    @keyframes slideUp { from { transform: translateY(20px); opacity:0; } to { transform: translateY(0); opacity:1; } }
    .modal-header { background: linear-gradient(135deg, #2d3748, #1a202c); color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; flex-shrink:0; }
    .modal-close { background: rgba(255,255,255,0.1); border: none; color: white; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 1rem; display:flex; align-items:center; justify-content:center; transition: background 0.2s; }
    .modal-close:hover { background: #e53e3e; }
    .modal-body { flex: 1; position: relative; overflow: hidden; cursor: grab; background:#f1f5f9; }
    .modal-body:active { cursor: grabbing; }
    #mcv { display: block; width: 100%; height: 100%; }
  `;

  const html=`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${exportMode==='diagram'?'תרשים מחלקות':'תרשים זרימה אינטראקטיבי'} — ${projectName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.toolbar{background:linear-gradient(135deg,#1a1a2e,#0f3460);color:white;padding:0 20px;height:52px;display:flex;align-items:center;gap:16px;flex-shrink:0}
.logo{font-weight:700;font-size:1.05rem}
.meta{font-size:.72rem;opacity:.65}
.hint{font-size:.75rem;background:rgba(255,255,255,.12);border-radius:6px;padding:4px 10px}
.legend{display:flex;gap:12px;font-size:.75rem;margin-right:auto}
${diagramCSS}
</style>
</head>
<body>
${bodyContent}
<script>
${extraScript}
<\/script>
</body>
</html>`;

  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`${exportMode==='diagram'?'class-diagram':'interactive-flow'}-${projectName}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`✅ ${exportMode==='diagram'?'תרשים':'זרימה'} הורד בהצלחה!`);
}
