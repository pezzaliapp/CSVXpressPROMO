/* ============================================================
   CSVXpressPROMO — loaders-extra.js
   Caricamento listino aggiuntivo: EXCEL (.xlsx/.xls) e PDF (viewer).
   PRINCIPIO: NON modifica app.js. Riusa le funzioni globali già
   esistenti (normalizeListino, aggiornaListinoSelect) e la variabile
   globale `listino`, esattamente come fa handleCSVUpload nel CSV.
   Classic script caricato DOPO app.js: i simboli globali esistono.
   ============================================================ */
(function () {
  'use strict';

  const PDFJS_WORKER_URL =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const XLSX_CDN =
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  let _xlsxPromise = null;
  function loadXLSX() {
    if (typeof window.XLSX !== 'undefined') return Promise.resolve();
    if (_xlsxPromise) return _xlsxPromise;
    _xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_CDN;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => (typeof window.XLSX !== 'undefined'
        ? resolve() : reject(new Error('XLSX caricato ma simbolo assente')));
      s.onerror = () => { _xlsxPromise = null; reject(new Error('Caricamento XLSX fallito')); };
      document.head.appendChild(s);
    });
    return _xlsxPromise;
  }

  // Mappa header -> chiavi attese da normalizeListino di CSVXpress
  function detectKey(columns, needles) {
    const lc = columns.map((c) => String(c || '').toLowerCase());
    for (const n of needles) {
      const idx = lc.findIndex((c) => c.includes(n));
      if (idx >= 0) return columns[idx];
    }
    return null;
  }

  // Parser numerico robusto: numero nativo, formato IT ("9.750", "1.234,56",
  // "9.750,00"), formato US ("9,750.00") e cifre semplici. Vedi parseDec in
  // app.js (single replace ',' -> '.'): "9.750" senza normalizzare diventa 9.75.
  function parseLocalizedNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    s = s.replace(/\s+/g, '').replace(/[€$£]/g, '');
    const hasComma = s.indexOf(',') >= 0;
    const hasDot   = s.indexOf('.') >= 0;
    if (hasComma && hasDot) {
      // L'ultimo separatore presente è il decimale, l'altro è migliaia.
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.'); // IT: 1.234,56
      } else {
        s = s.replace(/,/g, '');                    // US: 1,234.56
      }
    } else if (hasComma) {
      s = s.replace(',', '.');                       // solo virgola = decimale IT
    } else if (hasDot) {
      const parts = s.split('.');
      if (parts.length > 2) {
        s = parts.join('');                          // 1.234.567 -> migliaia
      } else if (/^-?\d+$/.test(parts[0]) && /^\d{3}$/.test(parts[1])) {
        s = parts[0] + parts[1];                     // 9.750 -> 9750 (migliaia)
      }
      // altrimenti resta decimale: 1.5, 1.50, 1.5000
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  // Restituisce una stringa che parseDec di app.js interpreta correttamente:
  // virgola come decimale, niente separatore migliaia (es. 9750 -> "9750",
  // 1234.5 -> "1234,5", "1.234,56" -> "1234,56", "9,750.00" -> "9750").
  function toCxpNumStr(v) {
    if (v === '' || v == null) return '0';
    return String(parseLocalizedNumber(v)).replace('.', ',');
  }

  function toCsvXpressRows(json) {
    if (!json.length) return [];
    const columns = Object.keys(json[0]);
    const kCod = detectKey(columns, ['codice', 'code', 'sku', 'art']) || columns[0];
    const kDes = detectKey(columns, ['descrizione', 'description', 'prodotto', 'product', 'nome', 'name']) || columns[1];
    const kPrz = detectKey(columns, ['prezzolordo', 'prezzo lordo', 'prezzo', 'price', 'listino', 'imp']) || columns[2];
    const kTra = detectKey(columns, ['trasporto', 'transport', 'shipping']);
    const kIns = detectKey(columns, ['installazione', 'installation', 'montaggio']);
    return json.map((row) => ({
      'Codice': row[kCod] != null ? String(row[kCod]) : '',
      'Descrizione': kDes && row[kDes] != null ? String(row[kDes]) : '',
      'PrezzoLordo': kPrz ? toCxpNumStr(row[kPrz]) : '0',
      'CostoTrasporto': kTra ? toCxpNumStr(row[kTra]) : '0',
      'CostoInstallazione': kIns ? toCxpNumStr(row[kIns]) : '0'
    }));
  }

  // ============================================================
  // FILTRO ADDITIVO Famiglia/Categoria (NON tocca listino/app.js)
  // ------------------------------------------------------------
  // Mappa parallela codice -> { famiglie, categorie } costruita
  // dal JSON Excel; valori multipli separati da "|". Quando la
  // mappa è vuota (CSV o Excel senza colonne) i filtri restano
  // nascosti e l'app si comporta esattamente come prima.
  // ============================================================
  let _famCatByCode = null;    // Map<codice, {famiglie, categorie}> o null
  let _famUnique = [];          // [{name, count}, ...]
  let _catUnique = [];
  const _selectedFam = new Set();
  const _selectedCat = new Set();
  let _selectObserver = null;

  function splitMulti(v) {
    if (v == null) return [];
    return String(v).split('|').map((s) => s.trim()).filter(Boolean);
  }

  function buildFamCatMap(json) {
    if (!json || !json.length) return null;
    const columns = Object.keys(json[0]);
    const kCod = detectKey(columns, ['codice', 'code', 'sku', 'art']) || columns[0];
    const kFam = detectKey(columns, ['famiglia', 'family']);
    const kCat = detectKey(columns, ['categoria', 'category']);
    if (!kFam && !kCat) return null;
    const byCode = new Map();
    const famCounts = new Map();
    const catCounts = new Map();
    json.forEach((row) => {
      const cod = row[kCod] != null ? String(row[kCod]) : '';
      if (!cod) return;
      const famiglie = kFam ? splitMulti(row[kFam]) : [];
      const categorie = kCat ? splitMulti(row[kCat]) : [];
      byCode.set(cod, { famiglie, categorie });
      famiglie.forEach((f) => famCounts.set(f, (famCounts.get(f) || 0) + 1));
      categorie.forEach((c) => catCounts.set(c, (catCounts.get(c) || 0) + 1));
    });
    const collator = new Intl.Collator('it', { sensitivity: 'base' });
    const toSorted = (m) => Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => collator.compare(a.name, b.name));
    return {
      byCode,
      famiglie: toSorted(famCounts),
      categorie: toSorted(catCounts)
    };
  }

  function clearFamCat() {
    _famCatByCode = null;
    _famUnique = [];
    _catUnique = [];
    _selectedFam.clear();
    _selectedCat.clear();
    renderFilterUI();
    applyFilterToSelect();
  }

  function setFamCat(result) {
    if (!result || (!result.famiglie.length && !result.categorie.length)) {
      clearFamCat();
      return;
    }
    _famCatByCode = result.byCode;
    _famUnique = result.famiglie;
    _catUnique = result.categorie;
    _selectedFam.clear();
    _selectedCat.clear();
    renderFilterUI();
    applyFilterToSelect();
  }

  function cssSafeId(s) {
    return String(s).replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  }

  function updateCount(id, selected, total) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = selected === 0 ? 'Tutte' : (selected + '/' + total);
  }

  function populateGroup(containerId, items, selectedSet, kind, countId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    items.forEach((it) => {
      const id = 'cxp-filt-' + kind + '-' + cssSafeId(it.name);
      const label = document.createElement('label');
      label.className = 'cxp-filter-opt';
      label.htmlFor = id;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.value = it.name;
      cb.checked = selectedSet.has(it.name);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedSet.add(it.name); else selectedSet.delete(it.name);
        updateCount(countId, selectedSet.size, items.length);
        applyFilterToSelect();
      });
      const span = document.createElement('span');
      span.textContent = it.name + ' (' + it.count + ')';
      label.append(cb, span);
      c.appendChild(label);
    });
  }

  function renderFilterUI() {
    const wrap = document.getElementById('cxp-filters');
    if (!wrap) return;
    const hasFam = _famUnique.length > 0;
    const hasCat = _catUnique.length > 0;
    const visible = hasFam || hasCat;
    wrap.style.display = visible ? '' : 'none';
    if (!visible) return;
    const famGroup = document.getElementById('cxp-fam-group');
    const catGroup = document.getElementById('cxp-cat-group');
    if (famGroup) famGroup.style.display = hasFam ? '' : 'none';
    if (catGroup) catGroup.style.display = hasCat ? '' : 'none';
    populateGroup('cxp-fam-options', _famUnique, _selectedFam, 'fam', 'cxp-fam-count');
    populateGroup('cxp-cat-options', _catUnique, _selectedCat, 'cat', 'cxp-cat-count');
    updateCount('cxp-fam-count', _selectedFam.size, _famUnique.length);
    updateCount('cxp-cat-count', _selectedCat.size, _catUnique.length);
  }

  function applyFilterToSelect() {
    const sel = document.getElementById('listinoSelect');
    if (!sel) return;
    if (!_famCatByCode) {
      Array.from(sel.options).forEach((opt) => {
        opt.hidden = false;
        opt.classList.remove('cxp-opt-hidden');
      });
      return;
    }
    const noFilter = _selectedFam.size === 0 && _selectedCat.size === 0;
    Array.from(sel.options).forEach((opt) => {
      if (noFilter) {
        opt.hidden = false;
        opt.classList.remove('cxp-opt-hidden');
        return;
      }
      const entry = _famCatByCode.get(opt.value);
      let ok = true;
      if (_selectedFam.size > 0) {
        ok = !!(entry && entry.famiglie.some((f) => _selectedFam.has(f)));
      }
      if (ok && _selectedCat.size > 0) {
        ok = !!(entry && entry.categorie.some((c) => _selectedCat.has(c)));
      }
      opt.hidden = !ok;
      opt.classList.toggle('cxp-opt-hidden', !ok);
    });
    const curOpt = sel.options[sel.selectedIndex];
    if (curOpt && curOpt.hidden) {
      const firstVisible = Array.from(sel.options).find((o) => !o.hidden);
      sel.value = firstVisible ? firstVisible.value : '';
    }
  }

  function setupSelectObserver() {
    const sel = document.getElementById('listinoSelect');
    if (!sel) return;
    if (_selectObserver) _selectObserver.disconnect();
    // Osserviamo solo childList: app.js fa innerHTML="" + appendChild;
    // le nostre modifiche sono solo attributi (hidden/class) -> nessun loop.
    _selectObserver = new MutationObserver(() => applyFilterToSelect());
    _selectObserver.observe(sel, { childList: true });
  }

  function setupFilterUI() {
    const reset = document.getElementById('cxp-filter-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        _selectedFam.clear();
        _selectedCat.clear();
        renderFilterUI();
        applyFilterToSelect();
      });
    }
    // CSV non porta colonne Famiglia/Categoria: ad ogni nuovo caricamento
    // CSV (input file o ripristino da memoria) azzeriamo la mappa per
    // evitare voci di filtro stantie. Non tocchiamo la logica CSV di app.js.
    const csvIn = document.getElementById('csvFileInput');
    if (csvIn) csvIn.addEventListener('change', () => clearFamCat());
    const btnLoadSaved = document.getElementById('btnLoadSavedCSV');
    if (btnLoadSaved) btnLoadSaved.addEventListener('click', () => clearFamCat());
    renderFilterUI();
    setupSelectObserver();
  }

  function setStatus(msg, isError) {
    const el = document.getElementById('cxp-extra-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'crimson' : '';
  }

  async function handleExcel(file) {
    try {
      setStatus('Lettura Excel in corso…');
      await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error('Foglio vuoto');
      const sheet = wb.Sheets[sheetName];
      // raw:true -> i numeri restano Number nativi (no formatting locale);
      // i testi (incluso "9.750" salvato come testo) restano stringhe.
      // toCxpNumStr li normalizza entrambi in un formato che parseDec legge.
      const json = window.XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
      if (!json.length) throw new Error('Nessuna riga trovata');
      const rows = toCsvXpressRows(json);
      // Mappa parallela Famiglia/Categoria (non passa per app.js). Se le
      // colonne mancano -> null -> filtri restano nascosti (degradazione).
      setFamCat(buildFamCatMap(json));

      // === Stesso effetto di handleCSVUpload, senza toccare app.js ===
      if (typeof normalizeListino !== 'function' || typeof aggiornaListinoSelect !== 'function') {
        throw new Error('Motore CSVXpress non pronto');
      }
      // assegna alla variabile globale `listino` di app.js (scope globale condiviso)
      listino = normalizeListino(rows);                       // eslint-disable-line no-undef
      try {
        if (typeof saveLastCsvPayload === 'function') {
          saveLastCsvPayload({                                 // eslint-disable-line no-undef
            listinoRows: listino,                              // eslint-disable-line no-undef
            meta: { name: file.name, size: file.size, lastModified: file.lastModified, fp: file.name + '|' + file.size + '|' + file.lastModified }
          });
        }
      } catch (_) {}
      aggiornaListinoSelect();                                 // eslint-disable-line no-undef
      const cerr = document.getElementById('csvError');
      if (cerr) cerr.style.display = 'none';
      setStatus('Listino Excel caricato: ' + file.name + ' (' + rows.length + ' righe).');
    } catch (err) {
      console.error(err);
      setStatus('Errore Excel: ' + (err.message || err), true);
    }
  }

  // ---- Viewer PDF (sola consultazione, riusa il modal scoped #cxp-modal) ----
  function openPdfModal(file) {
    const back = document.getElementById('cxp-modal');
    const titleEl = document.getElementById('cxp-modal-title');
    const body = document.getElementById('cxp-modal-body');
    if (!back || !body) { setStatus('Modale non disponibile.', true); return; }
    if (titleEl) titleEl.textContent = file.name;
    body.innerHTML = '';
    body.classList.remove('padded');

    const wrap = document.createElement('div');
    wrap.className = 'cxp-pdfwrap';
    const toolbar = document.createElement('div');
    toolbar.className = 'cxp-pdftoolbar';
    const prev = document.createElement('button');
    prev.type = 'button'; prev.textContent = '‹'; prev.disabled = true;
    const ind = document.createElement('span');
    ind.className = 'cxp-pdfind'; ind.textContent = '— / —';
    const next = document.createElement('button');
    next.type = 'button'; next.textContent = '›'; next.disabled = true;
    toolbar.append(prev, ind, next);
    const status = document.createElement('div');
    status.className = 'cxp-pdfstatus'; status.textContent = 'Caricamento…';
    const cw = document.createElement('div');
    cw.className = 'cxp-pdfcanvaswrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'cxp-pdfcanvas';
    canvas.style.display = 'none';
    cw.appendChild(canvas);
    wrap.append(toolbar, status, cw);
    body.appendChild(wrap);

    back.classList.add('open');
    document.body.style.overflow = 'hidden';

    let pdfDoc = null, cur = 1, tot = 0;
    async function render(n) {
      if (!pdfDoc) return;
      cur = Math.min(Math.max(1, Number(n) || 1), tot);
      try {
        const page = await pdfDoc.getPage(cur);
        const wW = Math.max(320, cw.clientWidth - 24);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: wW / base.width });
        const ctx = canvas.getContext('2d');
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        canvas.style.display = 'block';
        ind.textContent = cur + ' / ' + tot;
        prev.disabled = cur <= 1;
        next.disabled = cur >= tot;
      } catch (e) {
        console.error(e);
        status.textContent = 'Errore pagina ' + cur + '.';
        status.style.display = '';
      }
    }
    prev.addEventListener('click', () => render(cur - 1));
    next.addEventListener('click', () => render(cur + 1));

    (async () => {
      if (!window.pdfjsLib) { status.textContent = 'pdf.js non caricato.'; return; }
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        const buf = await file.arrayBuffer();
        pdfDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        tot = pdfDoc.numPages || 0;
        if (tot === 0) throw new Error('PDF senza pagine');
        status.style.display = 'none';
        if (tot === 1) toolbar.style.display = 'none';
        await render(1);
      } catch (e) {
        console.error(e);
        status.textContent = 'Impossibile aprire il PDF.';
      }
    })();
  }

  function handlePdf(file) {
    setStatus('PDF listino aperto in viewer: ' + file.name + ' (sola consultazione).');
    openPdfModal(file);
  }

  function bind() {
    const input = document.getElementById('cxp-extra-file');
    if (!input) return;
    input.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const name = (f.name || '').toLowerCase();
      if (name.endsWith('.pdf') || f.type === 'application/pdf') {
        handlePdf(f);
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls') ||
                 /sheet|excel/.test(f.type || '')) {
        handleExcel(f);
      } else {
        setStatus('Formato non gestito qui. Per CSV usa il campo "Carica Listino CSV".', true);
      }
      e.target.value = '';
    });
  }

  function init() {
    bind();
    setupFilterUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
