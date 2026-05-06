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
  const syncDecisionInFlight = {};
  let pendingConflictRows = null;
  let pendingConflictSignature = null;
  let cloudReadFailed = false;

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

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
  }

  function writeString(key, value) {
    try { localStorage.setItem(key, String(value)); } catch(e) {}
  }

  function conflictResolvedKey(userId) {
    return 'quiz_sync_conflict_resolved_' + userId;
  }

  function conflictDismissedKey(userId) {
    return 'quiz_sync_conflict_dismissed_' + userId;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function showProfileSyncStatus() {
    const pill = document.getElementById('profileSyncPill');
    if (!pill) return;
    pill.classList.add('show');
    pill.setAttribute('aria-hidden', 'false');
  }

  function hideProfileSyncStatus() {
    const pill = document.getElementById('profileSyncPill');
    if (!pill) return;
    pill.classList.remove('show');
    pill.setAttribute('aria-hidden', 'true');
  }

  async function keepSyncingVisibleSince(startedAt, minMs = 1200) {
    const remaining = minMs - (Date.now() - startedAt);
    if (remaining > 0) await delay(remaining);
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

  function objectHasKeys(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
  }

  function hasMeaningfulLocalAppData() {
    const history = readJSON(KEYS.history, []);
    if (Array.isArray(history) && history.length) return true;

    if (readString(KEYS.profileAvatar, null)) return true;

    const xp = readJSON(KEYS.xp, {});
    if (xp && ((xp.totalXP || 0) > 0 || (xp.currentLevel || 1) > 1)) return true;

    const pb = readJSON(KEYS.pb, {});
    if (pb && ((pb.bestPct || 0) > 0 || (pb.bestStreak || 0) > 0)) return true;

    const dayStreak = readJSON(KEYS.dayStreak, {});
    if (dayStreak && ((dayStreak.streak || 0) > 0 || (dayStreak.bestStreak || 0) > 0 || dayStreak.lastDate)) return true;

    const milestones = readJSON(KEYS.milestones, []);
    if (Array.isArray(milestones) && milestones.length) return true;

    if (objectHasKeys(readJSON(KEYS.weakness, {}))) return true;

    const srQueue = readJSON(KEYS.srQueue, []);
    if (Array.isArray(srQueue) && srQueue.length) return true;

    if (objectHasKeys(readJSON(KEYS.dailyChallenge, {}))) return true;

    const dcHistory = readJSON(KEYS.dcHistory, []);
    return Array.isArray(dcHistory) && dcHistory.length;
  }

  function hasLocalProfileOnly() {
    const profile = readJSON(KEYS.profile, {});
    return !!(profile && (profile.name || profile.joinedDate));
  }

  async function requestData(scope, request, fallback) {
    try {
      const { data, error } = await request;
      if (error) {
        cloudReadFailed = true;
        warnSync(scope, error);
        return fallback;
      }
      return data === null || data === undefined ? fallback : data;
    } catch(error) {
      cloudReadFailed = true;
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

  async function uploadLocalAppStateToSupabase(ctx) {
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
  }

  function restoredSessionFromRow(row) {
    if (row && row.raw_data && typeof row.raw_data === 'object') {
      return row.raw_data;
    }
    return {
      score: row.correct_answers || 0,
      total: row.total_questions || 0,
      correct: row.correct_answers || 0,
      pct: row.accuracy || 0,
      xp: 0,
      date: row.created_at || new Date().toISOString(),
      timed: row.mode === 'timed' ? true : null
    };
  }

  function restoredDailyChallengeFromRow(row) {
    const raw = row && row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    return {
      ...raw,
      date: raw.date || row.challenge_date,
      completed: raw.completed !== undefined ? raw.completed : !!row.completed,
      score: raw.score !== undefined ? raw.score : (row.score || 0),
      total: raw.total !== undefined ? raw.total : (row.total || 0),
      pct: raw.pct !== undefined ? raw.pct : (row.pct || 0),
      bracket: raw.bracket || row.bracket || null
    };
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function cloudSignature(rows) {
    const [
      profileRow,
      progressRow,
      settingsRow,
      sessionRows,
      milestoneRows,
      weaknessRow,
      srRow,
      dailyRows
    ] = rows || [];
    const sessions = Array.isArray(sessionRows)
      ? sessionRows.map(row => row && row.raw_data ? sessionKey(row.raw_data) : [row && row.created_at, row && row.correct_answers, row && row.total_questions, row && row.accuracy].join('|')).sort()
      : [];
    return JSON.stringify({
      profile: profileRow ? [profileRow.name || '', profileRow.joined_date || '', profileRow.avatar_url || ''] : [],
      progress: progressRow ? [
        progressRow.total_xp || 0,
        progressRow.current_level || 1,
        progressRow.best_pct || 0,
        progressRow.best_session_streak || 0,
        progressRow.day_streak || 0,
        progressRow.best_day_streak || 0,
        progressRow.last_streak_date || '',
        progressRow.daily_goal || 20,
        !!progressRow.practice_mode
      ] : [],
      settings: settingsRow ? [
        settingsRow.base_theme || 'vibrant',
        settingsRow.theme || 'default',
        !!settingsRow.custom_colors_enabled,
        settingsRow.custom_colors || null
      ] : [],
      sessions,
      milestones: Array.isArray(milestoneRows) ? milestoneRows.map(row => row && row.milestone_id).filter(Boolean).sort() : [],
      weakness: weaknessRow && weaknessRow.weakness_data ? weaknessRow.weakness_data : null,
      sr: srRow && Array.isArray(srRow.queue) ? srRow.queue : [],
      daily: Array.isArray(dailyRows) ? dailyRows.map(row => row && row.challenge_date).filter(Boolean).sort() : []
    });
  }

  function localSignature() {
    const history = readJSON(KEYS.history, []);
    const profile = readJSON(KEYS.profile, {});
    const xp = readJSON(KEYS.xp, {});
    const pb = readJSON(KEYS.pb, {});
    const dayStreak = readJSON(KEYS.dayStreak, {});
    return JSON.stringify({
      profile: [profile.name || '', profile.joinedDate || '', readString(KEYS.profileAvatar, '') || ''],
      progress: [
        xp.totalXP || 0,
        xp.currentLevel || 1,
        pb.bestPct || 0,
        pb.bestStreak || 0,
        dayStreak.streak || 0,
        dayStreak.bestStreak || 0,
        dayStreak.lastDate || '',
        readString(KEYS.dailyGoal, '20'),
        readString(KEYS.practiceMode, '0') === '1'
      ],
      settings: [
        readString(KEYS.baseTheme, 'vibrant'),
        readString(KEYS.theme, 'default'),
        readString(KEYS.customColorsOn, '0') === '1',
        readJSON(KEYS.customColors, null)
      ],
      sessions: Array.isArray(history) ? history.map(sessionKey).sort() : [],
      milestones: readJSON(KEYS.milestones, []).sort(),
      weakness: readJSON(KEYS.weakness, null),
      sr: readJSON(KEYS.srQueue, []),
      daily: {
        current: readJSON(KEYS.dailyChallenge, null),
        history: readJSON(KEYS.dcHistory, [])
      }
    });
  }

  function conflictParts(cloudRows) {
    return {
      local: localSignature(),
      cloud: cloudSignature(cloudRows)
    };
  }

  function markConflictResolved(ctx, source, parts) {
    if (!ctx || !source || !parts) return;
    try {
      localStorage.setItem(conflictResolvedKey(ctx.user.id), JSON.stringify({
        source,
        local: parts.local,
        cloud: parts.cloud,
        resolvedAt: new Date().toISOString()
      }));
      sessionStorage.removeItem(conflictDismissedKey(ctx.user.id));
    } catch(e) {}
  }

  function isConflictResolved(ctx, parts) {
    if (!ctx || !parts) return false;
    try {
      const saved = JSON.parse(localStorage.getItem(conflictResolvedKey(ctx.user.id)) || 'null');
      if (!saved) return false;
      if (saved.source === 'account') return saved.cloud === parts.cloud;
      if (saved.source === 'device') return saved.local === parts.local;
      return false;
    } catch(e) {
      return false;
    }
  }

  function markConflictDismissedThisSession(ctx, signature) {
    if (!ctx || !signature) return;
    try { sessionStorage.setItem(conflictDismissedKey(ctx.user.id), signature); } catch(e) {}
  }

  function isConflictDismissedThisSession(ctx, signature) {
    if (!ctx || !signature) return false;
    try { return sessionStorage.getItem(conflictDismissedKey(ctx.user.id)) === signature; } catch(e) { return false; }
  }

  function hasCloudProgressData(rows) {
    const [
      profileRow,
      progressRow,
      settingsRow,
      sessionRows,
      milestoneRows,
      weaknessRow,
      srRow,
      dailyRows
    ] = rows;

    if (profileRow && (profileRow.name || profileRow.joined_date || profileRow.avatar_url || profileRow.avatar_path)) return true;
    if (progressRow && (
      (progressRow.total_xp || 0) > 0
      || (progressRow.current_level || 1) > 1
      || (progressRow.best_pct || 0) > 0
      || (progressRow.best_session_streak || 0) > 0
      || (progressRow.day_streak || 0) > 0
      || (progressRow.best_day_streak || 0) > 0
      || !!progressRow.last_streak_date
      || (progressRow.daily_goal !== undefined && progressRow.daily_goal !== null && progressRow.daily_goal !== 20)
      || progressRow.practice_mode === true
    )) return true;
    if (settingsRow && (
      (settingsRow.base_theme && settingsRow.base_theme !== 'vibrant')
      || (settingsRow.theme && settingsRow.theme !== 'default')
      || settingsRow.custom_colors_enabled === true
      || (settingsRow.custom_colors !== undefined && settingsRow.custom_colors !== null)
    )) return true;
    if (Array.isArray(sessionRows) && sessionRows.length) return true;
    if (Array.isArray(milestoneRows) && milestoneRows.length) return true;
    if (weaknessRow && objectHasKeys(weaknessRow.weakness_data)) return true;
    if (srRow && Array.isArray(srRow.queue) && srRow.queue.length) return true;
    return Array.isArray(dailyRows) && dailyRows.length;
  }

  function refreshAfterCloudRestore() {
    setTimeout(() => {
      try {
        if (typeof loadSavedCustomColorInputs === 'function') loadSavedCustomColorInputs();
        if (typeof initTheme === 'function') initTheme();
        if (typeof initCustomColors === 'function') initCustomColors();
        if (typeof applyPracticeMode === 'function') applyPracticeMode(readString(KEYS.practiceMode, '0') === '1');
        if (typeof updateXPPill === 'function') updateXPPill();
        if (typeof updateDailyGoalUI === 'function') updateDailyGoalUI();
        if (typeof updateDailyChallengeBtn === 'function') updateDailyChallengeBtn();
        if (typeof renderSessionSummaryCard === 'function') renderSessionSummaryCard();
        if (typeof renderWeeklySummary === 'function') renderWeeklySummary();
        if (typeof renderHistory === 'function') renderHistory();
        window.updateAuthUI?.();
        window.updateSyncNotice?.();

        const profile = readJSON(KEYS.profile, {});
        const active = document.querySelector('.screen.active');
        if (profile && profile.name) {
          if (active && active.id === 's-profile' && typeof showProfile === 'function') showProfile();
          else if (typeof showDashboard === 'function') showDashboard();
        }
      } catch(error) {
        warnSync('cloud restore refresh', error);
      }
    }, 0);
  }

  async function fetchCloudAppState(ctx) {
    return Promise.all([
      requestData('restore user_profile', ctx.client.from('user_profile').select('*').eq('user_id', ctx.user.id).maybeSingle(), null),
      requestData('restore user_progress', ctx.client.from('user_progress').select('*').eq('user_id', ctx.user.id).maybeSingle(), null),
      requestData('restore user_settings', ctx.client.from('user_settings').select('*').eq('user_id', ctx.user.id).maybeSingle(), null),
      requestData('restore sessions', ctx.client.from('sessions').select('*').eq('user_id', ctx.user.id).limit(200), []),
      requestData('restore achievements_or_milestones', ctx.client.from('achievements_or_milestones').select('*').eq('user_id', ctx.user.id), []),
      requestData('restore weakness_stats', ctx.client.from('weakness_stats').select('*').eq('user_id', ctx.user.id).maybeSingle(), null),
      requestData('restore spaced_repetition_queue', ctx.client.from('spaced_repetition_queue').select('*').eq('user_id', ctx.user.id).maybeSingle(), null),
      requestData('restore daily_challenges', ctx.client.from('daily_challenges').select('*').eq('user_id', ctx.user.id), [])
    ]);
  }

  function restoreFetchedCloudAppStateToLocal(rows) {
    const [
      profileRow,
      progressRow,
      settingsRow,
      sessionRows,
      milestoneRows,
      weaknessRow,
      srRow,
      dailyRows
    ] = rows;

    if (profileRow && (profileRow.name || profileRow.joined_date)) {
      writeJSON(KEYS.profile, {
        name: profileRow.name || '',
        joinedDate: profileRow.joined_date || new Date().toISOString()
      });
    }
    if (profileRow && profileRow.avatar_url) writeString(KEYS.profileAvatar, profileRow.avatar_url);

    if (progressRow) {
      writeJSON(KEYS.xp, {
        totalXP: progressRow.total_xp || 0,
        currentLevel: progressRow.current_level || 1
      });
      writeJSON(KEYS.pb, {
        bestPct: progressRow.best_pct || 0,
        bestStreak: progressRow.best_session_streak || 0
      });
      writeJSON(KEYS.dayStreak, {
        streak: progressRow.day_streak || 0,
        bestStreak: progressRow.best_day_streak || 0,
        lastDate: progressRow.last_streak_date || null
      });
      if (progressRow.daily_goal !== undefined && progressRow.daily_goal !== null) writeString(KEYS.dailyGoal, progressRow.daily_goal);
      if (progressRow.practice_mode !== undefined && progressRow.practice_mode !== null) writeString(KEYS.practiceMode, progressRow.practice_mode ? '1' : '0');
    }

    if (settingsRow) {
      if (settingsRow.custom_colors !== undefined && settingsRow.custom_colors !== null) writeJSON(KEYS.customColors, settingsRow.custom_colors);
      if (settingsRow.custom_colors_enabled !== undefined && settingsRow.custom_colors_enabled !== null) writeString(KEYS.customColorsOn, settingsRow.custom_colors_enabled ? '1' : '0');
      if (settingsRow.base_theme) writeString(KEYS.baseTheme, settingsRow.base_theme);
      if (settingsRow.theme) writeString(KEYS.theme, settingsRow.theme);
    }

    if (Array.isArray(sessionRows) && sessionRows.length) {
      const sessions = sessionRows
        .map(restoredSessionFromRow)
        .filter(session => session && session.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 200);
      writeJSON(KEYS.history, sessions);
    }

    if (Array.isArray(milestoneRows) && milestoneRows.length) {
      writeJSON(KEYS.milestones, milestoneRows.map(row => row && row.milestone_id).filter(Boolean));
    }

    if (weaknessRow && weaknessRow.weakness_data !== undefined) writeJSON(KEYS.weakness, weaknessRow.weakness_data || {});
    if (srRow && srRow.queue !== undefined) writeJSON(KEYS.srQueue, srRow.queue || []);

    if (Array.isArray(dailyRows) && dailyRows.length) {
      const restored = dailyRows
        .map(restoredDailyChallengeFromRow)
        .filter(item => item && item.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      const completed = restored.filter(item => item.completed || item.score !== undefined);
      if (completed.length) writeJSON(KEYS.dcHistory, completed);
      const today = restored.find(item => item.date === todayKey());
      if (today) writeJSON(KEYS.dailyChallenge, today);
    }
  }

  function clearRestorableLocalAppState() {
    [
      KEYS.profile,
      KEYS.profileAvatar,
      KEYS.history,
      KEYS.xp,
      KEYS.pb,
      KEYS.dayStreak,
      KEYS.dailyGoal,
      KEYS.practiceMode,
      KEYS.customColors,
      KEYS.customColorsOn,
      KEYS.baseTheme,
      KEYS.theme,
      KEYS.milestones,
      KEYS.weakness,
      KEYS.srQueue,
      KEYS.dailyChallenge,
      KEYS.dcHistory
    ].forEach(key => {
      try { localStorage.removeItem(key); } catch(e) {}
    });
  }

  async function restoreCloudAppStateToLocal(ctx, cloudRows) {
    if (!ctx) return;
    try {
      const rows = cloudRows || await fetchCloudAppState(ctx);
      clearRestorableLocalAppState();
      restoreFetchedCloudAppStateToLocal(rows);
      markConflictResolved(ctx, 'account', pendingConflictSignature || conflictParts(rows));

      try { localStorage.setItem('quiz_local_data_synced', '1'); } catch(e) {}
      try { localStorage.removeItem('quiz_sync_notice_dismissed'); } catch(e) {}
      refreshAfterCloudRestore();
    } catch(error) {
      warnSync('cloud restore', error);
    }
  }

  function openProgressConflictModal(cloudRows, signature) {
    pendingConflictRows = cloudRows || null;
    pendingConflictSignature = signature || conflictParts(cloudRows);
    const modal = document.getElementById('progressConflictModal');
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('conflictAccountBtn')?.focus(), 0);
  }

  function closeProgressConflictModal() {
    const modal = document.getElementById('progressConflictModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function openReplaceAccountModal() {
    const modal = document.getElementById('replaceAccountModal');
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('replaceAccountCancelBtn')?.focus(), 0);
  }

  function closeReplaceAccountModal() {
    const modal = document.getElementById('replaceAccountModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  async function useAccountProgressFromConflict() {
    const ctx = getClientAndUser();
    closeProgressConflictModal();
    if (!ctx) return;
    await restoreCloudAppStateToLocal(ctx, pendingConflictRows);
    pendingConflictRows = null;
    pendingConflictSignature = null;
  }

  function requestKeepDeviceProgress() {
    closeProgressConflictModal();
    openReplaceAccountModal();
  }

  async function confirmKeepDeviceProgress() {
    const ctx = getClientAndUser();
    closeReplaceAccountModal();
    if (!ctx) return;
    try {
      await resetSupabaseAppData({ preserveProfile: null });
      await uploadLocalAppStateToSupabase(ctx);
      markConflictResolved(ctx, 'device', pendingConflictSignature || conflictParts(pendingConflictRows));
      pendingConflictRows = null;
      pendingConflictSignature = null;
    } catch(error) {
      warnSync('replace account progress', error);
    }
  }

  function cancelConflictSync() {
    closeProgressConflictModal();
    markConflictDismissedThisSession(getClientAndUser(), pendingConflictSignature ? JSON.stringify(pendingConflictSignature) : null);
    pendingConflictRows = null;
    pendingConflictSignature = null;
  }

  function cancelReplaceWarning() {
    closeReplaceAccountModal();
    openProgressConflictModal(pendingConflictRows, pendingConflictSignature);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('conflictAccountBtn')?.addEventListener('click', useAccountProgressFromConflict);
    document.getElementById('conflictDeviceBtn')?.addEventListener('click', requestKeepDeviceProgress);
    document.getElementById('conflictCancelBtn')?.addEventListener('click', cancelConflictSync);
    document.getElementById('conflictModalCloseBtn')?.addEventListener('click', cancelConflictSync);
    document.querySelectorAll('[data-conflict-close]').forEach(el => el.addEventListener('click', cancelConflictSync));
    document.getElementById('replaceAccountContinueBtn')?.addEventListener('click', confirmKeepDeviceProgress);
    document.getElementById('replaceAccountCancelBtn')?.addEventListener('click', cancelReplaceWarning);
    document.getElementById('replaceAccountCloseBtn')?.addEventListener('click', cancelReplaceWarning);
    document.querySelectorAll('[data-replace-close]').forEach(el => el.addEventListener('click', cancelReplaceWarning));
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (document.getElementById('replaceAccountModal')?.classList.contains('open')) cancelReplaceWarning();
      else if (document.getElementById('progressConflictModal')?.classList.contains('open')) cancelConflictSync();
    });
  });

  function migrateLocalAppStateToSupabase(options) {
    const ctx = getClientAndUser();
    if (!ctx) return;
    if (syncDecisionInFlight[ctx.user.id]) return syncDecisionInFlight[ctx.user.id];
    const showStatus = !!(options && options.showStatus);

    syncDecisionInFlight[ctx.user.id] = (async () => {
      const startedAt = Date.now();
      let conflictToOpen = null;
      if (showStatus) showProfileSyncStatus();
      try {
        if (!hasMeaningfulLocalAppData()) {
          cloudReadFailed = false;
          const cloudRows = await fetchCloudAppState(ctx);
          if (showStatus) await keepSyncingVisibleSince(startedAt);
          if (cloudReadFailed) return;
          if (hasCloudProgressData(cloudRows)) {
            await restoreCloudAppStateToLocal(ctx, cloudRows);
            return;
          }
          if (!hasLocalProfileOnly()) return;
          // Onboarding-only local profiles are uploaded only for brand-new cloud accounts.
        } else {
          cloudReadFailed = false;
          const cloudRows = await fetchCloudAppState(ctx);
          if (showStatus) await keepSyncingVisibleSince(startedAt);
          if (cloudReadFailed) return;
          if (hasCloudProgressData(cloudRows)) {
            const parts = conflictParts(cloudRows);
            const signature = JSON.stringify(parts);
            if (parts.local === parts.cloud) {
              try { localStorage.setItem('quiz_local_data_synced', '1'); } catch(e) {}
              return;
            }
            if (isConflictResolved(ctx, parts) || isConflictDismissedThisSession(ctx, signature)) return;
            conflictToOpen = { rows: cloudRows, parts };
            return;
          }
          // Real local progress remains authoritative for brand-new cloud accounts.
        }
        if (!hasMeaningfulLocalAppData() && !hasLocalProfileOnly()) {
          return;
        }
        await uploadLocalAppStateToSupabase(ctx);
      } catch(error) {
        warnSync('migration', error);
      } finally {
        if (showStatus) hideProfileSyncStatus();
        syncDecisionInFlight[ctx.user.id] = null;
        if (conflictToOpen) {
          setTimeout(() => openProgressConflictModal(conflictToOpen.rows, conflictToOpen.parts), 0);
        }
      }
    })();
    return syncDecisionInFlight[ctx.user.id];
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
