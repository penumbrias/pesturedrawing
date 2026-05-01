// js/app.js
// New features and bug fixes live here so we don't have to modify
// index.html each time. This file is loaded by a single <script> tag
// at the bottom of index.html, after all the existing inline scripts
// have run — so the existing globals (togglePause, nextImage, etc.)
// are already defined by the time we reach this code.

(function () {
  'use strict';

  console.log('app.js loaded');

  // === Bug fix: spacebar toggles pause in the viewer ===
  // The pause button worked via click but no key was wired up. Mirror
  // the pattern of the other viewer shortcuts: don't hijack while
  // typing in form fields, and only act when the viewer is visible.
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

  // === Bug fix: auto-advance when an image fails to load ===
  // When the Pinterest CDN hiccups or a URL is expired, the broken-image
  // icon used to stick on screen until the timer advanced. Now we skip
  // to the next image instead. Guarded so a whole batch of bad URLs
  // can't loop forever.
  const img = document.getElementById('currentImage');
  if (img) {
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE = 5;

    img.addEventListener('load', function () {
      consecutiveFailures = 0;
    });

    img.addEventListener('error', function () {
      // Empty src happens during normal teardown; ignore.
      if (!img.getAttribute('src')) return;
      consecutiveFailures++;
      if (consecutiveFailures > MAX_CONSECUTIVE) return;
      if (typeof nextImage === 'function') {
        setTimeout(nextImage, 250);
      }
    });
  }
})();
