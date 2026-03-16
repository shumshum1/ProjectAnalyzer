// ====== js/main.js ======
import { parse, buildRels, buildInternalMethodRels, assignLayer } from './parser.js';
import { generateHTMLExport, copyCode, exportPDF } from './exporter.js';

const CW=300, HEADER_H=58, ROW_H=20, SEC_T=17, PADV=8, PADH=14, TEXT_INDENT=18;
const ACOL={extends:'#e53e3e',implements:'#3182ce',has:'#38a169',uses:'#805ad5'};const CCOL={
  class:    {h:'#c6f6d5',dk:'#276749',bd:'#68d391',tx:'#1a4731'},
  interface:{h:'#bee3f8',dk:'#2a4365',bd:'#63b3ed',tx:'#1a365d'},
  abstract: {h:'#feebc8',dk:'#7b341e',bd:'#f6ad55',tx:'#652b19'},
  enum:     {h:'#e9d8fd',dk:'#44337a',bd:'#b794f4',tx:'#322659'},
};

let files=[], codes=[], classes=[], rels=[], nodes=[];
let mode='diagram', sc=1, px=0, py=0, pan=false, ds={x:0,y:0}, ps={x:0,y:0}, moved=false;
let hNode=null, selNode=null, hRel=null, hItem=null; 
let mNodes=[], mRels=[], msc=1, mpx=0, mpy=0, mPan=false, mds={x:0,y:0}, mps={x:0,y:0};

// ==========================================
// 🎛️ מנגנון סינון קשרים (Legend Filters)
// ==========================================
window.relFilters = { extends: true, implements: true, has: true, uses: true };

function getFilteredRels() {
    return rels.filter(r => window.relFilters[r.kind]);
}

window.toggleRelFilter = function(kind, isChecked) {
    window.relFilters[kind] = isChecked;
    if(mode === 'arch') ArchLayerManager.calculate();
    else layout(); 
    rv();
};

function createRelFiltersUI() {
    if (document.getElementById('relFilterBox')) {
        document.getElementById('relFilterBox').style.display = 'block';
        return;
    }
    const box = document.createElement('div');
    box.id = 'relFilterBox';
    box.style.position = 'absolute';
    box.style.bottom = '20px';
    box.style.left = '20px'; 
    box.style.background = 'rgba(255, 255, 255, 0.95)';
    box.style.padding = '12px 16px';
    box.style.border = '2px solid #e2e8f0';
    box.style.borderRadius = '8px';
    box.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)';
    box.style.zIndex = '100';
    box.style.fontSize = '13px';
    
    let html = '<div style="font-weight:bold;margin-bottom:8px;color:#2d3748;">🎛️ הצגת קשרים:</div>';
    const kinds = {extends:'ירושה (Extends)', implements:'מימוש (Implements)', has:'הכלה (Has)', uses:'שימוש (Uses)'};
    for (let k in kinds) {
        html += `<label style="display:flex;align-items:center;margin-bottom:6px;cursor:pointer;">
            <input type="checkbox" checked onchange="window.toggleRelFilter('${k}', this.checked)" style="margin-left:8px;cursor:pointer;width:15px;height:15px;">
            <span style="color:${ACOL[k]};margin-left:6px;font-size:16px;">■</span> ${kinds[k]}
        </label>`;
    }
    box.innerHTML = html;
    document.getElementById('cw').appendChild(box);
}

