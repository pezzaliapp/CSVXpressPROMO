# CSVXpressPROMO — Istruzioni per Claude Code

## Cos'è questo progetto
PWA che **clona CSVXpressSmart** e vi integra le funzionalità **PROMO** e
**Admin** di ListoAPP, più caricamento listino **Excel/PDF** aggiuntivo.

## REGOLA D'ORO (non negoziabile)
**La logica di CSVXpress NON si tocca.**
- `app.js` è il motore originale di CSVXpressSmart: **non modificarlo**.
  Resta intatto: inserimento verticale a schede su smartphone, calcoli
  riga, smart preventivo, sconto cliente, report WhatsApp/TXT.
- Tutto ciò che si aggiunge va in **moduli separati**:
  `promo.js`, `loaders-extra.js`, `promo.css`, `admin.js`, `admin.html`.
- I moduli additivi **riusano** le funzioni globali di `app.js`
  (`normalizeListino`, `aggiornaListinoSelect`, variabile `listino`)
  esattamente come fa `handleCSVUpload`. Non duplicano né riscrivono la logica.

## Architettura
| File | Ruolo | Modificabile? |
|------|-------|---------------|
| `app.js` | Motore CSVXpress (originale) | ❌ NO |
| `index.html` | Base CSVXpress + sezione PROMO additiva | ✅ solo parti `cxp-` |
| `promo.js` | Modulo PROMO isolato (IIFE, IDB `csvxpresspromo_db`) | ✅ |
| `loaders-extra.js` | Loader Excel/PDF additivo | ✅ |
| `promo.css` | Stili scoped `.cxp-` | ✅ |
| `admin.html` / `admin.js` | Pannello admin (IIFE, IDB `listoapp_db`) | ✅ |
| `service-worker.js` | Cache PWA `csvxpresspromo-*` | ✅ con bump versione |
| `manifest.json` | Manifest PWA | ✅ |

## Vincoli tecnici
- Nessun build step. Vanilla JS. Si serve come file statici.
- Gli script additivi sono `defer` e caricati **dopo** `app.js`
  (i simboli globali devono già esistere quando vengono usati).
- Prefisso CSS obbligatorio per ogni nuova classe: `.cxp-`.
- IndexedDB: `promo.js` usa `csvxpresspromo_db`, `app.js` usa
  `csvxpresssmart_db_v1`, `admin.js` usa `listoapp_db`. **Non unificarli.**
- `promo/promo.json` e `version.json` non vanno mai messi in cache.
- Ad ogni release: bump `CACHE_VERSION` in `service-worker.js` e
  `version.json` (timestamp UTC).

## Cosa NON fare mai
- Non riscrivere/refactorare `app.js`.
- Non rimuovere o rinominare classi CSS esistenti di CSVXpress.
- Non cambiare gli `id`/`onclick` usati da `app.js` in `index.html`.
- Non introdurre dipendenze npm o bundler.
- Non eliminare file in `promo/` senza conferma esplicita.

## Test rapido (locale)
```bash
python3 -m http.server 8080
# apri http://localhost:8080/  (utente) e /admin.html (admin)
```
Service worker richiede `localhost` o HTTPS (non `file://`).

## Deploy
GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.
