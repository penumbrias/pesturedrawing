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
    roots: [],
    boards: [],
    selectedIds: new Set(),
    expanded: new Set()
  };

  function makeBoardId(folderPath) {
    return LOCAL_PREFIX + folderPath.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  }

  function isImageFile(file) {
    if (file.type && file.type.startsWith('image/')) return true;
    return /\.(jpe?g|png|gif|webp|bmp|avif|tiff?|heic|svg)$/i.test(file.name || '');
  }

  function recomputeBoards() {
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

    const validIds = new Set(localState.boards.map(function (b) { return b.id; }));
    Array.from(localState.selectedIds).forEach(function (id) {
      if (!validIds.has(id)) localState.selectedIds.delete(id);
    });

    const validPaths = new Set(localState.boards.map(function (b) { return b.folderPath; }));
    Array.from(localState.expanded).forEach(function (p) {
      if (!validPaths.has(p)) localState.expanded.delete(p);
    });
  }

  function hasChildren(folderPath) {
    const prefix = folderPath + '/';
    return localState.boards.some(function (b) {
      return b.folderPath !== folderPath && b.folderPath.startsWith(prefix);
    });
  }

  function isVisible(board) {
    const parts = board.folderPath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/');
      if (!localState.expanded.has(ancestor)) return false;
    }
    return true;
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
    localState.expanded.add(rootName);
  }

  function clearAllRoots() {
    localState.roots.forEach(function (root) {
      root.entries.forEach(function (entry) {
        try { URL.revokeObjectURL(entry.url); } catch (_) {}
      });
    });
    localState.roots = [];
    localState.selectedIds.clear();
    localState.expanded.clear();
    recomputeBoards();
  }

  function expandAll() {
    localState.boards.forEach(function (b) {
      if (hasChildren(b.folderPath)) localState.expanded.add(b.folderPath);
    });
  }

  function collapseAll() {
    localState.expanded.clear();
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

  function injectLocalFilesUI() {
    const toggle = document.getElementById('sourceModeToggle');
    if (!toggle) return;
    if (toggle.querySelector('input[name="sourceMode"][value="local"]')) return;

    const radioLabel = document.createElement('label');
    radioLabel.style.marginLeft = '0.25rem';
    radioLabel.innerHTML =
      '<input type="radio" name="sourceMode" value="local"> Local files';
    toggle.appendChild(radioLabel);

    const section = document.createElement('div');
    section.id = 'localFilesSource';
    section.dataset.sourceSection = 'local';
    section.hidden = true;
    section.style.marginTop = '0.5rem';
    section.innerHTML =
      '<h3>Local Folders</h3>' +
      '<div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center;">' +
        '<button class="btn" id="localAddFolderBtn" type="button">+ Add folder</button>' +
        '<button class="btn" id="localExpandAllBtn" type="button" style="display:none;">Expand all</button>' +
        '<button class="btn" id="localCollapseAllBtn" type="button" style="display:none;">Collapse all</button>' +
        '<button class="btn" id="localClearBtn" type="button" style="display:none;">Clear all</button>' +
      '</div>' +
      '<div id="localStatus" class="hint" style="margin-top:.35rem;">No folders added yet</div>' +
      '<div id="localBoardList" style="max-height:280px; overflow:auto; border:1px solid #222430; border-radius:10px; padding:.35rem; background:#101217; margin-top:.35rem; display:none;"></div>' +
      '<div class="hint" style="margin-top:.35rem;">Pick a folder. Subfolders become selectable boards — you can pick a parent (gets every image inside it and its subfolders) or specific children. Files stay on your computer; nothing is uploaded.</div>';

    const pinterestSource = document.getElementById('pinterestSource');
    const card = pinterestSource ? pinterestSource.parentNode : null;
    if (card) card.appendChild(section);
    else document.body.appendChild(section);

    const folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
    folderInput.setAttribute('mozdirectory', '');
    folderInput.style.display = 'none';
    section.appendChild(folderInput);

    const addBtn         = section.querySelector('#localAddFolderBtn');
    const expandAllBtn   = section.querySelector('#localExpandAllBtn');
    const collapseAllBtn = section.querySelector('#localCollapseAllBtn');
    const clearBtn       = section.querySelector('#localClearBtn');
    const status         = section.querySelector('#localStatus');
    const list           = section.querySelector('#localBoardList');

    function notifySequenceChanged() {
      if (typeof handleSequenceVisibility === 'function') {
        handleSequenceVisibility();
      }
    }

    function renderList() {
      list.innerHTML = '';

      if (!localState.boards.length) {
        list.style.display = 'none';
        clearBtn.style.display = 'none';
        expandAllBtn.style.display = 'none';
        collapseAllBtn.style.display = 'none';
        status.textContent = 'No folders added yet';
        return;
      }

      list.style.display = 'block';
      clearBtn.style.display = 'inline-block';

      const anyParents = localState.boards.some(function (b) {
        return hasChildren(b.folderPath);
      });
      expandAllBtn.style.display   = anyParents ? 'inline-block' : 'none';
      collapseAllBtn.style.display = anyParents ? 'inline-block' : 'none';

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

      const visible = localState.boards.filter(isVisible);

      visible.forEach(function (board) {
        const row = document.createElement('div');
        row.style.cssText =
          'display:flex; gap:.4rem; align-items:center; padding:.18rem .25rem;' +
          ' padding-left:' + (0.25 + board.depth * 1.25) + 'rem;';

        const chevron = document.createElement('button');
        chevron.type = 'button';
        chevron.style.cssText =
          'width:1.2rem; height:1.2rem; padding:0; border:0; background:transparent;' +
          ' color:var(--muted); cursor:pointer; line-height:1; font-size:.9rem;';
        if (hasChildren(board.folderPath)) {
          const isOpen = localState.expanded.has(board.folderPath);
          chevron.textContent = isOpen ? '▼' : '▶';
          chevron.setAttribute('aria-label', isOpen ? 'Collapse' : 'Expand');
          chevron.addEventListener('click', function () {
            if (localState.expanded.has(board.folderPath)) {
              localState.expanded.delete(board.folderPath);
            } else {
              localState.expanded.add(board.folderPath);
            }
            renderList();
          });
        } else {
          chevron.textContent = '';
          chevron.disabled = true;
          chevron.style.cursor = 'default';
          chevron.setAttribute('aria-hidden', 'true');
        }
        row.appendChild(chevron);

        const lbl = document.createElement('label');
        lbl.style.cssText =
          'display:flex; gap:.5rem; align-items:center; cursor:pointer; flex:1; min-width:0;';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = board.id;
        cb.checked = localState.selectedIds.has(board.id);
        cb.addEventListener('change', function () {
          if (cb.checked) localState.selectedIds.add(board.id);
          else localState.selectedIds.delete(board.id);
          renderList();
          notifySequenceChanged();
        });
        lbl.appendChild(cb);

        const text = document.createElement('span');
        text.textContent = board.displayName + '  (' + board.fileCount + ')';
        text.style.cssText =
          'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        if (board.depth === 0) text.style.fontWeight = '600';
        lbl.appendChild(text);

        row.appendChild(lbl);
        list.appendChild(row);
      });
    }

    addBtn.addEventListener('click', function () { folderInput.click(); });

    folderInput.addEventListener('change', function () {
      if (folderInput.files && folderInput.files.length) {
        addRoot(folderInput.files);
        folderInput.value = '';
        renderList();
        notifySequenceChanged();
      }
    });

    expandAllBtn.addEventListener('click', function () {
      expandAll();
      renderList();
    });

    collapseAllBtn.addEventListener('click', function () {
      collapseAll();
      renderList();
    });

    clearBtn.addEventListener('click', function () {
      clearAllRoots();
      renderList();
      notifySequenceChanged();
    });

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectLocalFilesUI);
  } else {
    injectLocalFilesUI();
  }

  // Dynamically load the Lesson Plan editor (beta). Kept in a separate
  // file so app.js stays focused on bug fixes + the local files source.
  const planScript = document.createElement('script');
  planScript.src = 'js/lesson-plan.js';
  planScript.async = false;
  document.head.appendChild(planScript);
})();
