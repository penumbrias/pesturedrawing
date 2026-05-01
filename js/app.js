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
  // Feature: Local folders / files as a third image source
  // ===========================================================
  // The user picks one or more folders. Each subfolder, at any depth,
  // becomes a selectable "virtual board" — checkable like the bundled
  // sample boards or Pinterest boards. Multiple boards can be picked
  // and sequenced together. Selecting a parent folder includes every
  // image in that folder *and* its descendants. Files never leave
  // the browser; they're loaded as object URLs.
  //
  // Limitation: file pickers cannot persist selections across page
  // reloads (browser security), so users re-pick folders each visit.

  const LOCAL_PREFIX = 'local-';

  const localState = {
    // Top-level folders the user has added. Each contains all image
    // files the picker returned, with their relative paths.
    roots: [], // [{ rootName, entries: [{ relativePath, file, url }] }]
    // Computed list of folders at any depth across all roots.
    boards: [], // [{ id, displayName, depth, folderPath, fileCount }]
    // Folder ids the user has checked.
    selectedIds: new Set()
  };

  function makeBoardId(folderPath) {
    return LOCAL_PREFIX + folderPath.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  }

  function isImageFile(file) {
    if (file.type && file.type.startsWith('image/')) return true;
    return /\.(jpe?g|png|gif|webp|bmp|avif|tiff?|heic|svg)$/i.test(file.name || '');
  }

  function recomputeBoards() {
    // Count files per folder path (each folder counts ALL files in
    // itself plus every descendant — same behaviour the user would
    // expect when ticking a parent folder).
    const counts = new Map();
    localState.roots.forEach(function (root) {
      root.entries.forEach(function (entry) {
        const parts = entry.relativePath.split('/').slice(0, -1);
        for (let i = 1; i <= parts.length; i++) {
          const folderPath = parts.slice(0, i).join('/');
          counts.set(folderPath, (counts.get(folderPath) || 0) + 1);
        }
      });
    });

    const sortedPaths = Array.from(counts.keys()).sort();
    localState.boards = sortedPaths.map(function (folderPath) {
      const parts = folderPath.split('/');
      return {
        id: makeBoardId(folderPath),
        displayName: parts[parts.length - 1],
        depth: parts.length - 1,
        folderPath: folderPath,
        fileCount: counts.get(folderPath)
      };
    });

    // Drop any selections whose board no longer exists.
    const validIds = new Set(localState.boards.map(function (b) { return b.id; }));
    Array.from(localState.selectedIds).forEach(function (id) {
      if (!validIds.has(id)) localState.selectedIds.delete(id);
    });
  }

  function revokeRoot(rootName) {
    const root = localState.roots.find(function (r) { return r.rootName === rootName; });
    if (!root) return;
    root.entries.forEach(function (entry) {
      try { URL.revokeObjectURL(entry.url); } catch (_) {}
    });
  }

  function addRoot(fileList) {
    const files = Array.from(fileList || []).filter(isImageFile);
    if (!files.length) return;

    const rootName = (files[0].webkitRelativePath || files[0].name).split('/')[0];
    // If this root was already added, revoke and replace (treat as a refresh).
    if (localState.roots.some(function (r) { return r.rootName === rootName; })) {
      revokeRoot(rootName);
      localState.roots = localState.roots.filter(function (r) {
        return r.rootName !== rootName;
      });
    }

    const entries = files.map(function (file) {
      return {
        relativePath: file.webkitRelativePath || file.name,
        file: file,
        url: URL.createObjectURL(file)
      };
    });

    localState.roots.push({ rootName: rootName, entries: entries });
    recomputeBoards();
  }

  function clearAllRoots() {
    localState.roots.forEach(function (root) {
      root.entries.forEach(function (entry) {
        try { URL.revokeObjectURL(entry.url); } catch (_) {}
      });
    });
    localState.roots = [];
    localState.selectedIds.clear();
    recomputeBoards();
  }

  function urlsInFolder(folderPath) {
    const out = [];
    localState.roots.forEach(function (root) {
      root.entries.forEach(function (entry) {
        if (entry.relativePath === folderPath ||
            entry.relativePath.startsWith(folderPath + '/')) {
          out.push(entry.url);
        }
      });
    });
    return out;
  }

  // ---- UI injection ----

  function injectLocalFilesUI() {
    const toggle = document.getElementById('sourceModeToggle');
    if (!toggle) return;
    if (toggle.querySelector('input[name="sourceMode"][value="local"]')) return;

    // 1) Add the "Local files" radio.
    const radioLabel = document.createElement('label');
    radioLabel.style.marginLeft = '0.25rem';
    radioLabel.innerHTML =
      '<input type="radio" name="sourceMode" value="local"> Local files';
    toggle.appendChild(radioLabel);

    // 2) Build the section. data-source-section makes it auto-toggle
    //    via the existing applySourceMode() in index.html.
    const section = document.createElement('div');
    section.id = 'localFilesSource';
    section.dataset.sourceSection = 'local';
    section.hidden = true;
    section.style.marginTop = '0.5rem';
    section.innerHTML =
      '<h3>Local Folders</h3>' +
      '<div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center;">' +
        '<button class="btn" id="localAddFolderBtn" type="button">+ Add folder</button>' +
        '<button class="btn" id="localClearBtn" type="button" style="display:none;">Clear all</button>' +
      '</div>' +
      '<div id="localStatus" class="hint" style="margin-top:.35rem;">No folders added yet</div>' +
      '<div id="localBoardList" style="max-height:240px; overflow:auto; border:1px solid #222430; border-radius:10px; padding:.35rem; background:#101217; margin-top:.35rem; display:none;"></div>' +
      '<div class="hint" style="margin-top:.35rem;">Pick a folder. Subfolders become selectable boards — you can pick a parent (gets every image inside it and its subfolders) or specific children. Files stay on your computer; nothing is uploaded.</div>';

    const pinterestSource = document.getElementById('pinterestSource');
    const card = pinterestSource ? pinterestSource.parentNode : null;
    if (card) card.appendChild(section);
    else document.body.appendChild(section);

    // Hidden file input set up to pick a directory.
    const folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
    folderInput.setAttribute('mozdirectory', '');
    folderInput.style.display = 'none';
    section.appendChild(folderInput);

    const addBtn   = section.querySelector('#localAddFolderBtn');
    const clearBtn = section.querySelector('#localClearBtn');
    const status   = section.querySelector('#localStatus');
    const list     = section.querySelector('#localBoardList');

    function renderList() {
      list.innerHTML = '';

      if (!localState.boards.length) {
        list.style.display = 'none';
        clearBtn.style.display = 'none';
        status.textContent = 'No folders added yet';
        return;
      }

      list.style.display = 'block';
      clearBtn.style.display = 'inline-block';

      const totalFiles = localState.roots.reduce(function (sum, r) {
        return sum + r.entries.length;
      }, 0);
      const folderCount = localState.roots.length;
      const selectedCount = localState.selectedIds.size;
      const selectedFiles = Array.from(localState.selectedIds).reduce(function (sum, id) {
        const b = localState.boards.find(function (b) { return b.id === id; });
        return sum + (b ? b.fileCount : 0);
      }, 0);

      status.textContent =
        folderCount + ' folder' + (folderCount === 1 ? '' : 's') + ' added · ' +
        totalFiles + ' image' + (totalFiles === 1 ? '' : 's') + ' total · ' +
        selectedCount + ' board' + (selectedCount === 1 ? '' : 's') + ' selected (' +
        selectedFiles + ' image' + (selectedFiles === 1 ? '' : 's') + ' will play)';

      localState.boards.forEach(function (board) {
        const row = document.createElement('label');
        row.style.cssText =
          'display:flex; gap:.5rem; align-items:center; padding:.18rem .25rem;' +
          ' padding-left:' + (0.25 + board.depth * 1.25) + 'rem; cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = board.id;
        cb.checked = localState.selectedIds.has(board.id);
        cb.addEventListener('change', function () {
          if (cb.checked) localState.selectedIds.add(board.id);
          else localState.selectedIds.delete(board.id);
          renderList();
          if (typeof handleSequenceVisibility === 'function') {
            handleSequenceVisibility();
          }
        });
        row.appendChild(cb);

        const text = document.createElement('span');
        const indent = board.depth > 0 ? '↳ ' : '';
        text.textContent = indent + board.displayName + '  (' + board.fileCount + ')';
        if (board.depth === 0) text.style.fontWeight = '600';
        row.appendChild(text);
        list.appendChild(row);
      });
    }

    addBtn.addEventListener('click', function () { folderInput.click(); });

    folderInput.addEventListener('change', function () {
      if (folderInput.files && folderInput.files.length) {
        addRoot(folderInput.files);
        folderInput.value = '';
        renderList();
        if (typeof handleSequenceVisibility === 'function') {
          handleSequenceVisibility();
        }
      }
    });

    clearBtn.addEventListener('click', function () {
      clearAllRoots();
      renderList();
      if (typeof handleSequenceVisibility === 'function') {
        handleSequenceVisibility();
      }
    });

    // The original index.html attached change listeners to all radios
    // at startup. Our radio didn't exist then, so we wire it up here.
    const localRadio = radioLabel.querySelector('input');
    localRadio.addEventListener('change', function (e) {
      if (typeof applySourceMode === 'function') {
        applySourceMode(e.target.value);
      }
    });

    if (localStorage.getItem('sourceMode') === 'local') {
      localRadio.checked = true;
      if (typeof applySourceMode === 'function') applySourceMode('local');
    }

    renderList();
  }

  // ---- Monkeypatch the session engine ----

  const _origGetActiveBoards = window.getActiveBoards;
  window.getActiveBoards = function () {
    const checked = document.querySelector('input[name="sourceMode"]:checked');
    if (checked && checked.value === 'local') {
      return localState.boards
        .filter(function (b) { return localState.selectedIds.has(b.id); })
        .map(function (b) { return { id: b.id, name: b.displayName }; });
    }
    return typeof _origGetActiveBoards === 'function'
      ? _origGetActiveBoards.apply(this, arguments)
      : [];
  };

  function isAllLocal(boardObjs) {
    return boardObjs && boardObjs.length > 0 && boardObjs.every(function (b) {
      return String(b.id).startsWith(LOCAL_PREFIX);
    });
  }

  const _origFetchPinsForBoards = window.fetchPinsForBoards;
  window.fetchPinsForBoards = async function (boardObjs) {
    if (isAllLocal(boardObjs)) {
      const urls = [];
      boardObjs.forEach(function (boardObj) {
        const board = localState.boards.find(function (b) { return b.id === boardObj.id; });
        if (board) urls.push.apply(urls, urlsInFolder(board.folderPath));
      });
      return typeof shuffleArray === 'function' ? shuffleArray(urls) : urls;
    }
    return typeof _origFetchPinsForBoards === 'function'
      ? _origFetchPinsForBoards.apply(this, arguments)
      : [];
  };

  if (typeof window.fetchPinsByBoard === 'function') {
    const _origFetchPinsByBoard = window.fetchPinsByBoard;
    window.fetchPinsByBoard = async function (boardObjs) {
      if (isAllLocal(boardObjs)) {
        const out = {};
        boardObjs.forEach(function (boardObj) {
          const board = localState.boards.find(function (b) { return b.id === boardObj.id; });
          if (board) out[board.displayName] = urlsInFolder(board.folderPath);
        });
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
