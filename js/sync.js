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
    profileAvatar: 'quiz_profile_avatar',
    sessionSummary: 'quiz_last_session_summary'
  };

  const pending = {};
  const syncDecisionInFlight = {};
  let fullSyncTimer = null;
  let fullSyncInFlight = null;
  let fullSyncQueued = false;
  let pendingConflictRows = null;
  let pendingConflictSignature = null;
  let cloudReadFailed = false;
  const SYNC_MARKER_SCHEMA_VERSION = 2;

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

  function debugResetSync(message, details) {
    console.log('[reset sync] ' + message, details || {});
  }

  function debugSessionSync(message, details) {
    console.log('[session sync] ' + message, details || {});
  }

  function debugSyncMarker(message, details) {
    console.log('[sync marker] ' + message, details || {});
  }

  function debugKeepDeviceSync(message, details) {
    console.log('[keep device sync] ' + message, details || {});
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

  function hasMeaningfulLocalProgressData() {
    const history = readJSON(KEYS.history, []);
    if (Array.isArray(history) && history.length) return true;

    const xp = readJSON(KEYS.xp, {});
    if (xp && ((xp.totalXP || 0) > 0 || (xp.currentLevel || 1) > 1)) return true;

    const pb = readJSON(KEYS.pb, {});
    if (pb && ((pb.bestPct || 0) > 0 || (pb.bestStreak || 0) > 0)) return true;

    const dayStreak = readJSON(KEYS.dayStreak, {});
    if (dayStreak && ((dayStreak.streak || 0) > 0 || (dayStreak.bestStreak || 0) > 0 || dayStreak.lastDate)) return true;

    if (readString(KEYS.dailyGoal, null) !== null) return true;
    if (readString(KEYS.practiceMode, null) !== null) return true;
    if (readString(KEYS.baseTheme, null) !== null) return true;
    if (readString(KEYS.theme, null) !== null) return true;
    if (readString(KEYS.customColorsOn, null) !== null) return true;
    if (readString(KEYS.customColors, null) !== null) return true;

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
    if (session && session.session_id) return String(session.session_id);
    const legacyParts = [
      session && session.date,
      session && session.score,
      session && session.total,
      session && session.pct
    ];
    if (legacyParts.every(value => value === null || value === undefined || value === '')) return '';
    return legacyParts.join('|');
  }

  function rowSessionKey(row) {
    if (row && row.raw_data) return sessionKey(row.raw_data);
    const legacyParts = [
      row && row.created_at,
      row && row.correct_answers,
      row && row.total_questions,
      row && row.accuracy
    ];
    if (legacyParts.every(value => value === null || value === undefined || value === '')) return '';
    return legacyParts.join('|');
  }

  function dedupeSessionsByKey(sessions) {
    const seen = new Set();
    const deduped = [];
    (Array.isArray(sessions) ? sessions : []).forEach(session => {
      const key = sessionKey(session);
      if (!session || !key || seen.has(key)) return;
      seen.add(key);
      deduped.push(session);
    });
    return deduped;
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
      ctx.client.from('sessions').select('raw_data,created_at,correct_answers,total_questions,accuracy').eq('user_id', ctx.user.id),
      []
    );
    const existingKeys = new Set((Array.isArray(existingRows) ? existingRows : [])
      .map(rowSessionKey)
      .filter(Boolean));
    const rows = dedupeSessionsByKey(history)
      .filter(session => session && !existingKeys.has(sessionKey(session)))
      .map(session => mapSessionRow(ctx.user.id, session));
    if (rows.length) await awaitRequest('migration sessions', ctx.client.from('sessions').insert(rows));
  }

  async function uploadSingleSessionIfMissing(ctx, session) {
    if (!ctx || !session) return false;
    const key = sessionKey(session);
    debugSessionSync('upload requested', {
      session_id: session.session_id || null,
      canonicalKey: key
    });
    if (!key) return false;
    const existingRows = await requestData(
      'session upload lookup',
      ctx.client.from('sessions').select('raw_data,created_at,correct_answers,total_questions,accuracy').eq('user_id', ctx.user.id),
      []
    );
    const existingKeys = new Set((Array.isArray(existingRows) ? existingRows : []).map(rowSessionKey).filter(Boolean));
    if (existingKeys.has(key)) {
      debugSessionSync('upload skipped; session already exists in Supabase', {
        canonicalKey: key,
        cloudSessionCount: existingKeys.size
      });
      return false;
    }
    try {
      await awaitRequest('single session upload', ctx.client.from('sessions').insert(mapSessionRow(ctx.user.id, session)));
      debugSessionSync('upload succeeded', { canonicalKey: key });
      return true;
    } catch(error) {
      debugSessionSync('upload failed', { canonicalKey: key, error });
      throw error;
    }
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
    debugSessionSync('syncSessionToSupabase received session', {
      session_id: session && session.session_id ? session.session_id : null,
      canonicalKey: session ? sessionKey(session) : null
    });
    (async () => {
      if (session) await uploadSingleSessionIfMissing(ctx, session);
      await uploadFullLocalStateAndMarkSynced(ctx);
      const rows = await fetchCloudAppState(ctx);
      const cloudSessions = Array.isArray(rows && rows[3]) ? rows[3] : [];
      debugSessionSync('post-sync cloud session count', {
        cloudSessionCount: cloudSessions.length
      });
    })().catch(error => warnSync('sessions verified full sync', error));
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

  async function uploadLocalAppStateToSupabase(ctx, options) {
    return uploadFullLocalStateAndMarkSynced(ctx, options);
  }

  async function uploadFullLocalStateToSupabase(ctx) {
    const result = {
      avatarUploadFailed: false,
      avatarError: null
    };

    const profileRow = mapProfileRow(ctx.user.id);
    if (profileRow) {
      await awaitRequest('user_profile full sync', ctx.client.from('user_profile').upsert(profileRow, { onConflict: 'user_id' }));
    }

    const avatar = readString(KEYS.profileAvatar, null);
    if (avatar && avatar.startsWith('data:')) {
      try {
        await uploadProfileAvatar(ctx, avatar, null);
      } catch(error) {
        result.avatarUploadFailed = true;
        result.avatarError = error;
        warnSync('profile avatar full sync (continuing without blocking progress)', error);
        console.warn('[sync safety] avatar upload failure but non-avatar sync continuing:', error && error.message ? error.message : error);
      }
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

    return result;
  }

  function signaturePartsWithoutAvatar(parts) {
    const copy = { ...(parts || {}) };
    delete copy.avatar;
    return copy;
  }

  function signaturesMatchExceptAvatar(rows) {
    return JSON.stringify(signaturePartsWithoutAvatar(cloudSignatureParts(rows))) ===
      JSON.stringify(signaturePartsWithoutAvatar(localSignatureParts()));
  }

  async function verifyLocalNonAvatarCloudMatch(ctx) {
    cloudReadFailed = false;
    const rows = await fetchCloudAppState(ctx);
    if (cloudReadFailed) return { ok: false, rows };
    return {
      ok: signaturesMatchExceptAvatar(rows),
      rows
    };
  }

  function listContainsAllValues(container, required) {
    const set = new Set((Array.isArray(container) ? container : []).map(value => JSON.stringify(value)));
    return (Array.isArray(required) ? required : []).every(value => set.has(JSON.stringify(value)));
  }

  function cloudContainsLocalNonAvatarData(rows) {
    const local = localSignatureParts();
    const cloud = cloudSignatureParts(rows);

    if (local.profile.length && JSON.stringify(local.profile) !== JSON.stringify(cloud.profile)) return false;
    if (local.progress.length && JSON.stringify(local.progress) !== JSON.stringify(cloud.progress)) return false;
    if (local.settings.length && JSON.stringify(local.settings) !== JSON.stringify(cloud.settings)) return false;
    if (!listContainsAllValues(cloud.sessions, local.sessions)) return false;
    if (!listContainsAllValues(cloud.milestones, local.milestones)) return false;
    if (readString(KEYS.weakness, null) !== null && local.weakness !== cloud.weakness) return false;
    if (readString(KEYS.srQueue, null) !== null && local.sr !== cloud.sr) return false;
    if (!listContainsAllValues(cloud.daily, local.daily)) return false;
    return true;
  }

  async function verifyCloudContainsLocalNonAvatarData(ctx) {
    cloudReadFailed = false;
    const rows = await fetchCloudAppState(ctx);
    if (cloudReadFailed) return { ok: false, rows };
    return {
      ok: cloudContainsLocalNonAvatarData(rows),
      rows
    };
  }

  async function uploadFullLocalStateAndMarkSynced(ctx, options) {
    if (!ctx || !ctx.user || !ctx.user.id) return false;
    if (fullSyncInFlight) {
      fullSyncQueued = true;
      return fullSyncInFlight;
    }

    fullSyncInFlight = (async () => {
      let verified = false;
      let latestUploadResult = null;
      do {
        fullSyncQueued = false;
        latestUploadResult = await uploadFullLocalStateToSupabase(ctx);
        verified = await markLocalSyncedAfterVerifiedCloudMatch(ctx);
      } while (fullSyncQueued);

      if (!verified) {
        if (options && options.allowAvatarOnlyMismatch && latestUploadResult && latestUploadResult.avatarUploadFailed) {
          const nonAvatarVerification = await verifyLocalNonAvatarCloudMatch(ctx);
          if (nonAvatarVerification.ok) {
            console.warn('[sync safety] non-avatar cloud data matches local data, but full sync marker was not written because avatar still differs.');
            return {
              verified: false,
              nonAvatarVerified: true,
              avatarUploadFailed: true,
              rows: nonAvatarVerification.rows
            };
          }
        }
        throw new Error('Cloud verification did not match local app state after sync.');
      }
      return {
        verified: true,
        nonAvatarVerified: true,
        avatarUploadFailed: !!(latestUploadResult && latestUploadResult.avatarUploadFailed)
      };
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
    markLocalSyncedForUser(ctx, rows);
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
      ? sessionRows.map(rowSessionKey).sort()
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
    if (diff.sessions) {
      const localSessions = new Set(diff.sessions.local || []);
      const cloudSessions = new Set(diff.sessions.cloud || []);
      console.warn('[session sync] local/cloud session key diff', {
        onlyLocal: [...localSessions].filter(key => !cloudSessions.has(key)),
        onlyCloud: [...cloudSessions].filter(key => !localSessions.has(key))
      });
    }
  }

  function conflictParts(cloudRows) {
    return {
      local: localSignature(),
      cloud: cloudSignature(cloudRows)
    };
  }

  function formatConflictDate(value) {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not available';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function latestSessionDate(sessions) {
    const dates = (Array.isArray(sessions) ? sessions : [])
      .map(session => session && session.date)
      .filter(Boolean)
      .map(value => new Date(value))
      .filter(date => !Number.isNaN(date.getTime()))
      .sort((a, b) => b - a);
    return dates[0] ? dates[0].toISOString() : null;
  }

  function conflictSectionDiffs(localParts, cloudParts) {
    return ['profile', 'avatar', 'progress', 'settings', 'milestones', 'weakness', 'sr', 'daily']
      .filter(section => JSON.stringify(localParts[section]) !== JSON.stringify(cloudParts[section]));
  }

  function getConflictSummary(cloudRows) {
    const localHistory = readJSON(KEYS.history, []);
    const cloudSessionRows = Array.isArray(cloudRows && cloudRows[3]) ? cloudRows[3] : [];
    const cloudSessions = dedupeSessionsByKey(cloudSessionRows.map(restoredSessionFromRow).filter(session => session && session.date));
    const localParts = localSignatureParts();
    const cloudParts = cloudSignatureParts(cloudRows);
    const localSessionCount = Array.isArray(localHistory) ? dedupeSessionsByKey(localHistory).length : 0;
    const cloudSessionCount = cloudSessions.length;
    const localLatest = latestSessionDate(localHistory);
    const cloudLatest = latestSessionDate(cloudSessions);
    const localLatestTime = localLatest ? new Date(localLatest).getTime() : 0;
    const cloudLatestTime = cloudLatest ? new Date(cloudLatest).getTime() : 0;
    const sectionDiffs = conflictSectionDiffs(localParts, cloudParts);
    let recommendation = 'Review carefully before choosing.';
    let recommendationTarget = 'review';
    if (cloudSessionCount > localSessionCount || cloudLatestTime > localLatestTime) {
      recommendation = 'Recommended: Use account progress';
      recommendationTarget = 'account';
    } else if (localSessionCount > cloudSessionCount || localLatestTime > cloudLatestTime) {
      recommendation = 'Recommended: Keep device progress';
      recommendationTarget = 'device';
    }
    return {
      localSessionCount,
      cloudSessionCount,
      localLatest,
      cloudLatest,
      sectionDiffs,
      recommendation,
      recommendationTarget
    };
  }

  function ensureConflictModalDetails(modal) {
    const card = modal && modal.querySelector('.conflict-modal-card');
    if (!card) return null;
    let details = document.getElementById('conflictModalDetails');
    if (!details) {
      details = document.createElement('div');
      details.id = 'conflictModalDetails';
      details.className = 'conflict-compare';
      const actions = card.querySelector('.conflict-modal-actions');
      card.insertBefore(details, actions || null);
    }
    return details;
  }

  function formatConflictDiffs(sections) {
    if (!Array.isArray(sections) || !sections.length) return 'Saved progress differs';
    const labels = {
      profile: 'profile',
      avatar: 'photo',
      progress: 'XP/stats',
      settings: 'settings',
      milestones: 'achievements',
      weakness: 'weakness data',
      sr: 'practice queue',
      daily: 'daily progress'
    };
    return sections.map(section => labels[section] || section).join(', ');
  }

  function renderConflictModalDetails(cloudRows) {
    const modal = document.getElementById('progressConflictModal');
    const details = ensureConflictModalDetails(modal);
    if (!modal || !details) return;
    const headText = modal.querySelector('.conflict-modal-head p');
    if (headText) {
      headText.textContent = 'This device and your account have different saved progress. Choose which version you want to use.';
    }
    const summary = getConflictSummary(cloudRows);
    details.innerHTML = `
      <div class="conflict-compare-grid" aria-label="Progress comparison">
        <div class="conflict-compare-card">
          <div class="conflict-compare-label">This device</div>
          <div class="conflict-compare-row"><span>Sessions</span><strong>${summary.localSessionCount}</strong></div>
          <div class="conflict-compare-row"><span>Latest activity</span><strong>${formatConflictDate(summary.localLatest)}</strong></div>
        </div>
        <div class="conflict-compare-card">
          <div class="conflict-compare-label">Your account</div>
          <div class="conflict-compare-row"><span>Sessions</span><strong>${summary.cloudSessionCount}</strong></div>
          <div class="conflict-compare-row"><span>Latest activity</span><strong>${formatConflictDate(summary.cloudLatest)}</strong></div>
        </div>
      </div>
      <div class="conflict-diff-note">Different: ${formatConflictDiffs(summary.sectionDiffs)}</div>
      <div class="conflict-recommendation">${summary.recommendation}</div>
    `;
    const accountBtn = document.getElementById('conflictAccountBtn');
    const deviceBtn = document.getElementById('conflictDeviceBtn');
    const cancelBtn = document.getElementById('conflictCancelBtn');
    [accountBtn, deviceBtn, cancelBtn].forEach(btn => {
      btn?.classList.remove('conflict-action-primary', 'conflict-action-secondary', 'conflict-action-tertiary', 'conflict-action-destructive');
    });
    if (accountBtn) {
      accountBtn.innerHTML = '<span>Use account progress</span><small>Replace this device with your saved account progress.</small>';
      accountBtn.classList.add(summary.recommendationTarget === 'account' ? 'conflict-action-primary' : 'conflict-action-secondary');
    }
    if (deviceBtn) {
      deviceBtn.innerHTML = '<span>Keep device progress</span><small>Replace account progress with this device. This can overwrite account data.</small>';
      deviceBtn.classList.add(summary.recommendationTarget === 'device' ? 'conflict-action-primary' : 'conflict-action-secondary', 'conflict-action-destructive');
    }
    if (cancelBtn) {
      cancelBtn.innerHTML = '<span>Cancel</span><small>Do nothing for now. This conflict is not resolved.</small>';
      cancelBtn.classList.add('conflict-action-tertiary');
    }
  }

  function markLocalSyncedForUser(ctx, cloudRows) {
    if (!ctx || !ctx.user || !ctx.user.id) return;
    const localSig = localSignature();
    const cloudSig = cloudRows ? cloudSignature(cloudRows) : null;
    try {
      localStorage.setItem(localSyncMarkerKey(ctx.user.id), JSON.stringify({
        userId: ctx.user.id,
        local: localSig,
        cloud: cloudSig,
        syncedAt: new Date().toISOString(),
        schemaVersion: SYNC_MARKER_SCHEMA_VERSION
      }));
      localStorage.setItem('quiz_local_data_synced', '1');
      debugSyncMarker('written', {
        userId: ctx.user.id,
        hasCloudSignature: !!cloudSig,
        schemaVersion: SYNC_MARKER_SCHEMA_VERSION
      });
    } catch(e) {}
  }

  function isLocalUnchangedSinceUserSync(ctx, cloudRows) {
    if (!ctx || !ctx.user || !ctx.user.id) return false;
    try {
      const saved = JSON.parse(localStorage.getItem(localSyncMarkerKey(ctx.user.id)) || 'null');
      const currentLocal = localSignature();
      const currentCloud = cloudRows ? cloudSignature(cloudRows) : null;
      let trusted = false;
      let reason = 'trusted';
      if (!saved) reason = 'missing marker';
      else if (saved.userId !== ctx.user.id) reason = 'user mismatch';
      else if (!saved.cloud) reason = 'missing cloud signature';
      else if (!currentCloud) reason = 'missing current cloud signature';
      else if (saved.local !== currentLocal) reason = 'local changed';
      else if (saved.cloud !== currentCloud) reason = 'cloud changed';
      else trusted = true;
      debugSyncMarker('checked', {
        userId: ctx.user.id,
        trusted,
        reason: trusted ? 'trusted' : reason,
        hasSavedCloudSignature: !!(saved && saved.cloud),
        hasCurrentCloudSignature: !!currentCloud
      });
      return trusted;
    } catch(e) {
      debugSyncMarker('checked', {
        userId: ctx.user.id,
        trusted: false,
        reason: 'parse error'
      });
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
      if (saved.source === 'device') return saved.cloud === parts.cloud && saved.local === parts.local;
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

  function hasCloudMeaningfulNonProfileData(rows) {
    const [
      ,
      progressRow,
      settingsRow,
      sessionRows,
      milestoneRows,
      weaknessRow,
      srRow,
      dailyRows
    ] = rows || [];

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

  function cloudResetVerificationErrors(rows, preserveProfile) {
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
    const errors = [];
    if (progressRow) errors.push('user_progress');
    if (settingsRow) errors.push('user_settings');
    if (Array.isArray(sessionRows) && sessionRows.length) errors.push('sessions');
    if (Array.isArray(milestoneRows) && milestoneRows.length) errors.push('achievements_or_milestones');
    if (weaknessRow) errors.push('weakness_stats');
    if (srRow) errors.push('spaced_repetition_queue');
    if (Array.isArray(dailyRows) && dailyRows.length) errors.push('daily_challenges');
    if (!preserveProfile && profileRow) errors.push('user_profile');
    if (preserveProfile) {
      const expectedName = preserveProfile.name || '';
      const expectedJoined = preserveProfile.joinedDate || '';
      if (!profileRow) errors.push('user_profile_missing');
      else {
        if ((profileRow.name || '') !== expectedName) errors.push('user_profile_name');
        if (expectedJoined && (profileRow.joined_date || '') !== expectedJoined) errors.push('user_profile_joined_date');
      }
    }
    return errors;
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
      const sessions = dedupeSessionsByKey(sessionRows
        .map(restoredSessionFromRow)
        .filter(session => session && session.date))
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

  function restorableLocalKeys() {
    return [
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
      KEYS.dcHistory,
      KEYS.sessionSummary
    ];
  }

  function createLocalRestoreBackup(reason) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = 'quiz_restore_backup_' + timestamp;
    const values = {};
    restorableLocalKeys().forEach(itemKey => {
      try {
        const value = localStorage.getItem(itemKey);
        if (value !== null) values[itemKey] = value;
      } catch(e) {}
    });
    try {
      localStorage.setItem(key, JSON.stringify({
        reason: reason || 'cloud_restore',
        createdAt: new Date().toISOString(),
        values
      }));
      const backupKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const existingKey = localStorage.key(i);
        if (existingKey && existingKey.startsWith('quiz_restore_backup_')) backupKeys.push(existingKey);
      }
      backupKeys.sort().slice(0, Math.max(0, backupKeys.length - 3)).forEach(oldKey => {
        try { localStorage.removeItem(oldKey); } catch(e) {}
      });
      console.log('[sync restore] local backup created before restore', { key, savedKeys: Object.keys(values).length });
      return { key, values };
    } catch(error) {
      warnSync('local restore backup', error);
      return null;
    }
  }

  function restoreLocalBackupSnapshot(backup) {
    if (!backup || !backup.values) return;
    restorableLocalKeys().forEach(itemKey => {
      try { localStorage.removeItem(itemKey); } catch(e) {}
    });
    Object.keys(backup.values).forEach(itemKey => {
      try { localStorage.setItem(itemKey, backup.values[itemKey]); } catch(e) {}
    });
  }

  function clearStaleSessionSummaryIfNoHistory() {
    const history = readJSON(KEYS.history, []);
    if (Array.isArray(history) && history.length) return;
    try {
      if (localStorage.getItem(KEYS.sessionSummary) !== null) {
        localStorage.removeItem(KEYS.sessionSummary);
        console.log('[sync restore] stale session summary cleared because restored history is empty');
      }
    } catch(e) {}
  }

  async function restoreCloudAppStateToLocal(ctx, cloudRows) {
    if (!ctx) return;
    let backup = null;
    try {
      const rows = cloudRows || await fetchCloudAppState(ctx);
      if (!hasCloudMeaningfulNonProfileData(rows) && hasMeaningfulLocalProgressData()) {
        console.warn('[sync safety] Use account progress blocked because cloud is empty/profile-only while this device has local progress.');
        if (typeof alert === 'function') {
          alert('Account progress looks empty, so this device progress was kept. Your local sessions were not replaced.');
        }
        return false;
      }
      backup = createLocalRestoreBackup('cloud_restore');
      if (!backup) throw new Error('Could not create local backup before cloud restore.');
      clearRestorableLocalAppState();
      restoreFetchedCloudAppStateToLocal(rows);
      clearStaleSessionSummaryIfNoHistory();

      const verified = await markLocalSyncedAfterVerifiedCloudMatch(ctx, rows);
      if (!verified) {
        warnSync('cloud restore verification', new Error('Restored cloud state did not match local signature.'));
      } else {
        markConflictResolved(ctx, 'account', pendingConflictSignature || conflictParts(rows));
      }
      refreshAfterCloudRestore();
      return verified;
    } catch(error) {
      restoreLocalBackupSnapshot(backup);
      warnSync('cloud restore', error);
      return false;
    }
  }

  async function restoreCloudBackupSnapshotToSupabase(ctx, rows) {
    if (!ctx || !rows) return;
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

    if (profileRow) await awaitRequest('rollback user_profile', ctx.client.from('user_profile').upsert(profileRow, { onConflict: 'user_id' }));
    if (progressRow) await awaitRequest('rollback user_progress', ctx.client.from('user_progress').upsert(progressRow, { onConflict: 'user_id' }));
    if (settingsRow) await awaitRequest('rollback user_settings', ctx.client.from('user_settings').upsert(settingsRow, { onConflict: 'user_id' }));
    if (Array.isArray(sessionRows) && sessionRows.length) {
      await awaitRequest('rollback sessions', ctx.client.from('sessions').insert(sessionRows));
    }
    if (Array.isArray(milestoneRows) && milestoneRows.length) {
      await awaitRequest('rollback achievements_or_milestones', ctx.client.from('achievements_or_milestones').upsert(milestoneRows, { onConflict: 'user_id,milestone_id' }));
    }
    if (weaknessRow) await awaitRequest('rollback weakness_stats', ctx.client.from('weakness_stats').upsert(weaknessRow, { onConflict: 'user_id' }));
    if (srRow) await awaitRequest('rollback spaced_repetition_queue', ctx.client.from('spaced_repetition_queue').upsert(srRow, { onConflict: 'user_id' }));
    if (Array.isArray(dailyRows) && dailyRows.length) {
      await awaitRequest('rollback daily_challenges', ctx.client.from('daily_challenges').upsert(dailyRows, { onConflict: 'user_id,challenge_date' }));
    }
  }

  function openProgressConflictModal(cloudRows, signature) {
    pendingConflictRows = cloudRows || null;
    pendingConflictSignature = signature || conflictParts(cloudRows);
    const modal = document.getElementById('progressConflictModal');
    if (!modal) return;
    renderConflictModalDetails(cloudRows);
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
    const restored = await restoreCloudAppStateToLocal(ctx, pendingConflictRows);
    if (restored) {
      pendingConflictRows = null;
      pendingConflictSignature = null;
    }
  }

  function requestKeepDeviceProgress() {
    closeProgressConflictModal(openReplaceAccountModal);
  }

  async function confirmKeepDeviceProgress() {
    const ctx = getClientAndUser();
    closeReplaceAccountModal();
    if (!ctx) return;
    let cloudBackupRows = null;
    try {
      debugKeepDeviceSync('safety flow start', { userId: ctx.user.id });
      cloudReadFailed = false;
      cloudBackupRows = await fetchCloudAppState(ctx);
      if (cloudReadFailed) throw new Error('Could not create cloud backup before replacing account progress.');
      debugKeepDeviceSync('cloud backup/fetch result', {
        hasCloudProgress: hasCloudProgressData(cloudBackupRows),
        hasCloudNonProfileProgress: hasCloudMeaningfulNonProfileData(cloudBackupRows)
      });

      debugKeepDeviceSync('local upload preflight start');
      const preflightUpload = await uploadFullLocalStateToSupabase(ctx);
      const preflightVerification = await verifyCloudContainsLocalNonAvatarData(ctx);
      if (!preflightVerification.ok) {
        throw new Error('Could not verify local progress in cloud before replacing account progress.');
      }
      debugKeepDeviceSync('local upload preflight success', {
        containsLocalNonAvatarData: true,
        avatarUploadFailed: !!(preflightUpload && preflightUpload.avatarUploadFailed)
      });

      debugKeepDeviceSync('cloud reset start');
      try {
        await resetSupabaseAppData({ preserveProfile: null, requireSuccess: true });
      } catch(resetError) {
        debugKeepDeviceSync('cloud reset failure; attempting rollback', { error: resetError && resetError.message ? resetError.message : resetError });
        try {
          await restoreCloudBackupSnapshotToSupabase(ctx, cloudBackupRows);
          debugKeepDeviceSync('cloud rollback from backup success');
        } catch(rollbackError) {
          warnSync('replace account progress rollback', rollbackError);
        }
        throw resetError;
      }
      debugKeepDeviceSync('cloud reset success');

      debugKeepDeviceSync('local upload after reset start');
      let finalResult = null;
      try {
        finalResult = await uploadLocalAppStateToSupabase(ctx, { allowAvatarOnlyMismatch: true });
      } catch(uploadError) {
        debugKeepDeviceSync('local upload failure after reset; attempting rollback', { error: uploadError && uploadError.message ? uploadError.message : uploadError });
        try {
          await restoreCloudBackupSnapshotToSupabase(ctx, cloudBackupRows);
          debugKeepDeviceSync('cloud rollback from backup success');
        } catch(rollbackError) {
          warnSync('replace account progress rollback', rollbackError);
        }
        throw uploadError;
      }

      debugKeepDeviceSync('local upload after reset success', {
        verified: !!(finalResult && finalResult.verified),
        nonAvatarVerified: !!(finalResult && finalResult.nonAvatarVerified),
        avatarUploadFailed: !!(finalResult && finalResult.avatarUploadFailed)
      });

      if (finalResult && finalResult.verified) {
        markConflictResolved(ctx, 'device', pendingConflictSignature || conflictParts(pendingConflictRows));
        pendingConflictRows = null;
        pendingConflictSignature = null;
        return;
      }

      if (finalResult && finalResult.nonAvatarVerified && finalResult.avatarUploadFailed) {
        console.warn('[sync safety] Keep device progress uploaded sessions/progress, but conflict was not marked resolved because avatar still differs.');
        return;
      }

      throw new Error('Could not verify cloud after replacing account progress.');
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
            if (isLocalUnchangedSinceUserSync(ctx, cloudRows)) {
              await syncAllLocalAppStateToSupabase();
              return;
            }
            debugSyncMarker('not trusted; continuing to conflict decision', {
              userId: ctx.user.id
            });
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
    if (!ctx) throw new Error('No logged-in Supabase user for reset.');
    const preserveProfile = options && options.preserveProfile;
    const requireSuccess = !!(options && options.requireSuccess);
    const errors = [];
    debugResetSync('reset started', {
      loggedIn: !!ctx.user,
      userId: ctx.user && ctx.user.id,
      requireSuccess,
      preserveProfile: !!preserveProfile
    });
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
    debugResetSync('cloud delete started', { tables });
    await Promise.all(tables.map(async table => {
      try {
        const { error } = await ctx.client.from(table).delete().eq('user_id', ctx.user.id);
        if (error) {
          debugResetSync('table delete failure', { table, error });
          warnSync('reset ' + table, error);
          errors.push({ table, error });
        } else {
          debugResetSync('table delete success', { table });
        }
      } catch(error) {
        debugResetSync('table delete failure', { table, error });
        warnSync('reset ' + table, error);
        errors.push({ table, error });
      }
    }));
    if (requireSuccess && errors.length) {
      throw new Error('Could not clear all cloud app data before replacing account progress: ' + errors.map(item => item.table).join(', '));
    }
    if (preserveProfile) {
      const profile = preserveProfile;
      const avatar = readString(KEYS.profileAvatar, null);
      const profileRow = {
        user_id: ctx.user.id,
        name: profile.name || null,
        joined_date: profile.joinedDate || null,
        updated_at: new Date().toISOString()
      };
      if (avatar && !avatar.startsWith('data:')) profileRow.avatar_url = avatar;
      try {
        await awaitRequest('reset user_profile', ctx.client.from('user_profile').upsert(profileRow, { onConflict: 'user_id' }));
        debugResetSync('preserved profile upsert success', { userId: ctx.user.id, hasAvatar: !!profileRow.avatar_url });
      } catch(error) {
        debugResetSync('preserved profile upsert failure', { error });
        throw error;
      }
    }
    cloudReadFailed = false;
    const rows = await fetchCloudAppState(ctx);
    if (cloudReadFailed) throw new Error('Could not verify cloud reset after delete.');
    const verificationErrors = cloudResetVerificationErrors(rows, preserveProfile);
    debugResetSync('cloud reset verification result', {
      ok: verificationErrors.length === 0,
      failures: verificationErrors
    });
    if (verificationErrors.length) {
      throw new Error('Cloud reset verification failed: ' + verificationErrors.join(', '));
    }
    return rows;
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
