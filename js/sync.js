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
  let fullSyncTimer = null;
  let fullSyncInFlight = null;
  let fullSyncQueued = false;
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

  function localSyncMarkerKey(userId) {
    return 'quiz_local_sync_marker_' + userId;
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

  function runRequest(scope, request, onSuccess) {
    try {
      if (!request || typeof request.then !== 'function') return;
      request.then(({ error }) => {
        if (error) warnSync(scope, error);
        else if (typeof onSuccess === 'function') onSuccess();
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

  async function awaitRequest(scope, request) {
    const { data, error } = await request;
    if (error) throw error;
    return data;
  }

  function withAvatarCacheBust(url) {
    if (!url) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${Date.now()}`;
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
    const avatarUrl = withAvatarCacheBust(publicUrl);
    const profile = readJSON(KEYS.profile, {});
    const { error: profileError } = await ctx.client.from('user_profile').upsert({
      user_id: ctx.user.id,
      name: profile.name || null,
      joined_date: profile.joinedDate || null,
      avatar_path: path,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (profileError) throw profileError;
    writeString(KEYS.profileAvatar, avatarUrl);
    if (typeof window.renderProfileAvatar === 'function') {
      window.renderProfileAvatar(profile.name || '?');
    }
    return { path, publicUrl: avatarUrl };
  }

  function syncProfileAvatarToSupabase(dataUrl, file) {
    const ctx = getClientAndUser();
    if (!ctx || !dataUrl) return;
    uploadProfileAvatar(ctx, dataUrl, file)
      .then(() => uploadFullLocalStateAndMarkSynced(ctx))
      .catch(error => warnSync('profile avatar', error));
  }

  async function deleteProfileAvatar(ctx) {
    if (!ctx) return;
    const existing = await requestData(
      'delete profile avatar lookup',
      ctx.client.from('user_profile').select('avatar_path').eq('user_id', ctx.user.id).maybeSingle(),
      null
    );
    const path = existing && existing.avatar_path ? existing.avatar_path : null;
    if (path) {
      const { error: removeError } = await ctx.client.storage.from('profile-pictures').remove([path]);
      if (removeError) warnSync('profile avatar storage delete', removeError);
    }
    const { error: profileError } = await ctx.client
      .from('user_profile')
      .update({
        avatar_path: null,
        avatar_url: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', ctx.user.id);
    if (profileError) throw profileError;
    try { localStorage.removeItem(KEYS.profileAvatar); } catch(e) {}
  }

  function deleteProfileAvatarFromSupabase() {
    const ctx = getClientAndUser();
    if (!ctx) return;
    deleteProfileAvatar(ctx)
      .then(() => uploadFullLocalStateAndMarkSynced(ctx))
      .catch(error => warnSync('profile avatar delete', error));
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
      base_theme: baseTheme || 'dark',
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
    await awaitRequest('migration ' + table, ctx.client.from(table).upsert(row, { onConflict: 'user_id' }));
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
    if (rows.length) await awaitRequest('migration sessions', ctx.client.from('sessions').insert(rows));
  }

  async function migrateMilestones(ctx) {
    const ids = readJSON(KEYS.milestones, []);
    if (!Array.isArray(ids) || !ids.length) return;
    const rows = ids.map(id => ({
      user_id: ctx.user.id,
      milestone_id: id,
      unlocked_at: new Date().toISOString()
    }));
    await awaitRequest('migration achievements_or_milestones', ctx.client.from('achievements_or_milestones').upsert(rows, { onConflict: 'user_id,milestone_id' }));
  }

  async function migrateDataRowIfCloudEmpty(ctx, table, row, dataKeys) {
    if (!row) return;
    const existing = await requestData(
      'migration ' + table,
      ctx.client.from(table).select('*').eq('user_id', ctx.user.id).maybeSingle(),
      null
    );
    if (rowHasCloudValue(existing, dataKeys)) return;
    await awaitRequest('migration ' + table, ctx.client.from(table).upsert(row, { onConflict: 'user_id' }));
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
    if (missingRows.length) await awaitRequest('migration daily_challenges', ctx.client.from('daily_challenges').insert(missingRows));
  }

  function syncProfileToSupabase() {
    scheduleVerifiedFullLocalSync('user_profile');
  }

  function syncUserProgressToSupabase() {
    scheduleVerifiedFullLocalSync('user_progress');
  }

  function syncUserSettingsToSupabase() {
    scheduleVerifiedFullLocalSync('user_settings');
  }

  function syncMilestonesToSupabase() {
    scheduleVerifiedFullLocalSync('achievements_or_milestones');
  }

  function syncWeaknessToSupabase() {
    scheduleVerifiedFullLocalSync('weakness_stats');
  }

  function syncSpacedRepetitionToSupabase() {
    scheduleVerifiedFullLocalSync('spaced_repetition_queue');
  }

  function syncDailyChallengesToSupabase() {
    scheduleVerifiedFullLocalSync('daily_challenges');
  }

  function syncSessionToSupabase(session) {
    const ctx = getClientAndUser();
    if (!ctx) return;
    uploadFullLocalStateAndMarkSynced(ctx).catch(error => warnSync('sessions verified full sync', error));
  }

  function syncLatestSessionToSupabase() {
    const history = readJSON(KEYS.history, []);
    if (Array.isArray(history) && history[0]) syncSessionToSupabase(history[0]);
  }

  function syncAllLocalAppStateToSupabase() {
    const ctx = getClientAndUser();
    if (!ctx) return Promise.resolve(false);
    return uploadFullLocalStateAndMarkSynced(ctx);
  }

  async function uploadLocalAppStateToSupabase(ctx) {
    return uploadFullLocalStateAndMarkSynced(ctx);
  }

  async function uploadFullLocalStateToSupabase(ctx) {
    const profileRow = mapProfileRow(ctx.user.id);
    if (profileRow) {
      await awaitRequest('user_profile full sync', ctx.client.from('user_profile').upsert(profileRow, { onConflict: 'user_id' }));
    }

    const avatar = readString(KEYS.profileAvatar, null);
    if (avatar && avatar.startsWith('data:')) {
      await uploadProfileAvatar(ctx, avatar, null);
    }

    const progressRow = mapProgressRow(ctx.user.id);
    if (progressRow) {
      await awaitRequest('user_progress full sync', ctx.client.from('user_progress').upsert(progressRow, { onConflict: 'user_id' }));
    }

    const settingsRow = mapSettingsRow(ctx.user.id);
    if (settingsRow) {
      await awaitRequest('user_settings full sync', ctx.client.from('user_settings').upsert(settingsRow, { onConflict: 'user_id' }));
    }

    await migrateSessions(ctx);
    await migrateMilestones(ctx);

    const weaknessRaw = readString(KEYS.weakness, null);
    if (weaknessRaw !== null) {
      await awaitRequest('weakness_stats full sync', ctx.client.from('weakness_stats').upsert({
      user_id: ctx.user.id,
      weakness_data: readJSON(KEYS.weakness, {}),
      updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' }));
    }

    const srRaw = readString(KEYS.srQueue, null);
    if (srRaw !== null) {
      await awaitRequest('spaced_repetition_queue full sync', ctx.client.from('spaced_repetition_queue').upsert({
        user_id: ctx.user.id,
        queue: readJSON(KEYS.srQueue, []),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' }));
    }

    const dailyRows = mapDailyChallengeRows(ctx.user.id);
    if (dailyRows.length) {
      await awaitRequest('daily_challenges full sync', ctx.client.from('daily_challenges').upsert(dailyRows, { onConflict: 'user_id,challenge_date' }));
    }
  }

  async function uploadFullLocalStateAndMarkSynced(ctx) {
    if (!ctx || !ctx.user || !ctx.user.id) return false;
    if (fullSyncInFlight) {
      fullSyncQueued = true;
      return fullSyncInFlight;
    }

    fullSyncInFlight = (async () => {
      let verified = false;
      do {
        fullSyncQueued = false;
        await uploadFullLocalStateToSupabase(ctx);
        verified = await markLocalSyncedAfterVerifiedCloudMatch(ctx);
      } while (fullSyncQueued);

      if (!verified) {
        throw new Error('Cloud verification did not match local app state after sync.');
      }
      return true;
    })().finally(() => {
      fullSyncInFlight = null;
    });

    return fullSyncInFlight;
  }

  function scheduleVerifiedFullLocalSync(scope) {
    if (fullSyncTimer) clearTimeout(fullSyncTimer);
    fullSyncTimer = setTimeout(() => {
      fullSyncTimer = null;
      const ctx = getClientAndUser();
      if (!ctx) return;
      uploadFullLocalStateAndMarkSynced(ctx).catch(error => warnSync(scope + ' verified full sync', error));
    }, 350);
  }

  async function markLocalSyncedAfterVerifiedCloudMatch(ctx, cloudRows) {
    cloudReadFailed = false;
    const rows = cloudRows || await fetchCloudAppState(ctx);
    if (cloudReadFailed) return false;
    if (cloudSignature(rows) !== localSignature()) {
      logSignatureMismatch('verified full sync', rows);
      return false;
    }
    try { localStorage.setItem('quiz_local_data_synced', '1'); } catch(e) {}
    try { localStorage.removeItem('quiz_sync_notice_dismissed'); } catch(e) {}
    markLocalSyncedForUser(ctx);
    window.updateSyncNotice?.();
    return true;
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

  function uniqueSorted(values) {
    return [...new Set((Array.isArray(values) ? values : []).filter(value => value !== null && value !== undefined && value !== ''))].sort();
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
    }
    return value;
  }

  function normalizedDailyRowsFromLocal() {
    return mapDailyChallengeRows('local').map(row => [
      row.challenge_date || '',
      !!row.completed,
      row.score || 0,
      row.total || 0,
      row.pct || 0,
      row.bracket || ''
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }

  function normalizedDailyRowsFromCloud(rows) {
    return (Array.isArray(rows) ? rows : []).map(restoredDailyChallengeFromRow).map(item => [
      item.date || '',
      !!item.completed || item.score !== undefined,
      item.score || 0,
      item.total || 0,
      item.pct || 0,
      item.bracket || ''
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }

  function cloudSignatureParts(rows) {
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
    return {
      profile: profileRow ? [profileRow.name || '', profileRow.joined_date || ''] : [],
      avatar: profileRow && profileRow.avatar_url ? profileRow.avatar_url : '',
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
        settingsRow.base_theme || 'dark',
        settingsRow.theme || 'default',
        !!settingsRow.custom_colors_enabled,
        stableValue(settingsRow.custom_colors || null)
      ] : [],
      sessions: uniqueSorted(sessions),
      milestones: uniqueSorted(Array.isArray(milestoneRows) ? milestoneRows.map(row => row && row.milestone_id) : []),
      weakness: stableValue(weaknessRow && weaknessRow.weakness_data ? weaknessRow.weakness_data : null),
      sr: stableValue(srRow && Array.isArray(srRow.queue) ? srRow.queue : []),
      daily: normalizedDailyRowsFromCloud(dailyRows)
    };
  }

  function cloudSignature(rows) {
    return JSON.stringify(cloudSignatureParts(rows));
  }

  function localSignatureParts() {
    const history = readJSON(KEYS.history, []);
    const profile = readJSON(KEYS.profile, {});
    const avatar = readString(KEYS.profileAvatar, '') || '';
    const xp = readJSON(KEYS.xp, {});
    const pb = readJSON(KEYS.pb, {});
    const dayStreak = readJSON(KEYS.dayStreak, {});
    const hasProgress = readString(KEYS.xp, null) !== null
      || readString(KEYS.pb, null) !== null
      || readString(KEYS.dayStreak, null) !== null
      || readString(KEYS.dailyGoal, null) !== null
      || readString(KEYS.practiceMode, null) !== null;
    const hasSettings = readString(KEYS.baseTheme, null) !== null
      || readString(KEYS.theme, null) !== null
      || readString(KEYS.customColorsOn, null) !== null
      || readString(KEYS.customColors, null) !== null;
    return {
      profile: (profile.name || profile.joinedDate) ? [profile.name || '', profile.joinedDate || ''] : [],
      avatar,
      progress: hasProgress ? [
        xp.totalXP || 0,
        xp.currentLevel || 1,
        pb.bestPct || 0,
        pb.bestStreak || 0,
        dayStreak.streak || 0,
        dayStreak.bestStreak || 0,
        dayStreak.lastDate || '',
        parseInt(readString(KEYS.dailyGoal, '20'), 10) || 20,
        readString(KEYS.practiceMode, '0') === '1'
      ] : [],
      settings: hasSettings ? [
        readString(KEYS.baseTheme, 'dark'),
        readString(KEYS.theme, 'default'),
        readString(KEYS.customColorsOn, '0') === '1',
        stableValue(readJSON(KEYS.customColors, null))
      ] : [],
      sessions: uniqueSorted(Array.isArray(history) ? history.map(sessionKey) : []),
      milestones: uniqueSorted(readJSON(KEYS.milestones, [])),
      weakness: stableValue(readJSON(KEYS.weakness, null)),
      sr: stableValue(readJSON(KEYS.srQueue, [])),
      daily: normalizedDailyRowsFromLocal()
    };
  }

  function localSignature() {
    return JSON.stringify(localSignatureParts());
  }

  function logSignatureMismatch(scope, rows) {
    const local = localSignatureParts();
    const cloud = cloudSignatureParts(rows);
    const sections = uniqueSorted(Object.keys({ ...local, ...cloud }));
    const diff = {};
    sections.forEach(section => {
      const localValue = local[section];
      const cloudValue = cloud[section];
      if (JSON.stringify(localValue) !== JSON.stringify(cloudValue)) {
        diff[section] = { local: localValue, cloud: cloudValue };
      }
    });
    console.warn('Supabase sync verification mismatch:', {
      scope,
      mismatchedSections: Object.keys(diff),
      diff
    });
  }

  function conflictParts(cloudRows) {
    return {
      local: localSignature(),
      cloud: cloudSignature(cloudRows)
    };
  }

  function markLocalSyncedForUser(ctx) {
    if (!ctx || !ctx.user || !ctx.user.id) return;
    try {
      localStorage.setItem(localSyncMarkerKey(ctx.user.id), JSON.stringify({
        userId: ctx.user.id,
        local: localSignature(),
        syncedAt: new Date().toISOString()
      }));
      localStorage.setItem('quiz_local_data_synced', '1');
    } catch(e) {}
  }

  function isLocalUnchangedSinceUserSync(ctx) {
    if (!ctx || !ctx.user || !ctx.user.id) return false;
    try {
      const saved = JSON.parse(localStorage.getItem(localSyncMarkerKey(ctx.user.id)) || 'null');
      return !!(saved && saved.userId === ctx.user.id && saved.local === localSignature());
    } catch(e) {
      return false;
    }
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
      if (saved.source === 'account') return saved.cloud === parts.cloud && saved.local === parts.local;
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
      (settingsRow.base_theme && settingsRow.base_theme !== 'dark')
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
      requestData('restore sessions', ctx.client.from('sessions').select('*').eq('user_id', ctx.user.id).order('created_at', { ascending: false }).limit(200), []),
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

      const verified = await markLocalSyncedAfterVerifiedCloudMatch(ctx, rows);
      if (!verified) warnSync('cloud restore verification', new Error('Restored cloud state did not match local signature.'));
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
    modal.classList.remove('closing');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('conflictAccountBtn')?.focus(), 0);
  }

  function closeProgressConflictModal(afterClose) {
    const modal = document.getElementById('progressConflictModal');
    if (!modal) {
      if (typeof afterClose === 'function') afterClose();
      return;
    }
    modal.setAttribute('aria-hidden', 'true');
    if (!modal.classList.contains('open')) {
      modal.classList.remove('closing');
      if (typeof afterClose === 'function') afterClose();
      return;
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      modal.classList.remove('open', 'closing');
      if (typeof afterClose === 'function') afterClose();
      return;
    }
    modal.classList.add('closing');
    setTimeout(() => {
      modal.classList.remove('open', 'closing');
      if (typeof afterClose === 'function') afterClose();
    }, 180);
  }

  function openReplaceAccountModal() {
    const modal = document.getElementById('replaceAccountModal');
    if (!modal) return;
    modal.classList.remove('closing');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('replaceAccountCancelBtn')?.focus(), 0);
  }

  function closeReplaceAccountModal(afterClose) {
    const modal = document.getElementById('replaceAccountModal');
    if (!modal) {
      if (typeof afterClose === 'function') afterClose();
      return;
    }
    modal.setAttribute('aria-hidden', 'true');
    if (!modal.classList.contains('open')) {
      modal.classList.remove('closing');
      if (typeof afterClose === 'function') afterClose();
      return;
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      modal.classList.remove('open', 'closing');
      if (typeof afterClose === 'function') afterClose();
      return;
    }
    modal.classList.add('closing');
    setTimeout(() => {
      modal.classList.remove('open', 'closing');
      if (typeof afterClose === 'function') afterClose();
    }, 180);
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
    closeProgressConflictModal(openReplaceAccountModal);
  }

  async function confirmKeepDeviceProgress() {
    const ctx = getClientAndUser();
    closeReplaceAccountModal();
    if (!ctx) return;
    try {
      await resetSupabaseAppData({ preserveProfile: null, requireSuccess: true });
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
    closeReplaceAccountModal(() => openProgressConflictModal(pendingConflictRows, pendingConflictSignature));
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
              await markLocalSyncedAfterVerifiedCloudMatch(ctx, cloudRows);
              return;
            }
            if (isLocalUnchangedSinceUserSync(ctx)) {
              await syncAllLocalAppStateToSupabase();
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
    const requireSuccess = !!(options && options.requireSuccess);
    const errors = [];
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
        if (error) {
          warnSync('reset ' + table, error);
          errors.push({ table, error });
        }
      } catch(error) {
        warnSync('reset ' + table, error);
        errors.push({ table, error });
      }
    }));
    if (requireSuccess && errors.length) {
      throw new Error('Could not clear all cloud app data before replacing account progress: ' + errors.map(item => item.table).join(', '));
    }
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
  window.deleteProfileAvatarFromSupabase = deleteProfileAvatarFromSupabase;
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