// ==========================================
// 🏗️ ArchLayerManager - אליפסות קונצנטריות הפוכות
// ==========================================
window.ArchLayerManager = {
    activeNode: null,
    focusMode: 0, 
    radii: {}, 

    reset: function() {
        this.activeNode = null;
        this.focusMode = 0;
        this.calculate();
    },

    handleClick: function(node) {
        if (this.activeNode === node) {
            this.reset(); 
        } else {
            this.activeNode = node;
            this.focusMode = 1;
            this.calculate();
        }
    },

    calculate: function() {
        const archTypeEl = document.getElementById('archType');
        const archType = archTypeEl ? archTypeEl.value : 'mvvm';
        
        nodes.forEach(n => { 
            if(n.floor === undefined) n.floor = assignLayer(n.cls, archType); // קריאה מעודכנת לפארסר
            n.archVisible = true; 
            n.minimized = true;   
            n.isDimmed = false;
        });

        if (this.focusMode !== 0 && this.activeNode) {
            const activeRels = getFilteredRels(); 
            const relatedRels = activeRels.filter(r => r.from === this.activeNode.cls.name || r.to === this.activeNode.cls.name);
            const connectedNames = relatedRels.map(r => r.from === this.activeNode.cls.name ? r.to : r.from);

            nodes.forEach(n => {
                if (n === this.activeNode) {
                    n.minimized = false; 
                    n.isDimmed = false;
                } else if (connectedNames.includes(n.cls.name)) {
                    n.minimized = true;  
                    n.isDimmed = false;  
                } else {
                    n.minimized = true;  
                    n.isDimmed = true;   
                }
            });
        }

        let currentRx = 350; 
        let currentRy = 200; 
        const gapX = 350; 
        const gapY = 220; 
        this.radii = {};

        for (let f = 0; f <= 3; f++) {
            const fNodes = nodes.filter(n => n.floor === f);
            if (fNodes.length > 0) {
                let neededC = 0;
                fNodes.forEach(n => { neededC += (n.minimized ? 160 : CW) + 60; });
                const neededR = neededC / (2 * Math.PI);
                
                currentRx = Math.max(currentRx, neededR);
                currentRy = Math.max(currentRy, neededR * 0.65);
                
                this.radii[f] = { rx: currentRx, ry: currentRy };
                
                currentRx += gapX;
                currentRy += gapY;
            } else {
                this.radii[f] = { rx: currentRx, ry: currentRy };
            }
        }

        for (let f = 0; f <= 3; f++) {
            const fNodes = nodes.filter(n => n.floor === f);
            if(fNodes.length === 0) continue;

            const { rx, ry } = this.radii[f];
            fNodes.sort((a,b) => b.cls.methods.length - a.cls.methods.length);

            fNodes.forEach((n, i) => {
                const angle = (i / fNodes.length) * Math.PI * 2 - Math.PI / 2;
                
                n.w = n.minimized ? 160 : CW; 
                n.h = n.minimized ? HEADER_H : ch(n.cls); 
                n.colH = HEADER_H + (n.cls.par.length ? 14 : 0) + PADV;
                
                n.x = Math.cos(angle) * rx - n.w/2;
                n.y = Math.sin(angle) * ry - n.h/2;
            });
        }

        this.updateUI(); 
        rv();
    },

    updateUI: function() {
        let titleEl = document.getElementById('archTitle');
        if (!titleEl) {
            titleEl = document.createElement('div');
            titleEl.id = 'archTitle';
            titleEl.style.position = 'absolute';
            titleEl.style.top = '20px';
            titleEl.style.right = '20px';
            titleEl.style.zIndex = '100';
            titleEl.style.padding = '8px 16px';
            titleEl.style.background = 'rgba(255, 255, 255, 0.95)';
            titleEl.style.border = '2px solid #6b46c1';
            titleEl.style.borderRadius = '8px';
            titleEl.style.fontWeight = 'bold';
            titleEl.style.color = '#2d3748';
            titleEl.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)';
            document.getElementById('cw').appendChild(titleEl);
        }

        if (mode === 'arch') {
            titleEl.style.display = 'block';
            if (this.focusMode === 0) {
                titleEl.innerHTML = `🎯 <span style="color:#6b46c1">מפת מערכת מלאה</span> - לחץ לפתיחת קשרים, <b>לחיצה כפולה לזרימה פנימית</b>`;
            } else {
                titleEl.innerHTML = `🔍 מתמקד ב: <span style="color:#e53e3e">${this.activeNode.cls.name}</span><br><span style="font-size:0.75rem;font-weight:normal;color:#718096">לחיצה ברקע לאיפוס. לחיצה כפולה לזרימה פנימית.</span>`;
            }
        } else {
            titleEl.style.display = 'none';
        }
    },

    getVisibleNodes: function() {
        return nodes.filter(n => n.archVisible);
    },

    getVisibleRels: function() {
        if (this.focusMode === 0) return []; 
        
        const activeRels = getFilteredRels();
        const activeNames = this.getVisibleNodes().map(n => n.cls.name);
        const parentName = this.activeNode.cls.name;
        
        return activeRels.filter(r => 
            (r.from === parentName && activeNames.includes(r.to)) ||
            (r.to === parentName && activeNames.includes(r.from))
        );
    }
};

// ==========================================
// 📂 העלאת קבצים
// ==========================================
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
  } else if (e.dataTransfer.files) { dropFiles.push(...e.dataTransfer.files); }
  if (dropFiles.length > 0) go(dropFiles);
});

async function traverseEntry(entry,out){
  if(entry.isFile){ await new Promise(r=>{entry.file(f=>{out.push(f);r();},r);});
  } else if(entry.isDirectory){
    const reader=entry.createReader();
    await new Promise(r=>{
      function readAll(){ reader.readEntries(async entries=>{ if(!entries.length){r();return;} await Promise.all(entries.map(e=>traverseEntry(e,out))); readAll(); }); }
      readAll();
    });
  }
}

document.getElementById('fi').addEventListener('change',e=>go([...e.target.files]));

async function go(fs){
  const v = fs.filter(f => f.name.match(/\.(java|kt|dart|ts|tsx|js|jsx|py|cs)$/i));
  if(!v.length){ toast('לא נמצאו קבצי קוד נתמכים'); return; } 
  files=v; codes=await Promise.all(v.map(readF));
  classes=[]; codes.forEach((c,i)=>classes.push(...parse(c,v[i].webkitRelativePath || v[i].name)));
  rels=buildRels(classes); buildInternalMethodRels(classes); 
  
  ['es','stBox','lgBox','clBox','mtog'].forEach(id => document.getElementById(id).style.display = id==='es'?'none':(id==='mtog'?'flex':'block'));
  document.getElementById('sF').textContent=v.length; document.getElementById('sC').textContent=classes.filter(c=>c.type==='class').length;
  document.getElementById('sI').textContent=classes.filter(c=>c.type==='interface').length; document.getElementById('sR').textContent=rels.length;
  
  // ✅ הדלקת כל הכפתורים כולל כפתור הארכיטקטורה החדש
  ['cpBtn','pdfBtn','dlDiagBtn','dlFlowBtn','dlArchBtn'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.disabled = false;
  });
  
  createRelFiltersUI(); 
  renderList(); mode = null; setMode('diagram');
}
function readF(f){return new Promise(r=>{const fr=new FileReader();fr.onload=e=>r(e.target.result);fr.readAsText(f);})}// ==========================================
// 📐 סידור מערך רגיל (Layout)
// ==========================================
function ch(cls){
  let h=HEADER_H+PADV; if(cls.par.length) h+=14;
  if(cls.fields.length) h+=SEC_T+cls.fields.length*ROW_H+PADV;
  if(cls.methods.length) h+=SEC_T+cls.methods.length*ROW_H+PADV;
  return Math.max(h, HEADER_H+20);
}

