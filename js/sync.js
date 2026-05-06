(function () {
  const KEYS = {
    history: 'quiz_history',
    profile: 'quiz_profile',
    pb: 'quiz_pb',
    xp: 'quiz_xp',
    dayStreak: 'quiz_day_streak2',
    dailyGoal: 'quiz_daily_goal',
    milestones: 'quiz_milestones',
    weakness: 'quiz_weakness',
    srQueue: 'quiz_sr_queue',
    dailyChallenge: 'quiz_daily_challenge',
    dcHistory: 'quiz_dc_history',
    practiceMode: 'quiz_practice_mode',
    customColors: 'quiz_custom_colors',
    customColorsOn: 'quiz_custom_colors_on',
    baseTheme: 'quiz_base_theme',
    theme: 'quiz_theme'
  };

  const pending = {};

  function getClientAndUser() {
    const client = window.supabaseClient;
    const user = window.authState && window.authState.user;
    if (!client || !user || !user.id) return null;
    return { client, user };
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch(e) {
      return fallback;
    }
  }

  function readString(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch(e) {
      return fallback;
    }
  }

  function warnSync(scope, error) {
    console.warn('Supabase sync failed for ' + scope + ':', error && error.message ? error.message : error);
  }

  function runRequest(scope, request) {
    try {
      if (!request || typeof request.then !== 'function') return;
      request.then(({ error }) => {
        if (error) warnSync(scope, error);
      }).catch(error => warnSync(scope, error));
    } catch(error) {
      warnSync(scope, error);
    }
  }

  function schedule(scope, fn) {
    if (pending[scope]) clearTimeout(pending[scope]);
    pending[scope] = setTimeout(() => {
      pending[scope] = null;
      try { fn(); } catch(error) { warnSync(scope, error); }
    }, 250);
  }

  function syncProfileToSupabase() {
    schedule('user_profile', () => {
      const ctx = getClientAndUser();
      if (!ctx) return;
      const profile = readJSON(KEYS.profile, {});
      runRequest('user_profile', ctx.client.from('user_profile').upsert({
        user_id: ctx.user.id,
        name: profile.name || null,
        joined_date: profile.joinedDate || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' }));
    });
  }

  function syncUserProgressToSupabase() {
    schedule('user_progress', () => {
      const ctx = getClientAndUser();
      if (!ctx) return;
      const xp = readJSON(KEYS.xp, {});
      const pb = readJSON(KEYS.pb, {});
      const dayStreak = readJSON(KEYS.dayStreak, {});
      const goal = parseInt(readString(KEYS.dailyGoal, '20')) || 20;
      runRequest('user_progress', ctx.client.from('user_progress').upsert({
        user_id: ctx.user.id,
        total_xp: xp.totalXP || 0,
        current_level: xp.currentLevel || 1,
        best_pct: pb.bestPct || 0,
        best_session_streak: pb.bestStreak || 0,
        day_streak: dayStreak.streak || 0,
        best_day_streak: dayStreak.bestStreak || 0,
        last_streak_date: dayStreak.lastDate || null,
        daily_goal: goal,
        practice_mode: readString(KEYS.practiceMode, '0') === '1',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' }));
    });
  }

  function syncUserSettingsToSupabase() {
    schedule('user_settings', () => {
      const ctx = getClientAndUser();
      if (!ctx) return;
      runRequest('user_settings', ctx.client.from('user_settings').upsert({
        user_id: ctx.user.id,
        base_theme: readString(KEYS.baseTheme, 'vibrant'),
        theme: readString(KEYS.theme, 'default'),
        custom_colors_enabled: readString(KEYS.customColorsOn, '0') === '1',
        custom_colors: readJSON(KEYS.customColors, null),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' }));
    });
  }

  function syncMilestonesToSupabase() {
    schedule('achievements_or_milestones', () => {
      const ctx = getClientAndUser();
      if (!ctx) return;
      const ids = readJSON(KEYS.milestones, []);
      if (!Array.isArray(ids) || !ids.length) return;
      const rows = ids.map(id => ({
        user_id: ctx.user.id,
        milestone_id: id,
        unlocked_at: new Date().toISOString()
      }));
      runRequest('achievements_or_milestones', ctx.client.from('achievements_or_milestones').upsert(rows, { onConflict: 'user_id,milestone_id' }));
    });
  }

  function syncWeaknessToSupabase() {
    schedule('weakness_stats', () => {
      const ctx = getClientAndUser();
      if (!ctx) return;
      runRequest('weakness_stats', ctx.client.from('weakness_stats').upsert({
        user_id: ctx.user.id,
        weakness_data: readJSON(KEYS.weakness, {}),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' }));
    });
  }

  function syncSpacedRepetitionToSupabase() {
    schedule('spaced_repetition_queue', () => {
      const ctx = getClientAndUser();
      if (!ctx) return;
      runRequest('spaced_repetition_queue', ctx.client.from('spaced_repetition_queue').upsert({
        user_id: ctx.user.id,
        queue: readJSON(KEYS.srQueue, []),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' }));
    });
  }

  function syncDailyChallengesToSupabase() {
    schedule('daily_challenges', () => {
      const ctx = getClientAndUser();
      if (!ctx) return;
      const current = readJSON(KEYS.dailyChallenge, {});
      const history = readJSON(KEYS.dcHistory, []);
      const byDate = {};
      if (current && current.date) byDate[current.date] = current;
      if (Array.isArray(history)) {
        history.forEach(item => {
          if (item && item.date) byDate[item.date] = { ...byDate[item.date], ...item };
        });
      }
      const rows = Object.keys(byDate).map(date => {
        const item = byDate[date] || {};
        return {
          user_id: ctx.user.id,
          challenge_date: date,
          completed: !!item.completed || item.score !== undefined,
          score: item.score || 0,
          total: item.total || 0,
          pct: item.pct || 0,
          bracket: item.bracket || null,
          raw_data: item
        };
      });
      if (!rows.length) return;
      runRequest('daily_challenges', ctx.client.from('daily_challenges').upsert(rows, { onConflict: 'user_id,challenge_date' }));
    });
  }

  function syncSessionToSupabase(session) {
    const ctx = getClientAndUser();
    if (!ctx || !session) return;
    runRequest('sessions', ctx.client.from('sessions').insert({
      user_id: ctx.user.id,
      total_questions: session.total,
      correct_answers: session.score,
      accuracy: session.pct,
      time_taken_seconds: null,
      mode: session.timed ? 'timed' : 'practice',
      raw_data: session
    }));
  }

  function syncLatestSessionToSupabase() {
    const history = readJSON(KEYS.history, []);
    if (Array.isArray(history) && history[0]) syncSessionToSupabase(history[0]);
  }

  function syncAllLocalAppStateToSupabase() {
    if (!getClientAndUser()) return;
    syncProfileToSupabase();
    syncUserProgressToSupabase();
    syncUserSettingsToSupabase();
    syncMilestonesToSupabase();
    syncWeaknessToSupabase();
    syncSpacedRepetitionToSupabase();
    syncDailyChallengesToSupabase();
  }

  window.syncProfileToSupabase = syncProfileToSupabase;
  window.syncUserProgressToSupabase = syncUserProgressToSupabase;
  window.syncUserSettingsToSupabase = syncUserSettingsToSupabase;
  window.syncMilestonesToSupabase = syncMilestonesToSupabase;
  window.syncWeaknessToSupabase = syncWeaknessToSupabase;
  window.syncSpacedRepetitionToSupabase = syncSpacedRepetitionToSupabase;
  window.syncDailyChallengesToSupabase = syncDailyChallengesToSupabase;
  window.syncSessionToSupabase = syncSessionToSupabase;
  window.syncLatestSessionToSupabase = syncLatestSessionToSupabase;
  window.syncAllLocalAppStateToSupabase = syncAllLocalAppStateToSupabase;
})();
