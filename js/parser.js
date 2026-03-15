// ====== js/parser.js ======

export function getCommentBefore(text, index) {
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
            } else if (text[i] === '"' && text[i-1] === '"' && text[i-2] === '"') { 
                let j = i - 3;
                while (j > 2 && !(text[j] === '"' && text[j-1] === '"' && text[j-2] === '"')) j--;
                comments.unshift(text.slice(Math.max(0, j+1), i-2).trim());
                i = j - 3;
                while (i >= 0 && /[ \t\r\n]/.test(text[i])) i--;
            } else { break; }
        } else { break; }
    }
    return comments.join('\n');
}

function xbodyIdx(c,s){let d=0,i=s,st=-1;while(i<c.length){if(c[i]==='{'){d++;if(st<0)st=i;}else if(c[i]==='}'){d--;if(d===0)return {st:st+1,en:i};}i++;}return {st:st+1,en:c.length};}
function xbody(c,s){let d=0,i=s,st=-1;while(i<c.length){if(c[i]==='{'){d++;if(st<0)st=i;}else if(c[i]==='}'){d--;if(d===0)return c.slice(st+1,i);}i++;}return c.slice(st+1);}

function pyBodyIdx(c, s) {
    const pre = c.slice(0, s);
    const lineStart = pre.lastIndexOf('\n') + 1;
    const indentMatch = c.slice(lineStart, s).match(/^\s*/);
    const indent = indentMatch ? indentMatch[0].length : 0;
    let i = c.indexOf('\n', s);
    if (i === -1) return { st: s, en: c.length };
    let en = c.length;
    const lines = c.slice(i + 1).split('\n');
    let cur = i + 1;
    for (let l of lines) {
        if (l.trim().length > 0) {
            const lIndent = l.match(/^\s*/)[0].length;
            if (lIndent <= indent) { en = cur; break; }
        }
        cur += l.length + 1;
    }
    return { st: s, en };
}

function isAtRoot(text, index) {
    let d = 0;
    for(let i=0; i<index; i++){
        if(text[i]==='{') d++;
        else if(text[i]==='}') d--;
    }
    return d === 0;
}

function gv(s){return /private/.test(s)?'-':/protected/.test(s)?'#':'+';}
function sp(p){if(!p)return'';return p.split(',').map(s=>{const t=s.trim().split(/[\s:]+/);return t[t.length-1];}).join(', ');}

