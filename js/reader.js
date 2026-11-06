/**
 * Harry Potter EPUB3 Audio & Read-Along Web Player Engine
 * Faithful playback & synchronization with SMIL Media Overlays
 */

(function () {
  'use strict';

  // --- Global References & State ---
  const data = window.BOOK_DATA;
  if (!data || !data.chapters || data.chapters.length === 0) {
    console.error('BOOK_DATA not found or empty!');
    return;
  }

  const STORAGE_KEY = 'harry_potter_reader_story_pure_v3';

  let state = {
    chapterIndex: 0, // Default to Chapter 1: The Boy Who Lived
    cueIndex: 0,    // Default to Title cue ("Harry Potter and the Sorcerer's Stone")
    isPlaying: false,
    playbackRate: 1.0,
    volume: 1.0,
    muted: false,
    autoScroll: true,
    theme: 'light',
    fontSize: 19,
    fontFamily: 'serif'
  };

  // Restore saved state if exists
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state = Object.assign(state, parsed);
      if (state.chapterIndex < 0 || state.chapterIndex >= data.chapters.length) {
        state.chapterIndex = 0;
        state.cueIndex = 0;
      }
    }
  } catch (e) {
    console.warn('Could not read localStorage:', e);
  }

  // Active runtime variables
  let currentChapter = data.chapters[state.chapterIndex] || data.chapters[0];
  let currentCue = null;
  let currentAudioFile = '';
  let cueMap = new Map(); // id -> cueIndex
  let isSeeking = false;
  let userScrollTimeout = null;
  let isUserScrolling = false;
  let animFrameId = null;

  // Audio Object
  const audio = new Audio();
  audio.preload = 'auto';

  // UI elements
  const elBookText = document.getElementById('book-text');
  const elChapterTitle = document.getElementById('chapter-active-title');
  const elBtnPlayPause = document.getElementById('btn-play-pause');
  const elPlayIcon = document.getElementById('icon-play');
  const elPauseIcon = document.getElementById('icon-pause');
  const elBtnPrevChapter = document.getElementById('btn-prev-chapter');
  const elBtnNextChapter = document.getElementById('btn-next-chapter');
  const elBtnBottomPrev = document.getElementById('btn-bottom-prev');
  const elBtnBottomNext = document.getElementById('btn-bottom-next');
  const elBtnBackward = document.getElementById('btn-backward');
  const elBtnForward = document.getElementById('btn-forward');
  const elSpeedBadge = document.getElementById('speed-badge');
  const elAutoScrollToggle = document.getElementById('autoscroll-toggle');
  const elScrubberTrack = document.getElementById('scrubber-track');
  const elScrubberFill = document.getElementById('scrubber-fill');
  const elScrubberThumb = document.getElementById('scrubber-thumb');
  const elTimeCurrent = document.getElementById('time-current');
  const elTimeDuration = document.getElementById('time-duration');
  const elVolumeSlider = document.getElementById('volume-slider');
  const elBtnMute = document.getElementById('btn-mute');
  const elIconVolume = document.getElementById('icon-volume');
  const elIconMuted = document.getElementById('icon-muted');
  const elBtnToc = document.getElementById('btn-toc');
  const elTocOverlay = document.getElementById('toc-overlay');
  const elTocDrawer = document.getElementById('toc-drawer');
  const elBtnCloseToc = document.getElementById('btn-close-toc');
  const elTocList = document.getElementById('toc-list');
  const elTocSearch = document.getElementById('toc-search');
  const elBtnTheme = document.getElementById('btn-theme');
  const elBtnTextSettings = document.getElementById('btn-text-settings');
  const elBtnHelp = document.getElementById('btn-help');
  const elModalSettings = document.getElementById('modal-settings');
  const elModalHelp = document.getElementById('modal-help');
  const elScrollResumePill = document.getElementById('scroll-resume-pill');

  // --- Utility Functions ---
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        chapterIndex: state.chapterIndex,
        cueIndex: state.cueIndex,
        playbackRate: state.playbackRate,
        volume: state.volume,
        muted: state.muted,
        autoScroll: state.autoScroll,
        theme: state.theme,
        fontSize: state.fontSize,
        fontFamily: state.fontFamily
      }));
    } catch (e) {}
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // --- Themes & Display Settings ---
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    const themeBtn = document.getElementById('theme-name-display');
    if (themeBtn) {
      themeBtn.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
    }
    saveState();
  }

  function applyFontSize(size) {
    state.fontSize = Math.max(14, Math.min(32, size));
    document.documentElement.style.setProperty('--book-font-size', `${state.fontSize}px`);
    const valEl = document.getElementById('font-size-val');
    if (valEl) valEl.textContent = `${state.fontSize}px`;
    saveState();
  }

  function applyFontFamily(family) {
    state.fontFamily = family;
    let fontVal = "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif";
    if (family === 'sans') {
      fontVal = "MiloWeb, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
    }
    document.documentElement.style.setProperty('--font-family-book', fontVal);
    saveState();
  }

  // --- Table of Contents Generation ---
  function renderTOC(filterText = '') {
    if (!elTocList) return;
    elTocList.innerHTML = '';
    const query = filterText.toLowerCase().trim();
    const navItems = data.navigation || [];

    navItems.forEach((item, navIdx) => {
      if (query && !item.title.toLowerCase().includes(query)) {
        return;
      }

      const li = document.createElement('li');
      const isCurrentChapter = (item.chapterIndex === state.chapterIndex);
      li.className = 'toc-item' + (isCurrentChapter ? ' active' : '');
      li.dataset.navIndex = navIdx;

      const left = document.createElement('div');
      left.className = 'toc-item-left';

      const badge = document.createElement('span');
      badge.className = 'toc-num-badge';
      badge.textContent = `${item.number}`;

      const title = document.createElement('span');
      title.className = 'toc-item-text';
      title.textContent = item.title;

      left.appendChild(badge);
      left.appendChild(title);

      const chObj = data.chapters[item.chapterIndex];
      const count = document.createElement('span');
      count.className = 'toc-cues-count';
      count.textContent = chObj ? `${chObj.cues.length} cues` : '';

      li.appendChild(left);
      li.appendChild(count);

      li.addEventListener('click', () => {
        closeTOC();
        loadChapter(item.chapterIndex, 0, true);
      });

      elTocList.appendChild(li);
    });
  }

  function openTOC() {
    if (elTocOverlay && elTocDrawer) {
      elTocOverlay.classList.add('open');
      elTocDrawer.classList.add('open');
      if (elTocSearch) {
        elTocSearch.value = '';
        renderTOC();
        setTimeout(() => elTocSearch.focus(), 150);
      }
    }
  }

  function closeTOC() {
    if (elTocOverlay && elTocDrawer) {
      elTocOverlay.classList.remove('open');
      elTocDrawer.classList.remove('open');
    }
  }

  // --- Audio & Highlighting Engine ---
  function removeHighlight() {
    const activeElements = elBookText.querySelectorAll('.-epub-media-overlay-active, .media-overlay-active, .reading-active');
    activeElements.forEach((el) => {
      el.classList.remove('-epub-media-overlay-active', 'media-overlay-active', 'reading-active');
    });
  }

  function highlightCue(cue) {
    removeHighlight();
    if (!cue || !cue.id) return;

    const targetEl = document.getElementById(cue.id);
    if (targetEl) {
      targetEl.classList.add('-epub-media-overlay-active', 'media-overlay-active', 'reading-active');
      
      // Auto-scroll logic
      if (state.autoScroll && !isUserScrolling) {
        scrollToElementSmoothly(targetEl);
      }
    }
  }

  function scrollToElementSmoothly(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const headerHeight = document.getElementById('player-header') ? document.getElementById('player-header').offsetHeight : 70;
    const viewportHeight = window.innerHeight;

    // If element is already comfortably in view (top 15% to 65%), don't scroll
    const relativeTop = rect.top - headerHeight;
    if (relativeTop >= viewportHeight * 0.15 && relativeTop <= viewportHeight * 0.65) {
      return;
    }

    const targetY = window.scrollY + rect.top - headerHeight - (viewportHeight * 0.25);
    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: 'smooth'
    });
  }

  // Find cue by element ID or closest ancestor/descendant ID
  function findCueIndexForElement(targetEl) {
    let curr = targetEl;
    while (curr && curr !== elBookText) {
      if (curr.id && cueMap.has(curr.id)) {
        return cueMap.get(curr.id);
      }
      curr = curr.parentElement;
    }
    if (targetEl) {
      const childWithId = targetEl.querySelector('[id]');
      if (childWithId && cueMap.has(childWithId.id)) {
        return cueMap.get(childWithId.id);
      }
    }
    return -1;
  }

  // Load and play specific cue
  function playCue(index, startPlaying = true) {
    if (index < 0 || index >= currentChapter.cues.length) return;
    state.cueIndex = index;
    currentCue = currentChapter.cues[index];

    const audioPath = 'audio/' + currentCue.audio;
    const sameAudio = (currentAudioFile === currentCue.audio && audio.src.endsWith(currentCue.audio));

    if (!sameAudio) {
      currentAudioFile = currentCue.audio;
      audio.src = audioPath;
      audio.playbackRate = state.playbackRate;
      audio.volume = state.muted ? 0 : state.volume;

      const onCanPlay = () => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.currentTime = currentCue.begin;
        highlightCue(currentCue);
        if (startPlaying) {
          audio.play().then(() => updatePlayPauseBtn(true)).catch(handleAudioError);
        }
      };
      audio.addEventListener('canplay', onCanPlay);
      audio.load();
    } else {
      audio.currentTime = currentCue.begin;
      highlightCue(currentCue);
      if (startPlaying) {
        audio.play().then(() => updatePlayPauseBtn(true)).catch(handleAudioError);
      }
    }
    saveState();
  }

  function handleAudioError(err) {
    console.warn('Playback error or user gesture required:', err);
    updatePlayPauseBtn(false);
  }

  function updatePlayPauseBtn(isPlaying) {
    state.isPlaying = isPlaying;
    if (isPlaying) {
      elPlayIcon.style.display = 'none';
      elPauseIcon.style.display = 'block';
      elBtnPlayPause.setAttribute('title', 'Pause (Space)');
      startSyncLoop();
    } else {
      elPlayIcon.style.display = 'block';
      elPauseIcon.style.display = 'none';
      elBtnPlayPause.setAttribute('title', 'Play (Space)');
      stopSyncLoop();
    }
  }

  function togglePlayPause() {
    if (audio.paused) {
      if (!audio.src || audio.src === window.location.href) {
        playCue(state.cueIndex, true);
      } else {
        audio.play().then(() => updatePlayPauseBtn(true)).catch(handleAudioError);
      }
    } else {
      audio.pause();
      updatePlayPauseBtn(false);
    }
  }

  // Main high-frequency sync loop
  function startSyncLoop() {
    stopSyncLoop();
    function loop() {
      if (!audio.paused && !audio.seeking && !isSeeking) {
        syncActiveCueWithAudioTime();
        updateScrubberUI();
      }
      animFrameId = requestAnimationFrame(loop);
    }
    animFrameId = requestAnimationFrame(loop);
  }

  function stopSyncLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function syncActiveCueWithAudioTime() {
    const t = audio.currentTime;
    const cues = currentChapter.cues;
    if (!cues || cues.length === 0) return;

    // Fast check: Is currentCue still active?
    if (currentCue && currentCue.audio === currentAudioFile) {
      if (t >= currentCue.begin && t < currentCue.end) {
        return; // Still in current cue!
      }
    }

    // Next check: Did we advance to next cue?
    const nextIdx = state.cueIndex + 1;
    if (nextIdx < cues.length) {
      const nextCue = cues[nextIdx];
      if (nextCue.audio === currentAudioFile && t >= nextCue.begin && t < nextCue.end) {
        state.cueIndex = nextIdx;
        currentCue = nextCue;
        highlightCue(currentCue);
        return;
      }
    }

    // Search for cue matching time `t` in current audio file
    let foundIdx = -1;
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (c.audio === currentAudioFile && t >= c.begin && t < c.end) {
        foundIdx = i;
        break;
      }
    }

    if (foundIdx !== -1) {
      state.cueIndex = foundIdx;
      currentCue = cues[foundIdx];
      highlightCue(currentCue);
    } else {
      // Check if we passed the end of the last cue of this audio file
      if (currentCue && t >= currentCue.end) {
        if (nextIdx < cues.length) {
          const upcoming = cues[nextIdx];
          if (upcoming.audio !== currentAudioFile) {
            console.log('Transitioning to next audio file in chapter:', upcoming.audio);
            playCue(nextIdx, true);
          }
        }
      }
    }
  }

  function updateScrubberUI() {
    const cur = audio.currentTime || 0;
    const dur = audio.duration || 1;
    const pct = Math.max(0, Math.min(100, (cur / dur) * 100));

    if (elScrubberFill) elScrubberFill.style.width = `${pct}%`;
    if (elScrubberThumb) elScrubberThumb.style.left = `${pct}%`;
    if (elTimeCurrent) elTimeCurrent.textContent = formatTime(cur);
    if (elTimeDuration) elTimeDuration.textContent = formatTime(dur);
  }

  // --- Chapter Navigation ---
  function loadChapter(chapterIndex, targetCueIndex = 0, autoPlay = false) {
    if (chapterIndex < 0 || chapterIndex >= data.chapters.length) return;

    state.chapterIndex = chapterIndex;
    currentChapter = data.chapters[chapterIndex];

    // Build fast lookup map
    cueMap.clear();
    currentChapter.cues.forEach((c, idx) => {
      if (c.id) cueMap.set(c.id, idx);
    });

    // Render HTML content
    elBookText.innerHTML = currentChapter.html;

    // Update Header Badge & Titles
    if (elChapterTitle) elChapterTitle.textContent = currentChapter.title;
    document.title = `${currentChapter.title} — Harry Potter Reader`;

    // Update navigation button states
    const hasPrev = chapterIndex > 0;
    const hasNext = chapterIndex < data.chapters.length - 1;
    if (elBtnPrevChapter) elBtnPrevChapter.disabled = !hasPrev;
    if (elBtnNextChapter) elBtnNextChapter.disabled = !hasNext;
    if (elBtnBottomPrev) {
      elBtnBottomPrev.style.display = hasPrev ? 'inline-flex' : 'none';
      if (hasPrev) elBtnBottomPrev.innerHTML = `&larr; ${data.chapters[chapterIndex - 1].title}`;
    }
    if (elBtnBottomNext) {
      elBtnBottomNext.style.display = hasNext ? 'inline-flex' : 'none';
      if (hasNext) elBtnBottomNext.innerHTML = `${data.chapters[chapterIndex + 1].title} &rarr;`;
    }

    // Highlight active chapter in TOC
    renderTOC();

    // Cue audio
    const initialCue = targetCueIndex >= 0 && targetCueIndex < currentChapter.cues.length ? targetCueIndex : 0;
    playCue(initialCue, autoPlay);

    // Scroll to target element or top
    if (initialCue > 0 && currentChapter.cues[initialCue]) {
      setTimeout(() => {
        const el = document.getElementById(currentChapter.cues[initialCue].id);
        if (el) scrollToElementSmoothly(el);
      }, 50);
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    saveState();
  }

  function nextChapter() {
    if (state.chapterIndex < data.chapters.length - 1) {
      loadChapter(state.chapterIndex + 1, 0, true);
    }
  }

  function prevChapter() {
    if (audio.currentTime > 5) {
      audio.currentTime = 0;
    } else if (state.chapterIndex > 0) {
      loadChapter(state.chapterIndex - 1, 0, true);
    }
  }

  // --- Audio Event Listeners ---
  audio.addEventListener('ended', () => {
    console.log('Audio file ended:', currentAudioFile);
    const nextIdx = state.cueIndex + 1;
    if (nextIdx < currentChapter.cues.length) {
      playCue(nextIdx, true);
    } else {
      console.log('Chapter finished! Advancing to next chapter.');
      nextChapter();
    }
  });

  audio.addEventListener('pause', () => updatePlayPauseBtn(false));
  audio.addEventListener('play', () => updatePlayPauseBtn(true));
  audio.addEventListener('loadedmetadata', updateScrubberUI);

  // --- UI Event Listeners ---
  // Click on sentence to jump audio
  elBookText.addEventListener('click', (e) => {
    const cueIdx = findCueIndexForElement(e.target);
    if (cueIdx !== -1) {
      playCue(cueIdx, true);
    }
  });

  // Play / Pause
  if (elBtnPlayPause) elBtnPlayPause.addEventListener('click', togglePlayPause);

  // Next / Prev Chapter
  if (elBtnNextChapter) elBtnNextChapter.addEventListener('click', nextChapter);
  if (elBtnPrevChapter) elBtnPrevChapter.addEventListener('click', prevChapter);
  if (elBtnBottomNext) elBtnBottomNext.addEventListener('click', nextChapter);
  if (elBtnBottomPrev) elBtnBottomPrev.addEventListener('click', prevChapter);

  // Skip -15s / +15s
  if (elBtnBackward) {
    elBtnBackward.addEventListener('click', () => {
      audio.currentTime = Math.max(0, audio.currentTime - 15);
      syncActiveCueWithAudioTime();
    });
  }
  if (elBtnForward) {
    elBtnForward.addEventListener('click', () => {
      audio.currentTime = Math.min(audio.duration || 99999, audio.currentTime + 15);
      syncActiveCueWithAudioTime();
    });
  }

  // Playback Speed Controls
  const speeds = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  function setPlaybackSpeed(speed) {
    state.playbackRate = speed;
    audio.playbackRate = speed;
    if (elSpeedBadge) elSpeedBadge.textContent = `${speed}x`;
    document.querySelectorAll('.btn-modal-speed').forEach((btn) => {
      if (parseFloat(btn.dataset.speed) === speed) {
        btn.style.background = 'var(--accent-color)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--accent-color)';
      } else {
        btn.style.background = 'var(--bg-color)';
        btn.style.color = 'var(--text-color)';
        btn.style.borderColor = 'var(--panel-border)';
      }
    });
    saveState();
  }

  if (elSpeedBadge) {
    elSpeedBadge.addEventListener('click', () => {
      let currIdx = speeds.indexOf(state.playbackRate);
      if (currIdx === -1) currIdx = 1;
      const nextSpeed = speeds[(currIdx + 1) % speeds.length];
      setPlaybackSpeed(nextSpeed);
    });
  }

  document.querySelectorAll('.btn-modal-speed').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const spd = parseFloat(e.currentTarget.dataset.speed);
      if (!isNaN(spd)) setPlaybackSpeed(spd);
    });
  });

  // Auto-Scroll Toggle
  function updateAutoScrollButton() {
    if (elAutoScrollToggle) {
      if (state.autoScroll) {
        elAutoScrollToggle.classList.add('active');
        elAutoScrollToggle.setAttribute('title', 'Auto-scroll is ON (press A to toggle)');
      } else {
        elAutoScrollToggle.classList.remove('active');
        elAutoScrollToggle.setAttribute('title', 'Auto-scroll is OFF (press A to toggle)');
      }
    }
  }
  if (elAutoScrollToggle) {
    elAutoScrollToggle.addEventListener('click', () => {
      state.autoScroll = !state.autoScroll;
      updateAutoScrollButton();
      if (state.autoScroll && currentCue) {
        const el = document.getElementById(currentCue.id);
        if (el) scrollToElementSmoothly(el);
      }
      saveState();
    });
  }

  // Detect manual user scrolling to temporarily pause auto-scroll
  window.addEventListener('wheel', () => {
    isUserScrolling = true;
    if (elScrollResumePill) elScrollResumePill.classList.add('show');
    clearTimeout(userScrollTimeout);
    userScrollTimeout = setTimeout(() => {
      isUserScrolling = false;
      if (elScrollResumePill) elScrollResumePill.classList.remove('show');
    }, 4000);
  }, { passive: true });

  window.addEventListener('touchmove', () => {
    isUserScrolling = true;
    if (elScrollResumePill) elScrollResumePill.classList.add('show');
    clearTimeout(userScrollTimeout);
    userScrollTimeout = setTimeout(() => {
      isUserScrolling = false;
      if (elScrollResumePill) elScrollResumePill.classList.remove('show');
    }, 4000);
  }, { passive: true });

  if (elScrollResumePill) {
    elScrollResumePill.addEventListener('click', () => {
      isUserScrolling = false;
      elScrollResumePill.classList.remove('show');
      if (currentCue) {
        const el = document.getElementById(currentCue.id);
        if (el) scrollToElementSmoothly(el);
      }
    });
  }

  // Scrubber Seeking
  function seekFromEvent(e) {
    if (!elScrubberTrack || !audio.duration) return;
    const rect = elScrubberTrack.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pos * audio.duration;
    syncActiveCueWithAudioTime();
    updateScrubberUI();
  }

  if (elScrubberTrack) {
    elScrubberTrack.addEventListener('mousedown', (e) => {
      isSeeking = true;
      seekFromEvent(e);
      const onMouseMove = (ev) => seekFromEvent(ev);
      const onMouseUp = () => {
        isSeeking = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // Volume & Mute
  if (elVolumeSlider) {
    elVolumeSlider.value = state.volume;
    elVolumeSlider.addEventListener('input', (e) => {
      state.volume = parseFloat(e.target.value);
      state.muted = (state.volume === 0);
      audio.volume = state.volume;
      updateVolumeIcons();
      saveState();
    });
  }

  function updateVolumeIcons() {
    if (state.muted || state.volume === 0) {
      if (elIconVolume) elIconVolume.style.display = 'none';
      if (elIconMuted) elIconMuted.style.display = 'block';
    } else {
      if (elIconVolume) elIconVolume.style.display = 'block';
      if (elIconMuted) elIconMuted.style.display = 'none';
    }
  }

  if (elBtnMute) {
    elBtnMute.addEventListener('click', () => {
      state.muted = !state.muted;
      audio.volume = state.muted ? 0 : state.volume;
      if (elVolumeSlider) elVolumeSlider.value = state.muted ? 0 : state.volume;
      updateVolumeIcons();
      saveState();
    });
  }

  // TOC drawer interactions
  if (elBtnToc) elBtnToc.addEventListener('click', openTOC);
  if (elBtnCloseToc) elBtnCloseToc.addEventListener('click', closeTOC);
  if (elTocOverlay) elTocOverlay.addEventListener('click', closeTOC);
  if (elTocSearch) {
    elTocSearch.addEventListener('input', (e) => {
      renderTOC(e.target.value);
    });
  }

  // Theme Cycling
  const themes = ['light', 'sepia', 'dark', 'midnight'];
  if (elBtnTheme) {
    elBtnTheme.addEventListener('click', () => {
      let idx = themes.indexOf(state.theme);
      if (idx === -1) idx = 0;
      const next = themes[(idx + 1) % themes.length];
      applyTheme(next);
    });
  }

  // Font Size Buttons
  const btnFontSmaller = document.getElementById('btn-font-smaller');
  const btnFontBigger = document.getElementById('btn-font-bigger');
  if (btnFontSmaller) btnFontSmaller.addEventListener('click', () => applyFontSize(state.fontSize - 1));
  if (btnFontBigger) btnFontBigger.addEventListener('click', () => applyFontSize(state.fontSize + 1));

  // Font Family Switcher
  const btnFontSerif = document.getElementById('btn-font-serif');
  const btnFontSans = document.getElementById('btn-font-sans');
  if (btnFontSerif) btnFontSerif.addEventListener('click', () => applyFontFamily('serif'));
  if (btnFontSans) btnFontSans.addEventListener('click', () => applyFontFamily('sans'));

  // Modals
  function openModal(modal) {
    if (modal) modal.classList.add('open');
  }
  function closeModal(modal) {
    if (modal) modal.classList.remove('open');
  }
  if (elBtnTextSettings) elBtnTextSettings.addEventListener('click', () => openModal(elModalSettings));
  if (elBtnHelp) elBtnHelp.addEventListener('click', () => openModal(elModalHelp));

  document.querySelectorAll('.btn-close-modal').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal(elModalSettings);
      closeModal(elModalHelp);
    });
  });
  document.querySelectorAll('.modal-overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeModal(ov);
    });
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') {
      if (e.key === 'Escape') closeTOC();
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - 15);
        syncActiveCueWithAudioTime();
        break;
      case 'ArrowRight':
        e.preventDefault();
        audio.currentTime = Math.min(audio.duration || 99999, audio.currentTime + 15);
        syncActiveCueWithAudioTime();
        break;
      case '[':
        prevChapter();
        break;
      case ']':
        nextChapter();
        break;
      case 't':
      case 'T':
        if (elTocDrawer && elTocDrawer.classList.contains('open')) closeTOC();
        else openTOC();
        break;
      case 'a':
      case 'A':
        state.autoScroll = !state.autoScroll;
        updateAutoScrollButton();
        break;
      case 'm':
      case 'M':
        state.muted = !state.muted;
        audio.volume = state.muted ? 0 : state.volume;
        updateVolumeIcons();
        break;
      case '?':
        openModal(elModalHelp);
        break;
      case 'Escape':
        closeTOC();
        closeModal(elModalSettings);
        closeModal(elModalHelp);
        break;
    }
  });

  // --- Initial Bootstrap ---
  function init() {
    applyTheme(state.theme);
    applyFontSize(state.fontSize);
    applyFontFamily(state.fontFamily);
    setPlaybackSpeed(state.playbackRate);
    updateAutoScrollButton();
    updateVolumeIcons();
    if (elSpeedBadge) elSpeedBadge.textContent = `${state.playbackRate}x`;
    if (elVolumeSlider) elVolumeSlider.value = state.volume;

    renderTOC();
    loadChapter(state.chapterIndex, state.cueIndex, false);
    console.log('Harry Potter EPUB3 Audio Player initialized successfully.');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
