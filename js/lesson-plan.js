// js/lesson-plan.js
// Lesson Plan editor (beta). Designs a session as an ordered list of
// steps (image phases + breaks). Each images-step picks one or more
// boards as its source: empty list = mix from all currently-selected
// boards, one board = pull from that board, multiple boards = an
// ad-hoc linked group for that step.
//
// When enabled the editor replaces the existing Session Type / Class
// / Sequence sections in the setup screen. On Start it (a) populates
// the Class phases form to match the plan and (b) feeds the engine
// the right "selected boards" so it engages sequence mode and plays
// images in the order the plan defines.

(function () {
  'use strict';

  const PLAN_BETA_KEY    = 'pd:lessonPlan:beta';
  const PLAN_CURRENT_KEY = 'pd:lessonPlan:current';
  const PLAN_SAVED_KEY   = 'pd:lessonPlan:saved';
  const LEGACY_MIX = '__mix__';

  let stepCounter = 1;
  function makeStepId() {
    return 's' + Date.now().toString(36) + '_' + (stepCounter++);
  }

  function migrateStep(s) {
    if (!s || typeof s !== 'object') return s;
    if (Array.isArray(s.boards)) return s;
    const out = Object.assign({}, s);
    if (s.type === 'images') {
      if (s.source === LEGACY_MIX || !s.source) out.boards = [];
      else out.boards = [s.source];
      delete out.source;
    }
    return out;
  }

  function defaultSteps() {
    return [{
      id: makeStepId(),
      type: 'images',
      boards: [],
      count: 5,
      durationSec: 30
    }];
  }

  function loadCurrentSteps() {
    try {
      const raw = localStorage.getItem(PLAN_CURRENT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed.map(function (s) {
        const m = migrateStep(s);
        return Object.assign({}, m, { id: makeStepId() });
      });
    } catch (_) { return null; }
  }

  function loadSavedPresets() {
    try {
      const raw = localStorage.getItem(PLAN_SAVED_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.map(function (p) {
        return Object.assign({}, p, {
          steps: (p.steps || []).map(migrateStep)
        });
      });
    } catch (_) { return []; }
  }

  const planState = {
    enabled: localStorage.getItem(PLAN_BETA_KEY) === '1',
    steps: loadCurrentSteps() || defaultSteps(),
    saved: loadSavedPresets(),
    activePresetId: null
  };

  function persistCurrentSteps() {
    try { localStorage.setItem(PLAN_CURRENT_KEY, JSON.stringify(planState.steps)); }
    catch (_) {}
  }
  function persistSavedPresets() {
    try { localStorage.setItem(PLAN_SAVED_KEY, JSON.stringify(planState.saved)); }
    catch (_) {}
  }
  function persistEnabled() {
    localStorage.setItem(PLAN_BETA_KEY, planState.enabled ? '1' : '0');
  }

  function totalImages() {
    return planState.steps
      .filter(function (s) { return s.type === 'images'; })
      .reduce(function (sum, s) { return sum + (parseInt(s.count) || 0); }, 0);
  }
  function totalSeconds() {
    return planState.steps.reduce(function (sum, s) {
      if (s.type === 'images')
        return sum + (parseInt(s.count) || 0) * (parseInt(s.durationSec) || 0);
      if (s.type === 'break')
        return sum + (parseInt(s.durationSec) || 0);
      return sum;
    }, 0);
  }
  function fmtTotalDuration(seconds) {
    if (seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return h + 'h ' + String(m).padStart(2,'0') + 'm ' + String(s).padStart(2,'0') + 's';
    return m + ':' + String(s).padStart(2, '0');
  }

  // ---- Source picker vs lesson-plan view of "active boards" ----
  const _origGetActiveBoards = window.getActiveBoards;

  function sourcePickerBoards() {
    if (typeof _origGetActiveBoards !== 'function') return [];
    try { return _origGetActiveBoards.apply(null, arguments) || []; }
    catch (_) { return []; }
  }

  function planReferencedBoards() {
    const pool = sourcePickerBoards();
    const byName = new Map(pool.map(function (b) { return [b.name, b]; }));
    const used = new Set();

    planState.steps.forEach(function (step) {
      if (step.type !== 'images') return;
      const boards = step.boards || [];
      if (boards.length === 0) {
        pool.forEach(function (b) { used.add(b.name); });
      } else {
        boards.forEach(function (n) { used.add(n); });
      }
    });

    const out = [];
    used.forEach(function (name) {
      const b = byName.get(name);
      if (b) out.push(b);
    });
    return out;
  }

  window.getActiveBoards = function () {
    if (planState.enabled) return planReferencedBoards();
    return sourcePickerBoards();
  };

  function activeBoardNames() {
    return sourcePickerBoards().map(function (b) { return b.name; });
  }

  // ---- UI injection ----
  let editorContainer = null;
  let editorContent   = null;
  let toggleCheckbox  = null;
  let presetSelect    = null;
  let stepsList       = null;
  let totalEl         = null;
  let validationEl    = null;

  function renderHeader() {
    return (
      '<div style="display:flex; align-items:center; gap:.75rem; flex-wrap:wrap;">' +
        '<h3 style="margin:0;">Lesson Plan ' +
          '<span style="font-size:.7rem; padding:.1rem .4rem; background:var(--accent); color:var(--accent-ink); border-radius:6px; vertical-align:middle;">BETA</span>' +
        '</h3>' +
        '<label style="display:flex; align-items:center; gap:.4rem; margin:0;">' +
          '<input type="checkbox" id="lessonPlanToggle">' +
          '<span>Use Lesson Plan</span>' +
        '</label>' +
      '</div>' +
      '<div id="lessonPlanContent" style="margin-top:.5rem;">' +
        '<p class="hint" style="margin:.25rem 0 .5rem 0;">Plan a session as an ordered list of steps. Each step pulls images from one or more boards (empty = mix from all selected) for a chosen count and duration. Replaces the Session Type / Class / Sequence sections while enabled. Pick your image source below first, then build a plan here.</p>' +
        '<div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center;">' +
          '<select id="lessonPlanPresetSelect" style="max-width:14rem;"></select>' +
          '<button class="btn" id="lessonPlanLoadBtn" type="button">Load</button>' +
          '<button class="btn" id="lessonPlanSaveBtn" type="button">Save as preset…</button>' +
          '<button class="btn" id="lessonPlanRenameBtn" type="button">Rename</button>' +
          '<button class="btn" id="lessonPlanDeleteBtn" type="button">Delete</button>' +
          '<button class="btn" id="lessonPlanResetBtn" type="button">New plan</button>' +
        '</div>' +
        '<div id="lessonPlanSteps" style="margin-top:.75rem;"></div>' +
        '<div style="display:flex; gap:.5rem; margin-top:.5rem; flex-wrap:wrap;">' +
          '<button class="btn" id="lessonPlanAddStep" type="button">+ Add step</button>' +
          '<button class="btn" id="lessonPlanAddBreak" type="button">+ Add break</button>' +
        '</div>' +
        '<div id="lessonPlanTotal" style="margin-top:.75rem; font-weight:600;"></div>' +
        '<div id="lessonPlanValidation" class="hint" style="margin-top:.25rem; color:var(--accent); min-height:1.2em;"></div>' +
      '</div>'
    );
  }

  function injectUI() {
    const setup = document.getElementById('setup');
    if (!setup) return;
    if (document.getElementById('lessonPlanCard')) return;

    const grid = setup.querySelector('.grid');
    if (!grid) return;

    editorContainer = document.createElement('div');
    editorContainer.id = 'lessonPlanCard';
    editorContainer.className = 'col-12 card';
    editorContainer.innerHTML = renderHeader();
    grid.insertBefore(editorContainer, grid.firstChild);

    editorContent  = editorContainer.querySelector('#lessonPlanContent');
    toggleCheckbox = editorContainer.querySelector('#lessonPlanToggle');
    presetSelect   = editorContainer.querySelector('#lessonPlanPresetSelect');
    stepsList      = editorContainer.querySelector('#lessonPlanSteps');
    totalEl        = editorContainer.querySelector('#lessonPlanTotal');
    validationEl   = editorContainer.querySelector('#lessonPlanValidation');

    toggleCheckbox.checked = planState.enabled;
    toggleCheckbox.addEventListener('change', function () {
      planState.enabled = toggleCheckbox.checked;
      persistEnabled();
      applyVisibility();
      renderSteps();
    });

    editorContainer.querySelector('#lessonPlanLoadBtn')  .addEventListener('click', loadSelectedPreset);
    editorContainer.querySelector('#lessonPlanSaveBtn')  .addEventListener('click', savePresetPrompt);
    editorContainer.querySelector('#lessonPlanRenameBtn').addEventListener('click', renamePresetPrompt);
    editorContainer.querySelector('#lessonPlanDeleteBtn').addEventListener('click', deleteSelectedPreset);
    editorContainer.querySelector('#lessonPlanResetBtn') .addEventListener('click', resetToEmpty);
    editorContainer.querySelector('#lessonPlanAddStep')  .addEventListener('click', addImagesStep);
    editorContainer.querySelector('#lessonPlanAddBreak') .addEventListener('click', addBreakStep);

    renderSteps();
    renderPresetSelect();
    updateTotal();
    applyVisibility();
  }

  function findCardByH3(text) {
    return Array.from(document.querySelectorAll('.col-12.card')).find(function (c) {
      const h3 = c.querySelector('h3');
      return h3 && h3.textContent.trim() === text;
    });
  }

  function applyVisibility() {
    if (editorContent) editorContent.style.display = planState.enabled ? 'block' : 'none';

    const sessionTypeCard = findCardByH3('Session Type');
    const limit = document.getElementById('limitSection');
    const seq   = document.getElementById('sequenceOptions');

    if (sessionTypeCard) sessionTypeCard.style.display = planState.enabled ? 'none' : '';
    if (limit) limit.style.display = planState.enabled ? 'none' : '';
    if (seq)   seq.style.display   = planState.enabled ? 'none' : '';
  }

  function addImagesStep() {
    planState.steps.push({
      id: makeStepId(),
      type: 'images',
      boards: [],
      count: 5,
      durationSec: 30
    });
    persistCurrentSteps();
    renderSteps();
    updateTotal();
  }

  function addBreakStep() {
    planState.steps.push({
      id: makeStepId(),
      type: 'break',
      durationSec: 300
    });
    persistCurrentSteps();
    renderSteps();
    updateTotal();
  }

  function removeStep(id) {
    planState.steps = planState.steps.filter(function (s) { return s.id !== id; });
    persistCurrentSteps();
    renderSteps();
    updateTotal();
  }

  function moveStep(id, delta) {
    const i = planState.steps.findIndex(function (s) { return s.id === id; });
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= planState.steps.length) return;
    const tmp = planState.steps[i];
    planState.steps[i] = planState.steps[j];
    planState.steps[j] = tmp;
    persistCurrentSteps();
    renderSteps();
  }

  function updateStep(id, patch) {
    const step = planState.steps.find(function (s) { return s.id === id; });
    if (!step) return;
    Object.assign(step, patch);
    persistCurrentSteps();
    updateTotal();
  }

  function resetToEmpty() {
    if (!window.confirm('Discard the current plan and start a new one?')) return;
    planState.steps = defaultSteps();
    planState.activePresetId = null;
    persistCurrentSteps();
    renderSteps();
    renderPresetSelect();
    updateTotal();
    setValidation('');
  }

  function renderSteps() {
    if (!stepsList) return;
    stepsList.innerHTML = '';
    if (!planState.steps.length) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = 'Empty plan — click "+ Add step" to begin.';
      stepsList.appendChild(empty);
      return;
    }
    planState.steps.forEach(function (step, idx) {
      stepsList.appendChild(renderStepRow(step, idx));
    });
  }

  function renderSourcePicker(step) {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'display:flex; flex-wrap:wrap; gap:.25rem; align-items:center;' +
      ' flex:1; min-width:11rem; max-width:24rem;';

    const allNames = activeBoardNames();
    const boards = step.boards || [];

    boards.forEach(function (name) {
      wrap.appendChild(renderBoardChip(step, name, allNames.indexOf(name) === -1));
    });

    if (boards.length === 0) {
      const hint = document.createElement('span');
      hint.textContent = 'Mix from all selected';
      hint.style.cssText = 'color:var(--muted); font-style:italic; font-size:.85rem;';
      wrap.appendChild(hint);
    }

    const remaining = allNames.filter(function (n) { return boards.indexOf(n) === -1; });
    if (remaining.length > 0) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn mini';
      addBtn.textContent = boards.length === 0 ? '+ Pick board(s)' : '+';
      addBtn.title = 'Add a board to this step';
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        showBoardPicker(step, addBtn);
      });
      wrap.appendChild(addBtn);
    }

    return wrap;
  }

  function renderBoardChip(step, name, isStale) {
    const chip = document.createElement('span');
    chip.style.cssText =
      'display:inline-flex; align-items:center; gap:.15rem; padding:.15rem .15rem .15rem .45rem;' +
      ' background:#1a1c24; border:1px solid ' + (isStale ? '#a44' : '#2a2d3a') + ';' +
      ' border-radius:6px; font-size:.85rem;' + (isStale ? ' color:#f99;' : '');
    chip.title = isStale ? 'Not in current selection' : name;

    const text = document.createElement('span');
    text.textContent = name;
    text.style.cssText = 'max-width:12rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    chip.appendChild(text);

    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.style.cssText =
      'background:transparent; border:0; color:var(--muted); cursor:pointer;' +
      ' padding:0 .25rem; line-height:1; font-size:1.05rem;';
    x.title = 'Remove from this step';
    x.setAttribute('aria-label', 'Remove ' + name);
    x.addEventListener('click', function (e) {
      e.stopPropagation();
      const newBoards = (step.boards || []).filter(function (b) { return b !== name; });
      updateStep(step.id, { boards: newBoards });
      renderSteps();
    });
    chip.appendChild(x);
    return chip;
  }

  function showBoardPicker(step, anchor) {
    document.querySelectorAll('.lesson-board-picker').forEach(function (el) { el.remove(); });

    const allNames = activeBoardNames();
    const taken = new Set(step.boards || []);
    const available = allNames.filter(function (n) { return !taken.has(n); });

    const picker = document.createElement('div');
    picker.className = 'lesson-board-picker';
    picker.style.cssText =
      'position:absolute; background:#181a20; border:1px solid #333; border-radius:8px;' +
      ' padding:.35rem; max-height:260px; overflow:auto; z-index:9999; min-width:14rem;' +
      ' box-shadow:0 8px 22px rgba(0,0,0,.55);';

    if (available.length === 0) {
      picker.style.padding = '.5rem .65rem';
      picker.textContent = 'No more boards to add.';
    } else {
      available.forEach(function (name) {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = name;
        item.style.cssText =
          'display:block; width:100%; text-align:left; padding:.35rem .55rem;' +
          ' background:transparent; border:0; color:var(--text); cursor:pointer;' +
          ' border-radius:4px; font-size:.9rem;';
        item.addEventListener('mouseenter', function () { item.style.background = '#2a2d3a'; });
        item.addEventListener('mouseleave', function () { item.style.background = 'transparent'; });
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          const newBoards = (step.boards || []).slice();
          newBoards.push(name);
          updateStep(step.id, { boards: newBoards });
          picker.remove();
          renderSteps();
        });
        picker.appendChild(item);
      });
    }

    document.body.appendChild(picker);
    const rect = anchor.getBoundingClientRect();
    picker.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    picker.style.left = (rect.left + window.scrollX) + 'px';

    setTimeout(function () {
      function dismiss(e) {
        if (!picker.contains(e.target)) {
          picker.remove();
          document.removeEventListener('click', dismiss);
        }
      }
      document.addEventListener('click', dismiss);
    }, 0);
  }

  function renderStepRow(step, idx) {
    const row = document.createElement('div');
    row.className = 'lesson-step';
    row.dataset.id = step.id;
    row.style.cssText =
      'display:flex; gap:.4rem; align-items:center; padding:.4rem .5rem; margin-bottom:.35rem;' +
      ' background:#101217; border:1px solid #222430; border-radius:8px; flex-wrap:wrap;';

    const numBadge = document.createElement('span');
    numBadge.textContent = (idx + 1) + '.';
    numBadge.style.cssText = 'min-width:1.5rem; color:var(--muted);';
    row.appendChild(numBadge);

    if (step.type === 'images') {
      row.appendChild(renderSourcePicker(step));

      const countWrap = document.createElement('span');
      countWrap.style.cssText = 'display:inline-flex; align-items:center; gap:.25rem;';
      const countInput = document.createElement('input');
      countInput.type = 'number';
      countInput.min = '1';
      countInput.value = step.count;
      countInput.style.width = '3.5rem';
      countInput.addEventListener('input', function () {
        const v = parseInt(countInput.value, 10);
        updateStep(step.id, { count: isNaN(v) ? 1 : Math.max(1, v) });
      });
      countWrap.appendChild(countInput);
      const imagesLabel = document.createElement('span');
      imagesLabel.textContent = 'images';
      imagesLabel.style.color = 'var(--muted)';
      countWrap.appendChild(imagesLabel);
      row.appendChild(countWrap);

      const forLabel = document.createElement('span');
      forLabel.textContent = 'for';
      forLabel.style.color = 'var(--muted)';
      row.appendChild(forLabel);

      row.appendChild(renderDurationInput(step.durationSec, function (newSec) {
        updateStep(step.id, { durationSec: newSec });
      }));
      const eachLabel = document.createElement('span');
      eachLabel.textContent = 'each';
      eachLabel.style.color = 'var(--muted)';
      row.appendChild(eachLabel);
    } else if (step.type === 'break') {
      const lbl = document.createElement('strong');
      lbl.textContent = 'Break';
      lbl.style.cssText = 'padding:.15rem .5rem; background:#1a1c24; border-radius:6px;';
      row.appendChild(lbl);

      row.appendChild(renderDurationInput(step.durationSec, function (newSec) {
        updateStep(step.id, { durationSec: newSec });
      }));
    }

    const ctrls = document.createElement('div');
    ctrls.style.cssText = 'display:flex; gap:.25rem; margin-left:auto;';
    const upBtn   = makeIconBtn('↑', 'Move up',   function () { moveStep(step.id, -1); });
    const downBtn = makeIconBtn('↓', 'Move down', function () { moveStep(step.id,  1); });
    const rmBtn   = makeIconBtn('✕', 'Remove',    function () { removeStep(step.id); });
    if (idx === 0) upBtn.disabled = true;
    if (idx === planState.steps.length - 1) downBtn.disabled = true;
    ctrls.appendChild(upBtn);
    ctrls.appendChild(downBtn);
    ctrls.appendChild(rmBtn);
    row.appendChild(ctrls);

    return row;
  }

  function renderDurationInput(durationSec, onChange) {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex; align-items:center; gap:.25rem;';

    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.min = '0';
    minInput.value = Math.floor((durationSec || 0) / 60);
    minInput.style.width = '3.5rem';

    const secInput = document.createElement('input');
    secInput.type = 'number';
    secInput.min = '0';
    secInput.max = '59';
    secInput.value = (durationSec || 0) % 60;
    secInput.style.width = '3.5rem';

    function notify() {
      const m = parseInt(minInput.value, 10) || 0;
      const s = parseInt(secInput.value, 10) || 0;
      onChange(Math.max(0, m * 60 + s));
    }
    minInput.addEventListener('input', notify);
    secInput.addEventListener('input', notify);

    const m = document.createElement('span'); m.textContent = 'm'; m.style.color = 'var(--muted)';
    const s = document.createElement('span'); s.textContent = 's'; s.style.color = 'var(--muted)';

    wrap.appendChild(minInput);
    wrap.appendChild(m);
    wrap.appendChild(secInput);
    wrap.appendChild(s);
    return wrap;
  }

  function makeIconBtn(text, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn mini';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  function updateTotal() {
    if (!totalEl) return;
    const imgs = totalImages();
    const dur = totalSeconds();
    totalEl.textContent =
      'Total: ' + imgs + ' image' + (imgs === 1 ? '' : 's') + ', ' + fmtTotalDuration(dur);
  }

  function setValidation(msg) {
    if (validationEl) validationEl.textContent = msg || '';
  }

  function makePresetId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function renderPresetSelect() {
    if (!presetSelect) return;
    presetSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = planState.saved.length
      ? '— Pick a saved preset —'
      : '— No saved presets yet —';
    presetSelect.appendChild(placeholder);

    planState.saved.forEach(function (preset) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.name;
      presetSelect.appendChild(opt);
    });

    if (planState.activePresetId) presetSelect.value = planState.activePresetId;
  }

  function loadSelectedPreset() {
    const id = presetSelect.value;
    if (!id) { setValidation('Pick a preset first.'); return; }
    const preset = planState.saved.find(function (p) { return p.id === id; });
    if (!preset) return;
    planState.steps = preset.steps.map(function (s) {
      const m = migrateStep(s);
      return Object.assign({}, m, { id: makeStepId() });
    });
    planState.activePresetId = id;
    persistCurrentSteps();
    renderSteps();
    updateTotal();
    setValidation('Loaded preset: ' + preset.name);
  }

  function savePresetPrompt() {
    const defaultName = planState.activePresetId
      ? (planState.saved.find(function (p) { return p.id === planState.activePresetId; }) || {}).name || ''
      : '';
    const name = window.prompt('Save plan as preset (name):', defaultName);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const existing = planState.saved.find(function (p) { return p.name === trimmed; });
    if (existing) {
      if (!window.confirm('A preset named "' + trimmed + '" already exists. Overwrite it?')) return;
      existing.steps = serializeSteps(planState.steps);
      planState.activePresetId = existing.id;
    } else {
      const id = makePresetId();
      planState.saved.push({ id: id, name: trimmed, steps: serializeSteps(planState.steps) });
      planState.activePresetId = id;
    }
    persistSavedPresets();
    renderPresetSelect();
    setValidation('Preset saved: ' + trimmed);
  }

  function renamePresetPrompt() {
    const id = presetSelect.value;
    if (!id) { setValidation('Pick a preset to rename first.'); return; }
    const preset = planState.saved.find(function (p) { return p.id === id; });
    if (!preset) return;
    const name = window.prompt('Rename preset:', preset.name);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    preset.name = trimmed;
    persistSavedPresets();
    renderPresetSelect();
    setValidation('Preset renamed.');
  }

  function deleteSelectedPreset() {
    const id = presetSelect.value;
    if (!id) { setValidation('Pick a preset to delete first.'); return; }
    const preset = planState.saved.find(function (p) { return p.id === id; });
    if (!preset) return;
    if (!window.confirm('Delete preset "' + preset.name + '"?')) return;
    planState.saved = planState.saved.filter(function (p) { return p.id !== id; });
    if (planState.activePresetId === id) planState.activePresetId = null;
    persistSavedPresets();
    renderPresetSelect();
    setValidation('Preset deleted.');
  }

  function serializeSteps(steps) {
    return steps.map(function (s) {
      const out = {};
      Object.keys(s).forEach(function (k) {
        if (k !== 'id') out[k] = s[k];
      });
      return out;
    });
  }

  // ---- Apply lesson plan to the existing form ----
  function applyToForm() {
    setValidation('');

    if (!planState.steps.length) {
      setValidation('Add at least one step before starting.');
      return false;
    }
    const imageSteps = planState.steps.filter(function (s) { return s.type === 'images'; });
    if (!imageSteps.length) {
      setValidation('Add at least one images step (not just breaks).');
      return false;
    }
    if (imageSteps.some(function (s) { return (s.count || 0) <= 0; })) {
      setValidation('Each images step needs a count of at least 1.');
      return false;
    }

    const pickerBoards = sourcePickerBoards();
    if (!pickerBoards.length) {
      setValidation('Select at least one board in the Image Source section above.');
      return false;
    }
    const pickerNames = pickerBoards.map(function (b) { return b.name; });
    let staleBoard = null;
    for (const s of imageSteps) {
      const stepBoards = s.boards || [];
      const bad = stepBoards.find(function (n) { return pickerNames.indexOf(n) === -1; });
      if (bad) { staleBoard = bad; break; }
    }
    if (staleBoard) {
      setValidation('Step references a board not in your current selection: "' + staleBoard + '"');
      return false;
    }

    const classRadio = document.querySelector('input[name="mode"][value="class"]');
    if (classRadio) {
      classRadio.checked = true;
      classRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const phasesEl = document.getElementById('classPhases');
    if (!phasesEl) {
      setValidation('Internal error: class phases container missing.');
      return false;
    }
    phasesEl.innerHTML = '';
    if (typeof window.addPhaseRow !== 'function' ||
        typeof window.addBreakRow !== 'function') {
      setValidation('Internal error: phase row helpers unavailable.');
      return false;
    }
    planState.steps.forEach(function (step) {
      const sec = step.durationSec || 0;
      if (step.type === 'images') {
        window.addPhaseRow(step.count || 1, Math.floor(sec / 60), sec % 60);
      } else if (step.type === 'break') {
        window.addBreakRow(Math.floor(sec / 60), sec % 60);
      }
    });
    if (typeof window.recalcClassTotal === 'function') {
      window.recalcClassTotal();
    }

    const seqToggle = document.getElementById('sequenceToggle');
    if (seqToggle) {
      seqToggle.checked = true;
      seqToggle.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const slots = imageSteps.map(function (step) {
      const stepBoards = (step.boards && step.boards.length > 0)
        ? step.boards.slice()
        : pickerNames.slice();
      if (stepBoards.length === 1) {
        return { name: stepBoards[0], count: step.count || 1 };
      }
      return { names: stepBoards, count: step.count || 1 };
    });

    try {
      // eslint-disable-next-line no-undef
      sequenceSlots = slots;
      // eslint-disable-next-line no-undef
      sequenceEnabled = true;
    } catch (e) {
      console.warn('Lesson Plan: could not write sequenceSlots/sequenceEnabled directly', e);
    }
    if (typeof window.renderSequenceRows === 'function') {
      window.renderSequenceRows();
    }
    if (typeof window.handleSequenceVisibility === 'function') {
      window.handleSequenceVisibility();
    }

    return true;
  }

  // Wrap window.startSession so applyToForm always runs immediately
  // before the engine starts. Click-listener interception is unreliable
  // because index.html's startBtn capture-phase rebind calls
  // stopImmediatePropagation() and runs first, cancelling our listener.
  // Wrapping the function the rebind eventually calls is the only
  // reliable interception point.
  function setupStartHijack() {
    if (typeof window.startSession !== 'function') return;
    if (window.__lessonPlanWrappedStartSession) return;
    const orig = window.startSession;
    window.startSession = async function () {
      if (planState.enabled) {
        const ok = applyToForm();
        if (!ok) return;
      }
      return orig.apply(this, arguments);
    };
    window.__lessonPlanWrappedStartSession = true;
  }

  function watchBoardChanges() {
    const setup = document.getElementById('setup');
    if (setup) {
      setup.addEventListener('change', function (e) {
        if (!planState.enabled) return;
        const t = e.target;
        if (!t) return;
        if (editorContainer && editorContainer.contains(t)) return;
        renderSteps();
      });
    }

    if (typeof window.handleSequenceVisibility === 'function') {
      const orig = window.handleSequenceVisibility;
      window.handleSequenceVisibility = function () {
        const r = orig.apply(this, arguments);
        if (planState.enabled) renderSteps();
        return r;
      };
    }
  }

  function init() {
    injectUI();
    setupStartHijack();
    watchBoardChanges();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