export function parse(code, fn) {
  const isKt = /\.kt$/i.test(fn);
  const isDt = /\.dart$/i.test(fn);
  const isTsJs = /\.(ts|tsx|js|jsx)$/i.test(fn);
  const isPy = /\.py$/i.test(fn);
  const isCs = /\.cs$/i.test(fn);
  
  const clean = isPy ? code : code.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length)).replace(/\/\/.*/g, m => ' '.repeat(m.length));
  const res=[];

  if (isPy) {
    const re = /^(\s*)class\s+(\w+)(?:\(([^)]+)\))?:/gm;
    let m; while((m=re.exec(clean))!==null) {
      const name=m[2], par=m[3]?m[3].split(',').map(s=>s.trim()):[];
      const idxs=pyBodyIdx(clean, m.index + m[0].length); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
      res.push({ name, par, file:fn, type:'class', fields:pyF(bC,bO), methods:pyM(bC,bO,name), comment: getCommentBefore(code, m.index), rawBody:bO });
    }
  } else if (isTsJs) {
    let classesInFile = 0;
    const re = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+([\w.]+))?(?:\s+implements\s+([\w.\s,]+))?\s*\{/g;
    let m; while((m=re.exec(clean))!==null) {
      classesInFile++;
      const name=m[2], par=[]; if(m[3]) par.push(m[3].trim()); if(m[4]) par.push(...m[4].split(',').map(s=>s.trim()));
      const idxs=xbodyIdx(clean, m.index+m[0].length-1); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
      res.push({ name, par, file:fn, type:m[1]?'abstract':'class', fields:tsF(bC,bO), methods:tsM(bC,bO,name), comment: getCommentBefore(code, m.index), rawBody:bO });
    }
    const intRe = /(?:^|\n)\s*(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w.\s,]+))?\s*\{/g;
    while((m=intRe.exec(clean))!==null) {
      classesInFile++;
      const name=m[1], par=m[2]?m[2].split(',').map(s=>s.trim()):[];
      const idxs=xbodyIdx(clean, m.index+m[0].length-1); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
      res.push({ name, par, file:fn, type:'interface', fields:tsF(bC,bO), methods:tsM(bC,bO,name), comment: getCommentBefore(code, m.index), rawBody:bO });
    }

    // --- פיצ'ר חדש: טיפול בקבצים ללא מחלקות (הפיכת הקובץ למודול) ---
    if (classesInFile === 0) {
        const mtds = tsModM(clean, code);
        const flds = tsModF(clean, code);
        if (mtds.length > 0 || flds.length > 0) {
            const baseName = fn.split('/').pop().split('.')[0].replace(/[^a-zA-Z0-9]/g, '_');
            const modName = baseName.charAt(0).toUpperCase() + baseName.slice(1) + 'Module';
            res.push({
                name: modName, par: [], file: fn, type: 'class',
                fields: flds, methods: mtds, comment: 'מודול (קובץ המכיל פונקציות ללא מחלקות)', rawBody: code
            });
        }
    }
  } else if (isCs) {
    const re = /(?:^|\n)\s*((?:(?:public|private|protected|internal|abstract|sealed|static|partial|readonly)\s+)*)(class|interface|struct|enum|record)\s+(\w+)(?:\s*<[^>]+>)?(?:\s*:\s*([^{]+))?\s*\{/g;
    let m; while((m=re.exec(clean))!==null){
      const name=m[3], par=m[4]?m[4].split(',').map(s=>s.trim().replace(/<.*/,'')): [];
      const idxs=xbodyIdx(clean,m.index+m[0].length-1); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
      res.push({ name,par,file:fn, type:m[2]==='interface'?'interface':m[2]==='enum'?'enum':'class', fields:csF(bC,bO), methods:csM(bC,bO,name), comment: getCommentBefore(code, m.index), rawBody:bO });
    }
  } else if(isDt) {
    const re = /(?:^|\n)\s*(abstract\s+)?(class|mixin|enum|extension)\s+(\w+)(.*?)\{/g;
    let m;while((m=re.exec(clean))!==null){
       const name=m[3], sig=m[4]||''; let par=[];
       const exM=sig.match(/extends\s+([\w<>]+)/); if(exM)par.push(exM[1].replace(/<.*/,'').trim());
       const wiM=sig.match(/with\s+([\w<>, ]+)/); if(wiM)par.push(...wiM[1].split(',').map(s=>s.trim().replace(/<.*/,'')));
       const imM=sig.match(/implements\s+([\w<>, ]+)/); if(imM)par.push(...imM[1].split(',').map(s=>s.trim().replace(/<.*/,'')));
       const idxs=xbodyIdx(clean,m.index+m[0].length-1); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
       res.push({ name,par:par.filter(Boolean),file:fn, type:/abstract/.test(m[1]||'')?'abstract':m[2]==='enum'?'enum':(m[2]==='mixin'||m[2]==='extension')?'interface':'class', fields:dtF(bC,bO),methods:dtM(bC,bO,name), comment: getCommentBefore(code, m.index), rawBody:bO });
    }
  } else if(isKt) {
    const re=/(?:^|\n)\s*((?:(?:public|private|protected|internal|open|abstract|sealed|data|enum)\s+)*)(class|interface|object|enum\s+class)\s+(\w+)(?:\s*<[^>]*>)?\s*(?::\s*([^{(]+))?\s*\{/g;
    let m;while((m=re.exec(clean))!==null){
      const name=m[3], par=m[4]?m[4].split(',').map(s=>s.trim().replace(/[(<].*/,'').trim()).filter(Boolean):[];
      const idxs=xbodyIdx(clean,m.index+m[0].length-1); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
      res.push({ name,par,file:fn, type:/abstract/.test(m[1]||'')?'abstract':/enum/.test(m[2])?'enum':m[2]==='interface'?'interface':'class', fields:ktF(bC,bO),methods:ktM(bC,bO), comment: getCommentBefore(code, m.index), rawBody:bO });
    }
  } else {
    // Java
    const re=/(?:^|\n)\s*((?:(?:public|private|protected|static|final|abstract|strictfp|@\w+(?:\([^)]*\))?)\s*)*)(enum\s*class|enum|interface|@interface|class|record)\s+(\w+)(?:\s*<[^>]*>)?\s*(?:extends\s+([\w.<>, ]+?))?\s*(?:implements\s+([\w.<>, ]+?))?\s*\{/g;
    let m;while((m=re.exec(clean))!==null){
      const name=m[3], ext=m[4]?[m[4].trim().replace(/<.*/,'')]:[], impl=m[5]?m[5].split(',').map(s=>s.trim().replace(/<.*/,'')):[];
      const idxs=xbodyIdx(clean,m.index+m[0].length-1); const bC=clean.slice(idxs.st,idxs.en), bO=code.slice(idxs.st,idxs.en);
      res.push({ name,par:[...ext,...impl].filter(Boolean),file:fn, type:/abstract/.test(m[1]||'')?'abstract':m[2].includes('enum')?'enum':m[2].includes('interface')?'interface':'class', fields:jvF(bC,bO),methods:jvM(bC,bO,name), comment: getCommentBefore(code, m.index), rawBody:bO });
    }
  }
  return res;
}

// --- JS/TS Modules (פונקציות במקום מחלקות) ---
function tsModF(bC, bO) {
    const re = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*([^=;]+))?\s*(?:=.*?)?;/g;
    const r = []; let m;
    while((m = re.exec(bC)) !== null && r.length < 30) {
        if(!isAtRoot(bC, m.index)) continue;
        r.push({ v: '+', t: m[2] ? m[2].trim() : 'any', n: m[1], comment: getCommentBefore(bO, m.index) });
    }
    return r;
}

function tsModM(bC, bO) {
    const r = []; let m;
    // תפיסת function רגיל
    const reFn = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/g;
    while((m = reFn.exec(bC)) !== null && r.length < 30) {
        if(!isAtRoot(bC, m.index)) continue;
        const n = m[1];
        const idx = bC.indexOf('{', m.index);
        r.push({ v: '+', ret: m[3]?m[3].trim():'', n, p: sp(m[2].trim()), ctor: false, body: idx!==-1?xbody(bO,idx):'', comment: getCommentBefore(bO, m.index) });
    }
    // תפיסת פונקציות חץ (const myFunc = () => {})
    const reArr = /(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>\s*\{/g;
    while((m = reArr.exec(bC)) !== null && r.length < 30) {
        if(!isAtRoot(bC, m.index)) continue;
        const n = m[1];
        const idx = bC.indexOf('{', m.index);
        r.push({ v: '+', ret: '', n, p: sp(m[2].trim()), ctor: false, body: idx!==-1?xbody(bO,idx):'', comment: getCommentBefore(bO, m.index) });
    }
    return r;
}

// --- Java Parser ---
function jvF(bC, bO) {
    const re = /(?:^|\n)\s*((?:(?:public|private|protected|static|final|volatile|transient|@\w+(?:\([^)]*\))?)\s*)*)([\w<>\[\],.?]+(?:\[\])?)\s+(\w+)\s*(?:=.*?)?;/g;
    const r = []; let m;
    while((m = re.exec(bC)) !== null && r.length < 30) {
        if(!isAtRoot(bC, m.index)) continue;
        const n = m[3];
        if(['return','else','break','continue'].includes(n)) continue;
        r.push({v: gv(m[1]), t: m[2].trim(), n, comment: getCommentBefore(bO, m.index)});
    }
    return r;
}
function jvM(bC, bO, cn) {
    const re = /(?:^|\n)\s*((?:(?:public|private|protected|static|abstract|final|synchronized|override|@\w+(?:\([^)]*\))?)\s*)*)(?:([\w<>\[\],.?]+(?:\[\])?)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*throws\s+[^{;]+)?\s*(?:\{|;)/g;
    const r = []; let m;
    while((m = re.exec(bC)) !== null && r.length < 30) {
        if(!isAtRoot(bC, m.index)) continue;
        const n = m[3];
        if(['if','while','for','switch','catch','else'].includes(n)) continue;
        const idx = bC.indexOf('{', m.index);
        const hasBody = idx !== -1 && bC.substring(m.index + m[0].length - 2, m.index + m[0].length + 1).includes('{');
        r.push({
            v: gv(m[1]), ret: n === cn ? '' : (m[2] ? m[2].trim() : ''), n, p: sp(m[4].trim()),
            ctor: n === cn, body: hasBody ? xbody(bO, idx) : '', comment: getCommentBefore(bO, m.index)
        });
    }
    return r;
}

// --- Python Parser ---
function pyF(bC, bO) {
    const r = [];
    const re = /self\.([a-zA-Z_]\w*)\s*(?::\s*([^=]+))?\s*=/g;
    let m; const seen = new Set();
    while ((m = re.exec(bC)) !== null && r.length < 30) {
        const n = m[1];
        if(seen.has(n)) continue;
        seen.add(n);
        r.push({ v: n.startsWith('__') ? '-' : '+', t: m[2] ? m[2].trim() : 'Any', n, comment: '' });
    }
    return r;
}
function pyM(bC, bO, cn) {
    const re = /^([ \t]*)def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/gm;
    const r = []; let m;
    while ((m = re.exec(bC)) !== null && r.length < 30) {
        const n = m[2];
        const p = sp(m[3].replace(/self\s*,?\s*/, '').trim());
        const idxs = pyBodyIdx(bC, m.index + m[0].length - 1);
        r.push({
            v: n.startsWith('__') && n !== '__init__' ? '-' : '+',
            ret: m[4] ? m[4].trim() : '', n, p, ctor: n === '__init__',
            body: bO.slice(idxs.st, idxs.en),
            comment: getCommentBefore(bO, m.index)
        });
    }
    return r;
}

// --- JS / TS (Classes) Parser ---
function tsF(bC, bO) {
    const re = /(?:^|\n)\s*(public|private|protected)?\s*(readonly\s+)?(\w+)(?:\s*:\s*([^=;{]+))?\s*(?:=.*?)?;/g;
    const r = []; let m;
    while((m = re.exec(bC)) !== null && r.length < 30) {
        if(!isAtRoot(bC, m.index)) continue;
        const n = m[3];
        if(['return','continue','break'].includes(n)) continue;
        r.push({ v: m[1]==='private'?'-':m[1]==='protected'?'#':'+', t: m[4] ? m[4].trim() : 'any', n, comment: getCommentBefore(bO, m.index) });
    }
    return r;
}
function tsM(bC, bO, cn) {
    const re = /(?:^|\n)\s*(public|private|protected)?\s*(async\s+)?(?:get\s+|set\s+)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/g;
    const r = []; let m;
    while((m = re.exec(bC)) !== null && r.length < 30) {
        if(!isAtRoot(bC, m.index)) continue;
        const n = m[3];
        if(['if','switch','while','for','catch'].includes(n)) continue;
        const idx = bC.indexOf('{', m.index);
        r.push({ v: m[1]==='private'?'-':m[1]==='protected'?'#':'+', ret: m[5] ? m[5].trim() : '', n, p: sp(m[4].trim()), ctor: n === 'constructor', body: idx !== -1 ? xbody(bO, idx) : '', comment: getCommentBefore(bO, m.index) });
    }
    return r;
}

// --- C# Parser ---
function csF(bC, bO) {
    const re = /(?:^|\n)\s*((?:(?:public|private|protected|internal|static|readonly|volatile)\s+)*)([\w<>\[\],.?]+(?:\[\])?)\s+(\w+)\s*(?:\{.*?\}|;|=.*?;)/g;
    const r = []; let m;
    while((m = re.exec(bC)) !== null && r.length < 30) {
        if(!isAtRoot(bC, m.index)) continue;
        const n = m[3];
        if(['return','else','break','continue','get','set','class'].includes(n)) continue;
        r.push({v: gv(m[1]), t: m[2].trim(), n, comment: getCommentBefore(bO, m.index)});
    }
    return r;
}
function csM(bC, bO, cn) {
    const re = /(?:^|\n)\s*((?:(?:public|private|protected|internal|static|abstract|virtual|override|async)\s+)*)((?:[\w<>\[\],.?]+(?:\[\])?)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*(?:base|this)\([^)]*\))?\s*(?:\{|;)/g;
    const r = []; let m;
    while((m = re.exec(bC)) !== null && r.length < 30) {
        if(!isAtRoot(bC, m.index)) continue;
        const n = m[3];
        if(['if','while','for','switch','catch','else'].includes(n)) continue;
        const idx = bC.indexOf('{', m.index);
        const hasBody = idx !== -1 && bC.substring(m.index + m[0].length - 2, m.index + m[0].length + 1).includes('{');
        r.push({ v: gv(m[1]), ret: n === cn ? '' : (m[2]?m[2].trim():''), n, p: sp(m[4].trim()), ctor: n === cn, body: hasBody ? xbody(bO, idx) : '', comment: getCommentBefore(bO, m.index) });
    }
    return r;
}

// --- Kotlin & Dart Parsers ---
function ktF(bC,bO){const re=/^\s*((?:(?:public|private|protected|internal|override|lateinit)\s+)*)(val|var)\s+(\w+)\s*:\s*([\w<>?,. ]+)/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15)r.push({v:gv(m[1]),t:m[4].trim(),n:m[3],comment:getCommentBefore(bO,m.index)});return r;}
function ktM(bC,bO){const re=/^\s*((?:(?:public|private|protected|internal|override|open|abstract|suspend)\s+)*)fun\s+(?:[\w<>?,. ]+\.)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([\w<>?,. ]+))?(?:.*?\{|=)/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15){const n=m[2];const idx=bC.indexOf('{',m.index);r.push({v:gv(m[1]),ret:(m[4]||'Unit').trim(),n,p:sp(m[3].trim()),ctor:false,body:idx!==-1?xbody(bO,idx):'',comment:getCommentBefore(bO,m.index)});}return r;}
function dtF(bC,bO){const re=/^\s*(?:@.*?^\s*)?(?:(?:late|final|const|static)\s+)*([\w<>?]+)?\s+(_?\w+)\s*(?:=.*?)?;/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15){const n=m[2];if(['return','continue','break'].includes(n))continue;r.push({v:n.startsWith('_')?'-':'+',t:(m[1]&&m[1].trim()!=='var')?m[1].trim().replace('?',''):'dynamic',n,comment:getCommentBefore(bO,m.index)});}return r;}
function dtM(bC,bO,cn){const re=/^\s*(?:@override\s*)?(?:(?:static|factory)\s+)*((?:[\w<>?]+\s+)?)(_?\w+)\s*\(([^)]*)\)(?:.*?\{|=>)/gm;const r=[];let m;while((m=re.exec(bC))!==null&&r.length<15){const n=m[2];if(['if','switch','while','for','catch'].includes(n))continue;const idx=bC.indexOf('{',m.index);r.push({v:n.startsWith('_')?'-':'+',ret:m[1]?m[1].trim().replace('?',''):'',n,p:sp(m[3].trim()),ctor:n===cn,body:idx!==-1?xbody(bO,idx):'',comment:getCommentBefore(bO,m.index)});}return r;}

export function buildRels(classes){
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
            // בדיקה רגילה - האם שם המחלקה מופיע בגוף הפונקציה (עבור Java/C# וכו')
            const regex = new RegExp(`\\b${tn}\\b`);
            if (regex.test(m.body) && !r.find(x=>x.from===cls.name&&x.to===tn&&x.kind==='uses')) {
                  r.push({from:cls.name,to:tn,kind:'uses',label:`משתמש ב‑${tn} (בגוף הפונקציה)`,fld:null,mth:m});
            }
            
            // התיקון שלנו: אם זו מחלקת-מודול של JS/TS, נבדוק אם קראו לפונקציות שלה!
            if (tn.endsWith('Module')) {
               const tgt = classes.find(c => c.name === tn);
               if (tgt) {
                   tgt.methods.forEach(tm => {
                       // נוודא ששם הפונקציה לא קצר מדי כדי למנוע זיהוי שגוי
                       if (tm.n.length > 2) {
                           const callRe = new RegExp(`\\b${tm.n}\\s*\\(`); // מחפש שם פונקציה עם סוגריים, למשל "parse("
                           if (callRe.test(m.body) && !r.find(x=>x.from===cls.name&&x.to===tn&&x.kind==='uses')) {
                               r.push({from:cls.name,to:tn,kind:'uses',label:`קורא ל- ${tm.n}()`,fld:null,mth:m});
                           }
                       }
                   });
               }
            }
          }
        });
      }
    });
  });
  return r;
}
export function buildInternalMethodRels(classes){
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