function getCurH(n){ 
    if (mode === 'arch') return n.h; 
    return (mode === 'flow' && selNode !== n) ? n.colH : n.h; 
}

function layout(){
  if(mode === 'arch') { ArchLayerManager.calculate(); return; }
  
  const ord=['interface','enum','abstract','class'];
  const srt=[...classes].sort((a,b)=>ord.indexOf(a.type)-ord.indexOf(b.type));
  
  if (mode === 'diagram') {
    const cols=Math.max(2,Math.ceil(Math.sqrt(srt.length*1.4))), gx=80, gy=80, rowH=[];
    srt.forEach((cls,i)=>{const row=Math.floor(i/cols);const h=ch(cls);rowH[row]=Math.max(rowH[row]||0,h);});
    const rowY=[60]; for(let r=1;r<rowH.length;r++) rowY[r]=rowY[r-1]+rowH[r-1]+gy;
    nodes=srt.map((cls,i)=>{ const colH = HEADER_H + (cls.par.length ? 14 : 0) + PADV; return {cls, x:(i%cols)*(CW+gx)+60, y:rowY[Math.floor(i/cols)], w:CW, h:ch(cls), colH}; });
  } else if (mode === 'flow') {
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
  const currentNodes = mode === 'arch' ? ArchLayerManager.getVisibleNodes() : nodes;
  if(!currentNodes.length)return;
  const minX=Math.min(...currentNodes.map(n=>n.x))-80, maxX=Math.max(...currentNodes.map(n=>n.x+n.w))+80;
  const minY=Math.min(...currentNodes.map(n=>n.y))-80, maxY=Math.max(...currentNodes.map(n=>n.y+getCurH(n)))+80;
  const tw=maxX-minX, th=maxY-minY;
  sc=Math.min(cv.width/tw,cv.height/th,.95); px=(cv.width-tw*sc)/2 - minX*sc; py=(cv.height-th*sc)/2 - minY*sc;
  draw();
}

// ==========================================
// 🎨 קנבס ואירועי עכבר
// ==========================================
const cv=document.getElementById('cv'), cw=document.getElementById('cw');
function sizeCV(){cv.width=cw.clientWidth;cv.height=cw.clientHeight;}
window.addEventListener('resize',()=>{ sizeCV(); if(nodes.length)rv(); if(mNodes.length) sizeMCV(); });
sizeCV();

// ⚡ תוספת חדשה: לחיצה כפולה לזרימה פנימית
cv.addEventListener('dblclick', e => {
  const r=cv.getBoundingClientRect(), wx=(e.clientX-r.left-px)/sc, wy=(e.clientY-r.top-py)/sc;
  const currentNodes = mode === 'arch' ? ArchLayerManager.getVisibleNodes() : nodes;
  const hn = currentNodes.find(n => wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + getCurH(n)) || null;
  
  if (hn) {
      openMethodModal(hn.cls);
  }
});

cv.addEventListener('mousedown',e=>{pan=true;moved=false;ds={x:e.clientX,y:e.clientY};ps={x:px,y:py};});
window.addEventListener('mousemove',e=>{
  if (document.getElementById('methodModal') && document.getElementById('methodModal').style.display === 'flex') return;
  if(pan){const dx=e.clientX-ds.x,dy=e.clientY-ds.y;if(Math.abs(dx)+Math.abs(dy)>3){moved=true;px=ps.x+dx;py=ps.y+dy;draw();}return;}
  const r=cv.getBoundingClientRect(),wx=(e.clientX-r.left-px)/sc,wy=(e.clientY-r.top-py)/sc;
  
  const currentNodes = mode === 'arch' ? ArchLayerManager.getVisibleNodes() : nodes;
  const hn=currentNodes.find(n=>wx>=n.x&&wx<=n.x+n.w&&wy>=n.y&&wy<=n.y+getCurH(n))||null;
  
  let hi=null, hr=null;
  if(hn && (mode==='diagram' || hn===selNode) && !hn.minimized){ hi=findItemAt(hn,wy); }
  if(!hn){ hr=findRel(wx,wy); }
  if(hn!==hNode || hi!==hItem || hr!==hRel){ hNode=hn; hItem=hi; hRel=hr; cv.style.cursor=hn||hr?'pointer':'grab'; draw(); }
  if(hr){ showTip(e.clientX,e.clientY,{title:`${hr.from} → ${hr.to}`,subtitle:relKindHe(hr.kind),body:hr.label}); }
  else if(hi){ showTip(e.clientX,e.clientY,{title:hi.n, subtitle: hi.t ? `שדה: ${hi.t}` : `מתודה: ${hi.ctor?'Constructor':''}`, body: hi.comment}); }
  else { hideTip(); }
});

function findItemAt(node, wy){
   const cls=node.cls; let cy = node.y + HEADER_H;
   if(cls.par.length) cy+=14; cy+=PADV;
   if(cls.fields.length){ cy+=SEC_T; if(wy>=cy && wy<=cy+cls.fields.length*ROW_H){ return cls.fields[Math.floor((wy-cy)/ROW_H)]; } cy+=cls.fields.length*ROW_H+PADV; }
   if(cls.methods.length){ cy+=SEC_T; if(wy>=cy && wy<=cy+cls.methods.length*ROW_H){ return cls.methods[Math.floor((wy-cy)/ROW_H)]; } }
   return null;
}

window.addEventListener('mouseup',e=>{
  if(!pan)return; pan=false;
  if(!moved){
    const r=cv.getBoundingClientRect(),wx=(e.clientX-r.left-px)/sc,wy=(e.clientY-r.top-py)/sc;
    const currentNodes = mode === 'arch' ? ArchLayerManager.getVisibleNodes() : nodes;
    const hn=currentNodes.find(n=>wx>=n.x&&wx<=n.x+n.w&&wy>=n.y&&wy<=n.y+getCurH(n))||null;
    
    if(hn) { 
        if(mode === 'arch') {
            ArchLayerManager.handleClick(hn);
        } else if(mode === 'flow' && selNode === hn) { 
            // נשאר כתמיכה למצב הישן בנוסף לדאבל-קליק
            openMethodModal(hn.cls); 
        } else { 
            clickNode(hn); 
        }
    } else if(!findRel(wx,wy)){ 
        if (mode === 'arch') ArchLayerManager.reset(); 
        else { selNode=null; closeFP(); draw(); }
    }
  }
});

cv.addEventListener('wheel',e=>{e.preventDefault();const r=cv.getBoundingClientRect();za(e.deltaY<0?1.1:.91,e.clientX-r.left,e.clientY-r.top);},{passive:false});
function zb(f){za(f,cv.width/2,cv.height/2);}
function za(f,cx,cy){const wx=(cx-px)/sc,wy=(cy-py)/sc;sc=Math.min(Math.max(sc*f,.08),4);px=cx-wx*sc;py=cy-wy*sc;draw();}

function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}
function rrT(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}
function trunc(ctx,txt,maxW){if(ctx.measureText(txt).width<=maxW)return txt;while(txt.length>1&&ctx.measureText(txt+'…').width>maxW)txt=txt.slice(0,-1);return txt+'…';}
function related(a,b){return getFilteredRels().some(r=>(r.from===a&&r.to===b)||(r.from===b&&r.to===a));}
function relKindHe(k){ return {extends:'ירושה',implements:'מימוש',has:'הכלה',uses:'שימוש'}[k]; }

