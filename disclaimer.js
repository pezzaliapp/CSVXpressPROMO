/* ============================================================
   CSVXpressPROMO — disclaimer.js
   Gate di accesso additivo. NON modifica app.js. IIFE isolata.

   Comportamento:
   - Mostra l'overlay #cxp-disc-overlay all'apertura, bloccando ogni
     interazione con il resto della pagina (via `inert` + focus trap).
   - L'utente deve spuntare la casella e premere "Accedi": solo allora
     l'accettazione viene salvata in localStorage con la versione
     corrente del testo. Se il testo cambia (DISCLAIMER_VERSION), il
     disclaimer torna a comparire alla prossima apertura.
   - ESC e click sul backdrop NON chiudono. Unica via: bottone Accedi.

   Sincronia versione: la stessa stringa è letta dall'inline guard in
   index.html (data-disc-ver su <html>), così se la versione salvata
   combacia l'overlay non viene mai dipinto (nessun flash).
   ============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'cxp-disc-accepted';
  const ROOT_ATTR   = 'data-disc-accepted';
  const DISCLAIMER_VERSION =
    document.documentElement.getAttribute('data-disc-ver') || '2026-05-17b';

  function alreadyAccepted() {
    try { return localStorage.getItem(STORAGE_KEY) === DISCLAIMER_VERSION; }
    catch (_) { return false; }
  }

  function markAccepted() {
    try { localStorage.setItem(STORAGE_KEY, DISCLAIMER_VERSION); } catch (_) {}
    document.documentElement.setAttribute(ROOT_ATTR, '1');
  }

  // `inert` neutralizza focus + click sui fratelli dell'overlay,
  // garantendo che nulla dietro sia interagibile finché non si accetta.
  function setSiblingsInert(overlay, on) {
    const siblings = overlay.parentNode ? overlay.parentNode.children : [];
    for (let i = 0; i < siblings.length; i++) {
      const el = siblings[i];
      if (el === overlay) continue;
      if (el.tagName === 'SCRIPT') continue;
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    }
  }

  function getFocusables(root) {
    const sel = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    return Array.from(root.querySelectorAll(sel))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  /* ============================================================
     visualViewport sync — fix iPhone Safari portrait
     ============================================================
     iOS Safari ha una toolbar inferiore dinamica (frecce / condividi /
     tab) che NON viene esclusa dal layout viewport: un overlay
     position:fixed a tutto schermo finisce graficamente SOTTO la
     toolbar, e il suo footer (col bottone "Accedi") diventa
     fisicamente intoccabile. Le unità `100dvh` / `100vh` non
     risolvono perché si riferiscono comunque al layout viewport.

     Soluzione: l'API `window.visualViewport` restituisce l'area
     REALMENTE visibile, che ESCLUDE la toolbar Safari dinamica.
     Inchiodiamo top/left/width/height dell'overlay a quei valori,
     ricalcolando su:
       - vv.resize       → toolbar che appare/scompare, keyboard, rotazione
       - vv.scroll       → pinch-zoom + pan dell'utente
       - orientationchange / window.resize → ridondanza di sicurezza
     Sui browser senza l'API resta il fallback CSS (dvh / -webkit-fill-
     available / vh) definito in disclaimer.css. */
  function bindVisualViewport(overlay) {
    const vv = window.visualViewport;
    if (!vv) return function noop() {};
    function sync() {
      if (!overlay.isConnected) return;
      const s = overlay.style;
      s.top    = vv.offsetTop  + 'px';
      s.left   = vv.offsetLeft + 'px';
      s.width  = vv.width      + 'px';
      s.height = vv.height     + 'px';
    }
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);
    window.addEventListener('resize', sync);
    // Più tick: iOS aggiorna visualViewport in modo asincrono dopo il
    // primo paint, soprattutto in PWA standalone e dopo la rotazione.
    sync();
    requestAnimationFrame(sync);
    setTimeout(sync, 250);
    return function detach() {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
      window.removeEventListener('resize', sync);
    };
  }

  /* Body scroll lock mentre l'overlay è aperto. Evita che iOS scrolli
     la pagina dietro l'overlay: lo scroll della pagina è proprio ciò
     che fa apparire/scomparire la toolbar Safari, e riapparirebbe il
     problema dell'area inferiore inaccessibile. */
  let _htmlOverflowBackup = null;
  let _bodyOverflowBackup = null;
  function lockBodyScroll() {
    _htmlOverflowBackup = document.documentElement.style.overflow;
    _bodyOverflowBackup = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockBodyScroll() {
    if (_htmlOverflowBackup !== null) {
      document.documentElement.style.overflow = _htmlOverflowBackup;
    }
    if (_bodyOverflowBackup !== null) {
      document.body.style.overflow = _bodyOverflowBackup;
    }
    _htmlOverflowBackup = _bodyOverflowBackup = null;
  }

  function init() {
    const overlay = document.getElementById('cxp-disc-overlay');
    if (!overlay) return;

    if (alreadyAccepted()) {
      document.documentElement.setAttribute(ROOT_ATTR, '1');
      // Rimuove l'overlay dal DOM: non potrà mai più essere mostrato in
      // questa sessione, e non resta inert/focus trap attivo per sbaglio.
      overlay.remove();
      return;
    }

    const chk = document.getElementById('cxp-disc-agree');
    const btn = document.getElementById('cxp-disc-accept');
    if (!chk || !btn) return;

    btn.disabled = !chk.checked;
    chk.addEventListener('change', () => { btn.disabled = !chk.checked; });

    // Aggancia l'overlay alla visual viewport iOS PRIMA del primo paint
    // utente e blocca lo scroll della pagina dietro: in questo modo il
    // footer (checkbox + Accedi) è sempre dentro l'area visibile reale
    // anche con toolbar Safari estesa o compatta dopo scroll.
    const detachVV = bindVisualViewport(overlay);
    lockBodyScroll();

    btn.addEventListener('click', () => {
      if (!chk.checked) return;
      markAccepted();
      setSiblingsInert(overlay, false);
      detachVV();
      unlockBodyScroll();
      overlay.remove();
      // Restituisce focus a un landmark sensato per screen reader.
      const h1 = document.querySelector('header h1, main h1, h1');
      if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus(); }
    });

    // Focus trap + blocco ESC.
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = getFocusables(overlay);
      if (list.length === 0) return;
      const first = list[0];
      const last  = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Click sul backdrop = no-op (impedisce focus accidentali fuori).
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) e.preventDefault();
    });

    setSiblingsInert(overlay, true);

    // Sposta il focus sulla checkbox: l'utente legge → spunta → Tab → Accedi.
    requestAnimationFrame(() => {
      try { chk.focus({ preventScroll: false }); } catch (_) { chk.focus(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
