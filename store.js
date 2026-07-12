/* ============================================================
   STORE · modello dati + persistenza locale (Fase 1)
   Tre oggetti: Evento, Reminder, Task. Tutto in localStorage.
   Nessun account, nessuna rete: coerente con la discovery.
   ============================================================ */

const Store = (() => {
  const KEY = 'mb.v1';
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // ---- Categorie di default (6) — colore + flag recupero ----
  const DEFAULT_CATEGORIES = [
    { id: 'lavoro',  nome: 'Lavoro',                colore: '#4ea1ff', intensitaDefault: 'media', recupero: false },
    { id: 'viaggi',  nome: 'Viaggi & Prenotazioni', colore: '#c792ea', intensitaDefault: 'media', recupero: false },
    { id: 'salute',  nome: 'Salute',                colore: '#26c6da', intensitaDefault: 'bassa', recupero: false, neutra: true },
    { id: 'sport',   nome: 'Sport',                 colore: '#4ec97a', intensitaDefault: 'alta',  recupero: true },
    { id: 'libero',  nome: 'Tempo libero',          colore: '#ffb454', intensitaDefault: 'bassa', recupero: true },
    { id: 'studio',  nome: 'Studio & Progetti',     colore: '#f78c6c', intensitaDefault: 'media', recupero: false },
  ];

  const DEFAULT_DATA = {
    categorie: DEFAULT_CATEGORIES,
    eventi: [],       // eventi singoli (non ricorrenti)
    serie: [],        // template ricorrenti settimanali
    task: [],
    reminder: [],
    checkin: {},      // { 'YYYY-MM-DD': { r:[q1..q5], ore, skip?, ts } } — Fase 2
    prefs: {
      tema: 'auto',                 // 'auto' | id tema
      fontScale: 1,
      settimanaLavorativa: false,   // toggle default
      oreCapacita: 6,               // per Fase 2 (Energy Score)
      targetSonno: 7.5,             // per Fase 2
      sogliaAllerta: 80,            // per Fase 2
    },
    meta: { creato: new Date().toISOString() },
  };

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT_DATA);
      const parsed = JSON.parse(raw);
      // merge difensivo: se aggiungiamo campi in futuro non si rompe
      return {
        ...structuredClone(DEFAULT_DATA),
        ...parsed,
        prefs: { ...DEFAULT_DATA.prefs, ...(parsed.prefs || {}) },
        categorie: parsed.categorie?.length ? parsed.categorie : DEFAULT_CATEGORIES,
      };
    } catch (e) {
      console.warn('Store: dati illeggibili, riparto puliti.', e);
      return structuredClone(DEFAULT_DATA);
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { console.error('Store: salvataggio fallito', e); }
  }

  // ---- Helpers data (chiave giorno locale YYYY-MM-DD) ----
  const pad = n => String(n).padStart(2, '0');
  function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function parseKey(k) { const [y,m,dd] = k.split('-').map(Number); return new Date(y, m-1, dd); }

  // ============================================================
  //  CATEGORIE
  // ============================================================
  function categorie() { return data.categorie; }
  function categoria(id) { return data.categorie.find(c => c.id === id) || data.categorie[0]; }
  function upsertCategoria(cat) {
    const i = data.categorie.findIndex(c => c.id === cat.id);
    if (i >= 0) data.categorie[i] = { ...data.categorie[i], ...cat };
    else data.categorie.push({ id: uid(), recupero: false, ...cat });
    save();
  }
  function deleteCategoria(id) {
    if (data.categorie.length <= 1) return;
    data.categorie = data.categorie.filter(c => c.id !== id);
    save();
  }

  // ============================================================
  //  EVENTI  (singoli + serie ricorrenti espanse in occorrenze)
  // ============================================================
  function addEvento(ev) {
    const rec = {
      id: uid(), origine: 'manuale', intensita: 'media',
      anticipoAvviso: 15, stato: 'futuro', ...ev,
    };
    if (ev.ricorrente) {
      // crea una SERIE settimanale (settimana-template)
      const start = new Date(ev.inizio), end = new Date(ev.fine);
      data.serie.push({
        id: uid(), titolo: rec.titolo, categoria: rec.categoria, intensita: rec.intensita,
        anticipoAvviso: rec.anticipoAvviso, origine: 'manuale',
        giornoSettimana: start.getDay(),
        oraInizio: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
        oraFine: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
        dataInizio: dayKey(start),
        eccezioni: {},   // { 'YYYY-MM-DD': 'cancellato' | {overrides} }
      });
    } else {
      data.eventi.push(rec);
    }
    save();
    return rec;
  }

  function updateEvento(occ, patch) {
    if (occ.serieId) {
      // modifica di UNA occorrenza: salvo eccezione, la serie resta intatta
      const s = data.serie.find(x => x.id === occ.serieId);
      if (!s) return;
      s.eccezioni[occ.giorno] = { ...(typeof s.eccezioni[occ.giorno] === 'object' ? s.eccezioni[occ.giorno] : {}), ...patch };
    } else {
      const e = data.eventi.find(x => x.id === occ.id);
      if (e) Object.assign(e, patch);
    }
    save();
  }

  function deleteEvento(occ) {
    if (occ.serieId) {
      const s = data.serie.find(x => x.id === occ.serieId);
      if (s) s.eccezioni[occ.giorno] = 'cancellato';  // solo questa occorrenza
    } else {
      data.eventi = data.eventi.filter(x => x.id !== occ.id);
    }
    save();
  }

  function deleteSerieIntera(serieId) {
    data.serie = data.serie.filter(s => s.id !== serieId);
    save();
  }

  // Espande serie + eventi singoli per una finestra [from, to] (Date, inclusi)
  function eventiTra(from, to) {
    const out = [];
    // eventi singoli
    for (const e of data.eventi) {
      if (e.stato === 'cancellato') continue;
      const s = new Date(e.inizio);
      if (s >= startOfDay(from) && s <= endOfDay(to)) {
        out.push(toOcc(e, dayKey(s)));
      }
    }
    // serie ricorrenti settimanali
    for (const s of data.serie) {
      let cur = new Date(startOfDay(from));
      const limit = endOfDay(to);
      while (cur <= limit) {
        if (cur.getDay() === s.giornoSettimana && dayKey(cur) >= s.dataInizio) {
          const k = dayKey(cur);
          const ex = s.eccezioni[k];
          if (ex === 'cancellato') { cur = addDays(cur, 1); continue; }
          const ov = (typeof ex === 'object') ? ex : {};
          const oi = ov.oraInizio || s.oraInizio;
          const of = ov.oraFine || s.oraFine;
          const fineKey = (of <= oi) ? dayKey(addDays(parseKey(k), 1)) : k; // a cavallo di mezzanotte
          out.push({
            id: `${s.id}@${k}`, serieId: s.id, giorno: k,
            titolo: ov.titolo || s.titolo,
            categoria: ov.categoria || s.categoria,
            intensita: ov.intensita || s.intensita,
            anticipoAvviso: ov.anticipoAvviso ?? s.anticipoAvviso,
            inizio: `${k}T${oi}:00`, fine: `${fineKey}T${of}:00`,
            origine: 'manuale', ricorrente: true,
          });
        }
        cur = addDays(cur, 1);
      }
    }
    return out.sort((a,b) => new Date(a.inizio) - new Date(b.inizio));
  }

  function toOcc(e, giorno) {
    return { ...e, giorno, ricorrente: false };
  }

  function eventiDelGiorno(d) { return eventiTra(d, d); }

  // ============================================================
  //  TASK
  // ============================================================
  function addTask(t) {
    const rec = { id: uid(), intensita: 'media', effortOre: 1, stato: 'aperta', ...t };
    data.task.push(rec); save(); return rec;
  }
  function updateTask(id, patch) {
    const t = data.task.find(x => x.id === id);
    if (t) { Object.assign(t, patch); save(); }
  }
  function deleteTask(id) { data.task = data.task.filter(x => x.id !== id); save(); }
  function completaTask(id, feedback) {
    updateTask(id, { stato: 'completata', difficoltaFeedback: feedback, completataIl: new Date().toISOString() });
  }
  function taskAperte() { return data.task.filter(t => t.stato === 'aperta'); }
  function giorniRitardo(t) {
    if (!t.scadenza) return 0;
    const oggi = startOfDay(new Date());
    const sc = parseKey(t.scadenza);
    return Math.max(0, Math.round((oggi - sc) / 86400000));
  }

  // ============================================================
  //  REMINDER
  // ============================================================
  function addReminder(r) {
    const rec = { id: uid(), origine: 'manuale', stato: 'attivo', ...r };
    data.reminder.push(rec); save(); return rec;
  }
  function updateReminder(id, patch) {
    const r = data.reminder.find(x => x.id === id);
    if (r) { Object.assign(r, patch); save(); }
  }
  function deleteReminder(id) { data.reminder = data.reminder.filter(x => x.id !== id); save(); }
  function reminderAttivi() { return data.reminder.filter(r => r.stato === 'attivo'); }
  function reminderDelGiorno(k) { return reminderAttivi().filter(r => r.giorno === k); }

  // ============================================================
  //  CHECK-IN MATTUTINO (Fase 2)
  // ============================================================
  function checkinDi(key) { return data.checkin[key] || null; }
  function checkinDiOggi() { return checkinDi(dayKey(new Date())); }
  function checkinFattoOggi() { return !!data.checkin[dayKey(new Date())]; }   // risposto O saltato
  function salvaCheckin(obj) { data.checkin[dayKey(new Date())] = { ...obj }; save(); }

  // ============================================================
  //  PREFS
  // ============================================================
  function prefs() { return data.prefs; }
  function setPref(k, v) { data.prefs[k] = v; save(); }

  // ============================================================
  //  UTILITÀ DATE (esportate)
  // ============================================================
  function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
  function endOfDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

  // ---- Export / reset (utile per debug e futuro backup) ----
  function exportJSON() { return JSON.stringify(data, null, 2); }
  function resetAll() { data = structuredClone(DEFAULT_DATA); save(); }

  return {
    uid, dayKey, parseKey, startOfDay, endOfDay, addDays,
    categorie, categoria, upsertCategoria, deleteCategoria,
    addEvento, updateEvento, deleteEvento, deleteSerieIntera, eventiTra, eventiDelGiorno,
    addTask, updateTask, deleteTask, completaTask, taskAperte, giorniRitardo,
    addReminder, updateReminder, deleteReminder, reminderAttivi, reminderDelGiorno,
    checkinDi, checkinDiOggi, checkinFattoOggi, salvaCheckin,
    prefs, setPref, exportJSON, resetAll,
    get raw(){ return data; },
  };
})();