function drawGrid(ctx, w, h, _px, _py, _sc) {
  ctx.save();ctx.strokeStyle='#e8edf2';ctx.lineWidth=1;
  const gs=40*_sc,ox=((_px%gs)+gs)%gs,oy=((_py%gs)+gs)%gs;
  for(let x=ox;x<w;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let y=oy;y<h;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  ctx.restore();
}

function edgePt(n,tx,ty,isModal=false){
  const h = isModal ? n.h : getCurH(n); const cx=n.x+n.w/2,cy=n.y+h/2,dx=tx-cx,dy=ty-cy;
  if(!dx&&!dy)return{x:cx,y:cy}; const t=Math.min(Math.abs(n.w/2/(dx||1e-9)),Math.abs(h/2/(dy||1e-9))); return{x:cx+dx*t,y:cy+dy*t};
}
function relMP(rel){
  const fn=nodes.find(n=>n.cls.name===rel.from),tn=nodes.find(n=>n.cls.name===rel.to); if(!fn||!tn)return null;
  const fH=getCurH(fn), tH=getCurH(tn); const fp=edgePt(fn,tn.x+tn.w/2,tn.y+tH/2),tp=edgePt(tn,fn.x+fn.w/2,fn.y+fH/2);
  const cx=(fp.x+tp.x)/2-(tp.y-fp.y)*.15,cy=(fp.y+tp.y)/2+(tp.x-fp.x)*.15; return{fp,tp,cx,cy};
}
function findRel(wx,wy){
  const currentRels = mode === 'arch' ? ArchLayerManager.getVisibleRels() : getFilteredRels();
  for(const rel of currentRels){ const mp=relMP(rel);if(!mp)continue; for(let t=0;t<=1;t+=.04){ const bx=(1-t)*(1-t)*mp.fp.x+2*(1-t)*t*mp.cx+t*t*mp.tp.x; const by=(1-t)*(1-t)*mp.fp.y+2*(1-t)*t*mp.cy+t*t*mp.tp.y; if(Math.abs(wx-bx)<9&&Math.abs(wy-by)<9)return rel; } }return null;
}

function draw(){
  const ctx=cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0,0,cv.width,cv.height); drawGrid(ctx, cv.width, cv.height, px, py, sc);
  ctx.save();ctx.translate(px,py);ctx.scale(sc,sc);
  
  let currentNodes = mode === 'arch' ? ArchLayerManager.getVisibleNodes() : nodes;
  
  if (mode === 'arch') {
      const floorNames = {3: 'UI Layer (Outermost)', 2: 'Logic Layer', 1: 'Data Layer', 0: 'Models Layer (Core)'};
      const bgColors = ['rgba(254, 235, 200, 0.4)', 'rgba(198, 246, 213, 0.4)', 'rgba(233, 216, 253, 0.4)', 'rgba(190, 227, 248, 0.4)'];
      
      ctx.save();
      for(let f=3; f>=0; f--) {
          const rData = ArchLayerManager.radii?.[f];
          if (!rData) continue;
          
          ctx.beginPath();
          ctx.ellipse(0, 0, rData.rx + 160, rData.ry + 160, 0, 0, Math.PI * 2);
          ctx.fillStyle = bgColors[f];
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.08)';
          ctx.lineWidth = 2;
          ctx.stroke();
          
          ctx.fillStyle = 'rgba(74, 85, 104, 0.6)';
          ctx.font = 'bold 24px Segoe UI';
          ctx.textAlign = 'center';
          ctx.fillText(floorNames[f], 0, -rData.ry - 120);
      }
      ctx.restore();
  }

  if (mode === 'flow') { 
      currentNodes.forEach(n=>{ if(n!==selNode){ drawCard(ctx,n,false,n===hNode,selNode&&!related(selNode.cls.name,n.cls.name)); } }); 
      drawArrows(ctx); 
      if(selNode){ drawCard(ctx,selNode,true,selNode===hNode,false); } 
  } else if (mode === 'arch') {
      drawArrows(ctx); 
      currentNodes.forEach(n=>{ 
          drawCard(ctx, n, n===ArchLayerManager.activeNode, n===hNode, n.isDimmed); 
      }); 
  } else { 
      drawArrows(ctx); 
      currentNodes.forEach(n=>{ drawCard(ctx,n,n===selNode,n===hNode,false); }); 
  }
  ctx.restore();
}

