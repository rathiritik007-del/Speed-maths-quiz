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
    theme: 'quiz_theme',
    profileAvatar: 'quiz_profile_avatar'
  };

  const pending = {};
  const migrationStarted = {};

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

  function hasValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function rowHasCloudValue(row, keys) {
    if (!row) return false;
    return keys.some(key => hasValue(row[key]));
  }

  async function requestData(scope, request, fallback) {
    try {
      const { data, error } = await request;
      if (error) {
        warnSync(scope, error);
        return fallback;
      }
      return data === null || data === undefined ? fallback : data;
    } catch(error) {
      warnSync(scope, error);
      return fallback;
    }
  }

  function mapProfileRow(userId) {
    const profile = readJSON(KEYS.profile, {});
    if (!profile || (!profile.name && !profile.joinedDate)) return null;
    return {
      user_id: userId,
      name: profile.name || null,
      joined_date: profile.joinedDate || null,
      updated_at: new Date().toISOString()
    };
  }

  function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const meta = parts[0];
    const mimeMatch = meta.match(/^data:([^;]+);base64$/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function avatarExtension(file, blob) {
    const mime = (file && file.type) || (blob && blob.type) || 'image/png';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    return 'png';
  }

  async function uploadProfileAvatar(ctx, dataUrl, file) {
    if (!ctx || !dataUrl) return null;
    const blob = file || dataUrlToBlob(dataUrl);
    if (!blob) return null;
    const ext = avatarExtension(file, blob);
    const path = `${ctx.user.id}/avatar.${ext}`;
    const { error: uploadError } = await ctx.client.storage
      .from('profile-pictures')
      .upload(path, blob, {
        cacheControl: '3600',
        contentType: blob.type || 'image/png',
        upsert: true
      });
    if (uploadError) throw uploadError;
    const { data } = ctx.client.storage.from('profile-pictures').getPublicUrl(path);
    const publicUrl = data && data.publicUrl ? data.publicUrl : null;
    if (!publicUrl) throw new Error('Could not create profile avatar public URL.');
    const profile = readJSON(KEYS.profile, {});
    const { error: profileError } = await ctx.client.from('user_profile').upsert({
      user_id: ctx.user.id,
      name: profile.name || null,
      joined_date: profile.joinedDate || null,
      avatar_path: path,
      avatar_url: publicUrl,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (profileError) throw profileError;
    return { path, publicUrl };
  }

  function syncProfileAvatarToSupabase(dataUrl, file) {
    const ctx = getClientAndUser();
    if (!ctx || !dataUrl) return;
    uploadProfileAvatar(ctx, dataUrl, file).catch(error => warnSync('profile avatar', error));
  }

  async function migrateProfileAvatarIfCloudEmpty(ctx) {
    try {
      const avatar = readString(KEYS.profileAvatar, null);
      if (!avatar) return;
      const existing = await requestData(
        'migration profile avatar',
        ctx.client.from('user_profile').select('avatar_url, avatar_path').eq('user_id', ctx.user.id).maybeSingle(),
        null
      );
      if (rowHasCloudValue(existing, ['avatar_url', 'avatar_path'])) return;
      await uploadProfileAvatar(ctx, avatar, null);
    } catch(error) {
      warnSync('migration profile avatar', error);
    }
  }

  function mapProgressRow(userId) {
    const xp = readJSON(KEYS.xp, {});
    const pb = readJSON(KEYS.pb, {});
    const dayStreak = readJSON(KEYS.dayStreak, {});
    const goalRaw = readString(KEYS.dailyGoal, null);
    const practiceRaw = readString(KEYS.practiceMode, null);
    const hasProgress = Object.keys(xp || {}).length
      || Object.keys(pb || {}).length
      || Object.keys(dayStreak || {}).length
      || goalRaw !== null
      || practiceRaw !== null;
    if (!hasProgress) return null;
    return {
      user_id: userId,
      total_xp: xp.totalXP || 0,
      current_level: xp.currentLevel || 1,
      best_pct: pb.bestPct || 0,
      best_session_streak: pb.bestStreak || 0,
      day_streak: dayStreak.streak || 0,
      best_day_streak: dayStreak.bestStreak || 0,
      last_streak_date: dayStreak.lastDate || null,
      daily_goal: parseInt(goalRaw || '20') || 20,
      practice_mode: practiceRaw === '1',
      updated_at: new Date().toISOString()
    };
  }

  function mapSettingsRow(userId) {
    const baseTheme = readString(KEYS.baseTheme, null);
    const theme = readString(KEYS.theme, null);
    const customColorsOn = readString(KEYS.customColorsOn, null);
    const customColors = readJSON(KEYS.customColors, null);
    if (baseTheme === null && theme === null && customColorsOn === null && customColors === null) return null;
    return {
      user_id: userId,
      base_theme: baseTheme || 'vibrant',
      theme: theme || 'default',
      custom_colors_enabled: customColorsOn === '1',
      custom_colors: customColors,
      updated_at: new Date().toISOString()
    };
  }

  function mapSessionRow(userId, session) {
    return {
      user_id: userId,
      total_questions: session.total,
      correct_answers: session.score,
      accuracy: session.pct,
      time_taken_seconds: null,
      mode: session.timed ? 'timed' : 'practice',
      raw_data: session
    };
  }

  function sessionKey(session) {
    return [
      session && session.date,
      session && session.score,
      session && session.total,
      session && session.pct
    ].join('|');
  }

  function mapDailyChallengeRows(userId) {
    const current = readJSON(KEYS.dailyChallenge, {});
    const history = readJSON(KEYS.dcHistory, []);
    const byDate = {};
    if (current && current.date) byDate[current.date] = current;
    if (Array.isArray(history)) {
      history.forEach(item => {
        if (item && item.date) byDate[item.date] = { ...byDate[item.date], ...item };
      });
    }
    return Object.keys(byDate).map(date => {
      const item = byDate[date] || {};
      return {
        user_id: userId,
        challenge_date: date,
        completed: !!item.completed || item.score !== undefined,
        score: item.score || 0,
        total: item.total || 0,
        pct: item.pct || 0,
        bracket: item.bracket || null,
        raw_data: item
      };
    });
  }

  async function insertRowIfCloudEmpty(ctx, table, row, cloudValueKeys) {
    if (!row) return;
    const existing = await requestData(
      'migration ' + table,
      ctx.client.from(table).select('*').eq('user_id', ctx.user.id).maybeSingle(),
      null
    );
    if (rowHasCloudValue(existing, cloudValueKeys)) return;
    runRequest('migration ' + table, ctx.client.from(table).upsert(row, { onConflict: 'user_id' }));
  }

  async function migrateSessions(ctx) {
    const history = readJSON(KEYS.history, []);
    if (!Array.isArray(history) || !history.length) return;
    const existingRows = await requestData(
      'migration sessions',
      ctx.client.from('sessions').select('raw_data').eq('user_id', ctx.user.id),
      []
    );
    const existingKeys = new Set((Array.isArray(existingRows) ? existingRows : [])
      .map(row => row && row.raw_data ? sessionKey(row.raw_data) : '')
      .filter(Boolean));
    const rows = history
      .filter(session => session && !existingKeys.has(sessionKey(session)))
      .map(session => mapSessionRow(ctx.user.id, session));
    if (rows.length) runRequest('migration sessions', ctx.client.from('sessions').insert(rows));
  }

  function migrateMilestones(ctx) {
    const ids = readJSON(KEYS.milestones, []);
    if (!Array.isArray(ids) || !ids.length) return;
    const rows = ids.map(id => ({
      user_id: ctx.user.id,
      milestone_id: id,
      unlocked_at: new Date().toISOString()
    }));
    runRequest('migration achievements_or_milestones', ctx.client.from('achievements_or_milestones').upsert(rows, { onConflict: 'user_id,milestone_id' }));
  }

  async function migrateDataRowIfCloudEmpty(ctx, table, row, dataKeys) {
    if (!row) return;
    const existing = await requestData(
      'migration ' + table,
      ctx.client.from(table).select('*').eq('user_id', ctx.user.id).maybeSingle(),
      null
    );
    if (rowHasCloudValue(existing, dataKeys)) return;
    runRequest('migration ' + table, ctx.client.from(table).upsert(row, { onConflict: 'user_id' }));
  }

  async function migrateDailyChallenges(ctx) {
    const rows = mapDailyChallengeRows(ctx.user.id);
    if (!rows.length) return;
    const existingRows = await requestData(
      'migration daily_challenges',
      ctx.client.from('daily_challenges').select('challenge_date').eq('user_id', ctx.user.id),
      []
    );
    const existingDates = new Set((Array.isArray(existingRows) ? existingRows : [])
      .map(row => row && row.challenge_date)
      .filter(Boolean));
    const missingRows = rows.filter(row => !existingDates.has(row.challenge_date));
    if (missingRows.length) runRequest('migration daily_challenges', ctx.client.from('daily_challenges').insert(missingRows));
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

  function migrateLocalAppStateToSupabase() {
    const ctx = getClientAndUser();
    if (!ctx) return;
    if (migrationStarted[ctx.user.id]) return;
    migrationStarted[ctx.user.id] = true;
    (async () => {
      try {
        await insertRowIfCloudEmpty(ctx, 'user_profile', mapProfileRow(ctx.user.id), ['name', 'joined_date']);
        await migrateProfileAvatarIfCloudEmpty(ctx);
        await insertRowIfCloudEmpty(ctx, 'user_progress', mapProgressRow(ctx.user.id), [
          'total_xp',
          'current_level',
          'best_pct',
          'best_session_streak',
          'day_streak',
          'best_day_streak',
          'last_streak_date',
          'daily_goal',
          'practice_mode'
        ]);
        await insertRowIfCloudEmpty(ctx, 'user_settings', mapSettingsRow(ctx.user.id), [
          'base_theme',
          'theme',
          'custom_colors_enabled',
          'custom_colors'
        ]);
        await migrateSessions(ctx);
        migrateMilestones(ctx);
        await migrateDataRowIfCloudEmpty(ctx, 'weakness_stats', readString(KEYS.weakness, null) === null ? null : {
          user_id: ctx.user.id,
          weakness_data: readJSON(KEYS.weakness, {}),
          updated_at: new Date().toISOString()
        }, ['weakness_data']);
        await migrateDataRowIfCloudEmpty(ctx, 'spaced_repetition_queue', readString(KEYS.srQueue, null) === null ? null : {
          user_id: ctx.user.id,
          queue: readJSON(KEYS.srQueue, []),
          updated_at: new Date().toISOString()
        }, ['queue']);
        await migrateDailyChallenges(ctx);
        try { localStorage.setItem('quiz_local_data_synced', '1'); } catch(e) {}
        try { localStorage.removeItem('quiz_sync_notice_dismissed'); } catch(e) {}
        window.updateSyncNotice?.();
      } catch(error) {
        warnSync('migration', error);
      }
    })();
  }

  async function resetSupabaseAppData(options) {
    const ctx = getClientAndUser();
    if (!ctx) return;
    const preserveProfile = options && options.preserveProfile;
    const tables = [
      'sessions',
      'user_progress',
      'user_settings',
      'achievements_or_milestones',
      'weakness_stats',
      'spaced_repetition_queue',
      'daily_challenges'
    ];
    if (!preserveProfile) tables.push('user_profile');
    await Promise.all(tables.map(async table => {
      try {
        const { error } = await ctx.client.from(table).delete().eq('user_id', ctx.user.id);
        if (error) warnSync('reset ' + table, error);
      } catch(error) {
        warnSync('reset ' + table, error);
      }
    }));
    if (preserveProfile) {
      const profile = preserveProfile;
      runRequest('reset user_profile', ctx.client.from('user_profile').upsert({
        user_id: ctx.user.id,
        name: profile.name || null,
        joined_date: profile.joinedDate || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' }));
    }
  }

  window.syncProfileToSupabase = syncProfileToSupabase;
  window.syncProfileAvatarToSupabase = syncProfileAvatarToSupabase;
  window.syncUserProgressToSupabase = syncUserProgressToSupabase;
  window.syncUserSettingsToSupabase = syncUserSettingsToSupabase;
  window.syncMilestonesToSupabase = syncMilestonesToSupabase;
  window.syncWeaknessToSupabase = syncWeaknessToSupabase;
  window.syncSpacedRepetitionToSupabase = syncSpacedRepetitionToSupabase;
  window.syncDailyChallengesToSupabase = syncDailyChallengesToSupabase;
  window.syncSessionToSupabase = syncSessionToSupabase;
  window.syncLatestSessionToSupabase = syncLatestSessionToSupabase;
  window.syncAllLocalAppStateToSupabase = syncAllLocalAppStateToSupabase;
  window.migrateLocalAppStateToSupabase = migrateLocalAppStateToSupabase;
  window.resetSupabaseAppData = resetSupabaseAppData;
})();
