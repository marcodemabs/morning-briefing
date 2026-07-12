/* ============================================================
   ENERGY · motore Energy Score (puro, senza DOM) — Fase 2
   Implementa Energy-Score-Specifica.md v1. Legge da Store.
   Nessuno stato proprio: dà numeri, la UI li veste.
   ============================================================ */
const Energy = (() => {
  'use strict';

  // ---- Costanti (dalla specifica §10 — prima calibrazione, tarabili) ----
  const INT_MULT          = { bassa: 1, media: 1.5, alta: 2 };
  const K_CURVA           = 0.30;   // §4 termostato di sensibilità
  const CHECKIN_RANGE     = 0.20;   // §3a ±20% capacità
  const SONNO_PASSO       = 0.05;   // §3b deficit/salita per ora
  const SONNO_TORPORE     = 0.04;   // §3b discesa torpore per ora
  const SONNO_FLOOR_DEF   = 0.80;   // §3b tetto deficit
  const SONNO_CAP_PICCO   = 1.05;   // §3b picco
  const SONNO_FLOOR_TORP  = 0.92;   // §3b pavimento torpore
  const RECUPERO_PER_ORA  = 5;      // §5 punti scaricati per ora di self-care
  const RECUPERO_TETTO    = 15;     // §5 tetto complessivo
  const OVERDUE_PASSO     = 0.20;   // §6 +20%/giorno
  const OVERDUE_TETTO     = 2;      // §6 ×2 massimo

  const clamp   = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const intMult = i => INT_MULT[i] ?? 1.5;

  // ---- Capacità base: dalle ore in Impostazioni (default 6h → 9) ----
  function capacitaBase() {
    const ore = Store.prefs().oreCapacita ?? 6;
    return ore * 1.5;                 // 6 × 1,5 = 9 = àncora "giornata piena"
  }

  // ============================================================
  //  FATTORI (§3) — modulano la capacità
  // ============================================================
  // checkin = { r: [q1..q5 in -1/0/+1], ore: number } | null  → null = neutro (skip)
  function fattoreBenessere(checkin) {
    if (!checkin || !Array.isArray(checkin.r) || !checkin.r.length) return 1;
    const somma = checkin.r.reduce((a, b) => a + (Number(b) || 0), 0);     // -5..+5
    return clamp(1 + (somma / 5) * CHECKIN_RANGE, 0.80, 1.20);
  }

  // Curva a collina §3b. Il target sposta l'intera collina (default 7h30);
  // il picco resta 1h dopo il target (default 8h30 → 1,05), poi torpore.
  function fattoreSonno(ore, target) {
    if (ore == null) return 1;
    const t      = target ?? (Store.prefs().targetSonno ?? 7.5);
    const picco  = t + 1;                                    // default 8,5
    if (ore <= picco) {
      return clamp(1 + (ore - t) * SONNO_PASSO, SONNO_FLOOR_DEF, SONNO_CAP_PICCO);
    }
    return Math.max(SONNO_FLOOR_TORP, SONNO_CAP_PICCO - (ore - picco) * SONNO_TORPORE);
  }

  function capacita(checkin, target) {
    return capacitaBase() * fattoreBenessere(checkin) * fattoreSonno(checkin?.ore, target);
  }

  // ============================================================
  //  CARICO (§2) — eventi (esclusi recupero/neutra) + task
  // ============================================================
  function _catDi(id) { return Store.categoria(id); }

  // Eventi che pesano. residuo=true → gli eventi già finiti escono dal conto (§7)
  function caricoEventi(giornoKey, residuo, now) {
    const d = Store.parseKey(giornoKey);
    let tot = 0;
    for (const e of Store.eventiDelGiorno(d)) {
      const c = _catDi(e.categoria);
      if (c.recupero || c.neutra) continue;                 // recupero e Salute non sono carico
      if (residuo && new Date(e.fine) <= now) continue;     // §7 evento passato
      const durH = Math.max(0, (new Date(e.fine) - new Date(e.inizio)) / 3600000);
      tot += durH * intMult(e.intensita);
    }
    return tot;
  }

  // Ore di recupero del giorno (per lo scarico a punti §5)
  function oreRecupero(giornoKey, residuo, now) {
    const d = Store.parseKey(giornoKey);
    let ore = 0;
    for (const e of Store.eventiDelGiorno(d)) {
      const c = _catDi(e.categoria);
      if (!c.recupero) continue;
      if (residuo && new Date(e.fine) <= now) continue;
      ore += Math.max(0, (new Date(e.fine) - new Date(e.inizio)) / 3600000);
    }
    return ore;
  }

  // Task aperte che pesano su un dato giorno (§6 + §7).
  // Regola (interpretazione, tarabile): senza scadenza o scaduta/oggi → pesa OGGI;
  // con scadenza futura → pesa sul suo giorno. Overdue moltiplica (+20%/gg, tetto ×2).
  function caricoTask(giornoKey) {
    const oggiKey = Store.dayKey(new Date());
    let tot = 0;
    for (const t of Store.taskAperte()) {
      const rit  = Store.giorniRitardo(t);                          // 0 se non scaduta
      const mult = clamp(1 + rit * OVERDUE_PASSO, 1, OVERDUE_TETTO);
      const base = (Number(t.effortOre) || 0) * intMult(t.intensita);
      let appartiene;
      if (!t.scadenza)             appartiene = oggiKey;
      else if (t.scadenza <= oggiKey) appartiene = oggiKey;         // scaduta o in scadenza oggi
      else                         appartiene = t.scadenza;         // futura
      if (appartiene === giornoKey) tot += base * mult;
    }
    return tot;
  }

  // ============================================================
  //  SCORE (§4) — il numero 0–100
  // ============================================================
  // opts: { residuo=false, now=Date, checkin=null, target=null }
  function scoreGiorno(giorno, opts = {}) {
    const { residuo = false, now = new Date(), checkin = null, target = null } = opts;
    const giornoKey = (typeof giorno === 'string') ? giorno : Store.dayKey(giorno);

    const cap      = capacita(checkin, target);
    const caricoEv = caricoEventi(giornoKey, residuo, now);
    const caricoTk = caricoTask(giornoKey);
    const carico   = caricoEv + caricoTk;

    const R      = cap > 0 ? carico / cap : 0;
    const grezzo = 100 * (R * R) / (R * R + K_CURVA);                // §4 curva a S
    const recPt  = Math.min(RECUPERO_TETTO, oreRecupero(giornoKey, residuo, now) * RECUPERO_PER_ORA);
    const finale = clamp(grezzo - recPt, 0, 100);                    // §5 self-care sui punti

    return {
      score: Math.round(finale),
      grezzo: Math.round(grezzo),
      R, carico, caricoEv, caricoTk,
      capacita: cap,
      recupero: recPt,
      ...etichetta(finale),
    };
  }

  // ---- Fasce (§4) — 6 etichette + colore ----
  const FASCE = [
    { max: 15,  label: 'Molto bassa', tono: 'verde-acceso', colore: '#3ddc84' },
    { max: 35,  label: 'Bassa',       tono: 'verde',        colore: '#4ec97a' },
    { max: 50,  label: 'Media',       tono: 'giallo',       colore: '#e6c34a' },
    { max: 70,  label: 'Medio Alta',  tono: 'ambra',        colore: '#e8a33d' },
    { max: 85,  label: 'Alta',        tono: 'arancio',      colore: '#e8763d' },
    { max: 101, label: 'Estrema',     tono: 'rosso',        colore: '#e0524f' },
  ];
  function etichetta(score) {
    return FASCE.find(f => score < f.max) || FASCE[FASCE.length - 1];
  }

  // Score a partire da un carico arbitrario (per il filtro categoria della vista).
  // Nessun recupero: il filtro guarda solo "quanto pesa quella fetta di carico".
  function scoreDaCarico(carico, opts = {}) {
    const { checkin = null, target = null } = opts;
    const cap = capacita(checkin, target);
    const R = cap > 0 ? carico / cap : 0;
    const finale = clamp(100 * (R * R) / (R * R + K_CURVA), 0, 100);
    return { score: Math.round(finale), R, carico, capacita: cap, ...etichetta(finale) };
  }

  // Carico per categoria (solo categorie che pesano: esclude recupero e neutra).
  function caricoCategorie(giornoKey, opts = {}) {
    const { residuo = false, now = new Date() } = opts;
    const d = Store.parseKey(giornoKey);
    const map = new Map();
    for (const e of Store.eventiDelGiorno(d)) {
      const c = _catDi(e.categoria);
      if (c.recupero || c.neutra) continue;
      if (residuo && new Date(e.fine) <= now) continue;
      const durH = Math.max(0, (new Date(e.fine) - new Date(e.inizio)) / 3600000);
      const cur = map.get(c.id) || { id: c.id, nome: c.nome, colore: c.colore, ore: 0, carico: 0 };
      cur.ore += durH; cur.carico += durH * intMult(e.intensita);
      map.set(c.id, cur);
    }
    return [...map.values()].filter(x => x.carico > 0).sort((a, b) => b.carico - a.carico);
  }

  // ============================================================
  //  ALLERTA ANTICIPATA (§8) — oggi o entro 7 giorni sopra soglia
  // ============================================================
  function proiezione7gg(checkinOggi = null) {
    const oggi = new Date();
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = Store.addDays(oggi, i);
      // solo oggi ha un check-in; i giorni futuri sono neutri (nessun check-in ancora)
      const r = scoreGiorno(d, { residuo: false, checkin: i === 0 ? checkinOggi : null });
      out.push({ giorno: Store.dayKey(d), offset: i, ...r });
    }
    return out;
  }
  function allerta(soglia, checkinOggi = null) {
    const s = soglia ?? (Store.prefs().sogliaAllerta ?? 80);
    return proiezione7gg(checkinOggi).filter(g => g.score > s);
  }

  // ============================================================
  //  CONSIGLIO (a regole; valuteremo LLM più avanti)
  // ============================================================
  function consiglio(day) {
    const s = day.score;
    let base;
    if      (s >= 85) base = 'Giornata al limite. Se puoi, sposta o accorcia qualcosa.';
    else if (s >= 70) base = 'Giornata piena. Tieni margine tra gli impegni e non aggiungere altro.';
    else if (s >= 50) base = 'Ritmo sostenuto ma gestibile. Un blocco di recupero nel pomeriggio ci sta.';
    else if (s >= 35) base = 'Giornata equilibrata. C\u2019\u00e8 spazio per una cosa in pi\u00f9, se serve.';
    else if (s >= 15) base = 'Giornata leggera. Buon momento per portarti avanti su una task.';
    else              base = 'Giornata scarica. Goditela, o anticipa qualcosa che ti toglie peso domani.';

    if (day.recupero > 0 && s >= 70) base += ' Il recupero aiuta, ma da solo non basta.';
    else if (day.caricoTk > 0 && day.caricoEv === 0 && s >= 35) base += ' Il peso di oggi \u00e8 tutto sulle task in sospeso.';
    return base;
  }

  // ============================================================
  //  SELF-TEST (§9) — il mercoledì reale: atteso score ~84
  //  Aprilo dalla console: Energy._selftest()
  // ============================================================
  function _selftest() {
    const checkin = { r: [-1, 0, -1, 0, 0], ore: 5.5 };  // somma -2, dormito 5h30
    const fB  = fattoreBenessere(checkin);               // atteso 0,92
    const fS  = fattoreSonno(5.5, 7.5);                  // atteso 0,90
    const cap = 9 * fB * fS;                             // atteso ~7,45
    const R   = 12 / cap;                                // carico 12 (8h × media) → ~1,61
    const grezzo = 100 * R * R / (R * R + K_CURVA);      // ~89,6
    const finale = grezzo - 5;                           // corsa 1h → ~84,6
    const ok = Math.abs(fB - 0.92) < 0.01 && Math.abs(fS - 0.90) < 0.01
            && Math.abs(cap - 7.45) < 0.05 && Math.abs(R - 1.61) < 0.02
            && Math.abs(finale - 84) < 1.5;
    console.log(`[Energy selftest] fB=${fB.toFixed(2)} fS=${fS.toFixed(2)} cap=${cap.toFixed(2)} `
              + `R=${R.toFixed(2)} grezzo=${grezzo.toFixed(1)} finale=${finale.toFixed(1)} → ${ok ? 'OK ✓' : 'FAIL ✗'}`);
    return { fB, fS, cap, R, grezzo, finale, ok };
  }

  return {
    scoreGiorno, scoreDaCarico, caricoCategorie, capacita, fattoreBenessere, fattoreSonno,
    caricoEventi, caricoTask, oreRecupero,
    etichetta, proiezione7gg, allerta, consiglio,
    _selftest,
    // costanti esposte per future Impostazioni/taratura
    _K: { INT_MULT, K_CURVA, CHECKIN_RANGE, RECUPERO_PER_ORA, RECUPERO_TETTO, OVERDUE_PASSO, OVERDUE_TETTO },
  };
})();