function drawArrows(ctx){
  const currentRels = mode === 'arch' ? ArchLayerManager.getVisibleRels() : getFilteredRels();
  currentRels.forEach(rel=>{
    if(mode==='flow'&&selNode&&rel.from!==selNode.cls.name&&rel.to!==selNode.cls.name)return;
    const mp=relMP(rel);if(!mp)return;
    
    const col=ACOL[rel.kind],isH=rel===hRel; ctx.save();
    
    if(mode==='flow' || mode==='arch'){ ctx.shadowColor='rgba(0,0,0,0.4)'; ctx.shadowBlur=3; }
    ctx.strokeStyle=col;ctx.fillStyle=col; ctx.lineWidth=isH?3:1.8;
    if(rel.kind==='uses'||rel.kind==='implements')ctx.setLineDash([5,4]);else ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(mp.fp.x,mp.fp.y);ctx.quadraticCurveTo(mp.cx,mp.cy,mp.tp.x,mp.tp.y);ctx.stroke(); ctx.setLineDash([]);
    const ang=Math.atan2(mp.tp.y-mp.cy,mp.tp.x-mp.cx),sz=10;
    if(rel.kind==='extends'||rel.kind==='implements'){ ctx.beginPath();ctx.moveTo(mp.tp.x,mp.tp.y);ctx.lineTo(mp.tp.x-sz*Math.cos(ang-.4),mp.tp.y-sz*Math.sin(ang-.4));ctx.lineTo(mp.tp.x-sz*Math.cos(ang+.4),mp.tp.y-sz*Math.sin(ang+.4));ctx.closePath();ctx.fillStyle='white';ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.stroke();
    } else { ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(mp.tp.x,mp.tp.y);ctx.lineTo(mp.tp.x-sz*Math.cos(ang-.35),mp.tp.y-sz*Math.sin(ang-.35));ctx.lineTo(mp.tp.x-sz*Math.cos(ang+.35),mp.tp.y-sz*Math.sin(ang+.35));ctx.closePath();ctx.fill(); }
    if(isH||(mode==='flow'&&selNode)||(mode==='arch')){ const lx=(mp.fp.x+mp.cx)/2, ly=(mp.fp.y+mp.cy)/2; ctx.font='9px Segoe UI';ctx.fillStyle=col;ctx.fillText(rel.label,lx,ly-4); } 
    ctx.restore();
  });
}

