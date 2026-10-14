/**
 * Telegram Mini App Main Logic
 * Integrates with Telegram WebApp SDK, MyStat API backend, and handles dynamic rendering.
 */

// State Management
const state = {
  token: localStorage.getItem('mystat_token') || null,
  telegramId: null,
  userInfo: null,
  activeTab: 'tabHomework',
  currentHwFilter: 'pending',
  currentLeaderType: 'group',
  scheduleMonth: new Date(),
  selectedScheduleDate: new Date(),
  scheduleData: [],
  cachedHomework: null
};

// DOM Elements
const elements = {
  app: document.getElementById('app'),
  authModal: document.getElementById('authModal'),
  loginForm: document.getElementById('loginForm'),
  usernameInput: document.getElementById('usernameInput'),
  passwordInput: document.getElementById('passwordInput'),
  btnTogglePassword: document.getElementById('btnTogglePassword'),
  btnLoginSubmit: document.getElementById('btnLoginSubmit'),
  authErrorMsg: document.getElementById('authErrorMsg'),
  
  studentPill: document.getElementById('studentPill'),
  studentAvatar: document.getElementById('studentAvatar'),
  studentAvatarText: document.getElementById('studentAvatarText'),
  studentName: document.getElementById('studentName'),
  studentGroup: document.getElementById('studentGroup'),
  userPointsBadge: document.getElementById('userPointsBadge'),
  userGems: document.getElementById('userGems'),
  userCoins: document.getElementById('userCoins'),
  
  btnRefresh: document.getElementById('btnRefresh'),
  hwCountBadge: document.getElementById('hwCountBadge'),
  navHwDot: document.getElementById('navHwDot'),
  hwListContainer: document.getElementById('hwListContainer'),
  
  // Schedule
  currentMonthLabel: document.getElementById('currentMonthLabel'),
  btnPrevMonth: document.getElementById('btnPrevMonth'),
  btnNextMonth: document.getElementById('btnNextMonth'),
  btnScheduleToday: document.getElementById('btnScheduleToday'),
  btnScheduleTomorrow: document.getElementById('btnScheduleTomorrow'),
  btnScheduleAll: document.getElementById('btnScheduleAll'),
  daysScrollStrip: document.getElementById('daysScrollStrip'),
  scheduleListContainer: document.getElementById('scheduleListContainer'),
  
  // Grades
  todayDateLabel: document.getElementById('todayDateLabel'),
  todayGradesList: document.getElementById('todayGradesList'),
  recentVisitsContainer: document.getElementById('recentVisitsContainer'),
  
  // Leaders
  leadersPodium: document.getElementById('leadersPodium'),
  leadersListContainer: document.getElementById('leadersListContainer'),
  
  // Profile
  profileFullName: document.getElementById('profileFullName'),
  profileGroupName: document.getElementById('profileGroupName'),
  profileAvatarLarge: document.getElementById('profileAvatarLarge'),
  profileAvatarInitial: document.getElementById('profileAvatarInitial'),
  profileGems: document.getElementById('profileGems'),
  profileCoins: document.getElementById('profileCoins'),
  profileLevel: document.getElementById('profileLevel'),
  sysUptime: document.getElementById('sysUptime'),
  btnLogout: document.getElementById('btnLogout'),
  
  toast: document.getElementById('toast')
};

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  initTelegramWebApp();
  setupEventListeners();
  initLucide();
  
  // Check session & authenticate
  await checkAuthSession();
});

function initLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function initTelegramWebApp() {
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();

    // Enable closing confirmation if needed
    if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();

    // Extract telegram ID
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
      state.telegramId = tg.initDataUnsafe.user.id;
    }
  }

  // Fallback telegramId from query parameter if testing in browser
  if (!state.telegramId) {
    const params = new URLSearchParams(window.location.search);
    state.telegramId = params.get('tg_id') || params.get('telegramId') || 'local_user';
  }
}

