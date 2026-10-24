/**
 * ElectroQuiz Pro — Fullstack-Grade Application Engine
 * Handles:
 *  - Complete 1,153 PDF Question Bank & Verified Answer Key
 *  - 3 Core Modes: 200 Question Quiz, 500 Question Quiz, Complete 1,153 PDF Quiz (+ Custom Mistake/Bookmark Quizzes)
 *  - Instant Green & Red Highlighted Tile Boxes after every question answered
 *  - Resilient Browser Cache (localStorage with schema validation, cross-tab sync, backup/restore)
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'ELECTROQUIZ_PRO_CACHE_V1';
  const LETTERS = ['A', 'B', 'C', 'D'];

  // Verify dataset is loaded
  const ALL_QUESTIONS = Array.isArray(window.QUIZ_QUESTIONS) ? window.QUIZ_QUESTIONS : [];
  const QUESTION_BY_ID = new Map();
  ALL_QUESTIONS.forEach((q) => QUESTION_BY_ID.set(q.id, q));

  // Default State Schema
  function createDefaultState() {
    return {
      version: 1,
      lastSavedAt: Date.now(),
      activeNav: 'home',
      lastActiveMode: '200',
      settings: {
        theme: 'dark',
        autoAdvance: false,
        range200: '1-200',
        range500: '1-500',
        range1153: '1-1153'
      },
      // Global per-question history across all sessions: { [qId]: 'correct' | 'wrong' }
      globalHistory: {},
      bookmarks: [], // array of question IDs
      mistakes: [],  // array of question IDs
      sessions: {
        '200': createSessionObject('200', '1-200'),
        '500': createSessionObject('500', '1-500'),
        '1153': createSessionObject('1153', '1-1153'),
        'custom': null
      }
    };
  }

  function buildQuestionIdsForMode(modeKey, rangeSpec) {
    const total = ALL_QUESTIONS.length;
    if (total === 0) return [];

    if (rangeSpec === 'random') {
      const pool = ALL_QUESTIONS.map((q) => q.id);
      // Fisher-Yates shuffle
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = pool[i];
        pool[i] = pool[j];
        pool[j] = tmp;
      }
      const count = modeKey === '200' ? 200 : modeKey === '500' ? 500 : total;
      return pool.slice(0, Math.min(count, total));
    }

    // Parse "start-end"
    const parts = String(rangeSpec).split('-').map((n) => parseInt(n, 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const start = Math.max(1, parts[0]);
      const end = Math.min(total, parts[1]);
      const list = [];
      for (let id = start; id <= end; id++) {
        if (QUESTION_BY_ID.has(id)) list.push(id);
      }
      return list;
    }

    // Fallback
    const fallbackCount = modeKey === '200' ? 200 : modeKey === '500' ? 500 : total;
    return ALL_QUESTIONS.slice(0, fallbackCount).map((q) => q.id);
  }

  function createSessionObject(modeKey, rangeSpec, customIds, customTitle) {
    const qIds = customIds || buildQuestionIdsForMode(modeKey, rangeSpec);
    return {
      modeKey,
      title: customTitle || (modeKey === '200' ? '200 Question Quiz' : modeKey === '500' ? '500 Question Quiz' : 'Complete PDF Quiz (1,153 Qs)'),
      rangeSpec: rangeSpec || 'default',
      questionIds: qIds,
      currentIndex: 0,
      answers: {}, // { [qId]: selectedOptionIndex (0..3) }
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  // Load & Validate State from Cache
  let state = loadStateFromCache();
  let currentPaletteFilter = 'all';
  let explorerPage = 1;
  const EXPLORER_PAGE_SIZE = 30;
  let autoAdvanceTimer = null;

  function loadStateFromCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return createDefaultState();

      const def = createDefaultState();
      const merged = {
        ...def,
        ...parsed,
        settings: { ...def.settings, ...(parsed.settings || {}) },
        globalHistory: parsed.globalHistory && typeof parsed.globalHistory === 'object' ? parsed.globalHistory : {},
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks.filter((id) => QUESTION_BY_ID.has(id)) : [],
        mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes.filter((id) => QUESTION_BY_ID.has(id)) : [],
        sessions: { ...def.sessions, ...(parsed.sessions || {}) }
      };

      // Validate each standard session has valid questionIds
      ['200', '500', '1153'].forEach((m) => {
        const s = merged.sessions[m];
        if (!s || !Array.isArray(s.questionIds) || s.questionIds.length === 0) {
          merged.sessions[m] = createSessionObject(m, merged.settings['range' + m]);
        } else {
          s.questionIds = s.questionIds.filter((id) => QUESTION_BY_ID.has(id));
          if (typeof s.currentIndex !== 'number' || s.currentIndex < 0 || s.currentIndex >= s.questionIds.length) {
            s.currentIndex = 0;
          }
          if (!s.answers || typeof s.answers !== 'object') {
            s.answers = {};
          }
        }
      });

      return merged;
    } catch (err) {
      console.warn('Cache recovery triggered due to corrupted localStorage:', err);
      return createDefaultState();
    }
  }

  function saveStateToCache() {
    try {
      state.lastSavedAt = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const el = document.getElementById('sidebarLastSaved');
      if (el) {
        const d = new Date(state.lastSavedAt);
        el.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    } catch (err) {
      console.error('Failed to write to localStorage cache:', err);
      showToast('Warning: Browser storage is full or restricted.');
    }
  }

  // Toast helper
  function showToast(msg) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 250);
    }, 2600);
  }

  // Escape HTML safely while preserving unicode overbars and math symbols
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Calculate Session Stats
  function getSessionStats(session) {
    if (!session || !Array.isArray(session.questionIds)) {
      return { total: 0, answered: 0, correct: 0, wrong: 0, remaining: 0, accuracy: 0 };
    }
    const total = session.questionIds.length;
    let answered = 0;
    let correct = 0;
    let wrong = 0;

    for (const qId of session.questionIds) {
      if (Object.prototype.hasOwnProperty.call(session.answers, qId)) {
        answered++;
        const chosen = session.answers[qId];
        const qObj = QUESTION_BY_ID.get(qId);
        if (qObj && chosen === qObj.answer) {
          correct++;
        } else {
          wrong++;
        }
      }
    }

    const remaining = Math.max(0, total - answered);
    const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
    return { total, answered, correct, wrong, remaining, accuracy };
  }

  // Update Sidebar Badges & Home Dashboard Cards
  function updateAllSummaries() {
    ['200', '500', '1153'].forEach((m) => {
      const s = state.sessions[m];
      const st = getSessionStats(s);

      // Sidebar badge
      const navBadge = document.getElementById('navBadge' + m);
      if (navBadge) {
        navBadge.textContent = `${st.answered}/${st.total}`;
        navBadge.classList.toggle('live', st.answered > 0);
      }

      // Card elements on Home page
      const progText = document.getElementById('cardProgText' + m);
      const accText = document.getElementById('cardAccText' + m);
      const barCorrect = document.getElementById('cardBarCorrect' + m);
      const barWrong = document.getElementById('cardBarWrong' + m);
      const cCorrect = document.getElementById('cardCorrect' + m);
      const cWrong = document.getElementById('cardWrong' + m);
      const cRem = document.getElementById('cardRem' + m);
      const cStatus = document.getElementById('cardStatus' + m);
      const btnLabel = document.getElementById('btnLaunchLabel' + m);

      if (progText) progText.textContent = `${st.answered} / ${st.total} Answered`;
      if (accText) accText.textContent = `${st.accuracy}% Accuracy`;
      if (barCorrect) barCorrect.style.width = st.total > 0 ? `${(st.correct / st.total) * 100}%` : '0%';
      if (barWrong) barWrong.style.width = st.total > 0 ? `${(st.wrong / st.total) * 100}%` : '0%';
      if (cCorrect) cCorrect.textContent = st.correct;
      if (cWrong) cWrong.textContent = st.wrong;
      if (cRem) cRem.textContent = st.remaining;

      if (cStatus) {
        if (st.answered === 0) cStatus.textContent = 'Ready';
        else if (st.answered >= st.total) cStatus.textContent = 'Completed';
        else cStatus.textContent = `In Progress (#${s.currentIndex + 1})`;
      }

      if (btnLabel) {
        if (st.answered > 0 && st.answered < st.total) {
          btnLabel.textContent = `Resume (${st.answered}/${st.total}) →`;
        } else if (st.answered >= st.total) {
          btnLabel.textContent = `Review Completed Quiz`;
        } else {
          btnLabel.textContent = m === '1153' ? 'Start Complete PDF Quiz' : `Start ${m} Question Quiz`;
        }
      }
    });

    // Update Mistakes & Bookmarks Badges
    const mBadge = document.getElementById('navBadgeMistakes');
    const bBadge = document.getElementById('navBadgeBookmarks');
    if (mBadge) mBadge.textContent = state.mistakes.length;
    if (bBadge) bBadge.textContent = state.bookmarks.length;

    // Update Global Home Stats
    const historyKeys = Object.keys(state.globalHistory);
    let masteredCount = 0;
    historyKeys.forEach((k) => {
      if (state.globalHistory[k] === 'correct') masteredCount++;
    });
    const totalAnsweredGlobal = historyKeys.length;
    const globalAcc = totalAnsweredGlobal > 0 ? Math.round((masteredCount / totalAnsweredGlobal) * 100) : 0;

    const elMastered = document.getElementById('homeStatMastered');
    const elMasteredSub = document.getElementById('homeStatMasteredSub');
    const elAcc = document.getElementById('homeStatAccuracy');
    const elAccSub = document.getElementById('homeStatAnsweredSub');
    const elRev = document.getElementById('homeStatReviewCount');
    const elRevSub = document.getElementById('homeStatReviewSub');

    if (elMastered) elMastered.textContent = masteredCount.toLocaleString();
    if (elMasteredSub) elMasteredSub.textContent = `${((masteredCount / ALL_QUESTIONS.length) * 100).toFixed(1)}% of entire 1,153 PDF bank`;
    if (elAcc) elAcc.textContent = `${globalAcc}%`;
    if (elAccSub) elAccSub.textContent = `${totalAnsweredGlobal.toLocaleString()} unique PDF questions attempted`;
    if (elRev) elRev.textContent = (state.mistakes.length + state.bookmarks.length).toLocaleString();
    if (elRevSub) elRevSub.textContent = `${state.mistakes.length} mistakes • ${state.bookmarks.length} bookmarked`;
  }

  // Navigation & View Switching
  function navigateTo(navTarget) {
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }

    state.activeNav = navTarget;

    // Close mobile sidebar if open
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');

    // Update active state on sidebar buttons
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === navTarget);
    });

    // Hide all views
    document.querySelectorAll('.view-section').forEach((sec) => sec.classList.remove('active'));

    const topbarTitle = document.getElementById('topbarTitle');

    if (navTarget === 'home') {
      document.getElementById('view-home')?.classList.add('active');
      if (topbarTitle) topbarTitle.textContent = 'Home Dashboard';
      updateAllSummaries();
    } else if (navTarget === 'quiz-200' || navTarget === 'quiz-500' || navTarget === 'quiz-1153' || navTarget === 'quiz-custom') {
      const modeKey = navTarget.replace('quiz-', '');
      state.lastActiveMode = modeKey;
      document.getElementById('view-quiz')?.classList.add('active');
      const session = getActiveSession();
      if (topbarTitle) topbarTitle.textContent = session.title;
      renderActiveQuizQuestion();
      renderQuestionPalette();
    } else if (navTarget === 'mistakes') {
      document.getElementById('view-collection')?.classList.add('active');
      if (topbarTitle) topbarTitle.textContent = 'Mistake Deck (Red Tile Review)';
      renderCollectionView('mistakes');
    } else if (navTarget === 'bookmarks') {
      document.getElementById('view-collection')?.classList.add('active');
      if (topbarTitle) topbarTitle.textContent = 'Bookmarked Questions';
      renderCollectionView('bookmarks');
    } else if (navTarget === 'explorer') {
      document.getElementById('view-explorer')?.classList.add('active');
      if (topbarTitle) topbarTitle.textContent = 'Complete 1,153 PDF Question Bank Explorer';
      renderExplorerView();
    } else if (navTarget === 'cache') {
      document.getElementById('view-cache')?.classList.add('active');
      if (topbarTitle) topbarTitle.textContent = 'Cache & Progress Manager';
    }

    saveStateToCache();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getActiveSession() {
    const modeKey = state.lastActiveMode || '200';
    if (modeKey === 'custom' && state.sessions.custom && state.sessions.custom.questionIds.length > 0) {
      return state.sessions.custom;
    }
    return state.sessions[modeKey] || state.sessions['200'];
  }

  // Render the Active Quiz Question & Green/Red Option Tile Boxes
  function renderActiveQuizQuestion() {
    const session = getActiveSession();
    if (!session || session.questionIds.length === 0) return;

    const total = session.questionIds.length;
    if (session.currentIndex < 0) session.currentIndex = 0;
    if (session.currentIndex >= total) session.currentIndex = total - 1;

    const qId = session.questionIds[session.currentIndex];
    const qObj = QUESTION_BY_ID.get(qId);
    if (!qObj) return;

    const st = getSessionStats(session);

    // Top badges
    document.getElementById('quizStepBadge').textContent = `Question ${session.currentIndex + 1} of ${total}`;
    document.getElementById('quizPdfIdBadge').textContent = `PDF Q#${qObj.id} • Page ${qObj.page}`;
    document.getElementById('quizCategoryBadge').textContent = qObj.category;

    // Live score strip
    document.getElementById('quizLiveCorrect').textContent = st.correct;
    document.getElementById('quizLiveWrong').textContent = st.wrong;
    document.getElementById('quizLivePercent').textContent = `${st.accuracy}% Accuracy`;
    document.getElementById('sessionWrongCountBtn').textContent = st.wrong;

    // Question stem
    document.getElementById('quizQuestionText').textContent = `${qObj.id}. ${qObj.question}`;

    // Check if already answered in this session
    const hasAnswered = Object.prototype.hasOwnProperty.call(session.answers, qId);
    const selectedIndex = hasAnswered ? session.answers[qId] : null;
    const correctIndex = qObj.answer;

    // Build Option Tile Boxes
    const optionsGrid = document.getElementById('quizOptionsGrid');
    optionsGrid.innerHTML = '';

    qObj.options.forEach((optText, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-tile';

      let badgeHtml = '';

      if (hasAnswered) {
        btn.classList.add('locked');
        if (idx === correctIndex) {
          // Always highlight the right answer in a GREEN tile box
          btn.classList.add('tile-correct');
          badgeHtml = `<span class="option-status-badge">✓ Correct Answer</span>`;
        } else if (idx === selectedIndex && selectedIndex !== correctIndex) {
          // Highlight the user's wrong choice in a RED tile box
          btn.classList.add('tile-wrong');
          badgeHtml = `<span class="option-status-badge">✗ Your Choice</span>`;
        } else {
          btn.classList.add('tile-dimmed');
        }
      }

      btn.innerHTML = `
        <div class="option-tile-left">
          <span class="option-letter">${LETTERS[idx]}</span>
          <span class="option-text">${escapeHtml(optText)}</span>
        </div>
        ${badgeHtml}
      `;

      btn.addEventListener('click', () => handleSelectOption(idx));
      optionsGrid.appendChild(btn);
    });

    // Instant Feedback Banner
    const banner = document.getElementById('quizFeedbackBanner');
    const bannerMsg = document.getElementById('quizFeedbackMessage');
    const bannerRight = document.getElementById('quizFeedbackRight');

    if (hasAnswered) {
      const isCorrect = selectedIndex === correctIndex;
      banner.className = `feedback-banner show ${isCorrect ? 'correct-banner' : 'wrong-banner'}`;
      if (isCorrect) {
        bannerMsg.innerHTML = `<strong>Spot On!</strong> You selected Option <strong>${LETTERS[correctIndex]}</strong> (${escapeHtml(qObj.options[correctIndex])}).${qObj.note ? ' <br><small>' + escapeHtml(qObj.note) + '</small>' : ''}`;
        bannerRight.textContent = '+1 Correct (Green Tile)';
      } else {
        bannerMsg.innerHTML = `<strong>Incorrect.</strong> You chose Option <strong>${LETTERS[selectedIndex]}</strong>, but the correct answer is Option <strong>${LETTERS[correctIndex]}</strong>: <em>${escapeHtml(qObj.options[correctIndex])}</em>.${qObj.note ? ' <br><small>' + escapeHtml(qObj.note) + '</small>' : ''}`;
        bannerRight.textContent = 'Added to Mistake Deck';
      }
    } else {
      banner.className = 'feedback-banner';
      bannerMsg.textContent = '';
      bannerRight.textContent = '';
    }

    // Bookmark button state
    const isBookmarked = state.bookmarks.includes(qId);
    const bmBtn = document.getElementById('quizBookmarkBtn');
    const bmLabel = document.getElementById('quizBookmarkLabel');
    if (bmBtn && bmLabel) {
      bmBtn.classList.toggle('active', isBookmarked);
      bmLabel.textContent = isBookmarked ? '★ Bookmarked' : '☆ Bookmark';
    }

    // Previous / Next button states
    document.getElementById('quizPrevBtn').disabled = session.currentIndex === 0;
    document.getElementById('quizNextBtn').textContent = session.currentIndex === total - 1 ? 'Finish / First →' : 'Next Question →';

    // Update current highlight in palette without full rebuild if possible
    highlightCurrentTileInPalette();
  }

  function handleSelectOption(optionIdx) {
    const session = getActiveSession();
    if (!session) return;
    const qId = session.questionIds[session.currentIndex];
    const qObj = QUESTION_BY_ID.get(qId);
    if (!qObj) return;

    // Prevent accidental double-answering unless user clicks "Retry Question"
    if (Object.prototype.hasOwnProperty.call(session.answers, qId)) {
      return;
    }

    session.answers[qId] = optionIdx;
    session.updatedAt = Date.now();

    const isCorrect = optionIdx === qObj.answer;
    state.globalHistory[qId] = isCorrect ? 'correct' : 'wrong';

    if (!isCorrect) {
      if (!state.mistakes.includes(qId)) {
        state.mistakes.push(qId);
      }
    } else {
      // If user got it right, remove from mistake deck if present
      const mIdx = state.mistakes.indexOf(qId);
      if (mIdx !== -1) state.mistakes.splice(mIdx, 1);
    }

    saveStateToCache();
    updateAllSummaries();
    renderActiveQuizQuestion();
    renderQuestionPalette();

    if (state.settings.autoAdvance && session.currentIndex < session.questionIds.length - 1) {
      if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = setTimeout(() => {
        session.currentIndex++;
        saveStateToCache();
        renderActiveQuizQuestion();
      }, 1150);
    }
  }

  // Question Navigator Palette
  function renderQuestionPalette() {
    const session = getActiveSession();
    const grid = document.getElementById('paletteGrid');
    const summary = document.getElementById('paletteSummaryText');
    if (!session || !grid) return;

    const st = getSessionStats(session);
    if (summary) summary.textContent = `${st.answered}/${st.total} Done`;

    grid.innerHTML = '';
    const frag = document.createDocumentFragment();

    session.questionIds.forEach((qId, idx) => {
      const hasAnswered = Object.prototype.hasOwnProperty.call(session.answers, qId);
      const qObj = QUESTION_BY_ID.get(qId);
      const isCorrect = hasAnswered && qObj && session.answers[qId] === qObj.answer;
      const isWrong = hasAnswered && !isCorrect;
      const isBookmarked = state.bookmarks.includes(qId);

      // Apply palette filter
      if (currentPaletteFilter === 'unanswered' && hasAnswered) return;
      if (currentPaletteFilter === 'correct' && !isCorrect) return;
      if (currentPaletteFilter === 'wrong' && !isWrong) return;
      if (currentPaletteFilter === 'bookmarked' && !isBookmarked) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'p-tile';
      btn.setAttribute('data-step-idx', idx);
      btn.title = `Step ${idx + 1} (PDF Q#${qId})`;
      btn.textContent = idx + 1;

      if (idx === session.currentIndex) btn.classList.add('current');
      if (isCorrect) btn.classList.add('answered-correct');
      if (isWrong) btn.classList.add('answered-wrong');
      if (isBookmarked) btn.classList.add('bookmarked');

      btn.addEventListener('click', () => {
        session.currentIndex = idx;
        saveStateToCache();
        renderActiveQuizQuestion();
      });

      frag.appendChild(btn);
    });

    grid.appendChild(frag);
    highlightCurrentTileInPalette();
  }

  function highlightCurrentTileInPalette() {
    const session = getActiveSession();
    const grid = document.getElementById('paletteGrid');
    if (!session || !grid) return;

    let activeTile = null;
    grid.querySelectorAll('.p-tile').forEach((btn) => {
      const idx = parseInt(btn.getAttribute('data-step-idx'), 10);
      const isCurrent = idx === session.currentIndex;
      btn.classList.toggle('current', isCurrent);
      if (isCurrent) activeTile = btn;
    });

    if (activeTile) {
      activeTile.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  // Render Mistake Deck or Bookmarks View
  function renderCollectionView(type) {
    const isMistakes = type === 'mistakes';
    const listIds = isMistakes ? state.mistakes : state.bookmarks;

    document.getElementById('collectionTitle').textContent = isMistakes
      ? `Mistake Deck (${listIds.length})`
      : `Bookmarked Questions (${listIds.length})`;

    document.getElementById('collectionSubtitle').textContent = isMistakes
      ? 'Questions you answered in Red are automatically cached here so you can practice and turn them Green.'
      : 'Questions you flagged with ★ during your quiz sessions for quick revision.';

    const startBtn = document.getElementById('collectionStartQuizBtn');
    const clearBtn = document.getElementById('collectionClearBtn');

    startBtn.disabled = listIds.length === 0;
    clearBtn.disabled = listIds.length === 0;

    startBtn.onclick = () => {
      if (listIds.length === 0) return;
      state.sessions.custom = createSessionObject(
        'custom',
        'custom',
        [...listIds],
        isMistakes ? `Mistake Deck Quiz (${listIds.length} Qs)` : `Bookmarked Quiz (${listIds.length} Qs)`
      );
      navigateTo('quiz-custom');
    };

    clearBtn.onclick = () => {
      if (!confirm(`Are you sure you want to clear all ${listIds.length} items from this list?`)) return;
      if (isMistakes) state.mistakes = [];
      else state.bookmarks = [];
      saveStateToCache();
      updateAllSummaries();
      renderCollectionView(type);
      showToast('List cleared.');
    };

    const container = document.getElementById('collectionList');
    container.innerHTML = '';

    if (listIds.length === 0) {
      container.innerHTML = `
        <div class="bank-item-card" style="text-align:center; padding:42px;">
          <h3 style="margin-bottom:8px;">${isMistakes ? 'Zero Mistakes in Queue!' : 'No Bookmarked Questions Yet'}</h3>
          <p style="color:var(--text-secondary); font-size:0.9rem;">
            ${isMistakes ? 'Any question you answer wrong in the 200, 500, or 1,153 PDF quiz will automatically appear here.' : 'Click the ☆ Bookmark button (or press F) on any question during a quiz to save it here.'}
          </p>
        </div>
      `;
      return;
    }

    const frag = document.createDocumentFragment();
    listIds.forEach((qId) => {
      const qObj = QUESTION_BY_ID.get(qId);
      if (!qObj) return;
      frag.appendChild(createQuestionBankCard(qObj, true));
    });
    container.appendChild(frag);
  }

  // Create a card for Explorer / Collection views
  function createQuestionBankCard(qObj, showAnswers) {
    const card = document.createElement('div');
    card.className = 'bank-item-card';

    const status = state.globalHistory[qObj.id];
    const isBookmarked = state.bookmarks.includes(qObj.id);

    let statusPill = '';
    if (status === 'correct') {
      statusPill = `<span class="score-pill correct">✓ Mastered (Green)</span>`;
    } else if (status === 'wrong') {
      statusPill = `<span class="score-pill wrong">✗ Mistake (Red)</span>`;
    }

    const optsHtml = qObj.options
      .map((opt, idx) => {
        const isCorrect = idx === qObj.answer;
        return `
          <div class="bank-opt ${showAnswers && isCorrect ? 'correct-opt' : ''}">
            <strong>${LETTERS[idx]}.</strong>
            <span>${escapeHtml(opt)}</span>
          </div>
        `;
      })
      .join('');

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div class="q-badge-group">
          <span class="q-number-pill">PDF Q#${qObj.id}</span>
          <span class="q-pdf-pill">Page ${qObj.page}</span>
          <span class="q-cat-pill">${escapeHtml(qObj.category)}</span>
          ${statusPill}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary" data-practice-single="${qObj.id}" style="padding:5px 10px; font-size:0.78rem;">
            Jump to Q#${qObj.id} in Full Quiz
          </button>
        </div>
      </div>
      <div style="font-weight:700; font-size:1.05rem;">${qObj.id}. ${escapeHtml(qObj.question)}</div>
      <div class="bank-options-grid">${optsHtml}</div>
      ${qObj.note ? `<div style="font-size:0.78rem; color:var(--text-secondary);">ℹ ${escapeHtml(qObj.note)}</div>` : ''}
    `;

    card.querySelector('[data-practice-single]')?.addEventListener('click', () => {
      // Ensure 1153 session is in exact order or locate qObj.id
      const fullSession = state.sessions['1153'];
      let targetIdx = fullSession.questionIds.indexOf(qObj.id);
      if (targetIdx === -1) {
        fullSession.questionIds = ALL_QUESTIONS.map((q) => q.id);
        targetIdx = qObj.id - 1;
      }
      fullSession.currentIndex = targetIdx;
      navigateTo('quiz-1153');
    });

    return card;
  }

  // Explorer View (Search & Filter all 1,153 PDF Questions)
  function populateCategoryDropdown() {
    const sel = document.getElementById('explorerCategorySelect');
    if (!sel) return;
    const counts = {};
    ALL_QUESTIONS.forEach((q) => {
      counts[q.category] = (counts[q.category] || 0) + 1;
    });
    Object.keys(counts)
      .sort()
      .forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = `${cat} (${counts[cat]})`;
        sel.appendChild(opt);
      });
  }

  function renderExplorerView() {
    const query = (document.getElementById('explorerSearchInput')?.value || '').trim().toLowerCase();
    const catFilter = document.getElementById('explorerCategorySelect')?.value || 'all';
    const statusFilter = document.getElementById('explorerStatusSelect')?.value || 'all';
    const showAnswers = document.getElementById('explorerShowAnswersToggle')?.checked ?? true;

    const filtered = ALL_QUESTIONS.filter((q) => {
      if (catFilter !== 'all' && q.category !== catFilter) return false;
      const st = state.globalHistory[q.id];
      if (statusFilter === 'correct' && st !== 'correct') return false;
      if (statusFilter === 'wrong' && st !== 'wrong') return false;
      if (statusFilter === 'bookmarked' && !state.bookmarks.includes(q.id)) return false;
      if (statusFilter === 'unseen' && st) return false;

      if (query) {
        const qIdMatch = query.replace(/^q#?/, '');
        if (String(q.id) === qIdMatch) return true;
        const hay = `${q.id} ${q.question} ${q.options.join(' ')} ${q.category}`.toLowerCase();
        return hay.includes(query);
      }
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / EXPLORER_PAGE_SIZE));
    if (explorerPage > totalPages) explorerPage = totalPages;
    if (explorerPage < 1) explorerPage = 1;

    const startIdx = (explorerPage - 1) * EXPLORER_PAGE_SIZE;
    const pageItems = filtered.slice(startIdx, startIdx + EXPLORER_PAGE_SIZE);

    document.getElementById('explorerResultsInfo').textContent = `Showing ${pageItems.length > 0 ? startIdx + 1 : 0}–${startIdx + pageItems.length} of ${filtered.length} matching PDF questions`;
    document.getElementById('explorerPageIndicator').textContent = `Page ${explorerPage} of ${totalPages}`;
    document.getElementById('explorerPrevPageBtn').disabled = explorerPage <= 1;
    document.getElementById('explorerNextPageBtn').disabled = explorerPage >= totalPages;

    const listEl = document.getElementById('explorerList');
    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    pageItems.forEach((q) => frag.appendChild(createQuestionBankCard(q, showAnswers)));
    listEl.appendChild(frag);
  }

  // Theme & Settings Synchronization
  function applySettingsToDOM() {
    document.documentElement.setAttribute('data-theme', state.settings.theme || 'dark');
    const themeLabel = document.getElementById('themeToggleLabel');
    if (themeLabel) {
      themeLabel.textContent = state.settings.theme === 'light' ? 'Dark Mode' : 'Light Mode';
    }

    const autoLabel = document.getElementById('autoAdvanceLabel');
    if (autoLabel) {
      autoLabel.textContent = `Auto-Next: ${state.settings.autoAdvance ? 'On' : 'Off'}`;
    }

    ['200', '500', '1153'].forEach((m) => {
      const sel = document.getElementById('selectRange' + m);
      if (sel && state.settings['range' + m]) {
        sel.value = state.settings['range' + m];
      }
    });
  }

  // Bind All Event Listeners
  function initEventListeners() {
    // Sidebar navigation buttons
    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-nav');
        navigateTo(target);
      });
    });

    document.getElementById('brandHomeBtn')?.addEventListener('click', () => navigateTo('home'));
    document.querySelector('[data-goto="explorer"]')?.addEventListener('click', () => navigateTo('explorer'));

    // Quick resume button in Hero
    document.getElementById('heroQuickResumeBtn')?.addEventListener('click', () => {
      const last = state.lastActiveMode || '200';
      navigateTo('quiz-' + (last === 'custom' ? '200' : last));
    });

    // Mobile menu toggle
    document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.add('open');
      document.getElementById('sidebarOverlay')?.classList.add('open');
    });
    document.getElementById('sidebarCloseBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sidebarOverlay')?.classList.remove('open');
    });
    document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sidebarOverlay')?.classList.remove('open');
    });

    // Theme & Auto-Next toggles
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
      applySettingsToDOM();
      saveStateToCache();
    });

    document.getElementById('autoAdvanceBtn')?.addEventListener('click', () => {
      state.settings.autoAdvance = !state.settings.autoAdvance;
      applySettingsToDOM();
      saveStateToCache();
      showToast(`Auto-Next turned ${state.settings.autoAdvance ? 'ON' : 'OFF'}`);
    });

    // Range dropdown changes on Home cards
    ['200', '500', '1153'].forEach((m) => {
      const sel = document.getElementById('selectRange' + m);
      sel?.addEventListener('change', () => {
        const newRange = sel.value;
        state.settings['range' + m] = newRange;
        const currentSess = state.sessions[m];
        const st = getSessionStats(currentSess);
        if (st.answered === 0 || confirm(`Switch ${m}-Question Quiz to "${sel.options[sel.selectedIndex].text}"? This will start a fresh ${m}-question session.`)) {
          state.sessions[m] = createSessionObject(m, newRange);
          saveStateToCache();
          updateAllSummaries();
          showToast(`Configured ${m} Question Quiz (${newRange}).`);
        } else {
          sel.value = currentSess.rangeSpec;
        }
      });
    });

    // Launch & Reset Mode buttons on Home cards
    document.querySelectorAll('[data-launch-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-launch-mode');
        navigateTo('quiz-' + m);
      });
    });

    document.querySelectorAll('[data-reset-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-reset-mode');
        const range = document.getElementById('selectRange' + m)?.value || state.settings['range' + m];
        if (confirm(`Start a fresh ${m} Question Quiz session? Your current session progress for this mode will be reset.`)) {
          state.sessions[m] = createSessionObject(m, range);
          saveStateToCache();
          updateAllSummaries();
          showToast(`Reset ${m} Question Quiz session.`);
        }
      });
    });

    // Active Quiz Controls
    document.getElementById('quizPrevBtn')?.addEventListener('click', () => {
      const s = getActiveSession();
      if (s && s.currentIndex > 0) {
        s.currentIndex--;
        saveStateToCache();
        renderActiveQuizQuestion();
      }
    });

    document.getElementById('quizNextBtn')?.addEventListener('click', () => {
      const s = getActiveSession();
      if (!s) return;
      if (s.currentIndex < s.questionIds.length - 1) {
        s.currentIndex++;
      } else {
        s.currentIndex = 0;
        showToast('Reached end of quiz — wrapped to Question 1.');
      }
      saveStateToCache();
      renderActiveQuizQuestion();
    });

    document.getElementById('quizNextUnansweredBtn')?.addEventListener('click', () => {
      const s = getActiveSession();
      if (!s) return;
      const total = s.questionIds.length;
      for (let offset = 1; offset <= total; offset++) {
        const idx = (s.currentIndex + offset) % total;
        const qId = s.questionIds[idx];
        if (!Object.prototype.hasOwnProperty.call(s.answers, qId)) {
          s.currentIndex = idx;
          saveStateToCache();
          renderActiveQuizQuestion();
          return;
        }
      }
      showToast('All questions in this quiz have been answered!');
    });

    document.getElementById('quizBookmarkBtn')?.addEventListener('click', () => {
      const s = getActiveSession();
      if (!s) return;
      const qId = s.questionIds[s.currentIndex];
      const idx = state.bookmarks.indexOf(qId);
      if (idx === -1) {
        state.bookmarks.push(qId);
        showToast(`Bookmarked PDF Q#${qId}`);
      } else {
        state.bookmarks.splice(idx, 1);
        showToast(`Removed bookmark from PDF Q#${qId}`);
      }
      saveStateToCache();
      updateAllSummaries();
      renderActiveQuizQuestion();
      renderQuestionPalette();
    });

    document.getElementById('quizClearAnswerBtn')?.addEventListener('click', () => {
      const s = getActiveSession();
      if (!s) return;
      const qId = s.questionIds[s.currentIndex];
      if (Object.prototype.hasOwnProperty.call(s.answers, qId)) {
        delete s.answers[qId];
        saveStateToCache();
        updateAllSummaries();
        renderActiveQuizQuestion();
        renderQuestionPalette();
      }
    });

    // Palette filters
    document.querySelectorAll('[data-pfilter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentPaletteFilter = btn.getAttribute('data-pfilter');
        document.querySelectorAll('[data-pfilter]').forEach((b) => b.classList.toggle('active', b === btn));
        renderQuestionPalette();
      });
    });

    // Jump to step or PDF Q#
    const handleJump = () => {
      const input = document.getElementById('paletteJumpInput');
      const val = parseInt(input?.value || '', 10);
      const s = getActiveSession();
      if (!s || isNaN(val)) return;

      if (val >= 1 && val <= s.questionIds.length) {
        s.currentIndex = val - 1;
        saveStateToCache();
        renderActiveQuizQuestion();
        input.value = '';
      } else {
        const byPdfIdx = s.questionIds.indexOf(val);
        if (byPdfIdx !== -1) {
          s.currentIndex = byPdfIdx;
          saveStateToCache();
          renderActiveQuizQuestion();
          input.value = '';
        } else {
          showToast(`Number ${val} not found in current ${s.questionIds.length}-question set.`);
        }
      }
    };

    document.getElementById('paletteJumpBtn')?.addEventListener('click', handleJump);
    document.getElementById('paletteJumpInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleJump();
    });

    // Retry Red Tiles in Current Session
    document.getElementById('quizRetryMistakesInSessionBtn')?.addEventListener('click', () => {
      const s = getActiveSession();
      if (!s) return;
      const wrongIds = s.questionIds.filter((qId) => {
        if (!Object.prototype.hasOwnProperty.call(s.answers, qId)) return false;
        const qObj = QUESTION_BY_ID.get(qId);
        return qObj && s.answers[qId] !== qObj.answer;
      });
      if (wrongIds.length === 0) {
        showToast('No wrong (Red) answers in this session yet!');
        return;
      }
      state.sessions.custom = createSessionObject(
        'custom',
        'session-mistakes',
        wrongIds,
        `Session Mistakes Retry (${wrongIds.length} Qs)`
      );
      navigateTo('quiz-custom');
    });

    document.getElementById('quizResetSessionBtn')?.addEventListener('click', () => {
      const s = getActiveSession();
      if (!s) return;
      if (confirm(`Reset all answers in "${s.title}"?`)) {
        s.answers = {};
        s.currentIndex = 0;
        saveStateToCache();
        updateAllSummaries();
        renderActiveQuizQuestion();
        renderQuestionPalette();
        showToast('Quiz session reset.');
      }
    });

    // Keyboard shortcuts when in Active Quiz view
    window.addEventListener('keydown', (e) => {
      if (state.activeNav !== 'quiz-200' && state.activeNav !== 'quiz-500' && state.activeNav !== 'quiz-1153' && state.activeNav !== 'quiz-custom') {
        return;
      }
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      const key = e.key.toUpperCase();
      if (key === '1' || key === 'A') {
        e.preventDefault();
        handleSelectOption(0);
      } else if (key === '2' || key === 'B') {
        e.preventDefault();
        handleSelectOption(1);
      } else if (key === '3' || key === 'C') {
        e.preventDefault();
        handleSelectOption(2);
      } else if (key === '4' || key === 'D') {
        e.preventDefault();
        handleSelectOption(3);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        document.getElementById('quizNextBtn')?.click();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        document.getElementById('quizPrevBtn')?.click();
      } else if (key === 'F') {
        e.preventDefault();
        document.getElementById('quizBookmarkBtn')?.click();
      }
    });

    // Explorer events
    document.getElementById('explorerSearchInput')?.addEventListener('input', () => {
      explorerPage = 1;
      renderExplorerView();
    });
    document.getElementById('explorerCategorySelect')?.addEventListener('change', () => {
      explorerPage = 1;
      renderExplorerView();
    });
    document.getElementById('explorerStatusSelect')?.addEventListener('change', () => {
      explorerPage = 1;
      renderExplorerView();
    });
    document.getElementById('explorerShowAnswersToggle')?.addEventListener('change', () => {
      renderExplorerView();
    });
    document.getElementById('explorerPrevPageBtn')?.addEventListener('click', () => {
      explorerPage--;
      renderExplorerView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('explorerNextPageBtn')?.addEventListener('click', () => {
      explorerPage++;
      renderExplorerView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Cache Manager Export / Import / Reset
    document.getElementById('exportCacheBtn')?.addEventListener('click', () => {
      const dataStr = JSON.stringify(state, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `electroquiz-progress-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Progress backup downloaded.');
    });

    document.getElementById('importCacheBtn')?.addEventListener('click', () => {
      document.getElementById('importCacheInput')?.click();
    });

    document.getElementById('importCacheInput')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(String(reader.result));
          if (!imported || !imported.sessions) throw new Error('Invalid backup format');
          localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
          state = loadStateFromCache();
          applySettingsToDOM();
          updateAllSummaries();
          navigateTo('home');
          showToast('Progress restored from backup file!');
        } catch (err) {
          showToast('Error: Invalid backup JSON file.');
        }
      };
      reader.readAsText(file);
    });

    document.getElementById('clearAllCacheBtn')?.addEventListener('click', () => {
      if (!confirm('Are you sure you want to permanently clear all cached quiz progress, scores, mistakes, and bookmarks?')) return;
      localStorage.removeItem(STORAGE_KEY);
      state = createDefaultState();
      applySettingsToDOM();
      updateAllSummaries();
      navigateTo('home');
      showToast('All cached progress has been reset.');
    });

    // Multi-tab storage sync
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        state = loadStateFromCache();
        applySettingsToDOM();
        updateAllSummaries();
        if (state.activeNav.startsWith('quiz-')) {
          renderActiveQuizQuestion();
          renderQuestionPalette();
        }
      }
    });
  }

  // Initialize Application
  function init() {
    populateCategoryDropdown();
    applySettingsToDOM();
    initEventListeners();
    updateAllSummaries();
    // Restore last active view from cache so page refresh retains exact spot
    navigateTo(state.activeNav || 'home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