function drawCard(ctx,n,sel,hov,dim){
  let expand = true;
  if (mode === 'arch') expand = !n.minimized; 
  else expand = !(mode === 'flow') || sel;    
  
  const {cls,x,y}=n, col=CCOL[cls.type]||CCOL.class; 
  const currentW = (mode === 'arch' && n.minimized) ? 160 : CW; 
  const h = expand ? n.h : n.colH;
  
  ctx.save(); ctx.direction='ltr'; 
  if(dim) ctx.globalAlpha=.25; 
  
  if (mode === 'arch' && sel) { ctx.shadowColor=col.bd; ctx.shadowBlur=20; ctx.shadowOffsetY=0; }
  else { ctx.shadowColor='rgba(0,0,0,.1)';ctx.shadowBlur=sel?18:7;ctx.shadowOffsetY=sel?5:2; }

  if (!expand && mode === 'arch') {
      rr(ctx,x,y,currentW,h,11);ctx.fillStyle=col.h;ctx.fill(); ctx.shadowBlur=0;ctx.shadowOffsetY=0;
      ctx.strokeStyle=sel?col.dk:hov?col.bd:col.bd+'99';ctx.lineWidth=sel?2.5:hov?2:1.5;ctx.stroke();
      ctx.font='bold 12px Segoe UI';ctx.fillStyle=col.tx; 
      ctx.textAlign='center';
      ctx.fillText(trunc(ctx,cls.name,currentW-20), x+currentW/2, y+32);
      ctx.restore();
      return; 
  }

  rr(ctx,x,y,currentW,h,11);ctx.fillStyle='white';ctx.fill(); ctx.shadowBlur=0;ctx.shadowOffsetY=0; 
  ctx.strokeStyle=sel?col.dk:hov?col.bd:col.bd+'99';ctx.lineWidth=sel?2.5:hov?2:1.5;ctx.stroke();
  if(expand || cls.par.length){ rrT(ctx,x,y,currentW,HEADER_H,11);ctx.fillStyle=col.h;ctx.fill(); } else { rr(ctx,x,y,currentW,h,11);ctx.fillStyle=col.h;ctx.fill(); }
  ctx.font='italic 9px Segoe UI';ctx.fillStyle=col.dk+'bb'; ctx.fillText({class:'class',interface:'«interface»',abstract:'«abstract»',enum:'«enum»'}[cls.type]||'',x+PADH,y+15);
  ctx.font='bold 14px Segoe UI';ctx.fillStyle=col.tx; ctx.fillText(trunc(ctx,cls.name,currentW-PADH*2),x+PADH,y+36);
  let cy=y+HEADER_H; if(cls.par.length){ ctx.font='9px Segoe UI';ctx.fillStyle=col.dk; ctx.fillText(trunc(ctx,'▲ '+cls.par.slice(0,2).join(', '),currentW-PADH*2),x+PADH,cy+12); cy+=14; } cy+=PADV;
  if (expand) {
    function section(label,rows,drawFn){ ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,cy);ctx.lineTo(x+currentW,cy);ctx.stroke(); ctx.font='bold 8px Segoe UI';ctx.fillStyle='#a0aec0';ctx.fillText(label,x+PADH,cy+11);cy+=SEC_T; rows.forEach(row=>{drawFn(row,cy);cy+=ROW_H;}); cy+=PADV; } 
    if(cls.fields.length) section('FIELDS',cls.fields,(f,ry)=>{ if(f===hItem) { ctx.fillStyle='#edf2f7'; ctx.fillRect(x+1,ry,currentW-2,ROW_H); } const vc={'+':'#38a169','-':'#e53e3e','#':'#d69e2e'}[f.v]||'#4a5568'; ctx.font='bold 11px Courier New';ctx.fillStyle=vc;ctx.fillText(f.v,x+PADH,ry+14); ctx.font='11px Courier New';ctx.fillStyle='#2d3748';ctx.fillText(trunc(ctx,`${f.n}: ${f.t}`,currentW-PADH-TEXT_INDENT-PADH),x+PADH+TEXT_INDENT,ry+14); }); 
    if(cls.methods.length) section('METHODS',cls.methods,(m,ry)=>{ if(m===hItem) { ctx.fillStyle='#edf2f7'; ctx.fillRect(x+1,ry,currentW-2,ROW_H); } const vc={'+':'#38a169','-':'#e53e3e','#':'#d69e2e'}[m.v]||'#4a5568'; ctx.font='bold 11px Courier New';ctx.fillStyle=vc;ctx.fillText(m.v,x+PADH,ry+14); ctx.font='11px Courier New';ctx.fillStyle=m.ctor?'#805ad5':'#2d3748';ctx.fillText(trunc(ctx,`${m.n}(${m.p})${m.ret?': '+m.ret:''}`,currentW-PADH-TEXT_INDENT-PADH),x+PADH+TEXT_INDENT,ry+14); });
  }
  
  ctx.restore();
}

// ==========================================
// 🛠️ מודאלים ועזרים 
// ==========================================
const mcv = document.getElementById('mcv');
function openMethodModal(cls) {
   if(!cls.methods.length) { toast('אין פונקציות במחלקה זו'); return; }
   hideTip(); document.getElementById('mmTitle').textContent = `זרימה פנימית: ${cls.name}`; document.getElementById('methodModal').style.display = 'flex';
   const mw = 220, mh = 40;
   mNodes = cls.methods.map((m, i) => {
      let ring = 0, passed = 0, cap = 8; while (i >= passed + cap) { passed += cap; ring++; cap += 6; }
      const indexInRing = i - passed, totalInRing = Math.min(cap, cls.methods.length - passed), rRatio = 1 + ring * 1.1, rx = 350 * rRatio, ry = 200 * rRatio, angle = (indexInRing / totalInRing) * Math.PI * 2 - Math.PI / 2;
      return { m: m, x: rx*Math.cos(angle) - mw/2, y: ry*Math.sin(angle) - mh/2, w: mw, h: mh };
   });
   mRels = cls.internalCalls || []; sizeMCV();
   const minX=Math.min(...mNodes.map(n=>n.x))-60, maxX=Math.max(...mNodes.map(n=>n.x+n.w))+60, minY=Math.min(...mNodes.map(n=>n.y))-60, maxY=Math.max(...mNodes.map(n=>n.y+n.h))+60, tw=maxX-minX, th=maxY-minY; msc=Math.min(mcv.width/tw, mcv.height/th, 1); mpx=(mcv.width-tw*msc)/2 - minX*msc; mpy=(mcv.height-th*msc)/2 - minY*msc; drawMethodCanvas();
}
function closeMethodModal() { document.getElementById('methodModal').style.display = 'none'; hideTip(); }
function sizeMCV() { mcv.width = document.getElementById('mmBody').clientWidth; mcv.height = document.getElementById('mmBody').clientHeight; }
mcv.addEventListener('mousedown',e=>{mPan=true;mds={x:e.clientX,y:e.clientY};mps={x:mpx,y:mpy};});
mcv.addEventListener('mousemove',e=>{
   if(mPan){ mpx=mps.x+(e.clientX-mds.x);mpy=mps.y+(e.clientY-mds.y);drawMethodCanvas(); return; }
   const r=mcv.getBoundingClientRect(), wx=(e.clientX-r.left-mpx)/msc, wy=(e.clientY-r.top-mpy)/msc;
   const hn = mNodes.find(n => wx>=n.x && wx<=n.x+n.w && wy>=n.y && wy<=n.y+n.h) || null;
   if(hn) { mcv.style.cursor = 'pointer'; showTip(e.clientX, e.clientY, {title: hn.m.n, subtitle: 'מתודה', body: hn.m.comment});
   } else { mcv.style.cursor = 'grab'; hideTip(); }
});
window.addEventListener('mouseup',()=>{mPan=false;});
mcv.addEventListener('wheel',e=>{e.preventDefault();const r=mcv.getBoundingClientRect();const f=e.deltaY<0?1.1:.91,wx=(e.clientX-r.left-mpx)/msc,wy=(e.clientY-r.top-mpy)/msc;msc=Math.min(Math.max(msc*f,.1),4);mpx=e.clientX-r.left-wx*msc;mpy=e.clientY-r.top-wy*msc;drawMethodCanvas();},{passive:false});

