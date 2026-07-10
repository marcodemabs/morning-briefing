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
  };

  // ============================================================
  //  BOOT
  // ============================================================
  function boot() {
    applyTheme();
    // splash → app
    setTimeout(() => { $('#splash').classList.add('hidden'); $('#app').classList.remove('hidden'); }, 1300);
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

    // prossimo passo
    const ns = prossimoPasso(eventi, task);
    root.append(el('div',{class:'card'},
      el('div',{class:'section-label eyebrow'},'Prossimo passo'),
      ns
        ? el('div',{class:'next-step'}, el('div',{class:'ns-what'}, ns.what), el('div',{class:'ns-when'}, ns.when))
        : el('div',{class:'next-step empty'}, el('div',{class:'ns-what'}, 'Niente in programma. Goditi la giornata.'))
    ));

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

    // energy score è in Fase 2 — piccolo rimando
    root.append(el('div',{class:'card', style:'margin-top:14px;text-align:center'},
      el('div',{class:'section-label'},'Energy Score'),
      el('div',{class:'hint'},'Arriva in Fase 2 — per ora l\'app è il tuo planner a mano.')
    ));
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
  //  VIEW · ENERGY (stub Fase 2)
  // ============================================================
  function viewEnergy(root) {
    root.append(el('div',{class:'stub'},
      el('div',{class:'stub-badge'},'Fase 2'),
      el('h2',{},'Energy Score in arrivo'),
      el('p',{},'Il cuore dell\'app — check-in mattutino, ciambella 0–100 e consiglio dell\'assistente — si accende nella Fase 2. Le formule sono già definite nella specifica Energy Score.'),
    ));
  }

  // ============================================================
  //  VIEW · REVISIONE (base Fase 1: task incompiute di oggi)
  // ============================================================
  function viewRevisione(root) {
    const today = new Date();
    const eventiPassati = Store.eventiDelGiorno(today).filter(e => new Date(e.fine) <= new Date());
    const aperte = Store.taskAperte();
    root.append(el('div',{class:'toolbar'}, el('div',{class:'period-label'}, 'Chiusura di ' + new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long'}).format(today))));
    root.append(el('div',{class:'counters', style:'margin-bottom:14px'},
      counter(eventiPassati.length,'Eventi conclusi'),
      counter(aperte.length,'Task ancora aperte'),
    ));
    root.append(el('div',{class:'list-head'}, el('h2',{},'Task non completate')));
    if (!aperte.length) root.append(el('div',{class:'empty'}, el('div',{class:'em-title'},'Tutto chiuso 👏'), el('div',{class:'em-sub'},'Niente in sospeso per oggi.')));
    else { const card=el('div',{class:'card'}); aperte.forEach(t => card.append(taskItem(t, Store.giorniRitardo(t)))); root.append(card); }
    root.append(el('div',{class:'card', style:'text-align:center;margin-top:12px'},
      el('div',{class:'section-label'},'Statistiche complete'),
      el('div',{class:'hint'},'Le statistiche di giornata con Energy Score arrivano in Fase 2.')));
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
    const catCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Categorie'));
    Store.categorie().forEach(c => {
      catCard.append(el('div',{class:'cat-pick', onclick:()=>openCategoriaEditor(c)},
        el('div',{class:'cat-swatch', style:`background:${c.colore}`}),
        el('div',{style:'flex:1'}, el('div',{style:'font-size:.92rem;font-weight:500'}, c.nome),
          el('div',{class:'hint'}, 'intensità · ' + (intLabel[c.intensitaDefault] || 'media'))),
        el('div',{class:'hint'},'modifica ›'),
      ));
    });
    catCard.append(el('button',{class:'btn ghost sm', style:'margin-top:8px', onclick:()=>openCategoriaEditor(null)},'+ Nuova categoria'));
    root.append(catCard);

    // Parametri (Fase 2 preview)
    const parCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Parametri Energy Score (Fase 2)'));
    parCard.append(numRow('Ore di capacità', p.oreCapacita, 'h', v=>Store.setPref('oreCapacita',v), 3, 12, 0.5));
    parCard.append(numRow('Target sonno', p.targetSonno, 'h', v=>Store.setPref('targetSonno',v), 5, 10, 0.5));
    parCard.append(numRow('Soglia allerta', p.sogliaAllerta, '', v=>Store.setPref('sogliaAllerta',v), 60, 95, 5));
    root.append(parCard);

    // Connessioni (Fase 3)
    const connCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Connessioni'));
    connCard.append(el('div',{class:'hint', style:'margin-bottom:10px'},'Gmail e calendario Outlook si collegano in Fase 3 (auto-import).'));
    connCard.append(el('button',{class:'btn ghost sm', disabled:'', style:'opacity:.5'},'Disconnetti Gmail'));
    root.append(connCard);

    // Dati
    const dataCard = el('div',{class:'card'}, el('div',{class:'section-label eyebrow'},'Dati'));
    dataCard.append(el('div',{class:'hint', style:'margin-bottom:10px'},'Tutto è salvato solo su questo telefono. Nessun backup automatico (scelta di design).'));
    dataCard.append(el('button',{class:'btn ghost sm', style:'margin-right:8px', onclick:exportData},'Esporta JSON'));
    dataCard.append(el('button',{class:'btn danger sm', onclick:confirmReset},'Azzera tutto'));
    root.append(dataCard);

    root.append(el('div',{class:'hint', style:'text-align:center;margin-top:8px'},'Morning Briefing · v1 (Fase 1)'));
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

    openSheet(isNew?'Nuova categoria':'Modifica categoria', [
      el('div',{class:'field'}, el('label',{},'Nome'), nome),
      el('div',{class:'field'}, el('label',{},'Colore'), swWrap),
      el('div',{class:'field'}, el('label',{},'Intensità predefinita'), intChips,
        el('div',{class:'hint', style:'margin-top:8px'},'Pre-compila l\'intensità quando crei un evento in questa categoria. Sarà la base del calcolo Energy Score in Fase 2.')),
    ], {
      onSave: () => {
        if (!nome.value.trim()) { toast('Dai un nome alla categoria'); return false; }
        Store.upsertCategoria({ id:cat.id, nome:nome.value.trim(), colore:selCol, intensitaDefault:intens });
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
  function roundedNow(day){ const d=new Date(day); const n=new Date(); d.setHours(n.getHours(), n.getMinutes()<30?0:30,0,0); return d; }
  function dateVal(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function timeVal(d){ return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function isoLocal(d){ return `${dateVal(d)}T${timeVal(d)}:00`; }

  function registerSW(){ if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{}); }

  document.addEventListener('DOMContentLoaded', boot);
})();