function triggerHaptic(type = 'light') {
  if (window.Telegram?.WebApp?.HapticFeedback) {
    window.Telegram.WebApp.HapticFeedback.impactOccurred(type);
  }
}

// ==================== AUTHENTICATION ====================

async function checkAuthSession() {
  try {
    const headers = { 'X-Telegram-Id': state.telegramId };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

    const res = await fetch(`/api/session?telegramId=${state.telegramId}`, { headers });
    const data = await res.json();

    if (data.authenticated && data.userInfo) {
      state.token = data.token;
      state.userInfo = data.userInfo;
      localStorage.setItem('mystat_token', state.token);
      onAuthSuccess();
      return;
    }

    // If local token exists, try fetching profile directly
    if (state.token) {
      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      if (meRes.ok) {
        state.userInfo = await meRes.json();
        onAuthSuccess();
        return;
      }
    }

    // Needs login
    showAuthModal();
  } catch (err) {
    console.error('Session check error:', err);
    showAuthModal();
  }
}

function showAuthModal() {
  elements.authModal.classList.remove('hidden');
}

function hideAuthModal() {
  elements.authModal.classList.add('hidden');
}

function onAuthSuccess() {
  hideAuthModal();
  renderStudentProfile();
  loadAllData();
}

function renderStudentProfile() {
  if (!state.userInfo) return;
  const u = state.userInfo;

  elements.studentPill.classList.remove('hidden');
  elements.studentName.textContent = u.full_name || 'Студент';
  elements.studentGroup.textContent = u.group_name || 'IT Step Academy';

  // Avatar
  const initial = (u.full_name || 'С')[0].toUpperCase();
  elements.studentAvatarText.textContent = initial;
  elements.profileAvatarInitial.textContent = initial;

  if (u.photo) {
    elements.studentAvatar.style.backgroundImage = `url(${u.photo})`;
    elements.studentAvatarText.textContent = '';
    elements.profileAvatarLarge.style.backgroundImage = `url(${u.photo})`;
    elements.profileAvatarInitial.textContent = '';
  }

  // Gaming Points (Gems & Coins)
  if (Array.isArray(u.gaming_points)) {
    const gems = u.gaming_points.find(p => p.new_gaming_point_types__id === 1)?.points || 0;
    const coins = u.gaming_points.find(p => p.new_gaming_point_types__id === 2)?.points || 0;

    elements.userPointsBadge.classList.remove('hidden');
    elements.userGems.textContent = gems;
    elements.userCoins.textContent = coins;

    elements.profileGems.textContent = gems;
    elements.profileCoins.textContent = coins;
  }

  elements.profileFullName.textContent = u.full_name || 'Студент';
  elements.profileGroupName.textContent = u.group_name || 'Группа IT Step';
  elements.profileLevel.textContent = u.level || 1;
}

// ==================== API DATA FETCHING ====================

async function loadAllData() {
  elements.btnRefresh.classList.add('rotating');
  
  await Promise.allSettled([
    loadHomework(),
    loadSchedule(state.scheduleMonth),
    loadGrades(),
    loadLeaderboard(state.currentLeaderType),
    loadUptime()
  ]);

  elements.btnRefresh.classList.remove('rotating');
  initLucide();
}

/**
 * Fetch and render Homework
 */
async function loadHomework() {
  const filter = state.currentHwFilter;
  let url = '/api/homework?status=pending';

  if (filter === 'active') url = '/api/homework?status=3';
  else if (filter === 'overdue') url = '/api/homework?status=6';
  else if (filter === 'checked') url = '/api/homework?status=1';
  else if (filter === 'all') url = '/api/homework?status=all';

  elements.hwListContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Загрузка заданий...</p>
    </div>
  `;

  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error('Ошибка загрузки заданий');
    const data = await res.json();

    let list = [];
    if (filter === 'pending') {
      const active = data.active || [];
      const overdue = data.overdue || [];
      list = [...overdue, ...active];
      
      // Update badge
      const pendingTotal = list.length;
      elements.hwCountBadge.textContent = pendingTotal;
      if (pendingTotal > 0) {
        elements.navHwDot.classList.remove('hidden');
      } else {
        elements.navHwDot.classList.add('hidden');
      }
    } else {
      list = data.items || [];
    }

    renderHomeworkList(list);
  } catch (err) {
    elements.hwListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Не удалось загрузить ДЗ</div>
        <div class="empty-desc">${err.message}</div>
      </div>
    `;
  }
  initLucide();
}