function drawMethodCanvas() {
   const ctx = mcv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0,0,mcv.width,mcv.height); drawGrid(ctx, mcv.width, mcv.height, mpx, mpy, msc);
   ctx.save(); ctx.translate(mpx, mpy); ctx.scale(msc, msc);
   mNodes.forEach(n => {
      ctx.save(); ctx.direction = 'ltr'; rr(ctx, n.x, n.y, n.w, n.h, 6); ctx.fillStyle = n.m.ctor ? '#faf5ff' : '#ffffff'; ctx.fill(); ctx.strokeStyle = n.m.ctor ? '#b794f4' : '#cbd5e0'; ctx.lineWidth = 1.5; ctx.stroke();
      const vc={'+':'#38a169','-':'#e53e3e','#':'#d69e2e'}[n.m.v] || '#4a5568'; ctx.font='bold 12px Courier New'; ctx.fillStyle=vc; ctx.fillText(n.m.v, n.x+10, n.y+24); ctx.font='12px Courier New'; ctx.fillStyle='#2d3748'; ctx.fillText(trunc(ctx, `${n.m.n}(${n.m.p})`, n.w - 30), n.x+22, n.y+24); ctx.restore();
   });
   mRels.forEach(rel => {
      const fn = mNodes.find(n => n.m.n === rel.from.n), tn = mNodes.find(n => n.m.n === rel.to.n); if(!fn || !tn) return;
      const fp = edgePt(fn, tn.x+tn.w/2, tn.y+tn.h/2, true), tp = edgePt(tn, fn.x+fn.w/2, fn.y+fn.h/2, true); const cx=(fp.x+tp.x)/2-(tp.y-fp.y)*.2, cy=(fp.y+tp.y)/2+(tp.x-fp.x)*.2;
      ctx.strokeStyle = 'rgba(128, 90, 213, 0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.quadraticCurveTo(cx, cy, tp.x, tp.y); ctx.stroke();
      const ang=Math.atan2(tp.y-cy,tp.x-cx),sz=8; ctx.fillStyle='rgba(128, 90, 213, 0.7)'; ctx.beginPath(); ctx.moveTo(tp.x,tp.y);ctx.lineTo(tp.x-sz*Math.cos(ang-.35),tp.y-sz*Math.sin(ang-.35));ctx.lineTo(tp.x-sz*Math.cos(ang+.35),tp.y-sz*Math.sin(ang+.35));ctx.closePath(); ctx.fill();
   }); ctx.restore();
}

function renderList(){
  const el=document.getElementById('clList');el.innerHTML='';
  classes.forEach(cls=>{
    const d=document.createElement('div'); d.className='cit';d.dataset.n=cls.name;
    d.innerHTML=`<span class="badge b${cls.type[0]}">${{class:'C',interface:'I',abstract:'A',enum:'E'}[cls.type]}</span>${cls.name}`;
    d.onclick=()=>{ if(mode === 'flow' || mode === 'arch') { /* do nothing */ } else setMode('diagram'); const n=nodes.find(x=>x.cls.name===cls.name); if(n){ px=cv.width/2-n.x*sc-n.w*sc/2; py=cv.height/2-n.y*sc-getCurH(n)*sc/2; clickNode(n); } };el.appendChild(d);
  });
}
function clickNode(node){
  selNode=node; document.querySelectorAll('.cit').forEach(e=>e.classList.remove('on'));
  const el=document.querySelector(`.cit[data-n="${node.cls.name}"]`); if(el){el.classList.add('on');el.scrollIntoView({block:'nearest'});}
  const cls=node.cls; document.getElementById('fpT').textContent=cls.name; document.getElementById('fpS').textContent=`📁 ${cls.file}`;
  const co=document.getElementById('fpComment'); co.style.display=cls.comment?'block':'none'; co.textContent=cls.comment;
  
  const activeRels = getFilteredRels(); 
  const out=activeRels.filter(r=>r.from===cls.name),inn=activeRels.filter(r=>r.to===cls.name); let html='';
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

// ==========================================
// 🕹️ שליטה ומצבים
// ==========================================
function setMode(m){
  if(mode===m)return; mode=m; 
  document.querySelectorAll('.mtab').forEach((t,i)=>t.classList.toggle('on', i===(m==='diagram'?0 : m==='flow'?1 : 2))); 
  
  const archBox = document.getElementById('archBox');
  if (archBox) archBox.style.display = (m === 'arch') ? 'block' : 'none';

  const hintEl = document.getElementById('hint');
  
  if(m==='flow') {
    if (hintEl) {
        hintEl.style.display = 'block';
        hintEl.textContent = 'לחץ על מחלקה להרחבה, לחיצה כפולה לזרימה פנימית';
    }
    selNode=null; closeFP(); 
    if(window.ArchLayerManager && ArchLayerManager.updateUI) ArchLayerManager.updateUI(); 
    layout();
  } else if(m==='arch') {
    if (hintEl) hintEl.style.display = 'none'; 
    selNode=null; closeFP(); ArchLayerManager.reset(); 
  } else {
    if (hintEl) hintEl.style.display = 'none';
    selNode=null; closeFP(); 
    if(window.ArchLayerManager && ArchLayerManager.updateUI) ArchLayerManager.updateUI();
    layout();
  }
}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),3000);}

