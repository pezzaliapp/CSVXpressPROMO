# CSVXpressPROMO

PWA che **clona [CSVXpressSmart](https://github.com/pezzaliapp/CSVXpressSmart)**
mantenendone **integra la logica** (inserimento dati verticale a schede su
smartphone, smart preventivo, sconto cliente, report WhatsApp/TXT) e vi
**integra** le funzionalità di [ListoAPP](https://github.com/pezzaliapp/ListoAPP):

- 🔥 **PROMO** in tempo reale (pubblicate dall'admin via GitHub, viewer PDF/immagini, condivisione, import promo locali)
- ⚙️ **Pannello Admin** (`admin.html`) con PAT GitHub: CRUD promo, publish, bump versione
- 📥 **Caricamento listino aggiuntivo**: oltre al **CSV** originale, ora anche **Excel (.xlsx/.xls)** e **PDF** (viewer in sola consultazione)

## Principio di progetto

> La logica di CSVXpress **non è stata modificata**.

`app.js` è il motore originale di CSVXpressSmart, copiato **byte per byte**.
Tutte le aggiunte sono in **moduli isolati** che riusano le funzioni globali
esistenti (stesso meccanismo di `handleCSVUpload`), senza riscrivere nulla.

## Struttura

```
CSVXpressPROMO/
├── index.html            base CSVXpress + sezione PROMO additiva
├── app.js                MOTORE CSVXpress — INVARIATO
├── promo.js              modulo PROMO isolato (IIFE, IDB dedicato)
├── loaders-extra.js      loader Excel/PDF additivo (riusa i globali)
├── promo.css             stili scoped .cxp-
├── admin.html / admin.js pannello admin (da ListoAPP)
├── admin-styles.css      stili admin (da ListoAPP)
├── style.css             stile CSVXpress (invariato)
├── style.mobile.cards.rev.v3.css  schede verticali mobile (invariato)
├── service-worker.js     cache PWA csvxpresspromo-*
├── manifest.json
├── version.json
├── promo/
│   ├── promo.json        lista promo (gestita dall'admin)
│   └── *.pdf             allegati promo di esempio
├── icon/
├── CLAUDE.md             regole per Claude Code (guardrail)
├── .claude/settings.json permessi autonomi sicuri
└── setup.sh              crea l'ambiente di lavoro sicuro
```

## Avvio locale

```bash
python3 -m http.server 8080
# http://localhost:8080/        app utente
# http://localhost:8080/admin.html  pannello admin
```
Il service worker richiede `localhost` o HTTPS (non `file://`).

## Deploy (GitHub Pages)

Settings → Pages → Deploy from a branch → `main` / root.
L'app vivrà su `https://<owner>.github.io/CSVXpressPROMO/`.

## Admin: come pubblicare una promo

1. Apri `admin.html`, inserisci owner/repo e un **Personal Access Token** (scope `repo`), **Salva**.
2. **Test connessione** verifica l'accesso a `promo/promo.json`.
3. **Carica da GitHub** → aggiungi/duplica promo → **Pubblica**.
4. (Opzionale) spunta *bump version.json* per notificare gli utenti.

## Licenza

MIT (vedi `LICENSE`). Le librerie CDN (PapaParse, SheetJS, jsPDF, pdf.js)
mantengono le rispettive licenze.