function renderHomeworkList(items) {
  if (!items || items.length === 0) {
    elements.hwListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <div class="empty-title">Заданий нет!</div>
        <div class="empty-desc">В этой категории нет висящих домашних заданий.</div>
      </div>
    `;
    return;
  }

  elements.hwListContainer.innerHTML = items.map(hw => {
    const isOverdue = hw.status === 6;
    const isChecked = hw.status === 1;
    const statusClass = isOverdue ? 'status-overdue' : isChecked ? 'status-checked' : 'status-active';
    const pillClass = isOverdue ? 'pill-overdue' : isChecked ? 'pill-checked' : 'pill-active';

    // Download action button
    let downloadHtml = '';
    if (hw.downloadUrl) {
      // Use proxy or direct URL
      const proxyUrl = `/api/download-proxy?url=${encodeURIComponent(hw.downloadUrl)}`;
      downloadHtml = `
        <a href="${proxyUrl}" download="${hw.filename || 'homework_file'}" class="btn-download-hw" onclick="triggerHaptic('medium')">
          <i data-lucide="download"></i>
          <span>📥 Скачать задание ${hw.filename ? `(${escapeHtml(hw.filename)})` : ''}</span>
        </a>
      `;
    } else {
      downloadHtml = `
        <div class="btn-download-hw no-file">
          <i data-lucide="file-text"></i>
          <span>Файл задания не прикреплён</span>
        </div>
      `;
    }

    // Checked mark badge
    let gradeBadge = '';
    if (isChecked && hw.studentSolution?.mark) {
      gradeBadge = `<div class="mark-pill hw" style="margin-bottom: 8px;">Оценка: ${hw.studentSolution.mark} баллов</div>`;
    }

    return `
      <div class="hw-card ${statusClass}">
        <div class="hw-card-top">
          <span class="hw-subject-badge">${escapeHtml(hw.subject)}</span>
          <span class="hw-status-pill ${pillClass}">${escapeHtml(hw.statusName)}</span>
        </div>

        <h3 class="hw-title">${escapeHtml(hw.theme)}</h3>

        ${hw.comment ? `<p class="hw-description">${escapeHtml(hw.comment)}</p>` : ''}
        ${gradeBadge}

        <div class="hw-meta-row">
          <div class="hw-meta-item deadline">
            <i data-lucide="calendar"></i>
            <span>Срок: ${escapeHtml(hw.overdueTime || 'Бессрочно')}</span>
          </div>
          ${hw.teacher ? `
            <div class="hw-meta-item">
              <i data-lucide="user"></i>
              <span>${escapeHtml(hw.teacher)}</span>
            </div>
          ` : ''}
        </div>

        ${downloadHtml}
      </div>
    `;
  }).join('');
}

/**
 * Fetch and render Schedule
 */
async function loadSchedule(dateObj) {
  const dateStr = formatDate(dateObj);
  elements.currentMonthLabel.textContent = dateObj.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  renderDaysStrip(dateObj);

  elements.scheduleListContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Загрузка расписания...</p>
    </div>
  `;

  try {
    const res = await fetchWithAuth(`/api/schedule?month=${dateStr}`);
    if (!res.ok) throw new Error('Ошибка загрузки расписания');
    state.scheduleData = await res.json();

    filterScheduleForDate(state.selectedScheduleDate);
  } catch (err) {
    elements.scheduleListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Не удалось загрузить расписание</div>
        <div class="empty-desc">${err.message}</div>
      </div>
    `;
  }
  initLucide();
}

function renderDaysStrip(dateObj) {
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  let html = '';

  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month, d);
    const dayOfWeek = weekdays[curDate.getDay()];
    const isSelected = isSameDay(curDate, state.selectedScheduleDate);
    const isToday = isSameDay(curDate, today);

    html += `
      <div class="day-chip ${isSelected ? 'active' : ''} ${isToday ? 'is-today' : ''}" data-day="${d}">
        <span class="day-weekday">${dayOfWeek}</span>
        <span class="day-number">${d}</span>
      </div>
    `;
  }

  elements.daysScrollStrip.innerHTML = html;

  // Add click handlers for day chips
  elements.daysScrollStrip.querySelectorAll('.day-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const dayNum = parseInt(chip.getAttribute('data-day'));
      state.selectedScheduleDate = new Date(year, month, dayNum);
      triggerHaptic('light');

      elements.daysScrollStrip.querySelectorAll('.day-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      filterScheduleForDate(state.selectedScheduleDate);
    });
  });

  // Scroll active day into view
  const activeChip = elements.daysScrollStrip.querySelector('.day-chip.active');
  if (activeChip) {
    activeChip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function filterScheduleForDate(dateObj) {
  const targetStr = formatDate(dateObj);
  const items = state.scheduleData.filter(item => item.date === targetStr);

  renderScheduleItems(items, targetStr);
}

function renderScheduleItems(items, dateStr) {
  if (!items || items.length === 0) {
    elements.scheduleListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">☕</div>
        <div class="empty-title">Пар нет — выходной!</div>
        <div class="empty-desc">На дату <b>${dateStr}</b> занятий в расписании не найдено.</div>
      </div>
    `;
    return;
  }

  // Sort by started_at
  items.sort((a, b) => (a.started_at || '').localeCompare(b.started_at || ''));

  elements.scheduleListContainer.innerHTML = items.map((item, idx) => {
    return `
      <div class="lesson-card">
        <div class="lesson-card-time">
          <span class="time-start">${item.started_at || '--:--'}</span>
          <span class="time-end">${item.finished_at || '--:--'}</span>
        </div>

        <div class="lesson-card-info">
          <h4 class="lesson-subject">${escapeHtml(item.subject_name || 'Пара')}</h4>
          <div class="lesson-meta">
            ${item.teacher_name ? `
              <span><i data-lucide="user"></i> ${escapeHtml(item.teacher_name)}</span>
            ` : ''}
            <span>
              <i data-lucide="map-pin"></i> 
              <span class="room-badge">${escapeHtml(item.room_name || 'Аудитория не указана')}</span>
            </span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  initLucide();
}

/**
 * Fetch and render Grades (Today + Recent)
 */
async function loadGrades() {
  const today = new Date();
  elements.todayDateLabel.textContent = formatDate(today);

  try {
    const res = await fetchWithAuth('/api/grades/today');
    if (!res.ok) throw new Error('Ошибка загрузки оценок');
    const data = await res.json();

    // Render Today's Grades
    const todayGrades = data.todayGrades || [];
    if (todayGrades.length === 0) {
      elements.todayGradesList.innerHTML = `
        <div style="font-size: 13px; color: var(--text-muted); padding: 4px 0;">
          ℹ️ За сегодня новых оценок пока нет.
        </div>
      `;
    } else {
      elements.todayGradesList.innerHTML = todayGrades.map(g => {
        const marks = [];
        if (g.classWorkMark) marks.push(`<span class="mark-pill cw">Кл. работа: ${g.classWorkMark}</span>`);
        if (g.homeWorkMark) marks.push(`<span class="mark-pill hw">Домашка: ${g.homeWorkMark}</span>`);
        if (g.labWorkMark) marks.push(`<span class="mark-pill lab">Лабораторная: ${g.labWorkMark}</span>`);
        if (marks.length === 0) {
          marks.push(`<span class="mark-pill cw">${g.wasPresent ? '✅ Присутствовал(а)' : '❌ Отсутствовал(а)'}</span>`);
        }

        return `
          <div class="today-grade-item">
            <div class="today-grade-title">${escapeHtml(g.subject || 'Предмет')}</div>
            <div class="marks-row">${marks.join('')}</div>
          </div>
        `;
      }).join('');
    }

    // Render Recent Visits
    const recent = data.recentGrades || [];
    if (recent.length === 0) {
      elements.recentVisitsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-desc">История занятий пуста.</div>
        </div>
      `;
    } else {
      elements.recentVisitsContainer.innerHTML = recent.map(v => {
        const marks = [];
        if (v.classWorkMark) marks.push(`<span class="mark-pill cw">Класс: ${v.classWorkMark}</span>`);
        if (v.homeWorkMark) marks.push(`<span class="mark-pill hw">ДЗ: ${v.homeWorkMark}</span>`);
        if (v.labWorkMark) marks.push(`<span class="mark-pill lab">Лаб: ${v.labWorkMark}</span>`);

        return `
          <div class="visit-card">
            <div class="visit-card-header">
              <span>📅 ${escapeHtml(v.date)}</span>
              <span>${v.teacher ? escapeHtml(v.teacher) : ''}</span>
            </div>
            <div class="visit-subject">${escapeHtml(v.subject)}</div>
            ${marks.length > 0 ? `<div class="marks-row">${marks.join('')}</div>` : ''}
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    elements.todayGradesList.innerHTML = `<div style="color: var(--accent-rose); font-size: 13px;">${err.message}</div>`;
    elements.recentVisitsContainer.innerHTML = '';
  }

  initLucide();
}

/**
 * Fetch and render Leaderboard
 */
async function loadLeaderboard(type = 'group') {
  state.currentLeaderType = type;

  elements.leadersListContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Загрузка рейтинга...</p>
    </div>
  `;
  elements.leadersPodium.innerHTML = '';

  try {
    const res = await fetchWithAuth(`/api/leaderboard?type=${type}`);
    if (!res.ok) throw new Error('Ошибка загрузки рейтинга');
    const data = await res.json();
    const leaders = data.leaders || [];

    if (leaders.length === 0) {
      elements.leadersListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🏆</div>
          <div class="empty-title">Рейтинг пуст</div>
          <div class="empty-desc">Данные о лидерах для этой категории пока отсутствуют.</div>
        </div>
      `;
      return;
    }

    // Top 3 Podium
    const top3 = leaders.slice(0, 3);
    const podiumHtml = `
      <!-- 2nd Place -->
      ${top3[1] ? `
        <div class="podium-item second">
          <div class="podium-avatar" style="${top3[1].photo_path ? `background-image: url(${top3[1].photo_path})` : ''}">
            ${!top3[1].photo_path ? (top3[1].full_name || 'С')[0] : ''}
            <div class="podium-rank-badge">2</div>
          </div>
          <div class="podium-name">${escapeHtml(top3[1].full_name)}</div>
          <div class="podium-score">💎 ${top3[1].amount || 0}</div>
          <div class="podium-bar"></div>
        </div>
      ` : ''}

      <!-- 1st Place -->
      ${top3[0] ? `
        <div class="podium-item first">
          <div class="podium-avatar" style="${top3[0].photo_path ? `background-image: url(${top3[0].photo_path})` : ''}">
            ${!top3[0].photo_path ? (top3[0].full_name || 'С')[0] : ''}
            <div class="podium-rank-badge">1</div>
          </div>
          <div class="podium-name">${escapeHtml(top3[0].full_name)}</div>
          <div class="podium-score">💎 ${top3[0].amount || 0}</div>
          <div class="podium-bar"></div>
        </div>
      ` : ''}

      <!-- 3rd Place -->
      ${top3[2] ? `
        <div class="podium-item third">
          <div class="podium-avatar" style="${top3[2].photo_path ? `background-image: url(${top3[2].photo_path})` : ''}">
            ${!top3[2].photo_path ? (top3[2].full_name || 'С')[0] : ''}
            <div class="podium-rank-badge">3</div>
          </div>
          <div class="podium-name">${escapeHtml(top3[2].full_name)}</div>
          <div class="podium-score">💎 ${top3[2].amount || 0}</div>
          <div class="podium-bar"></div>
        </div>
      ` : ''}
    `;
    elements.leadersPodium.innerHTML = podiumHtml;

    // Remaining Leaders List (4th onwards or all)
    const rest = leaders.slice(3);
    elements.leadersListContainer.innerHTML = rest.map((st, idx) => {
      const pos = idx + 4;
      const isCurrentUser = state.userInfo?.full_name && st.full_name?.toLowerCase() === state.userInfo.full_name.toLowerCase();

      return `
        <div class="leader-row ${isCurrentUser ? 'current-user' : ''}">
          <span class="leader-pos">${pos}.</span>
          <div class="leader-avatar-small" style="${st.photo_path ? `background-image: url(${st.photo_path})` : ''}">
            ${!st.photo_path ? (st.full_name || 'С')[0] : ''}
          </div>
          <span class="leader-name">${escapeHtml(st.full_name)} ${isCurrentUser ? '<b>(Вы)</b>' : ''}</span>
          <span class="leader-points">💎 ${st.amount || 0}</span>
        </div>
      `;
    }).join('');

  } catch (err) {
    elements.leadersListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-desc">${err.message}</div>
      </div>
    `;
  }
}

/**
 * Load System Uptime for Render.com anti-sleep check
 */
async function loadUptime() {
  try {
    const res = await fetch('/ping');
    if (res.ok) {
      const data = await res.json();
      const minutes = Math.floor(data.uptime / 60);
      elements.sysUptime.textContent = `${minutes} мин`;
    }
  } catch (e) {}
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
  // Navigation Tabs
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Homework Filters
  document.querySelectorAll('[data-hw-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-hw-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentHwFilter = btn.getAttribute('data-hw-filter');
      triggerHaptic('light');
      loadHomework();
    });
  });

  // Schedule Month Switchers
  elements.btnPrevMonth.addEventListener('click', () => {
    state.scheduleMonth.setMonth(state.scheduleMonth.getMonth() - 1);
    state.selectedScheduleDate = new Date(state.scheduleMonth.getFullYear(), state.scheduleMonth.getMonth(), 1);
    triggerHaptic('light');
    loadSchedule(state.scheduleMonth);
  });

  elements.btnNextMonth.addEventListener('click', () => {
    state.scheduleMonth.setMonth(state.scheduleMonth.getMonth() + 1);
    state.selectedScheduleDate = new Date(state.scheduleMonth.getFullYear(), state.scheduleMonth.getMonth(), 1);
    triggerHaptic('light');
    loadSchedule(state.scheduleMonth);
  });

  // Quick Schedule Buttons
  elements.btnScheduleToday.addEventListener('click', () => {
    state.scheduleMonth = new Date();
    state.selectedScheduleDate = new Date();
    setActiveQuickBtn(elements.btnScheduleToday);
    loadSchedule(state.scheduleMonth);
  });

  elements.btnScheduleTomorrow.addEventListener('click', () => {
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    state.scheduleMonth = tmr;
    state.selectedScheduleDate = tmr;
    setActiveQuickBtn(elements.btnScheduleTomorrow);
    loadSchedule(state.scheduleMonth);
  });

  elements.btnScheduleAll.addEventListener('click', () => {
    setActiveQuickBtn(elements.btnScheduleAll);
    renderAllMonthSchedule();
  });

  // Leaderboard Segments
  document.querySelectorAll('[data-leader-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-leader-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const type = btn.getAttribute('data-leader-type');
      triggerHaptic('light');
      loadLeaderboard(type);
    });
  });

  // Refresh Button
  elements.btnRefresh.addEventListener('click', () => {
    triggerHaptic('medium');
    loadAllData();
  });

  // Toggle Password Visibility
  elements.btnTogglePassword.addEventListener('click', () => {
    const isPassword = elements.passwordInput.type === 'password';
    elements.passwordInput.type = isPassword ? 'text' : 'password';
    elements.btnTogglePassword.innerHTML = isPassword ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
    initLucide();
  });

  // Login Form Submit
  elements.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = elements.usernameInput.value.trim();
    const password = elements.passwordInput.value.trim();

    if (!username || !password) return;

    elements.btnLoginSubmit.disabled = true;
    elements.btnLoginSubmit.querySelector('.btn-text').textContent = 'Вход...';
    elements.btnLoginSubmit.querySelector('.btn-spinner').classList.remove('hidden');
    elements.authErrorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          telegramId: state.telegramId
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Ошибка авторизации в MyStat');

      state.token = data.token;
      state.userInfo = data.userInfo;
      localStorage.setItem('mystat_token', state.token);

      showToast('✅ Авторизация успешна!');
      triggerHaptic('heavy');
      onAuthSuccess();
    } catch (err) {
      elements.authErrorMsg.textContent = err.message;
      elements.authErrorMsg.classList.remove('hidden');
      triggerHaptic('error');
    } finally {
      elements.btnLoginSubmit.disabled = false;
      elements.btnLoginSubmit.querySelector('.btn-text').textContent = 'Войти в MyStat';
      elements.btnLoginSubmit.querySelector('.btn-spinner').classList.add('hidden');
    }
  });

  // Logout Button
  elements.btnLogout.addEventListener('click', async () => {
    if (!confirm('Вы действительно хотите выйти из MyStat?')) return;
    
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: state.telegramId })
    });

    state.token = null;
    state.userInfo = null;
    localStorage.removeItem('mystat_token');

    elements.studentPill.classList.add('hidden');
    elements.userPointsBadge.classList.add('hidden');
    showToast('👋 Вы вышли из аккаунта');
    showAuthModal();
  });
}