// ==========================================
// 🔗 חיווט פונקציות ל-Window
// ==========================================
window.closeFP = closeFP;
window.closeMethodModal = closeMethodModal;
window.zb = zb;
window.rv = rv;
window.setMode = setMode;
window.recalcArch = () => { if(mode === 'arch') ArchLayerManager.calculate(); };

window.copyCode = () => copyCode(files, codes, toast);

// ✅ הפתרון ל-PDF: שולחים ל-PDF רק את הקשרים המסוננים בעזרת getFilteredRels() !
window.exportPDF = () => exportPDF(nodes, classes, getFilteredRels(), files, CW, ACOL, CCOL, drawCard, toast);

document.getElementById('dlDiagBtn').addEventListener('click', () => handleExport('diagram'));
document.getElementById('dlFlowBtn').addEventListener('click', () => handleExport('flow'));

// ✅ האזנה לכפתור ייצוא ארכיטקטורה
const archBtn = document.getElementById('dlArchBtn');
if(archBtn) archBtn.addEventListener('click', () => handleExport('arch'));

function handleExport(exportMode) {
  const origMode = mode, origSel = selNode, origFocus = mode === 'arch' ? ArchLayerManager.focusMode : 0;
  
  if (mode !== exportMode) { 
      mode = exportMode; selNode = null; 
      if(mode === 'arch') ArchLayerManager.reset(); else layout(); 
  } else { 
      selNode = null; rv(); 
  }
  
  const projectName = files[0]?.name?.replace(/\.[^.]+$/,'') || 'project';
  let imgData = null;
  let htmlTemplateMode = exportMode; 
  
  // ✅ צילום הקנבס לתרשים וגם לארכיטקטורה
  if(exportMode === 'diagram' || exportMode === 'arch') {
    const currentNodes = mode === 'arch' ? ArchLayerManager.getVisibleNodes() : nodes;
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    
    if (mode === 'arch') {
        // חישוב גבולות לקנבס הענק של האליפסות
        const maxR = (ArchLayerManager.radii && ArchLayerManager.radii[3]) ? ArchLayerManager.radii[3].rx + 300 : 2000;
        const maxRy = (ArchLayerManager.radii && ArchLayerManager.radii[3]) ? ArchLayerManager.radii[3].ry + 300 : 2000;
        minX = -maxR; maxX = maxR; minY = -maxRy; maxY = maxRy;
    } else {
        minX=Math.min(...currentNodes.map(n=>n.x))-80; maxX=Math.max(...currentNodes.map(n=>n.x+n.w))+80;
        minY=Math.min(...currentNodes.map(n=>n.y))-80; maxY=Math.max(...currentNodes.map(n=>n.y+getCurH(n)))+80;
    }

    const oc=document.createElement('canvas'); oc.width=maxX-minX; oc.height=maxY-minY;
    const octx=oc.getContext('2d'); octx.direction='ltr'; octx.fillStyle='white'; octx.fillRect(0,0,oc.width,oc.height); 
    octx.translate(-minX, -minY);
    
    // ציור אליפסות הרקע לתמונת הייצוא (אם זה מצב ארכיטקטורה)
    if (mode === 'arch') {
        const floorNames = {3: 'UI Layer (Outermost)', 2: 'Logic Layer', 1: 'Data Layer', 0: 'Models Layer (Core)'};
        const bgColors = ['rgba(254, 235, 200, 0.4)', 'rgba(198, 246, 213, 0.4)', 'rgba(233, 216, 253, 0.4)', 'rgba(190, 227, 248, 0.4)'];
        octx.save();
        for(let f=3; f>=0; f--) {
            const rData = ArchLayerManager.radii?.[f];
            if (!rData) continue;
            octx.beginPath(); octx.ellipse(0, 0, rData.rx + 160, rData.ry + 160, 0, 0, Math.PI * 2);
            octx.fillStyle = bgColors[f]; octx.fill(); octx.strokeStyle = 'rgba(0,0,0,0.08)'; octx.lineWidth = 2; octx.stroke();
            octx.fillStyle = 'rgba(74, 85, 104, 0.6)'; octx.font = 'bold 24px Segoe UI'; octx.textAlign = 'center';
            octx.fillText(floorNames[f], 0, -rData.ry - 120);
        }
        octx.restore();
    }

    drawArrows(octx); 
    currentNodes.forEach(n => drawCard(octx,n,false,false,false));
    imgData = oc.toDataURL('image/png');
    
    // אנו משתמשים בתבנית ה-HTML הרגילה של 'diagram' כדי להציג את תמונת הארכיטקטורה
    if (mode === 'arch') htmlTemplateMode = 'diagram'; 
  }
  
  const title = projectName + (exportMode === 'arch' ? ' - Architecture' : '');
  generateHTMLExport(htmlTemplateMode, title, classes, getFilteredRels(), nodes, imgData);
  toast(`✅ ייצוא הושלם!`);
  
  mode = origMode; selNode = origSel; 
  if(mode === 'arch') { ArchLayerManager.focusMode = origFocus; ArchLayerManager.calculate(); } else layout();
}