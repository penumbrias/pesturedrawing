// js/lesson-plan.js
// Lesson Plan editor (beta). Designs a session as an ordered list of
// steps (image phases + breaks). When enabled, replaces the existing
// Session Type / Class / Sequence sections in the setup screen and
// hijacks the Start button: on click, the plan is translated into
// the existing Class phases + Sequence slots and the original
// startSession runs unchanged.
//
// Kept in its own file so app.js stays small and this UI can grow
// without bloating the main bundle.

(function () {
  'use strict';

  const PLAN_BETA_KEY    = 'pd:lessonPlan:beta';
  const PLAN_CURRENT_KEY = 'pd:lessonPlan:current';
  const PLAN_SAVED_KEY   = 'pd:lessonPlan:saved';
  const MIX_SOURCE       = '__mix__';

  let stepCounter = 1;
  function makeStepId() {
    return 's' + Date.now().toString(36) + '_' + (stepCounter++);
  }

  function defaultSteps() {
    return [{
      id: makeStepId(),
      type: 'images',
      source: MIX_SOURCE,
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
        return Object.assign({}, s, { id: makeStepId() });
      });
    } catch (_) { return null; }
  }

  function loadSavedPresets() {
    try {
      const raw = localStorage.getItem(PLAN_SAVED_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
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
    if (h > 0) {
      return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
    }
    return m + ':' + String(s).padStart(2, '0');
  }

  function activeBoards() {
    if (typeof window.getActiveBoards !== 'function') return [];
    try { return window.getActiveBoards() || []; }
    catch (_) { return []; }
  }

  function activeBoardNames() {
    return activeBoards().map(function (b) { return b.name; });
  }

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
        '<p class="hint" style="margin:.25rem 0 .5rem 0;">Plan a session as an ordered list of steps. Each step pulls images from a board (or all selected boards) for a chosen count and duration. Replaces the Session Type / Class / Sequence sections while enabled. Pick your image source below first, then build a plan here.</p>' +
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

  // ---- Step manipulation ----
  function addImagesStep() {
    planState.steps.push({
      id: makeStepId(),
      type: 'images',
      source: MIX_SOURCE,
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

  // ---- Rendering ----
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
      const sourceSelect = document.createElement('select');
      sourceSelect.style.cssText = 'min-width:9rem; flex:1; max-width:16rem;';

      const mixOpt = document.createElement('option');
      mixOpt.value = MIX_SOURCE;
      mixOpt.textContent = 'Mix from selected boards';
      sourceSelect.appendChild(mixOpt);

      const boardNames = activeBoardNames();
      boardNames.forEach(function (name) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sourceSelect.appendChild(opt);
      });

      // Show stale source as a placeholder so the user knows it's a problem.
      if (step.source !== MIX_SOURCE && boardNames.indexOf(step.source) === -1) {
        const stale = document.createElement('option');
        stale.value = step.source;
        stale.textContent = step.source + ' (not in current selection)';
        sourceSelect.appendChild(stale);
      }

      sourceSelect.value = step.source;
      sourceSelect.addEventListener('change', function () {
        updateStep(step.id, { source: sourceSelect.value });
      });
      row.appendChild(sourceSelect);

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

  // ---- Presets ----
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
      return Object.assign({}, s, { id: makeStepId() });
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
    const boards = activeBoards();
    if (!boards.length) {
      setValidation('Select at least one board in the Image Source section above.');
      return false;
    }
    const boardNames = boards.map(function (b) { return b.name; });
    const stale = imageSteps.find(function (s) {
      return s.source !== MIX_SOURCE && boardNames.indexOf(s.source) === -1;
    });
    if (stale) {
      setValidation('Step references a board not in your current selection: "' + stale.source + '"');
      return false;
    }

    // 1) Class mode
    const classRadio = document.querySelector('input[name="mode"][value="class"]');
    if (classRadio) {
      classRadio.checked = true;
      classRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 2) Rebuild #classPhases to match the plan
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

    // 3) Sequence: enable + build slots from images-steps only
    const seqToggle = document.getElementById('sequenceToggle');
    if (seqToggle) {
      seqToggle.checked = true;
      seqToggle.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const slots = imageSteps.map(function (step) {
      if (step.source === MIX_SOURCE) {
        return { names: boardNames.slice(), count: step.count || 1 };
      }
      return { name: step.source, count: step.count || 1 };
    });

    // sequenceSlots / sequenceEnabled are top-level let bindings in the
    // index.html script scope. From this script we can re-assign them by
    // name; the existing engine reads them when starting.
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

  function setupStartHijack() {
    const startBtn = document.getElementById('startBtn');
    if (!startBtn) return;
    startBtn.addEventListener('click', function (e) {
      if (!planState.enabled) return;
      const ok = applyToForm();
      if (!ok) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      // If ok, let the click continue — existing handlers read the form.
    }, true); // capture phase: runs before existing listeners
  }

  // Refresh source dropdowns whenever the active board selection might
  // have changed. handleSequenceVisibility is called from many places
  // that mutate selection — patching it gives us a reliable hook.
  function watchBoardChanges() {
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