function switchTab(tabId) {
  triggerHaptic('light');
  document.querySelectorAll('.tab-page').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add('active');

  const navBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  if (navBtn) navBtn.classList.add('active');

  state.activeTab = tabId;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setActiveQuickBtn(btn) {
  elements.btnScheduleToday.classList.remove('active');
  elements.btnScheduleTomorrow.classList.remove('active');
  elements.btnScheduleAll.classList.remove('active');
  btn.classList.add('active');
  triggerHaptic('light');
}

function renderAllMonthSchedule() {
  if (!state.scheduleData || state.scheduleData.length === 0) {
    elements.scheduleListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">☕</div>
        <div class="empty-title">Пар нет в этом месяце</div>
      </div>
    `;
    return;
  }

  // Group by date
  const groups = {};
  state.scheduleData.forEach(item => {
    if (!groups[item.date]) groups[item.date] = [];
    groups[item.date].push(item);
  });

  let html = '';
  Object.keys(groups).sort().forEach(dateKey => {
    html += `<div style="font-weight: 700; color: #818cf8; font-size: 13px; margin: 12px 0 6px 0;">📅 ${dateKey}</div>`;
    groups[dateKey].forEach(item => {
      html += `
        <div class="lesson-card" style="margin-bottom: 8px;">
          <div class="lesson-card-time">
            <span class="time-start">${item.started_at || '--:--'}</span>
            <span class="time-end">${item.finished_at || '--:--'}</span>
          </div>
          <div class="lesson-card-info">
            <h4 class="lesson-subject">${escapeHtml(item.subject_name || 'Пара')}</h4>
            <div class="lesson-meta">
              <span><i data-lucide="map-pin"></i> <span class="room-badge">${escapeHtml(item.room_name || 'Аудитория не указана')}</span></span>
            </div>
          </div>
        </div>
      `;
    });
  });

  elements.scheduleListContainer.innerHTML = html;
  initLucide();
}

// ==================== HELPERS ====================

async function fetchWithAuth(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    'X-Telegram-Id': state.telegramId
  };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  return fetch(url, { ...options, headers });
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, duration = 3000) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, duration);
}
