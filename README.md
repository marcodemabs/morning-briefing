# Morning Briefing — Fase 1 (core offline)

PWA personale installabile su iPhone. Tutto locale, nessun account, nessun costo.

## Cosa fa già (Fase 1)
- **Calendario** giorno / settimana / mese / anno + toggle settimana lavorativa/completa.
- **Eventi** manuali (titolo, categoria, orario, intensità) — creabili, modificabili, eliminabili.
- **Ricorrenti** settimanali (settimana-template): ogni occorrenza si sposta/elimina senza rompere la serie.
- **Task** con scadenza, intensità, effort; completamento con "Hai avuto difficoltà?" + animazione; scadute in rosso.
- **Riassunto Giornaliero** con "prossimo passo", contatori, suddivisione per categoria e agenda di oggi.
- **Revisione Giornaliera** con task ancora aperte.
- **Temi** Dark+, Light+, One Dark, Dracula + Automatico (segue iOS); dimensione testo regolabile.
- **Impostazioni**: categorie/colori, parametri Energy Score (pronti per la Fase 2), esporta/azzera dati.
- **Offline** completo (service worker) e **installabile** dalla Home.

Energy Score, auto-import e notifiche arrivano nelle Fasi 2–3 (già a specifica).

## Come installarla sull'iPhone
1. Apri l'URL in **Safari** (non Chrome: solo Safari può installare PWA su iOS).
2. Tocca il pulsante **Condividi** → **Aggiungi a Home**.
3. L'icona compare in Home come un'app: si apre a schermo intero, funziona offline.

## Provarla subito sul PC (senza deploy)
Apri `index.html` in un browser. Per far funzionare il service worker serve un server locale:
- se hai Python: dalla cartella, `python -m http.server 8080`, poi apri `http://localhost:8080`.

## Dove sono i dati
Tutto in `localStorage` del browser/telefono. Nessun dato esce dal dispositivo.
"Impostazioni → Dati → Esporta JSON" salva un backup manuale quando vuoi.

## Struttura file
- `index.html` — shell dell'app
- `styles.css` — stile + temi (aggiungerne è una manciata di variabili)
- `store.js` — modello dati a 3 oggetti + persistenza + ricorrenti
- `app.js` — interfaccia, navigazione, editor
- `sw.js` — offline
- `manifest.webmanifest` + `icons/` — installazione PWA
