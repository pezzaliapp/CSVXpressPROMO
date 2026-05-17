/* ============================================================
   CSVXpressPROMO — promo.js
   Modulo PROMO autonomo, derivato da ListoAPP.
   - IIFE isolato: NON tocca le variabili/funzioni globali di app.js
   - IndexedDB dedicato (db separato da quello di CSVXpressSmart)
   - Fetch promo.json (origin -> raw GitHub fallback -> cache IDB)
   - Render schede, viewer PDF/immagini via pdf.js, condivisione
   - Import promo locali (JSON / PDF / immagine)
   ============================================================ */
(function () {
  'use strict';

  // -------- CONFIG (allineata alla repo: modificabile da admin) --------
  // Owner/repo della repo che ospita promo/promo.json su GitHub Pages.
  const GH_OWNER = 'pezzaliapp';
  const GH_REPO = 'CSVXpressPROMO';
  const GH_BRANCH = 'main';
  const RAW_PROMO_URL =
    `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/promo/promo.json`;
  const PDFJS_WORKER_URL =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  // -------- IndexedDB dedicato (NON collide con csvxpresssmart_db_v1) --------
  const DB_NAME = 'csvxpresspromo_db';
  const STORE = 'kv';
  const KEY_PROMO_REMOTE = 'promo_remote_cache';
  const KEY_PROMO_LOCAL = 'promo_local_index';
  const KEY_PROMO_LOCAL_PREFIX = 'promo_local_';
  const KEY_PROMO_SEEN = 'csvxpresspromo_seen_v1';

  let _db = null;
  function openDB() {
    if (_db) return _db;
    _db = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _db;
  }
  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDel(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // -------- Utility --------
  const $ = (s, r) => (r || document).querySelector(s);
  function uid(p) {
    return (p || 'id_') + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function isWithinRange(today, startsAt, expiresAt) {
    if (startsAt && today < startsAt) return false;
    if (expiresAt && today > expiresAt) return false;
    return true;
  }
  function dataUrlToUint8Array(dataUrl) {
    const idx = dataUrl.indexOf(',');
    const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // -------- Toast (scoped) --------
  function showToast(message, kind, opts) {
    const wrap = $('#cxp-toasts');
    if (!wrap) { console.log('[promo]', message); return; }
    const t = document.createElement('div');
    t.className = 'cxp-toast ' + (kind || '');
    const msg = document.createElement('div');
    msg.className = 'cxp-toast-msg';
    msg.textContent = message;
    t.appendChild(msg);
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '✕';
    x.addEventListener('click', () => t.remove());
    t.appendChild(x);
    wrap.appendChild(t);
    const ttl = (opts && opts.ttl) || 4000;
    setTimeout(() => t.remove(), ttl);
  }

  // -------- Modal (scoped) --------
  let _modalCleanup = null;
  function openModal(title, build, cleanup) {
    const back = $('#cxp-modal');
    if (!back) return;
    const titleEl = $('#cxp-modal-title');
    const body = $('#cxp-modal-body');
    if (titleEl) titleEl.textContent = title || '';
    if (body) {
      body.innerHTML = '';
      body.classList.remove('padded');
      try { build(body); } catch (e) { console.error(e); }
    }
    back.classList.add('open');
    _modalCleanup = cleanup || null;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    const back = $('#cxp-modal');
    if (!back) return;
    back.classList.remove('open');
    document.body.style.overflow = '';
    if (typeof _modalCleanup === 'function') { try { _modalCleanup(); } catch (_) {} _modalCleanup = null; }
    const body = $('#cxp-modal-body');
    if (body) body.innerHTML = '';
  }

  // -------- Stato promo --------
  let promoRemote = [];
  let promoLocal = [];
  let promoEtag = null;
  let promoInFlight = null;

  async function loadPromoCaches() {
    try {
      const cache = await idbGet(KEY_PROMO_REMOTE);
      if (cache && Array.isArray(cache.list)) { promoRemote = cache.list; promoEtag = cache.etag || null; }
    } catch (_) {}
    try {
      const idx = await idbGet(KEY_PROMO_LOCAL);
      if (Array.isArray(idx)) {
        const all = [];
        for (const id of idx) {
          const p = await idbGet(KEY_PROMO_LOCAL_PREFIX + id);
          if (p) all.push(Object.assign({}, p, { _local: true }));
        }
        promoLocal = all;
      }
    } catch (_) {}
  }

  async function savePromoLocal(promo) {
    const id = promo.id || uid('lp_');
    promo.id = id;
    promo._local = true;
    if (!promo.createdAt) promo.createdAt = new Date().toISOString();
    await idbSet(KEY_PROMO_LOCAL_PREFIX + id, promo);
    let idx = (await idbGet(KEY_PROMO_LOCAL)) || [];
    if (!Array.isArray(idx)) idx = [];
    if (!idx.includes(id)) idx.push(id);
    await idbSet(KEY_PROMO_LOCAL, idx);
    promoLocal = promoLocal.filter((p) => p.id !== id).concat([promo]);
  }

  async function deletePromoLocal(id) {
    await idbDel(KEY_PROMO_LOCAL_PREFIX + id);
    let idx = (await idbGet(KEY_PROMO_LOCAL)) || [];
    if (!Array.isArray(idx)) idx = [];
    idx = idx.filter((x) => x !== id);
    await idbSet(KEY_PROMO_LOCAL, idx);
    promoLocal = promoLocal.filter((p) => p.id !== id);
    renderPromo();
    showToast('Promo locale eliminata.', 'success');
  }

  async function fetchPromoOnce() {
    if (promoInFlight) return promoInFlight;
    promoInFlight = (async () => {
      const tryFetch = async (url, useEtag) => {
        const headers = {};
        if (useEtag && promoEtag) headers['If-None-Match'] = promoEtag;
        return fetch(url, { cache: 'no-store', headers });
      };
      try {
        let res;
        const isFileProto = (location.protocol === 'file:');
        try {
          res = isFileProto
            ? await tryFetch(RAW_PROMO_URL, false)
            : await tryFetch('./promo/promo.json', true);
        } catch (e) {
          if (!isFileProto) res = await tryFetch(RAW_PROMO_URL, false);
          else throw e;
        }
        if (res.status === 304) return { unchanged: true };
        if (!res.ok) {
          if (res.status === 404) {
            promoRemote = [];
            await idbSet(KEY_PROMO_REMOTE, { etag: null, list: [] });
            return { changed: true };
          }
          throw new Error('HTTP ' + res.status);
        }
        promoEtag = res.headers.get('ETag') || promoEtag;
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.promo) ? data.promo : []);
        const before = promoRemote.map((p) => p.id).sort().join(',');
        const after = list.map((p) => p.id).sort().join(',');
        promoRemote = list;
        await idbSet(KEY_PROMO_REMOTE, { etag: promoEtag, list });
        return { changed: before !== after, list };
      } catch (err) {
        return { error: err };
      }
    })();
    try { return await promoInFlight; }
    finally { promoInFlight = null; }
  }

  function readSeen() {
    try { return JSON.parse(localStorage.getItem(KEY_PROMO_SEEN) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function markSeen(id) {
    const s = readSeen();
    s[id] = Date.now();
    try { localStorage.setItem(KEY_PROMO_SEEN, JSON.stringify(s)); } catch (_) {}
  }

  function isPromoActive(p) {
    if (p.active === false) return false;
    return isWithinRange(todayISO(), p.startsAt, p.expiresAt);
  }

  function getMergedPromos() {
    const map = new Map();
    promoRemote.forEach((p) => map.set(p.id, Object.assign({ _local: false }, p)));
    promoLocal.forEach((p) => map.set(p.id, Object.assign({}, p, { _local: true })));
    return Array.from(map.values());
  }

  async function refreshPromoVisible(showNewToast) {
    const before = new Set(getMergedPromos().map((p) => p.id));
    const r = await fetchPromoOnce();
    const after = getMergedPromos();
    if (r && r.changed && showNewToast) {
      const seen = readSeen();
      const newOnes = after.filter((p) => !before.has(p.id) && !seen[p.id] && isPromoActive(p));
      if (newOnes.length) {
        showToast('Nuove promo: ' + newOnes.map((p) => p.title).join(', '), 'success', { ttl: 6000 });
      }
    }
    renderPromo();
  }

  function renderPromo() {
    const wrap = $('#cxp-promo-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    const all = getMergedPromos();
    const active = all.filter(isPromoActive)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!active.length) {
      const empty = document.createElement('div');
      empty.className = 'cxp-empty';
      empty.textContent = 'Nessuna promo attiva al momento.';
      wrap.appendChild(empty);
      return;
    }
    active.forEach((p) => {
      const card = document.createElement('article');
      card.className = 'cxp-promo';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      const header = document.createElement('header');
      const titleWrap = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = p.title || '(senza titolo)';
      titleWrap.appendChild(h);
      const badges = document.createElement('div');
      if (p._local) {
        const b = document.createElement('span');
        b.className = 'cxp-badge local';
        b.textContent = '📱 locale';
        badges.appendChild(b);
      }
      if (p.type) {
        const b = document.createElement('span');
        b.className = 'cxp-badge';
        b.textContent = p.type;
        badges.appendChild(b);
      }
      header.appendChild(titleWrap);
      header.appendChild(badges);
      const desc = document.createElement('div');
      desc.className = 'cxp-desc';
      desc.textContent = p.description || '';
      const meta = document.createElement('div');
      meta.className = 'cxp-meta';
      const range = (p.startsAt || '—') + ' → ' + (p.expiresAt || '—');
      const rEl = document.createElement('span'); rEl.textContent = range; meta.appendChild(rEl);
      if (p.fileSize) {
        const s = document.createElement('span');
        s.textContent = (Math.round(p.fileSize / 1024)) + ' KB';
        meta.appendChild(s);
      }
      card.appendChild(header);
      if (p.description) card.appendChild(desc);
      card.appendChild(meta);
      if (p._local) {
        const actions = document.createElement('div');
        actions.className = 'cxp-promo-actions';
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'cxp-danger'; del.textContent = 'Elimina';
        del.addEventListener('click', (e) => { e.stopPropagation(); deletePromoLocal(p.id); });
        actions.appendChild(del);
        card.appendChild(actions);
      }
      const open = () => { markSeen(p.id); openPromo(p); };
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      wrap.appendChild(card);
    });
  }

  async function openPromo(p) {
    const url = p.url || '';
    if (!url) { showToast('Nessun allegato per questa promo.', 'warn'); return; }
    if ((p.type === 'link') ||
        (/^https?:/i.test(url) && !/\.(pdf|png|jpe?g|gif|webp)$/i.test(url))) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const isImage = p.type === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(url) ||
      (p.fileMime || '').startsWith('image/');
    const isPdf = p.type === 'pdf' || /\.pdf$/i.test(url) ||
      (p.fileMime || '') === 'application/pdf';
    const resolvedUrl = url;

    openModal(p.title || 'Promo', (body) => {
      if (isImage) {
        const img = document.createElement('img');
        img.src = resolvedUrl;
        img.alt = p.title || '';
        body.appendChild(img);
        body.classList.add('padded');
      } else if (isPdf) {
        const wrapper = document.createElement('div');
        wrapper.className = 'cxp-pdfwrap';

        const toolbar = document.createElement('div');
        toolbar.className = 'cxp-pdftoolbar';
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button'; prevBtn.textContent = '‹'; prevBtn.disabled = true;
        const indicator = document.createElement('span');
        indicator.className = 'cxp-pdfind';
        indicator.textContent = '— / —';
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button'; nextBtn.textContent = '›'; nextBtn.disabled = true;
        toolbar.append(prevBtn, indicator, nextBtn);

        const status = document.createElement('div');
        status.className = 'cxp-pdfstatus';
        status.textContent = 'Caricamento…';

        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'cxp-pdfcanvaswrap';
        const canvas = document.createElement('canvas');
        canvas.className = 'cxp-pdfcanvas';
        canvas.style.display = 'none';
        canvasWrap.appendChild(canvas);

        wrapper.append(toolbar, status, canvasWrap);
        body.appendChild(wrapper);

        let pdfDoc = null, currentPage = 1, totalPages = 0;
        async function renderPage(n) {
          if (!pdfDoc) return;
          currentPage = Math.min(Math.max(1, Number(n) || 1), totalPages);
          try {
            const page = await pdfDoc.getPage(currentPage);
            const wrapW = Math.max(320, canvasWrap.clientWidth - 24);
            const base = page.getViewport({ scale: 1 });
            const scale = wrapW / base.width;
            const viewport = page.getViewport({ scale });
            const ctx = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;
            canvas.style.display = 'block';
            indicator.textContent = currentPage + ' / ' + totalPages;
            prevBtn.disabled = currentPage <= 1;
            nextBtn.disabled = currentPage >= totalPages;
          } catch (err) {
            console.error(err);
            status.textContent = 'Errore nel rendering della pagina ' + currentPage + '.';
            status.style.display = '';
          }
        }
        prevBtn.addEventListener('click', () => renderPage(currentPage - 1));
        nextBtn.addEventListener('click', () => renderPage(currentPage + 1));

        (async () => {
          if (!window.pdfjsLib) {
            status.textContent = 'Viewer PDF non disponibile (pdf.js non caricato).';
            return;
          }
          try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
            const arg = resolvedUrl.startsWith('data:')
              ? { data: dataUrlToUint8Array(resolvedUrl) }
              : { url: resolvedUrl };
            pdfDoc = await window.pdfjsLib.getDocument(arg).promise;
            totalPages = pdfDoc.numPages || 0;
            if (totalPages === 0) throw new Error('PDF senza pagine');
            status.style.display = 'none';
            if (totalPages === 1) toolbar.style.display = 'none';
            await renderPage(1);
          } catch (err) {
            console.error(err);
            status.textContent = 'Impossibile aprire il PDF.';
          }
        })();
      } else {
        const a = document.createElement('a');
        a.href = resolvedUrl; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = 'Apri allegato in nuova scheda';
        body.classList.add('padded');
        body.appendChild(a);
      }

      // Footer: Chiudi + Condividi
      const modalEl = body.parentElement;
      if (modalEl) {
        const oldFooter = modalEl.querySelector(':scope > footer');
        if (oldFooter) oldFooter.remove();
        const footer = document.createElement('footer');
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button'; closeBtn.className = 'cxp-ghost';
        closeBtn.textContent = 'Chiudi';
        closeBtn.addEventListener('click', closeModal);
        const shareBtn = document.createElement('button');
        shareBtn.type = 'button'; shareBtn.className = 'cxp-primary';
        shareBtn.textContent = 'Condividi';
        shareBtn.addEventListener('click', async () => {
          try {
            let blob;
            if (p.url && p.url.startsWith('data:')) {
              blob = new Blob([dataUrlToUint8Array(p.url)], { type: p.fileMime || 'application/octet-stream' });
            } else {
              const r = await fetch(resolvedUrl);
              blob = await r.blob();
            }
            const fname = p.fileName || 'promo';
            const file = new File([blob], fname, { type: p.fileMime || blob.type });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: p.title || 'Promo', text: p.description || '' });
            } else {
              const dl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = dl; a.download = fname;
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(dl), 1000);
            }
          } catch (err) {
            if (err && err.name === 'AbortError') return;
            showToast('Condivisione fallita: ' + (err.message || err), 'error');
          }
        });
        footer.appendChild(closeBtn);
        footer.appendChild(shareBtn);
        modalEl.appendChild(footer);
      }
    }, () => {
      const f = document.querySelector('#cxp-modal .cxp-modal > footer');
      if (f) f.remove();
    });
  }

  async function importLocalPromoFromFile(file) {
    if (!file) return;
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.json')) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.promo) ? data.promo : [data]);
        let added = 0;
        for (const raw of list) {
          if (!raw || typeof raw !== 'object') continue;
          await savePromoLocal(Object.assign({}, raw));
          added++;
        }
        renderPromo();
        showToast(added + ' promo locali importate.', 'success');
      } catch (e) {
        showToast('JSON non valido: ' + (e.message || e), 'error');
      }
      return;
    }
    // PDF / immagine -> promo locale con allegato data:
    const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
    const isImg = /\.(png|jpe?g|gif|webp)$/i.test(name) || (file.type || '').startsWith('image/');
    if (!isPdf && !isImg) { showToast('Formato non supportato.', 'warn'); return; }
    try {
      const dataUrl = await fileToDataUrl(file);
      await savePromoLocal({
        title: file.name,
        description: '',
        url: dataUrl,
        type: isPdf ? 'pdf' : 'image',
        fileName: file.name,
        fileMime: file.type || (isPdf ? 'application/pdf' : 'image/*'),
        fileSize: file.size,
        startsAt: '',
        expiresAt: '',
        active: true
      });
      renderPromo();
      showToast('Promo locale aggiunta.', 'success');
    } catch (e) {
      showToast('Import fallito: ' + (e.message || e), 'error');
    }
  }

  // -------- Bootstrap --------
  function bindUI() {
    const refreshBtn = $('#cxp-promo-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => refreshPromoVisible(true));
    const importBtn = $('#cxp-promo-import');
    const importInput = $('#cxp-promo-import-file');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) importLocalPromoFromFile(f);
        e.target.value = '';
      });
    }
    const closeX = $('#cxp-modal-close');
    if (closeX) closeX.addEventListener('click', closeModal);
    const back = $('#cxp-modal');
    if (back) back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  async function init() {
    bindUI();
    await loadPromoCaches();
    renderPromo();
    await refreshPromoVisible(false);
    // polling 60s solo se tab visibile + trigger su focus/visibility
    setInterval(() => {
      if (document.visibilityState === 'visible') refreshPromoVisible(true);
    }, 60000);
    window.addEventListener('focus', () => refreshPromoVisible(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshPromoVisible(true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
