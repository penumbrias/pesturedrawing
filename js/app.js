// js/app.js
// New features and bug fixes live here so we don't have to modify
// index.html each time. This file is loaded by a single <script> tag
// at the bottom of index.html, after all the existing inline scripts
// have run — so the existing globals (togglePause, nextImage,
// applySourceMode, getActiveBoards, fetchPinsForBoards, etc.) are
// already defined by the time we reach this code.

(function () {
  'use strict';

  console.log('app.js loaded');

  // ===========================================================
  // Bug fix: spacebar toggles pause in the viewer
  // ===========================================================
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.key !== 'Spacebar') return;

    const target = e.target;
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    )) return;

    const viewer = document.getElementById('viewer');
    if (!viewer || viewer.style.display !== 'flex') return;

    e.preventDefault(); // stop the page from scrolling
    if (typeof togglePause === 'function') togglePause();
  });

  // ===========================================================
  // Bug fix: auto-advance when an image fails to load
  // ===========================================================
  const currentImageEl = document.getElementById('currentImage');
  if (currentImageEl) {
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE = 5;

    currentImageEl.addEventListener('load', function () {
      consecutiveFailures = 0;
    });

    currentImageEl.addEventListener('error', function () {
      if (!currentImageEl.getAttribute('src')) return;
      consecutiveFailures++;
      if (consecutiveFailures > MAX_CONSECUTIVE) return;
      if (typeof nextImage === 'function') {
        setTimeout(nextImage, 250);
      }
    });
  }

  // ===========================================================
  // Feature: Local files as a third image source
  // ===========================================================
  // Adds a "Local files" radio to the existing source-mode toggle and
  // a file picker section. Picked files are exposed to the rest of the
  // app as a single virtual board with id "local-files". We monkeypatch
  // getActiveBoards() and fetchPinsForBoards() so the existing session
  // engine can consume local files exactly like sample/Pinterest pins.
  //
  // Limitation: file pickers cannot persist selections across page
  // reloads (browser security), so users re-pick files each visit.

  const LOCAL_BOARD_ID = 'local-files';
  const LOCAL_BOARD_NAME = 'Local Files';

  const localState = {
    files: [] // [{ id, name, url }]
  };

  function clearLocalFiles() {
    localState.files.forEach(function (f) {
      try { URL.revokeObjectURL(f.url); } catch (_) {}
    });
    localState.files = [];
  }

  function injectLocalFilesUI() {
    const toggle = document.getElementById('sourceModeToggle');
    if (!toggle) return;
    if (toggle.querySelector('input[name="sourceMode"][value="local"]')) return;

    // 1) Add the radio option to the existing toggle group.
    const radioLabel = document.createElement('label');
    radioLabel.style.marginLeft = '0.25rem';
    radioLabel.innerHTML =
      '<input type="radio" name="sourceMode" value="local"> Local files';
    toggle.appendChild(radioLabel);

    // 2) Build the file-picker section. data-source-section makes it
    //    auto-toggle with applySourceMode() in index.html.
    const section = document.createElement('div');
    section.id = 'localFilesSource';
    section.dataset.sourceSection = 'local';
    section.hidden = true;
    section.style.marginTop = '0.5rem';
    section.innerHTML =
      '<h3>Local Files</h3>' +
      '<label>Pick image files from your computer</label>' +
      '<div style="display:flex; gap:.5rem; align-items:center; margin-top:.35rem; flex-wrap:wrap;">' +
        '<input type="file" id="localFileInput" multiple accept="image/*">' +
        '<button class="btn" id="localFilesClear" type="button" style="display:none;">Clear</button>' +
      '</div>' +
      '<div class="hint" id="localFileSummary" style="margin-top:.35rem;">No files selected</div>' +
      '<div class="hint" style="margin-top:.25rem;">Tip: pick multiple at once with Ctrl/Cmd-click. Files stay on your computer — nothing is uploaded.</div>';

    // Insert it next to the other source sections so layout matches.
    const pinterestSource = document.getElementById('pinterestSource');
    const card = pinterestSource ? pinterestSource.parentNode : null;
    if (card) {
      card.appendChild(section);
    } else {
      document.body.appendChild(section); // fallback
    }

    const fileInput = section.querySelector('#localFileInput');
    const summary   = section.querySelector('#localFileSummary');
    const clearBtn  = section.querySelector('#localFilesClear');

    function renderSummary() {
      const n = localState.files.length;
      summary.textContent = n
        ? n + ' file' + (n === 1 ? '' : 's') + ' selected'
        : 'No files selected';
      clearBtn.style.display = n ? 'inline-block' : 'none';
    }

    fileInput.addEventListener('change', function () {
      clearLocalFiles();
      const picked = Array.from(fileInput.files || []);
      localState.files = picked.map(function (file, i) {
        return {
          id:   'local-' + i,
          name: file.name,
          url:  URL.createObjectURL(file)
        };
      });
      renderSummary();
    });

    clearBtn.addEventListener('click', function () {
      clearLocalFiles();
      fileInput.value = '';
      renderSummary();
    });

    // The original index.html attached change listeners to all radios
    // it could find at startup. Our radio didn't exist then, so we
    // wire it up here.
    const localRadio = radioLabel.querySelector('input');
    localRadio.addEventListener('change', function (e) {
      if (typeof applySourceMode === 'function') {
        applySourceMode(e.target.value);
      }
    });

    // Restore "local" mode if the user had it selected before reloading.
    if (localStorage.getItem('sourceMode') === 'local') {
      localRadio.checked = true;
      if (typeof applySourceMode === 'function') {
        applySourceMode('local');
      }
    }

    renderSummary();
  }

  // Monkeypatch: route local mode through the existing session engine.
  const _origGetActiveBoards = window.getActiveBoards;
  window.getActiveBoards = function () {
    const checked = document.querySelector('input[name="sourceMode"]:checked');
    if (checked && checked.value === 'local') {
      return localState.files.length
        ? [{ id: LOCAL_BOARD_ID, name: LOCAL_BOARD_NAME }]
        : [];
    }
    return typeof _origGetActiveBoards === 'function'
      ? _origGetActiveBoards.apply(this, arguments)
      : [];
  };

  const _origFetchPinsForBoards = window.fetchPinsForBoards;
  window.fetchPinsForBoards = async function (boardObjs) {
    if (boardObjs && boardObjs.length === 1 && boardObjs[0].id === LOCAL_BOARD_ID) {
      const urls = localState.files.map(function (f) { return f.url; });
      return typeof shuffleArray === 'function' ? shuffleArray(urls) : urls;
    }
    return typeof _origFetchPinsForBoards === 'function'
      ? _origFetchPinsForBoards.apply(this, arguments)
      : [];
  };

  // Defensive: sequence mode uses fetchPinsByBoard. We don't expose
  // multiple local boards yet, but patch just in case the user enables
  // sequencing and we later support multiple local "boards".
  if (typeof window.fetchPinsByBoard === 'function') {
    const _origFetchPinsByBoard = window.fetchPinsByBoard;
    window.fetchPinsByBoard = async function (boardObjs) {
      if (boardObjs && boardObjs.length === 1 && boardObjs[0].id === LOCAL_BOARD_ID) {
        const out = {};
        out[LOCAL_BOARD_NAME] = localState.files.map(function (f) { return f.url; });
        return out;
      }
      return _origFetchPinsByBoard.apply(this, arguments);
    };
  }

  // Inject the UI.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectLocalFilesUI);
  } else {
    injectLocalFilesUI();
  }
})();
