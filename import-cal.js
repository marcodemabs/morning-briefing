/* ============================================================
   IMPORT-CAL · Fase 3 — Import calendario da PDF di Outlook
   Autonomo e locale: pdf.js on-device (CDN, lazy), parser,
   schermata di revisione. Nessun backend, il PDF non lascia
   il telefono. Semantica import-once + tombstone (Store).
   API pubblica:  ImportCal.apri({ onDone })
   ============================================================ */
window.ImportCal = (() => {
  const CDN   = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
  let pdfjs   = null;

  async function ensurePdfjs() {
    if (pdfjs) return pdfjs;
    pdfjs = await import(CDN + 'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = CDN + 'pdf.worker.min.mjs';
    return pdfjs;
  }

  // ---------- PARSER (validato in pdf.js) ----------
  const RE_TIME = /(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/;
  const RE_WD   = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/;
  const MONTHS  = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
  const isPUA   = s => [...s].some(c => { const x=c.charCodeAt(0); return x>=0xE000 && x<=0xF8FF; });

  function to24(t){
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if(!m) return t;
    let h = +m[1] % 12; if(/PM/i.test(m[3])) h += 12; return String(h).padStart(2,'0') + ':' + m[2];
  }
  function cleanTitle(t){
    t = t.replace(/^\s*(Canceled:|Annullato:)\s*/i,'');
    t = [...t].filter(c => { const x = c.codePointAt(0);
      return !((x>=0xE000&&x<=0xF8FF)||(x>=0x1F000&&x<=0x1FAFF)||x===0x2600||(x>=0x2700&&x<=0x27BF)); }).join('');
    t = t.split(/\s*Microsoft ?Teams?/i)[0];
    return t.replace(/\s+/g,' ').replace(/^[\s\-–]+|[\s\-–]+$/g,'').trim();
  }

  function parseItems(items, pageW){
    const DIV = pageW / 2;
    const cols = { L:[], R:[] };
    for (const it of items){
      if (!it.str.trim() && !isPUA(it.str)) continue;
      const col = it.x < DIV ? 'L' : 'R';
      let row = cols[col].find(r => Math.abs(r.top - it.top) <= 5);
      if (!row){ row = { top: it.top, words: [] }; cols[col].push(row); }
      row.words.push({ x: it.x, str: it.str });
    }
    const out = [];
    for (const side of ['L','R']){
      const rows = cols[side].sort((a,b) => a.top - b.top);
      let day = null;
      for (const r of rows){
        const line = r.words.sort((a,b)=>a.x-b.x).map(w=>w.str).join(' ').replace(/\s+/g,' ').trim();
        const raw  = r.words.map(w=>w.str).join('');
        const wd = line.match(RE_WD);
        if (wd){ day = `${wd[4]}-${String(MONTHS[wd[2]]+1).padStart(2,'0')}-${String(+wd[3]).padStart(2,'0')}`; continue; }
        if (!day) continue;
        if (/\bOOO\b/.test(line) && /All day/i.test(line)){
          out.push({ kind:'ooo', giorno:day }); continue;
        }
        const tm = line.match(RE_TIME);
        if (!tm) continue;
        const titolo = cleanTitle(line.slice(tm.index + tm[0].length));
        if (/Cancel|Annull/i.test(line)){
          out.push({ kind:'canceled', giorno:day, ora:to24(tm[1]), titolo }); continue;
        }
        out.push({ kind:'call', giorno:day, ora:to24(tm[1]), fine:to24(tm[2]), titolo, ricorrente:isPUA(raw) });
      }
    }
    return out;
  }

  async function parsePdf(file){
    const lib = await ensurePdfjs();
    const buf = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data: buf }).promise;
    const all = [];
    for (let p = 1; p <= doc.numPages; p++){
      const page = await doc.getPage(p);
      const vp   = page.getViewport({ scale: 1 });
      const tc   = await page.getTextContent();
      const items = tc.items.filter(i => 'str' in i)
        .map(i => ({ str: i.str, x: i.transform[4], top: vp.height - i.transform[5] }));
      all.push(...parseItems(items, vp.width));
    }
    return all;
  }

  // ---------- NORMALIZZAZIONE → elementi importabili ----------
  const nextDay = k => { const [y,m,d]=k.split('-').map(Number); const x=new Date(y,m-1,d+1);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };

  function normalizza(parsed){
    return parsed.map(p => {
      if (p.kind === 'ooo'){
        return { tipo:'reminder', kind:'ooo', giorno:p.giorno, titolo:'Fuori sede (OOO)',
                 idEsterno:`outlook:${p.giorno}|OOO` };
      }
      if (p.kind === 'canceled'){
        return { tipo:'skip', kind:'canceled', giorno:p.giorno, ora:p.ora, titolo:p.titolo,
                 idEsterno:`outlook:${p.giorno}T${p.ora}|CANC` };
      }
      const fineGiorno = (p.fine <= p.ora) ? nextDay(p.giorno) : p.giorno;
      return { tipo:'evento', kind:'call', giorno:p.giorno, ora:p.ora, fine:p.fine, titolo:p.titolo,
               ricorrente:p.ricorrente, categoria:'lavoro', intensita:'media',
               inizio:`${p.giorno}T${p.ora}:00`, fineISO:`${fineGiorno}T${p.fine}:00`,
               idEsterno:`outlook:${p.giorno}T${p.ora}-${p.fine}|${p.titolo}` };
    });
  }

  // ---------- STILE (iniettato una volta) ----------
  function injectCss(){
    if (document.getElementById('imp-style')) return;
    const css = `
    .imp-scrim{position:fixed;inset:0;z-index:200;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch}
    .imp-wrap{max-width:430px;margin:0 auto;padding:0 14px calc(120px + env(safe-area-inset-bottom))}
    .imp-top{display:flex;align-items:center;gap:10px;padding:calc(18px + env(safe-area-inset-top)) 2px 14px}
    .imp-mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(145deg,var(--accent),var(--accent-weak));flex:none}
    .imp-top h2{font-size:1.05rem;font-weight:600;margin:0}
    .imp-top .sub{font-size:.78rem;color:var(--text-muted)}
    .imp-x{margin-left:auto;width:34px;height:34px;border-radius:8px;border:1px solid var(--border-soft);color:var(--text-muted);display:grid;place-items:center;background:none;font-size:1.05rem}
    .imp-file{display:flex;align-items:center;gap:10px;background:var(--bg-elevated);border:1px solid var(--border-soft);border-radius:12px;padding:11px 12px;margin-bottom:12px}
    .imp-file .ic{width:30px;height:30px;border-radius:8px;background:var(--bg-panel);display:grid;place-items:center;flex:none}
    .imp-file .nm{font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .imp-file .rng{font-size:.72rem;color:var(--text-subtle);font-family:'JetBrains Mono',monospace}
    .imp-file .re{margin-left:auto;font-size:.78rem;color:var(--accent);border:1px solid var(--accent-weak);border-radius:7px;padding:5px 9px;background:none;flex:none}
    .imp-sum{display:flex;gap:8px;margin-bottom:6px}
    .imp-stat{flex:1;background:var(--bg-elevated);border:1px solid var(--border-soft);border-radius:12px;padding:11px 8px;text-align:center}
    .imp-stat b{display:block;font-size:1.25rem;font-weight:600}
    .imp-stat span{font-size:.68rem;color:var(--text-muted)}
    .imp-stat.on b{color:var(--accent)} .imp-stat.skip b{color:var(--text-subtle)}
    .imp-day{font-size:.72rem;color:var(--text-subtle);text-transform:uppercase;letter-spacing:.4px;margin:16px 4px 8px;font-weight:600}
    .imp-ev{display:flex;align-items:center;gap:11px;background:var(--bg-elevated);border:1px solid var(--border-soft);border-radius:12px;padding:11px 12px;margin-bottom:8px;transition:opacity .15s}
    .imp-ev .bar{width:3px;align-self:stretch;border-radius:2px;flex:none}
    .imp-ev .body{flex:1;min-width:0}
    .imp-ev .t{font-size:.76rem;color:var(--text-muted);font-family:'JetBrains Mono',monospace}
    .imp-ev .ti{font-size:.92rem;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .imp-badge{font-size:.62rem;color:var(--text-subtle);border:1px solid var(--border);border-radius:5px;padding:1px 5px;margin-left:6px;vertical-align:middle;white-space:nowrap}
    .imp-chk{width:24px;height:24px;border-radius:7px;border:1.8px solid var(--text-subtle);flex:none;display:grid;place-items:center;background:none;transition:.15s}
    .imp-chk.on{background:var(--accent);border-color:var(--accent)}
    .imp-chk svg{opacity:0;transition:.15s} .imp-chk.on svg{opacity:1}
    .imp-ev.off{opacity:.5} .imp-ev.off .ti{text-decoration:line-through;text-decoration-color:var(--text-subtle)}
    .imp-guide{margin:22px 2px 0}
    .imp-guide h3{font-size:.7rem;color:var(--text-muted);font-weight:600;margin:0 0 9px;display:flex;align-items:center;gap:6px}
    .imp-guide h3::before{content:"";width:3px;height:11px;border-radius:2px;background:var(--accent)}
    .imp-guide ol{list-style:none;counter-reset:s;display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
    .imp-guide li{counter-increment:s;display:flex;gap:9px;font-size:.72rem;color:var(--text-muted);line-height:1.45}
    .imp-guide li::before{content:counter(s);color:var(--text-subtle);font-family:'JetBrains Mono',monospace;font-size:.68rem;min-width:11px}
    .imp-foot{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:center;padding:14px 14px calc(14px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 34%)}
    .imp-foot .inner{width:100%;max-width:402px;display:flex;gap:10px}
    .imp-btn{padding:13px 16px;border-radius:10px;font-weight:600;font-size:.95rem;border:none;background:var(--accent);color:#fff;font-family:inherit}
    .imp-btn:active{transform:scale(.98);filter:brightness(1.08)}
    .imp-btn.block{flex:1} .imp-btn:disabled{opacity:.45}
    .imp-btn.ghost{background:var(--bg-panel);color:var(--text);border:1px solid var(--border);flex:none}
    .imp-center{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:14px;color:var(--text-muted);text-align:center;padding:0 20px}
    .imp-spin{width:30px;height:30px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:imp-rot .8s linear infinite}
    @keyframes imp-rot{to{transform:rotate(360deg)}}`;
    document.head.append(Object.assign(document.createElement('style'), { id:'imp-style', textContent: css }));
  }

  // ---------- UI ----------
  const CHECK = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.2 3.2L13 5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const DOWL  = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const catColore = () => (Store.categoria('lavoro')?.colore) || 'var(--accent)';

  let scrim = null;
  function close(){ if (scrim){ scrim.remove(); scrim = null; } }

  function shell(inner){
    close();
    scrim = document.createElement('div');
    scrim.className = 'imp-scrim';
    scrim.innerHTML = `<div class="imp-wrap">${inner}</div>`;
    document.body.append(scrim);
    return scrim;
  }

  function pickFile(){
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.pdf,application/pdf';
      inp.style.display = 'none';
      inp.onchange = () => resolve(inp.files[0] || null);
      document.body.append(inp); inp.click();
      setTimeout(() => inp.remove(), 60000);
    });
  }

  function screenLoading(msg){
    shell(`<div class="imp-center"><div class="imp-spin"></div><div>${msg}</div></div>`);
  }
  function screenMessage(title, msg, onRetry){
    shell(`<div class="imp-center"><div style="font-size:1.05rem;color:var(--text);font-weight:600">${title}</div>
      <div style="font-size:.88rem">${msg}</div>
      <button class="imp-btn" id="imp-retry">Scegli un altro file</button>
      <button class="imp-btn ghost" id="imp-cancel" style="border:none;background:none;color:var(--text-muted)">Annulla</button></div>`);
    scrim.querySelector('#imp-retry').onclick = onRetry;
    scrim.querySelector('#imp-cancel').onclick = close;
  }

  function screenReview(file, items, onDone){
    injectCss();
    const bar = catColore();

    // decisioni iniziali + dedup
    items.forEach(it => {
      it._dup = Store.importEsisteGia(it.idEsterno);
      it._on  = !it._dup && it.tipo !== 'skip';   // annullate off, duplicati off
    });

    const byDay = {};
    for (const it of items){ (byDay[it.giorno] ||= []).push(it); }
    const giorni = Object.keys(byDay).sort();

    const dateFmt = k => { const [y,m,d]=k.split('-').map(Number); const dt=new Date(y,m-1,d);
      return `${DOWL[dt.getDay()]} ${d}`; };
    const rng = () => { const a=giorni[0], b=giorni[giorni.length-1];
      const f=k=>{const[,m,d]=k.split('-');return `${+d}/${+m}`;}; return `${f(a)}–${f(b)}`; };

    let html = `
      <div class="imp-top"><div class="imp-mark"></div>
        <div><h2>Importa da Outlook</h2><div class="sub">Rivedi prima di aggiungere all'agenda</div></div>
        <button class="imp-x" id="imp-close">✕</button></div>
      <div class="imp-file"><div class="ic">📄</div>
        <div style="min-width:0"><div class="nm">${(file.name||'Calendario.pdf')}</div>
          <div class="rng">${rng()} · ${items.length} eventi letti</div></div>
        <button class="imp-file re" id="imp-change">Cambia file</button></div>
      <div class="imp-sum">
        <div class="imp-stat on"><b id="imp-n-on">0</b><span>da importare</span></div>
        <div class="imp-stat"><b id="imp-n-neu">0</b><span>promemoria</span></div>
        <div class="imp-stat skip"><b id="imp-n-skip">0</b><span>saltati</span></div></div>`;

    items.forEach((it, i) => { it._i = i; });
    for (const g of giorni){
      html += `<div class="imp-day">${dateFmt(g)}</div>`;
      for (const it of byDay[g]){
        const off = it._on ? '' : ' off';
        const chk = it._on ? ' on' : '';
        let time, title, badge = '', barCol = bar;
        if (it.kind === 'ooo'){
          time = 'tutto il giorno'; title = '🔔 ' + it.titolo;
          badge = '<span class="imp-badge">promemoria</span>'; barCol = 'var(--text-subtle)';
        } else if (it.kind === 'canceled'){
          time = it.ora; title = it.titolo;
          badge = '<span class="imp-badge">annullata</span>'; barCol = 'var(--text-subtle)';
        } else {
          time = `${it.ora}–${it.fine}`; title = it.titolo;
          if (it._dup) badge = '<span class="imp-badge">già in agenda</span>';
          else if (it.ricorrente) badge = '<span class="imp-badge">ricorrente</span>';
        }
        html += `<div class="imp-ev${off}" data-i="${it._i}">
          <div class="bar" style="background:${barCol}"></div>
          <div class="body"><div class="t">${time}</div><div class="ti">${title}${badge}</div></div>
          <button class="imp-chk${chk}" data-i="${it._i}">${CHECK}</button></div>`;
      }
    }

    html += `
      <div class="imp-guide"><h3>Come ottenere il file</h3><ol>
        <li>Apri Outlook e vai al Calendario</li>
        <li>Tocca Print, poi scegli Vista Verticale</li>
        <li>Premi Print in basso a sinistra</li>
        <li>Scegli Salva come PDF</li>
        <li>Salvalo nei File, poi torna qui e tocca Cambia file</li>
      </ol></div>`;

    shell(html);
    scrim.insertAdjacentHTML('beforeend',
      `<div class="imp-foot"><div class="inner">
        <button class="imp-btn ghost" id="imp-cancel2">Annulla</button>
        <button class="imp-btn block" id="imp-go">Importa</button></div></div>`);

    const recount = () => {
      let on=0, neu=0, skip=0;
      for (const it of items){
        if (!it._on){ skip++; continue; }
        if (it.kind === 'ooo') neu++; else on++;
      }
      scrim.querySelector('#imp-n-on').textContent   = on;
      scrim.querySelector('#imp-n-neu').textContent  = neu;
      scrim.querySelector('#imp-n-skip').textContent = skip;
      const go = scrim.querySelector('#imp-go');
      go.textContent = 'Importa ' + (on+neu) + ' eventi';
      go.disabled = (on+neu) === 0;
    };

    scrim.querySelectorAll('.imp-chk').forEach(btn => btn.onclick = () => {
      const it = items[+btn.dataset.i];
      it._on = !it._on;
      btn.classList.toggle('on', it._on);
      scrim.querySelector(`.imp-ev[data-i="${it._i}"]`).classList.toggle('off', !it._on);
      recount();
    });
    scrim.querySelector('#imp-close').onclick   = close;
    scrim.querySelector('#imp-cancel2').onclick = close;
    scrim.querySelector('#imp-change').onclick  = () => start(onDone);
    scrim.querySelector('#imp-go').onclick = () => {
      const chosen = items.filter(it => it._on);
      const n = Store.importaBatch(chosen);
      close();
      onDone && onDone();
      miniToast(`${n} eventi importati`);
    };
    recount();
  }

  function miniToast(msg){
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:300;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text);padding:11px 16px;border-radius:10px;font-size:.9rem;box-shadow:0 6px 20px rgba(0,0,0,.4)';
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ---------- FLUSSO ----------
  async function start(onDone){
    const file = await pickFile();
    if (!file) return;
    screenLoading('Leggo il PDF sul dispositivo…');
    try {
      const parsed = await parsePdf(file);
      const items  = normalizza(parsed);
      if (!items.length){
        screenMessage('Nessun evento trovato',
          'Il file non sembra la stampa "Vista Verticale" del calendario Outlook. Riprova con quel formato.',
          () => start(onDone));
        return;
      }
      screenReview(file, items, onDone);
    } catch (err){
      console.error('Import: errore parsing', err);
      screenMessage('Non riesco a leggere il file',
        'Assicurati che sia un PDF (non un\'immagine) e di essere online al primo import, così scarico il lettore PDF.',
        () => start(onDone));
    }
  }

  return { apri(opts={}){ start(opts.onDone); } };
})();
