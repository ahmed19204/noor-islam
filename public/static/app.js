// ══════════════════════════════════════════════════════════════
// Noor Prayer Times – Client-side Application
// FULLY DATABASE-DRIVEN – No fake/mock/generated data
// ══════════════════════════════════════════════════════════════
import { inject } from '@vercel/analytics/react'
(function () {
  'use strict';

  const TZ = 'Europe/Moscow';
  const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const STORAGE_PREFS = 'noor-notification-preferences';
  const STORAGE_LANG = 'NEXT_LOCALE';
  const STORAGE_QUEUE = 'noor-notification-queue';
  const STORAGE_FIRED = 'noor-notification-fired';
  const NOTIFICATION_GRACE_MS = 2 * 60 * 1000;

  // ── i18n ──
  const translations = {
    en: {
      appName: 'Noor Prayer Times', city: 'Nizhny Novgorod', timezoneLabel: 'Moscow Time',
      home: 'Home', schedule: 'Schedule', alerts: 'Alerts', admin: 'Admin',
      currentPrayer: 'Current Prayer', nextPrayerIn: 'Next prayer in:', untilPrayer: 'Until',
      todaySchedule: "Today's Schedule", notifications: 'Notifications',
      adhanAudio: 'Adhan Audio', vibrateBefore: 'Vibrate Before', pushAlerts: 'Push Alerts',
      inspiration: 'Inspiration', quote: '"Indeed, prayer has been decreed upon the believers a decree of specified times."',
      noData: 'Prayer times are not available for today yet.', today: 'Today', loading: 'Loading...',
      fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha',
      monthlySchedule: 'Monthly Schedule', date: 'Date', monthFallback: 'No prayer times for this month.',
      todayBadge: 'Today', notifTitle: 'Notification Settings',
      notifSubtitle: 'Manage your spiritual reminders and Adhan preferences.',
      enableNotifTitle: 'Enable System Notifications', permDefault: 'Permission not requested yet',
      permGranted: 'Permission granted', permDenied: 'Permission blocked in browser settings',
      allowAccess: 'Allow Access', dailyPrayers: 'Daily Prayers', audioPreferences: 'Audio Preferences',
      globalAdhan: 'Global Adhan', volume: 'Volume', mute: 'Mute',
      heroEyebrow: 'Nizhny Novgorod', heroTitleStart: 'Find Peace in', heroTitleAccent: 'Every Moment',
      heroDescription: 'Accurate prayer times, serene Adhan notifications, and monthly schedules designed for a focused, distraction-free spiritual environment.',
      cta: 'Get Started', featurePrecisionTitle: 'Precision Timing for Nizhny Novgorod',
      featurePrecisionBody: 'Calculated with meticulous accuracy for your exact location.',
      featureAdhanTitle: 'Serene Adhan Alerts', featureAdhanBody: 'Gentle, beautiful notifications that slide in to remind you.',
      featureSound: 'Sound Notifications', loadingDashboard: 'Loading your prayer dashboard...',
      continue: 'Continue', uploadSchedule: 'Upload Schedule',
      uploadSubtitle: 'Securely import monthly prayer times via CSV format.',
      adminAccessTitle: 'Admin Access', adminAccessBody: 'Enter the admin password to unlock uploads.',
      passwordLabel: 'Admin Password', unlockDashboard: 'Unlock Dashboard',
      logout: 'Log Out', dragDrop: 'Drag & Drop CSV File',
      uploadHint: 'or click to browse. Expected: date, fajr, dhuhr, asr, maghrib, isha, city',
      selectFile: 'Select File', uploadSuccessful: 'Upload Successful',
      waitingUpload: 'Waiting for upload...', manageData: 'Manage Data',
      manageHint: 'Remove existing months to prevent conflicts.', noMonths: 'No uploaded months found yet.',
      dataPreview: 'Data Preview', reminderBefore: 'Remind before prayer',
      prayerSoon: 'starts in {min} minutes', prayerNow: 'Prayer time has begun.',
      noDataShort: '--:--', tomorrowFajr: "Tomorrow's Fajr",
      dbNotConfigured: 'Database not configured. Please set up Supabase.',
      ru: 'RU', en: 'EN',
    },
    ru: {
      appName: 'Noor Prayer Times', city: 'Нижний Новгород', timezoneLabel: 'Москва',
      home: 'Главная', schedule: 'Расписание', alerts: 'Уведомления', admin: 'Админ',
      currentPrayer: 'Текущий намаз', nextPrayerIn: 'Следующий намаз через:', untilPrayer: 'До',
      todaySchedule: 'Расписание на сегодня', notifications: 'Уведомления',
      adhanAudio: 'Звук азана', vibrateBefore: 'Вибрация заранее', pushAlerts: 'Push-уведомления',
      inspiration: 'Напоминание', quote: '"Воистину, намаз предписан верующим в определенное время."',
      noData: 'На сегодня время намазов пока не загружено.', today: 'Сегодня', loading: 'Загрузка...',
      fajr: 'Фаджр', dhuhr: 'Зухр', asr: 'Аср', maghrib: 'Магриб', isha: 'Иша',
      monthlySchedule: 'Месячное расписание', date: 'Дата', monthFallback: 'Для этого месяца данных нет.',
      todayBadge: 'Сегодня', notifTitle: 'Настройки уведомлений',
      notifSubtitle: 'Управляйте напоминаниями о намазе.',
      enableNotifTitle: 'Включить системные уведомления', permDefault: 'Разрешение ещё не запрашивалось',
      permGranted: 'Разрешение получено', permDenied: 'Разрешение заблокировано',
      allowAccess: 'Разрешить', dailyPrayers: 'Ежедневные намазы', audioPreferences: 'Настройки звука',
      globalAdhan: 'Общий азан', volume: 'Громкость', mute: 'Без звука',
      heroEyebrow: 'Нижний Новгород', heroTitleStart: 'Обретайте спокойствие', heroTitleAccent: 'в каждый момент',
      heroDescription: 'Точные времена намаза, спокойные уведомления об азане и ежемесячные расписания.',
      cta: 'Начать', featurePrecisionTitle: 'Точное расписание для Нижнего Новгорода',
      featurePrecisionBody: 'Время рассчитывается с высокой точностью именно для вашего города.',
      featureAdhanTitle: 'Спокойные уведомления', featureAdhanBody: 'Мягкие уведомления напоминают о намазе.',
      featureSound: 'Звуковые уведомления', loadingDashboard: 'Загрузка...',
      continue: 'Продолжить', uploadSchedule: 'Загрузка расписания',
      uploadSubtitle: 'Безопасно импортируйте расписание в формате CSV.',
      adminAccessTitle: 'Доступ администратора', adminAccessBody: 'Введите пароль для управления данными.',
      passwordLabel: 'Пароль администратора', unlockDashboard: 'Открыть панель',
      logout: 'Выйти', dragDrop: 'Перетащите CSV-файл',
      uploadHint: 'или нажмите для выбора. Формат: date, fajr, dhuhr, asr, maghrib, isha, city',
      selectFile: 'Выбрать файл', uploadSuccessful: 'Загрузка выполнена',
      waitingUpload: 'Ожидание загрузки...', manageData: 'Управление данными',
      manageHint: 'Удалите месяцы перед новой загрузкой.', noMonths: 'Загруженных месяцев нет.',
      dataPreview: 'Предпросмотр', reminderBefore: 'Напомнить до намаза',
      prayerSoon: 'через {min} минут', prayerNow: 'Время намаза наступило.',
      noDataShort: '--:--', tomorrowFajr: 'Фаджр завтра',
      dbNotConfigured: 'База данных не настроена. Настройте Supabase.',
      ru: 'RU', en: 'EN',
    }
  };

  // ══════════════════════════════════════════════════════════════
  // CENTRALIZED PRAYER STATE – Single source of truth
  // ══════════════════════════════════════════════════════════════
  const PrayerState = {
    todayData: null,       // Database row for today (or null)
    tomorrowData: null,    // Database row for tomorrow (or null)
    dataVersion: 0,        // Server-side version tracker
    lastFetchDate: '',     // Track date for rollover detection
    rolloverInFlight: false,
  };

  // ── Client State ──
  let currentLocale = localStorage.getItem(STORAGE_LANG) || 'ru';
  let currentScheduleMonth = '';
  let adhanAudio = null;
  let notifTimers = {};
  let audioUnlocked = false;
  let versionPollInterval = null;

  // ── Preferences ──
  function getPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_PREFS);
      if (raw) return { ...defaultPrefs(), ...JSON.parse(raw) };
    } catch { }
    return defaultPrefs();
  }
  function defaultPrefs() {
    return {
      prayers: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
      audio: { enabled: true, muted: false, volume: 0.8, vibrate: false, notifyBeforeMinutes: 15 }
    };
  }
  function savePrefs(p) { localStorage.setItem(STORAGE_PREFS, JSON.stringify(p)); }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
  }

  function pruneFiredNotifications() {
    const fired = readJson(STORAGE_FIRED, {});
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    Object.keys(fired).forEach(key => {
      if (!fired[key] || fired[key] < cutoff) delete fired[key];
    });
    writeJson(STORAGE_FIRED, fired);
    return fired;
  }

  function hasNotificationFired(tag) {
    return Boolean(pruneFiredNotifications()[tag]);
  }

  function markNotificationFired(tag) {
    const fired = pruneFiredNotifications();
    fired[tag] = Date.now();
    writeJson(STORAGE_FIRED, fired);
  }

  // ── Moscow time helpers ──
  function getMoscowNow() {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const p = {};
    f.formatToParts(new Date()).filter(x => x.type !== 'literal').forEach(x => p[x.type] = x.value);
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      time: `${p.hour}:${p.minute}:${p.second}`,
      hour: parseInt(p.hour), minute: parseInt(p.minute), second: parseInt(p.second)
    };
  }

  function getPrayerDateTime(date, time) {
    if (!date || !time) return null;
    const t = time.length === 5 ? time + ':00' : time;
    return new Date(`${date}T${t}+03:00`);
  }

  // ══════════════════════════════════════════════════════════════
  // CENTRALIZED PRAYER LOGIC – Always uses database data only
  // ══════════════════════════════════════════════════════════════

  /**
   * Determines current and next prayer based on DB data.
   * Prayer order: Fajr → Dhuhr → Asr → Maghrib → Isha → next day Fajr
   * Returns { current, next, nextTime, countdownSeconds, isNextDay }
   */
  function computePrayerStatus() {
    const now = new Date();
    const todayRow = PrayerState.todayData;
    const tomorrowRow = PrayerState.tomorrowData;

    // No data at all
    if (!todayRow) {
      return { current: null, next: null, nextTime: null, countdownSeconds: 0, isNextDay: false, hasData: false };
    }

    // Build today's prayer moments
    const todayMoments = PRAYERS.map(p => ({
      prayer: p,
      dt: getPrayerDateTime(todayRow.date, todayRow[p])
    })).filter(m => m.dt !== null);

    // Find current prayer and next prayer
    let current = null;
    let next = null;
    let nextDt = null;

    // Check if we're before the first prayer
    if (todayMoments.length > 0 && now < todayMoments[0].dt) {
      // Before Fajr – no current prayer, next is Fajr
      current = null;
      next = todayMoments[0].prayer;
      nextDt = todayMoments[0].dt;
      const secs = Math.max(0, Math.floor((nextDt - now) / 1000));
      return { current, next, nextTime: nextDt, countdownSeconds: secs, isNextDay: false, hasData: true };
    }

    // Find which prayer period we're in
    for (let i = 0; i < todayMoments.length; i++) {
      const thisMoment = todayMoments[i];
      const nextMoment = todayMoments[i + 1];

      if (now >= thisMoment.dt) {
        if (!nextMoment || now < nextMoment.dt) {
          current = thisMoment.prayer;
          if (nextMoment) {
            next = nextMoment.prayer;
            nextDt = nextMoment.dt;
          }
          break;
        }
      }
    }

    // If we have a next prayer today
    if (next && nextDt) {
      const secs = Math.max(0, Math.floor((nextDt - now) / 1000));
      return { current, next, nextTime: nextDt, countdownSeconds: secs, isNextDay: false, hasData: true };
    }

    // After Isha – check tomorrow's Fajr
    if (current === 'isha' && tomorrowRow) {
      const tomorrowFajrDt = getPrayerDateTime(tomorrowRow.date, tomorrowRow.fajr);
      if (tomorrowFajrDt) {
        const secs = Math.max(0, Math.floor((tomorrowFajrDt - now) / 1000));
        return { current: 'isha', next: 'fajr', nextTime: tomorrowFajrDt, countdownSeconds: secs, isNextDay: true, hasData: true };
      }
    }

    // After Isha, no tomorrow data
    if (current === 'isha') {
      return { current: 'isha', next: null, nextTime: null, countdownSeconds: 0, isNextDay: false, hasData: true };
    }

    // Fallback – shouldn't reach here normally
    return { current, next, nextTime: nextDt, countdownSeconds: 0, isNextDay: false, hasData: true };
  }

  function formatCountdown(s) {
    if (s <= 0) return '--:--:--';
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }

  function formatTime(time) {
    if (!time) return '--:--';
    const [h, m] = time.split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }

  // ── i18n apply ──
  function t(key) { return translations[currentLocale]?.[key] || translations.en[key] || key; }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (translations[currentLocale]?.[key]) el.textContent = translations[currentLocale][key];
      else if (translations.en[key]) el.textContent = translations.en[key];
    });
    document.documentElement.lang = currentLocale;
  }

  function renderLangSwitcher() {
    document.querySelectorAll('#lang-switcher').forEach(container => {
      container.innerHTML = ['ru', 'en'].map(l =>
        `<button type="button" onclick="window.NoorApp.setLocale('${l}')" class="px-4 py-1 rounded-full text-[14px] font-medium transition-colors ${currentLocale === l ? 'bg-primary/20 text-primary' : 'text-[#bdc9c2] hover:text-primary'}">${l.toUpperCase()}</button>`
      ).join('');
    });
  }

  // ══════════════════════════════════════════════════════════════
  // DATABASE FETCH – All data comes from Supabase via API
  // ══════════════════════════════════════════════════════════════

  // Cache-busting query param ensures we never get an intermediary CDN cached
  // response. The Service Worker also forwards API requests with cache:'no-store'
  // and the backend sets Cache-Control: no-store, so a CSV upload is reflected
  // for every client on the very next poll.
  function apiUrl(path) {
    const sep = path.includes('?') ? '&' : '?';
    return path + sep + '_=' + Date.now();
  }

  async function fetchToday() {
    try {
      const res = await fetch(apiUrl('/api/prayer-times/today'), { cache: 'no-store', credentials: 'same-origin' });
      const json = await res.json();
      if (json.success) {
        PrayerState.todayData = json.data.today || null;
        if (json.data.version) PrayerState.dataVersion = json.data.version;
        return true;
      }
    } catch { }
    return false;
  }

  async function fetchTomorrow() {
    try {
      const res = await fetch(apiUrl('/api/prayer-times/tomorrow'), { cache: 'no-store', credentials: 'same-origin' });
      const json = await res.json();
      if (json.success) {
        PrayerState.tomorrowData = json.data.tomorrow || null;
        if (json.data.version) PrayerState.dataVersion = json.data.version;
        return true;
      }
    } catch { }
    return false;
  }

  /** Fetch all prayer data and refresh UI */
  async function refreshAllData() {
    await Promise.all([fetchToday(), fetchTomorrow()]);
    renderPrayerList();
    scheduleNotifications();
    // Update landing page preview if on that page
    updateLandingPreview();
  }

  // ══════════════════════════════════════════════════════════════
  // VERSION-BASED POLLING – Detects admin uploads/deletes instantly
  // ══════════════════════════════════════════════════════════════

  async function checkDataVersion() {
    try {
      const res = await fetch(apiUrl('/api/data-version'), { cache: 'no-store', credentials: 'same-origin' });
      const json = await res.json();
      if (json.success && json.data.version !== PrayerState.dataVersion) {
        // Server data has changed – refresh everything.
        PrayerState.dataVersion = json.data.version;
        // Tell the SW to drop any cached /api/ responses (defence-in-depth).
        try { navigator.serviceWorker?.controller?.postMessage({ type: 'NOOR_CACHE_BUST' }); } catch { }
        await refreshAllData();
      }
    } catch { }
  }

  function startVersionPolling() {
    if (versionPollInterval) clearInterval(versionPollInterval);
    // Poll every 10 seconds for data changes. This is the heartbeat that
    // propagates an admin CSV upload to every connected client.
    versionPollInterval = setInterval(checkDataVersion, 10000);
  }

  // ══════════════════════════════════════════════════════════════
  // MIDNIGHT ROLLOVER – Centralized date-change handling
  // ══════════════════════════════════════════════════════════════

  async function handleMidnightRollover(newDate) {
    if (PrayerState.rolloverInFlight) return;
    PrayerState.rolloverInFlight = true;
    try {
      // If we pre-fetched tomorrow and it matches the new date, promote it
      if (PrayerState.tomorrowData?.date === newDate) {
        PrayerState.todayData = PrayerState.tomorrowData;
        PrayerState.tomorrowData = null;
      } else {
        // Fetch fresh from database
        await fetchToday();
      }
      // Always fetch new tomorrow
      await fetchTomorrow();

      // Re-render and reschedule
      renderPrayerList();
      scheduleNotifications();
      // Clear stale notification fired records
      pruneFiredNotifications();
    } finally {
      PrayerState.rolloverInFlight = false;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // HOME PAGE – Live clock, prayer status, countdown
  // ══════════════════════════════════════════════════════════════

  function tickHome() {
    const moscow = getMoscowNow();

    // Live clock
    const clockEl = document.getElementById('live-clock');
    if (clockEl) clockEl.textContent = moscow.time.slice(0, 5);

    // Live date
    const dateEl = document.getElementById('live-date');
    if (dateEl) {
      const d = new Date(`${moscow.date}T12:00:00+03:00`);
      const opts = { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ };
      const locale = currentLocale === 'ru' ? 'ru-RU' : 'en-US';
      dateEl.textContent = d.toLocaleDateString(locale, opts);
    }

    // Midnight rollover – check if date changed
    if (PrayerState.lastFetchDate && moscow.date !== PrayerState.lastFetchDate) {
      handleMidnightRollover(moscow.date);
    }
    PrayerState.lastFetchDate = moscow.date;

    // Compute prayer status from centralized DB state
    const status = computePrayerStatus();
    updatePrayerUI(status);
  }

  function updatePrayerUI(status) {
    const cp = document.getElementById('current-prayer');
    const cd = document.getElementById('countdown');
    const nl = document.getElementById('next-prayer-label');

    if (!status.hasData) {
      // No database data – show empty state
      if (cp) cp.textContent = t('noData');
      if (cd) cd.textContent = '--:--:--';
      if (nl) nl.textContent = '';
      return;
    }

    const focusPrayer = status.current || status.next;
    if (cp) cp.textContent = focusPrayer ? t(focusPrayer) : t('noData');
    if (cd) cd.textContent = formatCountdown(status.countdownSeconds);
    if (nl) {
      if (status.next) {
        const prefix = status.isNextDay ? t('tomorrowFajr') : `${t('untilPrayer')} ${t(status.next)}`;
        nl.textContent = prefix;
      } else if (status.current) {
        nl.textContent = t('today');
      } else {
        nl.textContent = '';
      }
    }

    // Update prayer list highlights
    if (PrayerState.todayData) {
      PRAYERS.forEach(p => {
        const row = document.getElementById(`prayer-row-${p}`);
        if (!row) return;
        if (p === focusPrayer) {
          row.className = 'prayer-row-active flex justify-between items-center py-3';
          row.querySelector('.prayer-name').className = 'prayer-name text-primary font-bold';
          row.querySelector('.prayer-time').className = 'prayer-time text-[20px] leading-7 font-semibold text-primary font-bold';
        } else {
          row.className = 'flex justify-between items-center py-3 border-b border-white/5 last:border-b-0';
          row.querySelector('.prayer-name').className = 'prayer-name text-[#bdc9c2]';
          row.querySelector('.prayer-time').className = 'prayer-time text-[20px] leading-7 font-semibold';
        }
      });
    }
  }

  function renderPrayerList() {
    const container = document.getElementById('prayer-list');
    if (!container) return;

    if (!PrayerState.todayData) {
      // Empty state – no DB data for today
      container.innerHTML = `<div class="py-6 text-[#bdc9c2]">${t('noData')}</div>`;
      return;
    }

    container.innerHTML = PRAYERS.map(p =>
      `<div id="prayer-row-${p}" class="flex justify-between items-center py-3 border-b border-white/5 last:border-b-0">
        <span class="prayer-name text-[#bdc9c2]">${t(p)}</span>
        <span class="prayer-time text-[20px] leading-7 font-semibold">${formatTime(PrayerState.todayData[p])}</span>
      </div>`
    ).join('');
  }

  // ── Landing page – show DB times in preview panel ──
  function updateLandingPreview() {
    const container = document.getElementById('landing-preview-times');
    if (!container) return;

    const row = PrayerState.todayData;
    const previewPrayers = ['fajr', 'dhuhr', 'asr'];
    container.innerHTML = previewPrayers.map((p, i) => {
      const time = row ? formatTime(row[p]) : '--:--';
      const isMiddle = i === 1;
      if (isMiddle) {
        return `<div class="flex justify-between items-center p-2 rounded bg-primary/20 border border-primary/30 shadow-[0_0_15px_rgba(126,215,183,0.1)]"><span class="text-primary font-bold" data-i18n="${p}">${t(p)}</span><span class="text-primary font-bold">${time}</span></div>`;
      }
      return `<div class="flex justify-between items-center p-2 rounded bg-surface/50"><span class="text-[#bdc9c2] text-sm" data-i18n="${p}">${t(p)}</span><span class="font-medium">${time}</span></div>`;
    }).join('');
  }

  // ── Schedule page ──
  async function loadSchedule(month) {
    currentScheduleMonth = month;
    const label = document.getElementById('month-label');
    if (label) {
      const [y, m] = month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1, 1));
      label.textContent = d.toLocaleDateString(currentLocale === 'ru' ? 'ru-RU' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }

    const body = document.getElementById('schedule-body');
    if (!body) return;
    body.innerHTML = `<tr><td colspan="6" class="py-8 px-6 text-[#bdc9c2]">${t('loading')}</td></tr>`;

    try {
      const res = await fetch(apiUrl(`/api/prayer-times/monthly?month=${month}`), { cache: 'no-store', credentials: 'same-origin' });
      const json = await res.json();
      const rows = json.data?.rows || [];
      const today = getMoscowNow().date;

      if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="py-8 px-6 text-[#bdc9c2]">${t('monthFallback')}</td></tr>`;
        return;
      }

      body.innerHTML = rows.map(row => {
        const isToday = row.date === today;
        const dateLabel = new Date(`${row.date}T00:00:00Z`).toLocaleDateString(currentLocale === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        return `<tr class="${isToday ? 'relative z-10 bg-primary/10 border-y border-primary/40 shadow-[inset_0_0_20px_rgba(126,215,183,0.15)]' : 'hover:bg-white/[0.02] transition-colors duration-200'}">
          <td class="${isToday ? 'py-4 px-6 text-[20px] leading-7 font-semibold text-primary flex items-center gap-2' : 'py-4 px-6 text-[#bdc9c2]'}">${dateLabel}${isToday ? ` <span class="text-xs text-[#e9c176]">${t('todayBadge')}</span>` : ''}</td>
          ${PRAYERS.map(p => `<td class="${isToday ? 'py-4 px-6 text-[20px] leading-7 font-semibold text-primary' : 'py-4 px-6'}">${formatTime(row[p])}</td>`).join('')}
        </tr>`;
      }).join('');
    } catch { body.innerHTML = `<tr><td colspan="6" class="py-8 px-6 text-[#ffb4ab]">Error loading data</td></tr>`; }
  }

  function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // ── Notifications page ──
  function renderNotifPage() {
    const prefs = getPrefs();

    // Permission status
    const status = document.getElementById('permission-status');
    if (status && 'Notification' in window) {
      const perm = Notification.permission;
      status.textContent = perm === 'granted' ? t('permGranted') : perm === 'denied' ? t('permDenied') : t('permDefault');
    }

    // Prayer list
    const list = document.getElementById('notif-prayer-list');
    if (list) {
      list.innerHTML = PRAYERS.map(p => {
        const checked = prefs.prayers[p];
        const timeStr = PrayerState.todayData ? formatTime(PrayerState.todayData[p]) : '--:--';
        return `<div class="glass-panel rounded-xl p-3 flex items-center justify-between mb-3 group transition-colors hover:bg-surface/10">
          <div class="flex items-center gap-6">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background:#323536"><span class="material-symbols-outlined text-[#bdc9c2]">notifications</span></div>
            <div><div class="text-[20px] leading-7 font-semibold">${t(p)}</div><div class="text-[#bdc9c2] text-[14px] font-medium">${timeStr}</div></div>
          </div>
          <label class="noor-switch-label">
            <input type="checkbox" ${checked ? 'checked' : ''} class="sr-only peer" onchange="window.NoorApp.togglePrayerNotif('${p}', this.checked)">
            <span class="noor-switch ${checked ? 'is-on' : ''}"><span></span></span>
          </label>
        </div>`;
      }).join('');
    }

    // Volume
    const vs = document.getElementById('volume-slider');
    const vd = document.getElementById('volume-display');
    if (vs) vs.value = prefs.audio.volume;
    if (vd) vd.textContent = Math.round(prefs.audio.volume * 100) + '%';

    // Mute
    const mt = document.getElementById('mute-toggle');
    if (mt) mt.checked = prefs.audio.muted;
  }

  // ══════════════════════════════════════════════════════════════
  // NOTIFICATION SCHEDULING – Uses ONLY database prayer times
  // ══════════════════════════════════════════════════════════════

  function notificationText(prayer, type, minutes) {
    const name = t(prayer);
    if (currentLocale === 'ru') {
      return type === 'before'
        ? { title: name, body: `${name}: ${t('prayerSoon').replace('{min}', minutes)}` }
        : { title: name, body: t('prayerNow') };
    }
    return type === 'before'
      ? { title: name, body: `${name} prayer starts in ${minutes} minutes` }
      : { title: name, body: `It is now time for ${name} prayer` };
  }

  function buildNotificationEvents() {
    const prefs = getPrefs();
    const minutes = Number(prefs.audio.notifyBeforeMinutes || 15);
    const beforeMs = minutes * 60 * 1000;
    const now = Date.now();
    // Only use database data – never generate
    const rows = [PrayerState.todayData, PrayerState.tomorrowData].filter(Boolean);
    const events = [];

    rows.forEach(row => {
      PRAYERS.forEach(prayer => {
        if (!prefs.prayers[prayer] || !row[prayer]) return;
        const prayerDt = getPrayerDateTime(row.date, row[prayer]);
        if (!prayerDt) return;
        const prayerAt = prayerDt.getTime();
        [
          { type: 'before', when: prayerAt - beforeMs },
          { type: 'at', when: prayerAt }
        ].forEach(item => {
          if (item.when < now - NOTIFICATION_GRACE_MS) return;
          const text = notificationText(prayer, item.type, minutes);
          events.push({
            id: `${row.date}-${prayer}-${item.type}-${minutes}`,
            tag: `noor-${row.date}-${prayer}-${item.type}`,
            prayer,
            type: item.type,
            when: item.when,
            title: text.title,
            body: text.body
          });
        });
      });
    });

    return events.sort((a, b) => a.when - b.when);
  }

  function scheduleNotifications() {
    // Clear ALL existing timers first
    Object.values(notifTimers).forEach(id => clearTimeout(id));
    notifTimers = {};

    // Build events from DB data only
    const events = buildNotificationEvents();
    writeJson(STORAGE_QUEUE, events);
    sendScheduleToServiceWorker(events);

    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const now = Date.now();
    events.forEach(event => {
      if (hasNotificationFired(event.id)) return;
      const delay = Math.max(0, event.when - now);
      notifTimers[event.id] = setTimeout(() => fireNotificationEvent(event), delay);
    });
  }

  async function sendScheduleToServiceWorker(events) {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({ type: 'NOOR_SCHEDULE_NOTIFICATIONS', events });
    } catch { }
  }

  async function fireNotificationEvent(event) {
    if (hasNotificationFired(event.id)) return;
    markNotificationFired(event.id);
    await showNotif(event.title, event.body, event.tag);
    showToast(event.body);

    if (event.type === 'at') {
      const prefs = getPrefs();
      if (prefs.audio.enabled && !prefs.audio.muted) playAdhan(prefs.audio.volume);
      if (prefs.audio.vibrate && navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
  }

  async function showNotif(title, body, tag) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const options = {
        body,
        tag,
        renotify: false,
        icon: '/icons/icon-192.png',
        badge: '/favicon.svg',
        timestamp: Date.now(),
        data: { url: '/home', tag }
      };
      if (reg) await reg.showNotification(title, options);
      else new Notification(title, options);
    } catch { }
  }

  function showToast(message) {
    const existing = document.querySelector('.noor-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'noor-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  // ── Adhan Audio ──
  function ensureAdhanAudio() {
    if (!adhanAudio) {
      adhanAudio = new Audio('/audio/adhan.mp3');
      adhanAudio.preload = 'auto';
      adhanAudio.playsInline = true;
    }
    return adhanAudio;
  }

  function unlockAdhanAudio() {
    if (audioUnlocked) return;
    const audio = ensureAdhanAudio();
    const previousMuted = audio.muted;
    audio.muted = true;
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = previousMuted;
      audioUnlocked = true;
    }).catch(() => {
      audio.muted = previousMuted;
    });
  }

  function playAdhan(volume) {
    const audio = ensureAdhanAudio();
    audio.pause();
    audio.currentTime = 0;
    audio.volume = Number(volume ?? 0.8);
    audio.muted = false;
    audio.play().catch(() => {
      showToast(currentLocale === 'ru' ? t('adhanAudio') : 'Tap once to enable Adhan audio');
    });
  }

  function updateToggleUI() {
    const prefs = getPrefs();
    const adhanBtn = document.getElementById('toggle-adhan');
    const vibrateBtn = document.getElementById('toggle-vibrate');
    const pushBtn = document.getElementById('toggle-push');

    if (adhanBtn) {
      const on = prefs.audio.enabled && !prefs.audio.muted;
      adhanBtn.classList.toggle('is-on', on);
      adhanBtn.setAttribute('aria-pressed', String(on));
    }
    if (vibrateBtn) {
      const on = prefs.audio.vibrate;
      vibrateBtn.classList.toggle('is-on', on);
      vibrateBtn.setAttribute('aria-pressed', String(on));
    }
    if (pushBtn) {
      const on = typeof Notification !== 'undefined' && Notification.permission === 'granted';
      pushBtn.classList.toggle('is-on', on);
      pushBtn.setAttribute('aria-pressed', String(on));
    }

    // Reminder buttons
    document.querySelectorAll('.reminder-btn').forEach(btn => {
      const min = parseInt(btn.getAttribute('data-minutes'));
      btn.classList.toggle('active', min === prefs.audio.notifyBeforeMinutes);
    });

    document.querySelectorAll('.noor-switch-label input').forEach(input => {
      const control = input.parentElement?.querySelector('.noor-switch');
      if (control) control.classList.toggle('is-on', input.checked);
    });
  }

  // ── PWA Registration ──
  async function registerSW() {
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/sw.js'); } catch { }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════

  window.NoorApp = {
    setLocale(l) {
      currentLocale = l;
      localStorage.setItem(STORAGE_LANG, l);
      document.cookie = `NEXT_LOCALE=${l};path=/;max-age=31536000;SameSite=Lax`;
      applyI18n();
      renderLangSwitcher();
      renderPrayerList();
      updateLandingPreview();
      if (window.__ACTIVE_PAGE__ === 'schedule' && currentScheduleMonth) loadSchedule(currentScheduleMonth);
      if (window.__ACTIVE_PAGE__ === 'notifications') { renderNotifPage(); updateToggleUI(); }
      scheduleNotifications();
    },
    toggleAdhan() {
      const p = getPrefs();
      if (p.audio.muted) { p.audio.muted = false; }
      else { p.audio.enabled = !p.audio.enabled; }
      savePrefs(p); updateToggleUI(); scheduleNotifications();
    },
    toggleVibrate() {
      const p = getPrefs();
      p.audio.vibrate = !p.audio.vibrate;
      savePrefs(p); updateToggleUI();
    },
    togglePush() {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(() => { updateToggleUI(); scheduleNotifications(); });
      } else {
        updateToggleUI();
        scheduleNotifications();
      }
    },
    setReminder(min) {
      const p = getPrefs();
      p.audio.notifyBeforeMinutes = min;
      savePrefs(p); updateToggleUI(); scheduleNotifications();
    },
    askNotifPermission() {
      if (typeof Notification === 'undefined') return;
      Notification.requestPermission().then(perm => {
        const s = document.getElementById('permission-status');
        if (s) s.textContent = perm === 'granted' ? t('permGranted') : perm === 'denied' ? t('permDenied') : t('permDefault');
        scheduleNotifications();
      });
    },
    togglePrayerNotif(prayer, checked) {
      const p = getPrefs();
      p.prayers[prayer] = checked;
      savePrefs(p); updateToggleUI(); scheduleNotifications();
    },
    setVolume(v) {
      const p = getPrefs();
      p.audio.volume = parseFloat(v);
      savePrefs(p);
      if (adhanAudio) adhanAudio.volume = p.audio.volume;
      const vd = document.getElementById('volume-display');
      if (vd) vd.textContent = Math.round(p.audio.volume * 100) + '%';
    },
    toggleMute() {
      const p = getPrefs();
      p.audio.muted = !p.audio.muted;
      savePrefs(p);
      if (adhanAudio) adhanAudio.muted = p.audio.muted;
      updateToggleUI();
    },
    playAdhanPreview() {
      const p = getPrefs();
      playAdhan(p.audio.volume);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // ADMIN – Upload/Delete triggers version bump on server
  // ══════════════════════════════════════════════════════════════

  window.NoorAdmin = {
    async login(e) {
      e.preventDefault();
      const pw = document.getElementById('admin-password').value;
      const errEl = document.getElementById('login-error');
      try {
        const res = await fetch('/api/admin/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw })
        });
        const json = await res.json();
        if (json.success) {
          document.getElementById('admin-login').classList.add('hidden');
          document.getElementById('admin-dashboard').classList.remove('hidden');
          this.refreshMonths();
        } else {
          errEl.textContent = json.error?.message || 'Invalid password';
          errEl.classList.remove('hidden');
        }
      } catch { errEl.textContent = 'Network error'; errEl.classList.remove('hidden'); }
      return false;
    },
    async logout() {
      await fetch('/api/admin/session', { method: 'DELETE' });
      document.getElementById('admin-login').classList.remove('hidden');
      document.getElementById('admin-dashboard').classList.add('hidden');
    },
    async refreshMonths() {
      try {
        const res = await fetch(apiUrl('/api/admin/prayer-times'), { cache: 'no-store', credentials: 'same-origin' });
        const json = await res.json();
        const months = json.data?.months || [];
        const list = document.getElementById('months-list');
        if (!list) return;
        if (months.length === 0) { list.innerHTML = `<p class="text-[#bdc9c2]">${t('noMonths')}</p>`; return; }
        list.innerHTML = months.map(m => {
          const [y, mo] = m.split('-').map(Number);
          const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(currentLocale === 'ru' ? 'ru-RU' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
          return `<div class="flex items-center justify-between p-3 rounded-lg" style="background:rgba(50,53,54,0.5)">
            <span class="text-[14px] font-medium capitalize">${label}</span>
            <button type="button" onclick="window.NoorAdmin.deleteMonth('${m}')" class="text-[#ffb4ab] hover:opacity-80"><span class="material-symbols-outlined text-sm">delete</span></button>
          </div>`;
        }).join('');
      } catch { }
    },
    async deleteMonth(month) {
      if (!confirm(`Delete all prayer times for ${month}?`)) return;
      try {
        const res = await fetch('/api/admin/delete-month', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city: 'Nizhny Novgorod', month }) });
        const json = await res.json();
        if (json.success) {
          // Update local version immediately
          if (json.data?.version) PrayerState.dataVersion = json.data.version;
          this.refreshMonths();
          // Force immediate data refresh for this admin tab too
          await refreshAllData();
        }
      } catch { }
    },
    async upload(mode) {
      const fileInput = document.getElementById('csv-file');
      const file = fileInput?.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);
      const statusEl = document.getElementById('upload-status');
      const errSection = document.getElementById('error-section');
      const errList = document.getElementById('error-list');
      if (statusEl) statusEl.textContent = 'Processing...';

      try {
        const res = await fetch('/api/admin/prayer-times', { method: 'POST', cache: 'no-store', credentials: 'same-origin', body: formData });
        let json;
        try { json = await res.json(); }
        catch { json = { success: false, error: { message: `Server returned ${res.status} ${res.statusText}` } }; }

        // ── Surface real server errors instead of masking them as "0 valid rows" ──
        if (!json.success) {
          const msg = json.error?.message || `Upload failed (HTTP ${res.status})`;
          if (statusEl) statusEl.textContent = msg;
          if (errSection && errList) {
            errSection.classList.remove('hidden');
            errList.innerHTML = `<p class="text-[#ffb4ab]">${msg}</p>`;
          }
          return;
        }

        const data = json.data;
        if (statusEl) {
          if (data?.committed) {
            statusEl.textContent = `${data.savedRows} rows saved.`;
          } else if (data?.validRows > 0) {
            statusEl.textContent = `${data.validRows} valid rows (preview).`;
          } else {
            // 0 valid rows — explain WHY using the first error message we have
            const first = data?.errors?.[0]?.message;
            statusEl.textContent = first ? `0 valid rows — ${first}` : '0 valid rows.';
          }
        }

        // Preview table
        const body = document.getElementById('preview-body');
        if (body && data?.rows) {
          body.innerHTML = data.rows.slice(0, 12).map(r =>
            `<tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td class="py-3 px-4 text-[#bdc9c2]">${r.date}</td><td class="py-3 px-4">${r.fajr}</td><td class="py-3 px-4">${r.dhuhr}</td>
              <td class="py-3 px-4">${r.asr}</td><td class="py-3 px-4">${r.maghrib}</td><td class="py-3 px-4">${r.isha}</td><td class="py-3 px-4">${r.city}</td>
            </tr>`
          ).join('');
        }

        // Errors
        if (data?.errors?.length > 0) {
          errSection?.classList.remove('hidden');
          if (errList) errList.innerHTML = data.errors.slice(0, 20).map(e => `<p class="text-[#ffb4ab]">Row ${e.row}: ${e.message}${e.value ? ` (value: "${e.value}")` : ''}</p>`).join('');
        } else { errSection?.classList.add('hidden'); }

        if (data?.committed) {
          // Update local version immediately
          if (data.version) PrayerState.dataVersion = data.version;
          // Tell the SW to drop any cached /api/ responses so this tab AND
          // every other tab/device picks up the new data on its next poll.
          try { navigator.serviceWorker?.controller?.postMessage({ type: 'NOOR_CACHE_BUST' }); } catch { }
          this.refreshMonths();
          // Force immediate data refresh
          await refreshAllData();
        }
      } catch (e) {
        if (statusEl) statusEl.textContent = `Upload failed: ${e?.message || 'network error'}`;
      }
    }
  };

  // ── File input label ──
  document.addEventListener('change', e => {
    if (e.target.id === 'csv-file') {
      const el = document.getElementById('selected-file');
      if (el && e.target.files?.[0]) el.textContent = e.target.files[0].name;
    }
  });

  // ── Reminder buttons ──
  document.addEventListener('click', e => {
    if (e.target.classList.contains('reminder-btn')) {
      window.NoorApp.setReminder(parseInt(e.target.getAttribute('data-minutes')));
    }
  });

  // ══════════════════════════════════════════════════════════════
  // INITIALIZATION – Database-driven from the start
  // ══════════════════════════════════════════════════════════════

  async function init() {
    const page = window.__ACTIVE_PAGE__;

    // Register service worker
    await registerSW();

    // Apply i18n
    applyI18n();
    renderLangSwitcher();
    document.addEventListener('pointerdown', unlockAdhanAudio, { once: true, passive: true });

    // Resume version polling when tab becomes visible.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        checkDataVersion();
        scheduleNotifications();
      }
    });
    // Also re-check on bfcache restore (mobile) and when the network returns.
    window.addEventListener('pageshow', () => { checkDataVersion(); });
    window.addEventListener('focus', () => { checkDataVersion(); });
    window.addEventListener('online', () => { checkDataVersion(); });

    // Start version polling on ALL pages to detect admin changes
    startVersionPolling();

    if (page === 'home') {
      await refreshAllData();
      updateToggleUI();
      tickHome();
      setInterval(tickHome, 1000);
    }

    if (page === 'landing') {
      // Fetch today's data for preview panel
      await fetchToday();
      updateLandingPreview();
    }

    if (page === 'schedule') {
      const month = getMoscowNow().date.slice(0, 7);
      await loadSchedule(month);
      document.getElementById('prev-month')?.addEventListener('click', () => loadSchedule(shiftMonth(currentScheduleMonth, -1)));
      document.getElementById('next-month')?.addEventListener('click', () => loadSchedule(shiftMonth(currentScheduleMonth, 1)));
    }

    if (page === 'notifications') {
      await refreshAllData();
      renderNotifPage();
      updateToggleUI();
    }

    if (page === 'admin') {
      // Check if already authenticated
      try {
        const res = await fetch('/api/admin/session');
        const json = await res.json();
        if (json.data?.authenticated) {
          document.getElementById('admin-login')?.classList.add('hidden');
          document.getElementById('admin-dashboard')?.classList.remove('hidden');
          window.NoorAdmin.refreshMonths();
        }
      } catch { }
    }

    // Splash auto-redirect
    if (page === 'splash') {
      setTimeout(() => { window.location.href = '/home'; }, 2000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  inject()
})();
