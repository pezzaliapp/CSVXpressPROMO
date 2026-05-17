# CSVXpressPROMO

PWA proprietaria che **clona [CSVXpressSmart](https://github.com/pezzaliapp/CSVXpressSmart)**
mantenendone **integra la logica** (inserimento dati verticale a schede su
smartphone, smart preventivo, sconto cliente, report WhatsApp/TXT) e vi
**integra** le funzionalità di [ListoAPP](https://github.com/pezzaliapp/ListoAPP).
Entrambi i progetti d'origine sono opere dell'autore (pezzaliapp).

## Funzionalità

- 🔒 **Disclaimer / gate di accesso** — overlay obbligatorio mostrato
  all'avvio: l'app è inutilizzabile finché non viene accettata
  l'informativa (responsabilità, obbligo di verifica, privacy GDPR,
  uso B2B). L'accettazione è salvata in `localStorage` con la versione
  del testo; se il testo viene aggiornato è richiesta la riaccettazione.
- 🔥 **PROMO** in tempo reale (pubblicate dall'admin via GitHub, viewer
  PDF/immagini, condivisione, import di promo locali)
- ⚙️ **Pannello Admin** (`admin.html`) con Personal Access Token GitHub:
  CRUD promo, publish, bump `version.json`
- 📥 **Caricamento listino aggiuntivo**: oltre al **CSV** originale,
  anche **Excel (.xlsx/.xls)** con parsing robusto dei numeri in
  formato italiano (`9.750`, `1.234,56`) e americano, e **PDF** (viewer
  in sola consultazione)

## Principio di progetto

> La logica di CSVXpress **non è stata modificata**.

`app.js` è il motore originale di CSVXpressSmart, copiato **byte per byte**.
Tutte le aggiunte sono in **moduli isolati** che riusano le funzioni globali
esistenti (stesso meccanismo di `handleCSVUpload`), senza riscrivere nulla.

## Struttura

```
CSVXpressPROMO/
├── index.html            base CSVXpress + sezioni additive (PROMO, disclaimer)
├── app.js                MOTORE CSVXpress — INVARIATO
├── promo.js              modulo PROMO isolato (IIFE, IDB dedicato)
├── loaders-extra.js      loader Excel/PDF additivo (riusa i globali)
├── disclaimer.js         gate di accesso (IIFE, localStorage versionato)
├── promo.css             stili scoped .cxp-
├── disclaimer.css        stili scoped .cxp-disc-
├── admin.html / admin.js pannello admin (da ListoAPP)
├── admin-styles.css      stili admin
├── style.css                       stile CSVXpress (invariato)
├── style.mobile.cards.rev.v3.css   schede verticali mobile (invariato)
├── service-worker.js     cache PWA csvxpresspromo-*
├── manifest.json
├── version.json
├── promo/
│   ├── promo.json        lista promo (gestita dall'admin)
│   └── *.pdf             allegati promo di esempio
├── icon/
├── CLAUDE.md             regole per Claude Code (guardrail)
└── .claude/settings.json permessi autonomi sicuri
```

## Avvio locale

```bash
python3 -m http.server 8080
# http://localhost:8080/             app utente
# http://localhost:8080/admin.html   pannello admin
```

Il service worker richiede `localhost` o HTTPS (non `file://`).

## Deploy (GitHub Pages)

Settings → Pages → Deploy from a branch → `main` / root.
L'app vivrà su `https://<owner>.github.io/CSVXpressPROMO/`.

## Admin: come pubblicare una promo

1. Apri `admin.html`, inserisci owner/repo e un **Personal Access Token**
   (scope `repo`), **Salva**.
2. **Test connessione** verifica l'accesso a `promo/promo.json`.
3. **Carica da GitHub** → aggiungi/duplica promo → **Pubblica**.
4. (Opzionale) spunta *bump version.json* per notificare gli utenti.

## Disclaimer & Privacy

L'app mostra all'avvio un overlay con disclaimer, esonero di
responsabilità e **informativa GDPR**. Il testo integrale è in
`index.html` (sezione `cxp-disc-overlay`); in sintesi:

- software fornito *"così com'è"*, nessuna garanzia;
- **obbligo per l'utente** di verificare prezzi, sconti, totali e
  documenti prima di qualsiasi uso commerciale;
- destinato a **uso professionale B2B**;
- **tutti i dati operativi restano sul dispositivo** (IndexedDB /
  localStorage): non sono trasmessi all'autore né a terzi;
- **nessun tracker, nessuna profilazione**: l'app non utilizza Google
  Analytics, Microsoft Clarity, pixel pubblicitari o tag manager;
  nessun cookie di profilazione; nessun trasferimento di dati verso
  Paesi extra UE;
- titolare del trattamento: Alessandro Pezzali — https://pezzaliapp.com
  (per i diritti artt. 15-22 GDPR e per ogni contatto).

Quando il testo del disclaimer viene aggiornato (campo
`DISCLAIMER_VERSION` in `disclaimer.js` / attributo `data-disc-ver` in
`index.html`) la riaccettazione è richiesta automaticamente.

## Changelog

- **1.2.0** (2026-05-17) — Privacy: rimossi tutti i riferimenti a
  strumenti di analisi di terze parti dall'informativa GDPR;
  esplicitata l'assenza di Google Analytics, Microsoft Clarity, cookie
  di profilazione e trasferimenti extra UE. Bump `DISCLAIMER_VERSION`
  (riaccettazione richiesta) e bump cache service worker.
- **1.1.0** (2026-05-17) — Disclaimer/gate di accesso con informativa
  GDPR, fix parsing numeri italiani nei loader Excel, refresh cache
  service worker.
- **1.0.0** — Versione iniziale: clone di CSVXpressSmart con motore
  invariato + modulo PROMO + admin + loader Excel/PDF.

## Licenza

Software **proprietario**.
© 2026 **Alessandro Pezzali — pezzaliapp**. Tutti i diritti riservati.
https://pezzaliapp.com

Termini d'uso completi: vedere il file [`LICENSE`](LICENSE) e il
disclaimer in-app mostrato all'avvio dell'applicazione. In particolare
sono vietati, salvo autorizzazione scritta, copia, ridistribuzione,
modifica, opere derivate, reverse engineering e rivendita.

La pubblicazione del codice in repository pubblico ha finalità di
trasparenza e ispezione e **non costituisce rinuncia ai diritti
riservati** né concessione di licenza open source.

Le librerie di terze parti caricate via CDN (PapaParse, SheetJS, jsPDF,
pdf.js) restano soggette alle rispettive licenze d'origine (MIT /
Apache-2.0): vedere la sezione *Librerie di terze parti* del file
[`LICENSE`](LICENSE).
