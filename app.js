/* ============================================================
   APP · UI + interazione (Fase 1)
   Vanilla JS, nessun build step. Deploy = commit della cartella.
   ============================================================ */
(() => {
  'use strict';

  // ---------- DOM helpers ----------
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const el = (tag, attrs={}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  };

  // ---------- Date formatting (Italiano) ----------
  const DOW  = ['dom','lun','mar','mer','gio','ven','sab'];
  const DOWL = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const MON  = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  const MONL = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const hhmm = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  const isToday = d => sameDay(d, new Date());

  // ---------- State ----------
  const state = {
    view: 'riassunto',
    calMode: 'mese',       // giorno | settimana | mese | anno
    cursor: new Date(),    // data di riferimento del calendario
    selected: new Date(),  // giorno selezionato
    enMode: 'giorno',      // Energy: giorno | settimana | mese
    enHead: 'media',       // Energy periodo: media | picco
    enCat: null,           // Energy giorno: id categoria filtrata
    enBar: null,           // Energy periodo: indice barra selezionata
  };

  // ============================================================
  //  BOOT
  // ============================================================
  function boot() {
    applyTheme();
    // splash → app → (eventuale check-in mattutino)
    setTimeout(() => {
      $('#splash').classList.add('hidden');
      $('#app').classList.remove('hidden');
      if (!Store.checkinFattoOggi()) openCheckin();
    }, 1300);
    wireChrome();
    render();
    registerSW();
  }

  function wireChrome() {
    $('#menuBtn').addEventListener('click', openDrawer);
    $('#scrim').addEventListener('click', closeDrawer);
    $$('.nav-item').forEach(b => b.addEventListener('click', () => { go(b.dataset.view); closeDrawer(); }));
    $('#drawerDate').textContent = new Intl.DateTimeFormat('it-IT',{weekday:'short',day:'numeric',month:'short'}).format(new Date());
  }

  function openDrawer(){ $('#drawer').classList.add('open'); $('#scrim').classList.remove('hidden'); }
  function closeDrawer(){ $('#drawer').classList.remove('open'); $('#scrim').classList.add('hidden'); }

  function go(view){ state.view = view; render(); }

  // ============================================================
  //  THEME
  // ============================================================
  function applyTheme() {
    const t = Store.prefs().tema;
    let theme = t;
    if (t === 'auto') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light-plus' : 'dark-plus';
    document.documentElement.setAttribute('data-theme', theme);
    const meta = theme === 'light-plus' ? '#ffffff' : getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    $('meta[name="theme-color"]')?.setAttribute('content', meta || '#1e1e1e');
  }
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (Store.prefs().tema==='auto') applyTheme(); });

  // ============================================================
  //  RENDER ROUTER
  // ============================================================
  const TITLES = { riassunto:'Riassunto', calendario:'Calendario', task:'Task', energy:'Energy Score', revisione:'Revisione', impostazioni:'Impostazioni' };
  function render() {
    $('#viewTitle').textContent = TITLES[state.view] || '';
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    const root = $('#viewRoot'); root.innerHTML = ''; root.scrollTop = 0;
    // top-right action button per-view
    const act = $('#topAction'); act.innerHTML = ''; act.onclick = null; act.classList.remove('accent');
    ({
      riassunto: viewRiassunto,
      calendario: viewCalendario,
      task: viewTask,
      energy: viewEnergy,
      revisione: viewRevisione,
      impostazioni: viewImpostazioni,
    }[state.view] || viewRiassunto)(root);
  }

  function plusAction(fn) {
    const act = $('#topAction'); act.classList.add('accent');
    act.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    act.onclick = fn;
  }

  // ============================================================
  //  VIEW · RIASSUNTO GIORNALIERO
  // ============================================================
  function viewRiassunto(root) {
    const today = new Date();
    const eventi = Store.eventiDelGiorno(today);
    const task = Store.taskAperte();
    const rem = Store.reminderDelGiorno(Store.dayKey(today));

    // header data
    root.append(el('div',{class:'toolbar'},
      el('div',{class:'period-label'}, new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long'}).format(today)),
      el('div',{class:'grow'}),
    ));

    // allerta anticipata (§8): oggi o entro 7 giorni sopra soglia
    const soglia = Store.prefs().sogliaAllerta ?? 80;
    const alerts = Energy.allerta(soglia, Store.checkinDiOggi());
    if (alerts.length) {
      const primo = alerts[0];
      let msg;
      if (primo.offset === 0) msg = `Oggi proietti ${primo.score}. Giornata pesante — tieni un margine e non aggiungere altro.`;
      else {
        const g = new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long'}).format(Store.parseKey(primo.giorno));
        msg = `${g} proietti ${primo.score}. Alleggerisci o preparati per tempo.`;
      }
      if (alerts.length > 1) msg += ` (+${alerts.length-1} altr${alerts.length-1===1?'o giorno':'i giorni'} sopra ${soglia})`;
      root.append(el('div',{class:'alert-banner', onclick:()=>go('energy')},
        el('div',{class:'alert-ico'}, '⚠'),
        el('div',{style:'flex:1'}, el('div',{class:'alert-title'}, 'Allerta carico'), el('div',{class:'alert-msg'}, msg)),
        el('div',{class:'alert-go'}, '›'),
      ));
    }

    // prossimo passo
    const ns = prossimoPasso(eventi, task);
    root.append(el('div',{class:'card'},
      el('div',{class:'section-label eyebrow'},'Prossimo passo'),
      ns
        ? el('div',{class:'next-step'}, el('div',{class:'ns-what'}, ns.what), el('div',{class:'ns-when'}, ns.when))
        : el('div',{class:'next-step empty'}, el('div',{class:'ns-what'}, 'Niente in programma. Goditi la giornata.'))
    ));

    // energy score vivo (Fase 2, step 1) — subito sotto il prossimo passo
    root.append(energyCardOggi());

    // counters
    root.append(el('div',{class:'counters', style:'margin-bottom:12px'},
      counter(eventi.length, 'Eventi'),
      counter(task.length, 'Task aperte'),
      counter(rem.length, 'Reminder'),
    ));

    // suddivisione per categoria (ore per categoria oggi)
    const perCat = {};
    for (const e of eventi) {
      const durH = (new Date(e.fine) - new Date(e.inizio)) / 3600000;
      const c = Store.categoria(e.categoria);
      perCat[c.id] = perCat[c.id] || { cat:c, ore:0 };
      perCat[c.id].ore += Math.max(0, durH);
    }
    const cats = Object.values(perCat).sort((a,b)=>b.ore-a.ore);
    if (cats.length) {
      const maxOre = Math.max(...cats.map(c=>c.ore), 1);
      const card = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Suddivisione di oggi'));
      for (const {cat,ore} of cats) {
        card.append(el('div',{class:'cat-row'},
          el('div',{class:'cat-name'}, cat.nome),
          el('div',{class:'cat-bar'}, el('div',{class:'cat-fill', style:`width:${Math.round(ore/maxOre*100)}%;background:${cat.colore}`})),
          el('div',{class:'cat-val'}, fmtOre(ore)),
        ));
      }
      root.append(card);
    }

    // agenda di oggi
    root.append(el('div',{class:'list-head'}, el('h2',{},'Agenda di oggi'), el('span',{class:'hint'}, eventi.length? '' : '')));
    if (!eventi.length) root.append(el('div',{class:'empty'}, el('div',{class:'em-title'},'Giornata libera'), el('div',{class:'em-sub'},'Aggiungi un evento dal Calendario.')));
    else eventi.forEach(e => root.append(agendaItem(e)));
  }

  // Card Energy Score del giorno (vivo: usa il carico residuo).
  // Presentazione a 3 livelli (ALTO/MEDIO/BASSO), palette dedicata distinta dalle categorie.
  function energyCardOggi() {
    const ci = Store.checkinDiOggi();
    const r = Energy.scoreGiorno(new Date(), { residuo: true, checkin: ci });
    const tk = enTier(r.score);
    const neutro = !ci || !Array.isArray(ci.r);
    const card = el('div',{class:'card energy-card'},
      el('div',{class:'energy-head'},
        el('div',{class:'section-label eyebrow'},'Energy Score'),
        el('button',{class:'ci-redo', onclick:openCheckin}, neutro ? 'Fai il check-in ›' : '↻ check-in'),
      ),
      el('div',{class:'energy-row'},
        el('div',{class:'energy-num mono', style:`color:${tk.col}`}, String(r.score)),
        el('div',{class:'energy-meta'},
          el('div',{class:'energy-label', style:`color:${tk.col}`}, tk.txt),
        ),
      ),
      el('div',{class:'energy-track'}, el('div',{class:'energy-fill', style:`width:${r.score}%;background:${tk.col}`})),
      el('div',{class:'energy-advice'}, Energy.consiglio(r)),
    );
    if (neutro) card.append(el('div',{class:'energy-note'}, ci ? 'Check-in saltato: fattori neutri.' : 'Nessun check-in oggi: fattori neutri.'));
    return card;
  }

  // Livello a 3 fasce per la UI (palette "strumento", distinta dalle categorie)
  function enTier(s){
    if (s >= 70) return { txt:'ALTO',  col:'var(--s-alto)'  };
    if (s >= 35) return { txt:'MEDIO', col:'var(--s-medio)' };
    return          { txt:'BASSO', col:'var(--s-basso)' };
  }

  function prossimoPasso(eventi, task) {
    const now = new Date();
    const futuri = eventi.filter(e => new Date(e.inizio) > now).sort((a,b)=>new Date(a.inizio)-new Date(b.inizio));
    if (futuri.length) {
      const e = futuri[0], d = new Date(e.inizio);
      const mins = Math.round((d - now)/60000);
      const quando = mins < 90 ? `fra ${mins} min (${hhmm(d)})` : `alle ${hhmm(d)}`;
      return { what: e.titolo, when: quando };
    }
    // altrimenti la task più urgente
    const urg = task.slice().sort((a,b)=> (a.scadenza||'9999').localeCompare(b.scadenza||'9999'))[0];
    if (urg) return { what: urg.titolo, when: urg.scadenza ? `task · scade ${scadLabel(urg)}` : 'task · senza scadenza' };
    return null;
  }

  function counter(n, lbl){ return el('div',{class:'counter'}, el('div',{class:'num'}, String(n)), el('div',{class:'lbl'}, lbl)); }

  function agendaItem(e) {
    const c = Store.categoria(e.categoria);
    const d = new Date(e.inizio), f = new Date(e.fine);
    const item = el('div',{class:'agenda-item', onclick:()=>openEventEditor(e)},
      el('div',{class:'agenda-time'}, hhmm(d)),
      el('div',{class:'agenda-bar', style:`background:${c.colore}`}),
      el('div',{class:'agenda-body'},
        el('div',{class:'agenda-title'}, e.titolo, e.ricorrente ? el('span',{class:'rec-badge'},'↻') : null),
        el('div',{class:'agenda-meta'}, `${c.nome} · ${hhmm(d)}–${hhmm(f)}`),
      ),
    );
    return item;
  }

  // ============================================================
  //  VIEW · CALENDARIO
  // ============================================================
  function viewCalendario(root) {
    plusAction(() => openEventEditor(null, state.selected));

    // segmented: modalità
    const seg = el('div',{class:'segmented', style:'margin-bottom:12px'});
    ['giorno','settimana','mese','anno'].forEach(m => {
      seg.append(el('button',{class: state.calMode===m?'active':'', onclick:()=>{state.calMode=m; render();}}, m[0].toUpperCase()+m.slice(1)));
    });
    root.append(seg);

    // toolbar navigazione
    const label = periodLabel();
    root.append(el('div',{class:'toolbar'},
      el('button',{class:'nav-arrow', onclick:()=>{shiftCursor(-1); render();}, html:'‹'}),
      el('div',{class:'period-label grow'}, label),
      el('button',{class:'nav-arrow', onclick:()=>{shiftCursor(1); render();}, html:'›'}),
      el('button',{class:'today-chip', onclick:()=>{state.cursor=new Date(); state.selected=new Date(); render();}}, 'Oggi'),
    ));

    // toggle settimana lavorativa (solo settimana/mese)
    if (state.calMode==='settimana' || state.calMode==='mese') {
      const p = Store.prefs();
      root.append(el('div',{class:'toolbar'},
        el('div',{class:'grow'}),
        el('button',{class:'chip'+(p.settimanaLavorativa?' active':''), onclick:()=>{Store.setPref('settimanaLavorativa', !p.settimanaLavorativa); render();}},
          p.settimanaLavorativa ? 'Lun–Ven' : 'Settimana completa'),
      ));
    }

    ({ giorno: calGiorno, settimana: calSettimana, mese: calMese, anno: calAnno }[state.calMode])(root);
  }

  function periodLabel() {
    const c = state.cursor;
    if (state.calMode==='giorno') return new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long'}).format(state.selected);
    if (state.calMode==='anno') return String(c.getFullYear());
    if (state.calMode==='settimana') { const {start,end}=weekBounds(c); return `${start.getDate()} ${MON[start.getMonth()]} – ${end.getDate()} ${MON[end.getMonth()]}`; }
    return `${MONL[c.getMonth()]} ${c.getFullYear()}`;
  }
  function shiftCursor(dir){
    const c = state.cursor;
    if (state.calMode==='giorno'){ state.selected = Store.addDays(state.selected, dir); state.cursor = new Date(state.selected); }
    else if (state.calMode==='settimana') state.cursor = Store.addDays(c, 7*dir);
    else if (state.calMode==='mese') state.cursor = new Date(c.getFullYear(), c.getMonth()+dir, 1);
    else state.cursor = new Date(c.getFullYear()+dir, c.getMonth(), 1);
  }

  function weekBounds(d) {
    const lav = Store.prefs().settimanaLavorativa;
    const day = d.getDay(); // 0 dom
    const offsetToMon = (day===0 ? -6 : 1-day);
    const start = Store.addDays(Store.startOfDay(d), offsetToMon);
    const end = lav ? Store.addDays(start, 4) : Store.addDays(start, 6);
    return { start, end };
  }

  // -- Giorno: colonna eventi --
  function calGiorno(root) {
    const d = state.selected;
    const eventi = Store.eventiDelGiorno(d);
    const rem = Store.reminderDelGiorno(Store.dayKey(d));
    root.append(el('div',{class:'day-head'},
      el('div',{class:'dh-num'}, String(d.getDate())),
      el('div',{class:'dh-txt'}, `${DOWL[d.getDay()]} · ${MONL[d.getMonth()]}`)
    ));
    if (rem.length) {
      const rc = el('div',{class:'card'}, el('div',{class:'section-label'},'Reminder'));
      rem.forEach(r => rc.append(reminderRow(r)));
      root.append(rc);
    }
    if (!eventi.length) root.append(el('div',{class:'empty'}, el('div',{class:'em-title'},'Nessun evento'), el('div',{class:'em-sub'},'Tocca + per aggiungerne uno.')));
    else { const card = el('div',{class:'card'}); eventi.forEach(e => card.append(agendaItem(e))); root.append(card); }
  }

  // -- Settimana: strip + lista giorno selezionato --
  function calSettimana(root) {
    const {start,end} = weekBounds(state.cursor);
    const days = []; for (let x=new Date(start); x<=end; x=Store.addDays(x,1)) days.push(new Date(x));
    const strip = el('div',{class:'week-strip', style:`--wd:${days.length}`});
    days.forEach(day => {
      const evs = Store.eventiDelGiorno(day);
      const cls = 'ws-cell' + (isToday(day)?' today':'') + (sameDay(day,state.selected)?' selected':'');
      const marks = el('div',{class:'ws-mark'});
      [...new Set(evs.map(e=>Store.categoria(e.categoria).colore))].slice(0,4).forEach(col => marks.append(el('span',{class:'ws-dot', style:`background:${col}`})));
      strip.append(el('button',{class:cls, onclick:()=>{state.selected=day; render();}},
        el('div',{class:'ws-dow'}, DOW[day.getDay()]),
        el('div',{class:'ws-num'}, String(day.getDate())),
        marks,
      ));
    });
    root.append(strip);
    // lista del giorno selezionato
    const sel = state.selected;
    root.append(el('div',{class:'list-head'}, el('h2',{}, new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric'}).format(sel))));
    const eventi = Store.eventiDelGiorno(sel);
    if (!eventi.length) root.append(el('div',{class:'empty'}, el('div',{class:'em-title'},'Giorno libero')));
    else { const card = el('div',{class:'card'}); eventi.forEach(e => card.append(agendaItem(e))); root.append(card); }
  }

  // -- Mese: griglia --
  function calMese(root) {
    const c = state.cursor;
    const lav = Store.prefs().settimanaLavorativa;
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const startDow = (first.getDay()===0?7:first.getDay()) - 1; // lun=0
    const gridStart = Store.addDays(first, -startDow);
    const dows = lav ? ['lun','mar','mer','gio','ven'] : ['lun','mar','mer','gio','ven','sab','dom'];

    const grid = el('div',{class:'cal-grid', style: lav?'grid-template-columns:repeat(5,1fr)':''});
    dows.forEach(d => grid.append(el('div',{class:'cal-dow'}, d)));

    for (let w=0; w<6; w++) {
      for (let i=0; i<7; i++) {
        const day = Store.addDays(gridStart, w*7+i);
        if (lav && (day.getDay()===0 || day.getDay()===6)) continue;
        const evs = Store.eventiDelGiorno(day);
        const out = day.getMonth() !== c.getMonth();
        const cls = 'cal-cell'+(out?' out':'')+(isToday(day)?' today':'')+(sameDay(day,state.selected)?' selected':'');
        const dots = el('div',{class:'cal-dots'});
        [...new Set(evs.map(e=>Store.categoria(e.categoria).colore))].slice(0,3).forEach(col => dots.append(el('span',{class:'cal-dot', style:`background:${col}`})));
        grid.append(el('button',{class:cls, onclick:()=>{state.selected=new Date(day); state.calMode='giorno'; render();}},
          el('div',{class:'cal-daynum'}, String(day.getDate())), dots));
      }
    }
    root.append(grid);
    root.append(el('div',{class:'hint', style:'text-align:center;margin-top:12px'},'Tocca un giorno per aprirlo.'));
  }

  // -- Anno: 12 mini-mesi --
  function calAnno(root) {
    const y = state.cursor.getFullYear();
    const grid = el('div',{class:'year-grid'});
    for (let m=0; m<12; m++) {
      const from = new Date(y,m,1), to = new Date(y,m+1,0);
      const evs = Store.eventiTra(from,to);
      const daysWith = new Set(evs.map(e=>e.giorno));
      const box = el('div',{class:'year-month', onclick:()=>{state.cursor=new Date(y,m,1); state.calMode='mese'; render();}},
        el('div',{class:'ym-name'}, MONL[m]));
      const mini = el('div',{class:'ym-mini'});
      const first = new Date(y,m,1); const startDow=(first.getDay()===0?7:first.getDay())-1;
      for (let s=0;s<startDow;s++) mini.append(el('div',{class:'ym-day'},''));
      for (let dd=1; dd<=to.getDate(); dd++) {
        const key = Store.dayKey(new Date(y,m,dd));
        const cls = 'ym-day'+(daysWith.has(key)?' has':'')+(isToday(new Date(y,m,dd))?' today':'');
        mini.append(el('div',{class:cls}, String(dd)));
      }
      box.append(mini); grid.append(box);
    }
    root.append(grid);
  }

  // ============================================================
  //  VIEW · TASK
  // ============================================================
  function viewTask(root) {
    plusAction(() => openTaskEditor(null));
    const task = Store.taskAperte().map(t => ({ t, ritardo: Store.giorniRitardo(t) }));
    task.sort((a,b) => {
      if ((b.ritardo>0) !== (a.ritardo>0)) return (b.ritardo>0?1:0)-(a.ritardo>0?1:0);
      return (a.t.scadenza||'9999').localeCompare(b.t.scadenza||'9999');
    });
    if (!task.length) { root.append(el('div',{class:'empty'}, el('div',{class:'em-title'},'Nessuna task aperta'), el('div',{class:'em-sub'},'Tocca + per crearne una.'))); return; }
    const card = el('div',{class:'card'});
    task.forEach(({t,ritardo}) => card.append(taskItem(t, ritardo)));
    root.append(card);
  }

  function taskItem(t, ritardo) {
    const overdue = ritardo > 0;
    const check = el('button',{class:'task-check'+(overdue?' overdue':''), 'aria-label':'Completa'});
    const item = el('div',{class:'task-item'+(overdue?' overdue':'')},
      check,
      el('div',{class:'task-body', onclick:()=>openTaskEditor(t)},
        el('div',{class:'task-title'}, t.titolo),
        el('div',{class:'task-meta'}, taskMeta(t, ritardo)),
      ),
      el('span',{class:'task-int'}, {bassa:'bassa',media:'media',alta:'alta'}[t.intensita] || 'media'),
    );
    check.addEventListener('click', (ev) => {
      ev.stopPropagation();
      check.classList.add('checked','burst');
      openDifficolta(t, () => { item.style.transition='opacity .3s, transform .3s'; item.style.opacity='0'; item.style.transform='translateX(12px)'; setTimeout(render, 300); });
    });
    return item;
  }
  function taskMeta(t, ritardo) {
    let s = t.scadenza ? `scade ${scadLabel(t)}` : 'senza scadenza';
    if (ritardo>0) s = ritardo===1 ? 'scaduta ieri' : `scaduta ${ritardo}gg fa`;
    return `${s} · ${fmtOre(t.effortOre)}`;
  }
  function scadLabel(t) {
    const d = Store.parseKey(t.scadenza); const oggi=Store.startOfDay(new Date());
    const diff = Math.round((Store.startOfDay(d)-oggi)/86400000);
    if (diff===0) return 'oggi'; if (diff===1) return 'domani'; if (diff===-1) return 'ieri';
    return new Intl.DateTimeFormat('it-IT',{weekday:'short',day:'numeric',month:'short'}).format(d);
  }

  function openDifficolta(t, done) {
    const scrim = el('div',{class:'dialog-scrim'});
    const close = (fb) => { Store.completaTask(t.id, fb); scrim.remove(); toast('Task completata ✓'); done && done(); };
    scrim.append(el('div',{class:'dialog'},
      el('h3',{},'Task completata'),
      el('p',{},'Hai avuto difficoltà?'),
      el('div',{class:'chips', style:'margin-bottom:12px'},
        el('button',{class:'chip', onclick:()=>close({v:'no'})},'No'),
        el('button',{class:'chip', onclick:()=>close({v:'si'})},'Sì'),
        el('button',{class:'chip', onclick:()=>promptAltro(scrim, close)},'Altro…'),
      ),
    ));
    document.body.append(scrim);
  }
  function promptAltro(scrim, close) {
    const box = $('.dialog', scrim); box.innerHTML='';
    const ta = el('textarea',{rows:'3', placeholder:'Due parole su com\'è andata…'});
    box.append(el('h3',{},'Com\'è andata?'), el('div',{class:'field'}, ta),
      el('button',{class:'btn block', onclick:()=>close({v:'altro', testo: ta.value.trim()})},'Salva'));
    ta.focus();
  }

  // ============================================================
  //  VIEW · ENERGY SCORE (Fase 2)
  // ============================================================
  const TASK_COL = '#8a94a6';   // grigio-ardesia: le task, distinto dai toni categoria

  function viewEnergy(root) {
    const seg = el('div',{class:'segmented', style:'margin-bottom:14px'});
    ['giorno','settimana','mese'].forEach(m => seg.append(
      el('button',{class: state.enMode===m?'active':'', onclick:()=>{ state.enMode=m; state.enCat=null; state.enBar=null; render(); }},
        m[0].toUpperCase()+m.slice(1))));
    root.append(seg);
    if (state.enMode === 'giorno') enGiorno(root);
    else enPeriodo(root, state.enMode);
  }

  // anello SVG: arco score + tacca 80 + numero/livello al centro
  function enRing(score) {
    const tk = enTier(score), R = 92, C = 2*Math.PI*R, off = C*(1 - score/100);
    const a = (-90 + 80/100*360) * Math.PI/180, cx=105, cy=105, r1=R-11, r2=R+11;
    const x1=(cx+r1*Math.cos(a)).toFixed(1), y1=(cy+r1*Math.sin(a)).toFixed(1);
    const x2=(cx+r2*Math.cos(a)).toFixed(1), y2=(cy+r2*Math.sin(a)).toFixed(1);
    return el('div',{class:'en-ringwrap'}, el('div',{class:'en-ring', html:
      `<svg class="en-arc" width="210" height="210" viewBox="0 0 210 210">
         <circle cx="105" cy="105" r="${R}" fill="none" stroke="var(--bg-panel)" stroke-width="14"/>
         <circle cx="105" cy="105" r="${R}" fill="none" stroke="${tk.col}" stroke-width="14" stroke-linecap="round"
           stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>
       <svg width="210" height="210" viewBox="0 0 210 210" style="position:absolute;inset:0">
         <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text)" stroke-width="2" opacity=".7"/></svg>
       <div class="en-center"><div class="en-num mono" style="color:${tk.col}">${score}</div>
         <div class="en-tier" style="color:${tk.col}">${tk.txt}</div></div>`}));
  }

  // --- GIORNO: anello (filtrabile per categoria) + barre "cosa pesa oggi" ---
  function enGiorno(root) {
    const key = Store.dayKey(new Date());
    const ci = Store.checkinDiOggi();
    const full = Energy.scoreGiorno(new Date(), { residuo: true, checkin: ci });
    const cats = Energy.caricoCategorie(key, { residuo: true });
    const caricoTk = Energy.caricoTask(key);
    const rows = cats.map(c => ({ id:c.id, nome:c.nome, colore:c.colore, ore:c.ore, carico:c.carico }));
    if (caricoTk > 0) rows.push({ id:'__task', nome:'Task', colore:TASK_COL, ore:null, carico:caricoTk });
    const tot = rows.reduce((a,r)=>a+r.carico, 0);

    if (state.enCat != null && !rows.some(r=>r.id===state.enCat)) state.enCat = null;
    let shown = full.score;
    if (state.enCat != null) shown = Energy.scoreDaCarico(rows.find(r=>r.id===state.enCat).carico, { checkin: ci }).score;

    const ringCard = el('div',{class:'card'}, enRing(shown));
    if (state.enCat != null) ringCard.append(el('div',{class:'en-filt'},
      el('button',{class:'en-reset', onclick:()=>{ state.enCat=null; render(); }}, 'Tutte')));
    root.append(ringCard);

    const barsCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'}, 'Cosa pesa oggi · tocca per filtrare'));
    if (!rows.length) barsCard.append(el('div',{class:'hint'}, 'Niente in agenda che pesi oggi.'));
    rows.forEach(r => {
      const sel = state.enCat === r.id;
      barsCard.append(el('div',{class:'en-catrow'+(sel?' sel':''), onclick:()=>{ state.enCat = sel?null:r.id; render(); }},
        el('div',{class:'en-swatch', style:`background:${r.colore}`}),
        el('div',{class:'en-catname'}, r.nome),
        el('div',{class:'en-cattrack'}, el('div',{class:'en-catfill', style:`width:${tot? r.carico/tot*100:0}%;background:${r.colore}`})),
        el('div',{class:'en-catval mono'}, r.ore!=null ? fmt1(r.ore)+' h' : fmt1(r.carico)),
      ));
    });
    const oreRec = Energy.oreRecupero(key, true, new Date());
    if (oreRec > 0) barsCard.append(el('div',{class:'en-recnote'}, `↓ recupero · ${fmt1(oreRec)} h · −${Math.min(15, Math.round(oreRec*5))}`));
    root.append(barsCard);

    root.append(el('div',{class:'card'}, el('div',{class:'energy-advice'}, Energy.consiglio(full))));
  }

  // --- SETTIMANA / MESE: anello media|picco + istogramma giornaliero con tap ---
  function enPeriodo(root, mode) {
    const giorni = mode==='settimana' ? enSettimana() : enMese();
    const P = giorni.map(d => ({ date:d, score: Energy.scoreGiorno(d, { residuo:false, checkin: Store.checkinDi(Store.dayKey(d)) }).score }));
    const vals = P.map(x=>x.score);
    const media = Math.round(vals.reduce((a,b)=>a+b,0) / (vals.length||1));
    const picco = vals.length ? Math.max(...vals) : 0;
    const head = state.enHead==='media' ? media : picco;

    const ringCard = el('div',{class:'card'}, enRing(head));
    const mp = el('div',{class:'en-mp'});
    [['media','Media'],['picco','Picco']].forEach(([k,lab]) => mp.append(
      el('button',{class: state.enHead===k?'on':'', onclick:()=>{ state.enHead=k; render(); }}, lab)));
    ringCard.append(mp);
    root.append(ringCard);

    const barsCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'}, mode==='settimana'?'Andamento settimana':'Andamento mese'));
    if (state.enBar != null && state.enBar >= P.length) state.enBar = null;

    const wrap = el('div',{class:'en-bars-wrap'});
    wrap.append(el('div',{class:'en-line80', style:`top:${(1-80/100)*120}px`}, el('span',{},'80')));
    const bars = el('div',{class:'en-bars'});
    P.forEach((x,i) => {
      const dim = state.enBar!=null && state.enBar!==i;
      const lab = mode==='settimana' ? DOW[x.date.getDay()] : String(x.date.getDate());
      bars.append(el('div',{class:'en-bar'+(dim?' dim':''), onclick:()=>{ state.enBar = state.enBar===i?null:i; render(); }},
        el('div',{class:'en-col', style:`height:${x.score}%;background:${enTier(x.score).col}`}),
        el('div',{class:'en-d'}, lab),
      ));
    });
    wrap.append(bars);
    barsCard.append(wrap);

    if (state.enBar != null && P[state.enBar]) {
      const b = P[state.enBar], tk = enTier(b.score);
      const dstr = new Intl.DateTimeFormat('it-IT').format(b.date);
      barsCard.append(el('div',{class:'en-stat'},
        el('div',{class:'en-strow'}, el('span',{},'Data'),    el('b',{class:'mono'}, dstr)),
        el('div',{class:'en-strow'}, el('span',{},'Score'),   el('b',{class:'mono', style:`color:${tk.col}`}, String(b.score))),
        el('div',{class:'en-strow'}, el('span',{},'Livello'), el('b',{style:`color:${tk.col}`}, tk.txt)),
      ));
    } else {
      barsCard.append(el('div',{class:'en-stat-hint'}, 'Tocca una barra per i dettagli'));
    }
    root.append(barsCard);
  }

  function enSettimana() {
    const t = new Date(); const dow = (t.getDay()+6)%7;         // lun = 0
    const mon = Store.addDays(t, -dow); mon.setHours(0,0,0,0);
    return [...Array(7)].map((_,i)=>Store.addDays(mon,i));
  }
  function enMese() {
    const t = new Date(), y=t.getFullYear(), m=t.getMonth();
    const n = new Date(y, m+1, 0).getDate();
    return [...Array(n)].map((_,i)=>new Date(y,m,i+1));
  }

  // ============================================================
  //  VIEW · REVISIONE (base Fase 1: task incompiute di oggi)
  // ============================================================
  function viewRevisione(root) {
    const today = new Date();
    const key = Store.dayKey(today);
    const eventiPassati = Store.eventiDelGiorno(today).filter(e => new Date(e.fine) <= new Date());
    const aperte = Store.taskAperte();
    root.append(el('div',{class:'toolbar'}, el('div',{class:'period-label'}, 'Chiusura di ' + new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long'}).format(today))));

    // Energy Score del giorno intero (con il check-in di oggi)
    const r = Energy.scoreGiorno(today, { residuo:false, checkin: Store.checkinDiOggi() });
    const tk = enTier(r.score);
    const oreRec = Energy.oreRecupero(key, false, new Date());
    const scoreCard = el('div',{class:'card'},
      el('div',{class:'section-label eyebrow'},'Energy Score di oggi'),
      el('div',{class:'rev-score'},
        el('div',{class:'rev-num mono', style:`color:${tk.col}`}, String(r.score)),
        el('div',{class:'rev-tier', style:`color:${tk.col}`}, tk.txt),
      ),
      el('div',{class:'rev-row'}, el('span',{},'Carico del giorno'), el('b',{class:'mono'}, fmt1(r.carico))),
      el('div',{class:'rev-row'}, el('span',{},'Recupero'), el('b',{class:'mono'}, oreRec>0 ? `${fmt1(oreRec)} h · −${Math.min(15,Math.round(oreRec*5))}` : '—')),
    );
    root.append(scoreCard);

    root.append(el('div',{class:'counters', style:'margin:4px 0 14px'},
      counter(eventiPassati.length,'Eventi conclusi'),
      counter(aperte.length,'Task ancora aperte'),
    ));
    root.append(el('div',{class:'list-head'}, el('h2',{},'Task non completate')));
    if (!aperte.length) root.append(el('div',{class:'empty'}, el('div',{class:'em-title'},'Tutto chiuso 👏'), el('div',{class:'em-sub'},'Niente in sospeso per oggi.')));
    else { const card=el('div',{class:'card'}); aperte.forEach(t => card.append(taskItem(t, Store.giorniRitardo(t)))); root.append(card); }
  }

  // ============================================================
  //  VIEW · IMPOSTAZIONI
  // ============================================================
  function viewImpostazioni(root) {
    const p = Store.prefs();

    // Tema
    const temaCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Tema'));
    const temi = [['auto','Automatico (iOS)'],['dark-plus','Dark+'],['light-plus','Light+'],['one-dark','One Dark'],['dracula','Dracula']];
    const chips = el('div',{class:'chips'});
    temi.forEach(([id,label]) => chips.append(el('button',{class:'chip'+(p.tema===id?' active':''), onclick:()=>{Store.setPref('tema',id); applyTheme(); render();}}, label)));
    temaCard.append(chips);
    temaCard.append(el('div',{class:'hint', style:'margin-top:10px'},'Altri temi VS Code (Nord, Gruvbox, Tokyo Night…) arrivano in Fase 5.'));
    root.append(temaCard);

    // Categorie
    const intLabel = { bassa:'bassa', media:'media', alta:'alta' };
    const catMeta = c => c.neutra ? 'neutra · non incide'
      : c.recupero ? 'recupero · self-care'
      : 'carico · intensità ' + (intLabel[c.intensitaDefault] || 'media');
    const catCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Categorie'));
    Store.categorie().forEach(c => {
      catCard.append(el('div',{class:'cat-pick', onclick:()=>openCategoriaEditor(c)},
        el('div',{class:'cat-swatch', style:`background:${c.colore}`}),
        el('div',{style:'flex:1'}, el('div',{style:'font-size:.92rem;font-weight:500'}, c.nome),
          el('div',{class:'hint'}, catMeta(c))),
        el('div',{class:'hint'},'modifica ›'),
      ));
    });
    catCard.append(el('button',{class:'btn ghost sm', style:'margin-top:8px', onclick:()=>openCategoriaEditor(null)},'+ Nuova categoria'));
    root.append(catCard);

    // Parametri Energy Score
    const parCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Parametri Energy Score'));
    parCard.append(numRow('Ore di capacità', p.oreCapacita, 'h', v=>Store.setPref('oreCapacita',v), 3, 12, 0.5));
    parCard.append(numRow('Target sonno', p.targetSonno, 'h', v=>Store.setPref('targetSonno',v), 5, 10, 0.5));
    parCard.append(numRow('Soglia allerta', p.sogliaAllerta, '', v=>Store.setPref('sogliaAllerta',v), 60, 95, 5));
    parCard.append(el('div',{class:'hint', style:'margin-top:8px'},'La soglia allerta accende l\'avviso anticipato nel Riassunto.'));
    root.append(parCard);

    // Connessioni (Fase 3)
    // Connessioni (Fase 3)
    const connCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Connessioni'));
    connCard.append(el('div',{class:'hint', style:'margin-bottom:10px'},'Importa le call di lavoro dal PDF del calendario Outlook (Vista Verticale). Tutto in locale: il file non lascia il telefono.'));
    connCard.append(el('button',{class:'btn ghost sm', onclick:()=>ImportCal.apri({onDone:render})},'Importa calendario Outlook'));
    root.append(connCard);

    // Dati
    const dataCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Dati'));
    dataCard.append(el('div',{class:'hint', style:'margin-bottom:10px'},'Tutto è salvato solo su questo telefono. Nessun backup automatico (scelta di design).'));
    dataCard.append(el('button',{class:'btn ghost sm', style:'margin-right:8px', onclick:exportData},'Esporta JSON'));
    dataCard.append(el('button',{class:'btn danger sm', onclick:confirmReset},'Azzera tutto'));
    root.append(dataCard);

    root.append(el('div',{class:'hint', style:'text-align:center;margin-top:8px'},'Morning Briefing · v1'));
  }

  function numRow(label, val, unit, onChange, min, max, step) {
    const disp = el('span',{class:'mono', style:'min-width:52px;text-align:right'}, `${val}${unit}`);
    const dec = el('button',{class:'nav-arrow', html:'−'});
    const inc = el('button',{class:'nav-arrow', html:'+'});
    let v = val;
    const upd = (nv) => { v = Math.min(max, Math.max(min, Math.round(nv/step)*step)); disp.textContent = `${v}${unit}`; onChange(v); };
    dec.onclick = ()=>upd(v-step); inc.onclick = ()=>upd(v+step);
    return el('div',{class:'toolbar', style:'margin:6px 0'},
      el('div',{class:'grow', style:'font-size:.9rem'}, label), dec, disp, inc);
  }

  function openCategoriaEditor(cat) {
    const isNew = !cat;
    cat = cat ? {...cat} : { id: Store.uid(), nome:'', colore:null, intensitaDefault:'media' };
    const PALETTE = ['#4ea1ff','#c792ea','#26c6da','#4ec97a','#ffb454','#f78c6c','#f14c4c','#bd93f9','#50fa7b','#61afef','#e5c07b','#98c379'];
    // colori già usati da ALTRE categorie: non riassegnabili (evita confusione)
    const presi = new Set(Store.categorie().filter(x => x.id !== cat.id).map(x => x.colore));
    let selCol = cat.colore || PALETTE.find(c => !presi.has(c)) || PALETTE[0];

    const nome = el('input',{value:cat.nome, placeholder:'Es. Famiglia'});
    const swWrap = el('div',{class:'swatches'});
    PALETTE.forEach(col => {
      const taken = presi.has(col);
      const s = el('button',{class:'swatch'+(col===selCol?' sel':'')+(taken?' taken':''), style:`background:${col}`});
      if (taken) s.disabled = true;
      else s.onclick = ()=>{ selCol=col; $$('.swatch',swWrap).forEach(x=>x.classList.remove('sel')); s.classList.add('sel'); };
      swWrap.append(s);
    });

    let intens = cat.intensitaDefault || 'media';
    const intChips = el('div',{class:'chips'});
    [['bassa','Bassa'],['media','Media'],['alta','Alta']].forEach(([v,l]) => {
      const b = el('button',{class:'chip'+(v===intens?' active':'')}, l);
      b.onclick = ()=>{ intens=v; $$('.chip',intChips).forEach(x=>x.classList.remove('active')); b.classList.add('active'); };
      intChips.append(b);
    });

    // Ruolo verso l'Energy Score: carico | recupero | neutra
    let ruolo = cat.neutra ? 'neutra' : (cat.recupero ? 'recupero' : 'carico');
    const RUOLO_TXT = {
      carico:   'Pesa sull\'Energy Score (carico normale).',
      recupero: 'Self-care: scarica lo score. −5 punti per ogni ora, fino a −15 al giorno.',
      neutra:   'Non incide sull\'Energy Score, né carico né recupero.',
    };
    const ruoloHint = el('div',{class:'hint', style:'margin-top:8px'});
    const intField = el('div',{class:'field'}, el('label',{},'Intensità predefinita'), intChips,
      el('div',{class:'hint', style:'margin-top:8px'},'Pre-compila l\'intensità quando crei un evento in questa categoria. È la base del carico nell\'Energy Score.'));
    const syncRuolo = () => { ruoloHint.textContent = RUOLO_TXT[ruolo]; intField.style.display = ruolo==='carico' ? '' : 'none'; };
    const ruoloChips = el('div',{class:'chips'});
    [['carico','Carico'],['recupero','Recupero'],['neutra','Neutra']].forEach(([v,l]) => {
      const b = el('button',{class:'chip'+(v===ruolo?' active':'')}, l);
      b.onclick = ()=>{ ruolo=v; $$('.chip',ruoloChips).forEach(x=>x.classList.remove('active')); b.classList.add('active'); syncRuolo(); };
      ruoloChips.append(b);
    });
    syncRuolo();

    openSheet(isNew?'Nuova categoria':'Modifica categoria', [
      el('div',{class:'field'}, el('label',{},'Nome'), nome),
      el('div',{class:'field'}, el('label',{},'Colore'), swWrap),
      el('div',{class:'field'}, el('label',{},'Ruolo verso l\'Energy Score'), ruoloChips, ruoloHint),
      intField,
    ], {
      onSave: () => {
        if (!nome.value.trim()) { toast('Dai un nome alla categoria'); return false; }
        Store.upsertCategoria({ id:cat.id, nome:nome.value.trim(), colore:selCol, intensitaDefault:intens,
          recupero: ruolo==='recupero', neutra: ruolo==='neutra' });
        render(); return true;
      },
      onDelete: isNew ? null : () => { Store.deleteCategoria(cat.id); render(); },
    });
  }

  // ============================================================
  //  EDITOR · EVENTO
  // ============================================================
  function openEventEditor(occ, defaultDay) {
    const isNew = !occ;
    const base = defaultDay || state.selected || new Date();
    const start = occ ? new Date(occ.inizio) : roundedNow(base);
    const end   = occ ? new Date(occ.fine)   : new Date(start.getTime()+60*60000);

    const titolo = el('input',{value: occ?occ.titolo:'', placeholder:'Es. Call cliente X'});
    const catSel = el('select',{});
    const initialCat = occ ? occ.categoria : (Store.categorie()[0]?.id || 'lavoro');
    Store.categorie().forEach(c => catSel.append(el('option',{value:c.id, ...(initialCat===c.id?{selected:''}:{}) }, c.nome)));
    const dataIn = el('input',{type:'date', value: dateVal(start)});
    const oraIn  = el('input',{type:'time', value: timeVal(start)});
    const oraFn  = el('input',{type:'time', value: timeVal(end)});

    let intens = occ ? occ.intensita : (Store.categoria(initialCat).intensitaDefault || 'media');
    const intChips = el('div',{class:'chips'});
    const setIntens = (v) => { intens=v; $$('.chip',intChips).forEach(x=>x.classList.toggle('active', x.dataset.v===v)); };
    [['bassa','Bassa'],['media','Media'],['alta','Alta']].forEach(([v,l]) => {
      intChips.append(el('button',{class:'chip'+(v===intens?' active':''), 'data-v':v, onclick:()=>setIntens(v)}, l));
    });
    // cambiando categoria, pre-compila l'intensità predefinita (resta modificabile)
    catSel.addEventListener('change', () => setIntens(Store.categoria(catSel.value).intensitaDefault || 'media'));

    const fields = [
      el('div',{class:'field'}, el('label',{},'Titolo'), titolo),
      el('div',{class:'field'}, el('label',{},'Categoria'), catSel),
      el('div',{class:'field'}, el('label',{},'Giorno'), dataIn),
      el('div',{class:'row2'},
        el('div',{class:'field'}, el('label',{},'Inizio'), oraIn),
        el('div',{class:'field'}, el('label',{},'Fine'), oraFn),
      ),
      el('div',{class:'field'}, el('label',{},'Intensità'), intChips),
    ];

    // ricorrenza — solo alla creazione
    let ricorrente = false;
    if (isNew) {
      const recChip = el('button',{class:'chip'}, 'Ripeti ogni settimana');
      recChip.onclick = ()=>{ ricorrente=!ricorrente; recChip.classList.toggle('active', ricorrente); };
      fields.push(el('div',{class:'field'}, el('label',{},'Ricorrenza (settimana-template)'), recChip));
    } else if (occ.ricorrente) {
      fields.push(el('div',{class:'hint', style:'margin:-4px 0 12px'},'↻ Occorrenza di una serie settimanale. Le modifiche valgono solo per questo giorno.'));
    }

    openSheet(isNew?'Nuovo evento':'Modifica evento', fields, {
      onSave: () => {
        if (!titolo.value.trim()) { toast('Serve un titolo'); return false; }
        const [y,m,d] = dataIn.value.split('-').map(Number);
        const [h1,mi1] = oraIn.value.split(':').map(Number);
        const [h2,mi2] = oraFn.value.split(':').map(Number);
        let inizio = new Date(y,m-1,d,h1,mi1), fine = new Date(y,m-1,d,h2,mi2);
        if (fine <= inizio) fine = new Date(fine.getTime() + 24*3600*1000); // a cavallo della mezzanotte → finisce il giorno dopo
        const patch = { titolo:titolo.value.trim(), categoria:catSel.value, intensita:intens,
                        inizio:isoLocal(inizio), fine:isoLocal(fine) };
        if (isNew) Store.addEvento({ ...patch, ricorrente });
        else Store.updateEvento(occ, patch);
        render(); return true;
      },
      onDelete: isNew ? null : () => { Store.deleteEvento(occ); render(); },
      extra: (!isNew && occ.ricorrente) ? el('button',{class:'btn danger block', style:'margin-top:8px',
        onclick: ()=>{ Store.deleteSerieIntera(occ.serieId); closeSheet(); render(); toast('Serie eliminata'); }}, 'Elimina tutta la serie') : null,
    });
  }

  // ============================================================
  //  EDITOR · TASK
  // ============================================================
  function openTaskEditor(t) {
    const isNew = !t;
    const titolo = el('input',{value:t?t.titolo:'', placeholder:'Es. Prenotare dentista'});
    const scad = el('input',{type:'date', value: t&&t.scadenza ? t.scadenza : dateVal(new Date())});
    const effort = el('input',{type:'number', min:'0', step:'0.5', value: t?t.effortOre:1});
    let intens = t?t.intensita:'media';
    const intChips = el('div',{class:'chips'});
    [['bassa','Bassa'],['media','Media'],['alta','Alta']].forEach(([v,l]) => {
      const b=el('button',{class:'chip'+(v===intens?' active':'')}, l);
      b.onclick=()=>{intens=v; $$('.chip',intChips).forEach(x=>x.classList.remove('active')); b.classList.add('active');};
      intChips.append(b);
    });
    openSheet(isNew?'Nuova task':'Modifica task', [
      el('div',{class:'field'}, el('label',{},'Titolo'), titolo),
      el('div',{class:'row2'},
        el('div',{class:'field'}, el('label',{},'Scadenza'), scad),
        el('div',{class:'field'}, el('label',{},'Effort (ore)'), effort),
      ),
      el('div',{class:'field'}, el('label',{},'Intensità'), intChips),
    ], {
      onSave: () => {
        if (!titolo.value.trim()) { toast('Serve un titolo'); return false; }
        const patch = { titolo:titolo.value.trim(), scadenza:scad.value, effortOre:parseFloat(effort.value)||0, intensita:intens };
        if (isNew) Store.addTask(patch); else Store.updateTask(t.id, patch);
        render(); return true;
      },
      onDelete: isNew ? null : () => { Store.deleteTask(t.id); render(); },
    });
  }

  // reminder row (con azioni in-app, non da notifica)
  function reminderRow(r) {
    return el('div',{class:'agenda-item'},
      el('div',{class:'agenda-bar', style:'background:var(--warn)'}),
      el('div',{class:'agenda-body'}, el('div',{class:'agenda-title'}, 'Reminder: '+r.testo)),
      el('button',{class:'btn ghost sm', onclick:()=>{Store.updateReminder(r.id,{stato:'fatto'}); toast('Fatto ✓'); render();}}, 'Fatto'),
    );
  }

  // ============================================================
  //  CHECK-IN MATTUTINO (Fase 2) — 6 domande, 1 tap l'una, skippabile
  //  I 5 quesiti valgono -1/0/+1 (sinistra→destra). Il 6° sono le ore.
  // ============================================================
  const CHECKIN_Q = [
    { q: 'Come hai dormito?',                       opt: ['Male','Così così','Bene'] },
    { q: 'Come ti senti fisicamente?',              opt: ['Scarico','Nella media','In forma'] },
    { q: 'Che umore hai?',                          opt: ['Giù','Neutro','Su'] },
    { q: 'Quanto sei sotto tensione?',              opt: ['Molto','Un po\'','Tranquillo'] }, // invertita: Tranquillo = +1
    { q: 'Quanto ti senti motivato e concentrato?', opt: ['Poco','Abbastanza','Molto'] },
  ];

  function openCheckin() {
    const answers = new Array(CHECKIN_Q.length).fill(null);
    const last = Store.checkinDiOggi();
    let ore = (last && typeof last.ore === 'number') ? last.ore : (Store.prefs().targetSonno ?? 7.5);
    const total = CHECKIN_Q.length + 1; // 5 domande + sonno

    const panel = el('div',{class:'checkin'});
    const scrim = el('div',{class:'checkin-scrim'}, panel);
    document.body.append(scrim);

    const finish = (payload) => { Store.salvaCheckin({ ...payload, ts: Date.now() }); scrim.remove(); render(); toast('Check-in salvato'); };
    const skip   = () => { Store.salvaCheckin({ skip: true, ts: Date.now() }); scrim.remove(); render(); };

    function chrome(i) {
      const dots = el('div',{class:'ci-dots'});
      for (let k=0;k<total;k++) dots.append(el('span',{class:'ci-dot'+(k<=i?' on':'')}));
      return [
        el('div',{class:'ci-head'},
          el('div',{},
            el('div',{class:'ci-hello'},'Buongiorno'),
            el('div',{class:'ci-date'}, new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long'}).format(new Date())),
          ),
          el('button',{class:'ci-skip', onclick:skip},'Salta'),
        ),
        dots,
      ];
    }

    function step(i) {
      panel.innerHTML = '';
      chrome(i).forEach(n => panel.append(n));

      if (i < CHECKIN_Q.length) {
        const item = CHECKIN_Q[i];
        panel.append(el('div',{class:'ci-q'}, item.q));
        const opts = el('div',{class:'ci-opts'});
        item.opt.forEach((label, idx) => {
          const val = idx - 1; // 0→-1, 1→0, 2→+1
          opts.append(el('button',{class:'ci-opt'+(answers[i]===val?' sel':''),
            onclick:()=>{ answers[i]=val; step(i+1); }}, label));
        });
        panel.append(opts);
      } else {
        // 6ª: ore di sonno (stepper 30 min)
        panel.append(el('div',{class:'ci-q'},'Quante ore hai dormito?'));
        const disp = el('div',{class:'ci-sleep mono'}, fmtOreMin(ore));
        const set = (nv) => { ore = Math.min(12, Math.max(3, Math.round(nv*2)/2)); disp.textContent = fmtOreMin(ore); };
        panel.append(el('div',{class:'ci-sleep-row'},
          el('button',{class:'ci-step', onclick:()=>set(ore-0.5)},'−'), disp,
          el('button',{class:'ci-step', onclick:()=>set(ore+0.5)},'+'),
        ));
        panel.append(el('button',{class:'ci-done', onclick:()=>finish({ r: answers.map(v=>v??0), ore })},'Fatto'));
      }

      if (i > 0) panel.append(el('button',{class:'ci-back', onclick:()=>step(i-1)},'‹ Indietro'));
    }
    step(0);
  }

  function fmtOreMin(h){ const H=Math.floor(h); const M=Math.round((h-H)*60); return `${H}h${String(M).padStart(2,'0')}`; }

  // ============================================================
  //  SHEET / TOAST
  // ============================================================
  let sheetScrim = null;
  function openSheet(title, fields, {onSave, onDelete, extra}={}) {
    closeSheet();
    const body = el('div',{class:'sheet'},
      el('div',{class:'sheet-grab'}),
      el('div',{class:'sheet-head'}, el('div',{class:'sheet-title'}, title), el('button',{class:'sheet-close', html:'✕', onclick:closeSheet})),
    );
    fields.forEach(f => body.append(f));
    body.append(el('button',{class:'btn block', style:'margin-top:6px', onclick:()=>{ if(onSave()!==false) closeSheet(); }}, 'Salva'));
    if (extra) body.append(extra);
    if (onDelete) body.append(el('button',{class:'btn danger block', style:'margin-top:8px', onclick:()=>{ onDelete(); closeSheet(); toast('Eliminato'); }}, 'Elimina'));
    sheetScrim = el('div',{class:'sheet-scrim', onclick:(e)=>{ if(e.target===sheetScrim) closeSheet(); }}, body);
    document.body.append(sheetScrim);
  }
  function closeSheet(){ if (sheetScrim){ sheetScrim.remove(); sheetScrim=null; } }

  let toastT = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(()=>t.classList.add('hidden'), 1800);
  }

  function confirmReset() {
    const scrim = el('div',{class:'dialog-scrim'});
    scrim.append(el('div',{class:'dialog'},
      el('h3',{},'Azzerare tutto?'),
      el('p',{},'Elimina eventi, task, reminder e impostazioni da questo telefono. Non è reversibile.'),
      el('div',{class:'row2'},
        el('button',{class:'btn ghost', onclick:()=>scrim.remove()},'Annulla'),
        el('button',{class:'btn danger', onclick:()=>{Store.resetAll(); scrim.remove(); applyTheme(); render(); toast('Dati azzerati');}},'Azzera'),
      )));
    document.body.append(scrim);
  }
  function exportData() {
    const blob = new Blob([Store.exportJSON()], {type:'application/json'});
    const a = el('a',{href:URL.createObjectURL(blob), download:'morning-briefing-backup.json'}); a.click();
    toast('Backup esportato');
  }

  // ---------- format helpers ----------
  function fmtOre(h){ if(!h) return '0h'; return (Math.round(h*10)/10).toString().replace('.',',')+'h'; }
  function fmt1(n){ return (Math.round((n||0)*10)/10).toString().replace('.',','); }
  function roundedNow(day){ const d=new Date(day); const n=new Date(); d.setHours(n.getHours(), n.getMinutes()<30?0:30,0,0); return d; }
  function dateVal(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function timeVal(d){ return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function isoLocal(d){ return `${dateVal(d)}T${timeVal(d)}:00`; }

  function registerSW(){ if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{}); }

  document.addEventListener('DOMContentLoaded', boot);
})();
