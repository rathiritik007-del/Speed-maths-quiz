const isMobile = window.matchMedia("(pointer: coarse)").matches;

// ═══════════════════════════════════════════════
//  PRACTICE MODE
// ═══════════════════════════════════════════════
const PRACTICE_MODE_KEY = 'quiz_practice_mode';

function isPracticeMode() {
  try { return localStorage.getItem(PRACTICE_MODE_KEY) === '1'; } catch(e) { return false; }
}

function applyPracticeMode(on) {
  document.documentElement.dataset.practice = on ? '1' : '0';
  // Sync toggle if profile screen is open
  const tog = document.getElementById('practiceModeTog');
  if (tog) tog.checked = on;
}

function setPracticeMode(on) {
  try {
    localStorage.setItem(PRACTICE_MODE_KEY, on ? '1' : '0');
    window.syncUserProgressToSupabase?.();
  } catch(e) {}
  applyPracticeMode(on);
  // If XP/level modal is showing, hide it immediately
  if (on) {
    const modal = document.getElementById('levelUpModal');
    if (modal) modal.classList.remove('show');
    const toast = document.getElementById('milestoneToast');
    if (toast) toast.classList.remove('show');
  }
}

// Apply on load — before anything renders
applyPracticeMode(isPracticeMode());

  let qs=[], cur=0, score=0, results=[], qType='both';
let instant=true, autoSub=false, answered=false, pickMode=false;
let pendingPickAnswer = null;
let autoSubmitTimer = null;

let timerInterval=null;
let stopwatchInterval=null;
let stopwatchStart=null;

let timerMode = 'fixed';
let duration = 7;
const CIRC=188.5;

// ── TIMED MODE state ──
let isTimedMode = false;
  let sessionId = 0; // incremented on every new test start or abort — stale callbacks bail out
let timedDuration = 60;          // seconds
let timedInterval = null;        // rAF handle
let timedStartTime = null;
let timedQAnswered = 0;
const TIMED_DURATIONS = [30, 60, 90, 120, 180, 300]; // slider steps

function restartAnimationClass(el, className) {
  if (!el) return;
  const key = '_restart_' + className;
  if (el[key]) cancelAnimationFrame(el[key]);
  el.classList.remove(className);
  el[key] = requestAnimationFrame(() => {
    el[key] = null;
    el.classList.add(className);
  });
}

function restartInlineAnimation(el) {
  if (!el) return;
  if (el._restartInlineAnimFrame) cancelAnimationFrame(el._restartInlineAnimFrame);
  el.style.animation = 'none';
  el._restartInlineAnimFrame = requestAnimationFrame(() => {
    el._restartInlineAnimFrame = null;
    el.style.animation = '';
  });
}

function clearAutoSubmitTimer() {
  if (!autoSubmitTimer) return;
  clearTimeout(autoSubmitTimer);
  autoSubmitTimer = null;
}

function maybeScheduleAutoSubmit(inputEl) {
  clearAutoSubmitTimer();
  if (!autoSub || answered) return;
  const q = qs[cur];
  if (!q || !inputEl) return;
  const val = inputEl.value;
  if (val === '' || val === '-') return;
  const targetLen = q.reverse ? String(q.n).length : String(q.answer).length;
  if (val.replace('-', '').length < targetLen) return;
  const scheduledSession = sessionId;
  const scheduledQuestion = cur;
  autoSubmitTimer = setTimeout(() => {
    autoSubmitTimer = null;
    if (sessionId === scheduledSession && cur === scheduledQuestion && !answered) checkAnswer();
  }, 120);
}

// ── new feature state ──
let streak = 0, bestStreak = 0;
let lives = 3, livesMode = false;
let reverseMode = false, spacedMode = false, focusMode = false;
  let arithSubType = 'both'; // 'add' | 'sub' | 'both'
  let arithDiff    = '2digit'; // '2digit' | '3digit' | '4digit'

  function setArithType(el){
    arithSubType = el.dataset.atype;
    document.querySelectorAll('#arithTypeGrid .timer-opt').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
  }

  function setArithDiff(el){
    arithDiff = el.dataset.adiff;
    document.querySelectorAll('#arithDiffGrid .timer-opt').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
  }
let focusNums = new Set();
let wrongQueue = [];   // spaced repetition re-queue
let retrySet = new Set();
const PB_KEY = 'quiz_pb';

let tablesScope = 'custom';
let selectedTables = new Set();
const multUpTo = 10;
let multSubType = 'tables';
let mult2dDiff  = 'easy';

function getTablesRange(){
  const f = parseInt(document.getElementById('tablesFrom').value) || 2;
  const t = parseInt(document.getElementById('tablesTo').value) || 12;
  return { from: Math.min(f,t), to: Math.max(f,t) };
}
function onTablesRangeChange(){
  const focusOn = document.getElementById('focusTog').checked;
  if(focusOn && qType === 'multiplication') { selectedTables.clear(); buildFocusGrid(); }
}
function set2dDiff(btn){
  document.querySelectorAll('#mult2dDiffGrid .timer-opt').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  mult2dDiff = btn.dataset['2ddiff'];
}
function setMultType(btn){
  document.querySelectorAll('#multTypeGrid .timer-opt').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  multSubType = btn.dataset.mtype;
  document.getElementById('tablesSection').style.display = multSubType === 'tables' ? '' : 'none';
  document.getElementById('twoDigitSection').style.display = multSubType === '2digit' ? '' : 'none';
  const focusSubEl = document.getElementById('focusTogSub');
  if(focusSubEl) focusSubEl.textContent = multSubType === 'tables' ? 'Pick specific tables' : 'Pick specific numbers';
}

  function show(id){
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.body.dataset.activeScreen = id;
  }
  function setType(t){
    qType = t;
    const isMultiplication = t === 'multiplication';
    const isArithmetic     = t === 'arithmetic';
    ['squares','cubes','both','multiplication','arithmetic'].forEach(x=>{
      const btn=document.getElementById('btn-'+x);
      if(btn) btn.classList.toggle('active', x===t);
    });
    document.getElementById('rangeCell').style.display       = (isMultiplication || isArithmetic) ? 'none' : '';
    document.getElementById('tablesCell').style.display      = isMultiplication ? '' : 'none';
    document.getElementById('arithmeticCell').style.display  = isArithmetic     ? '' : 'none';
    const revTog = document.getElementById('reverseTog');
    const revRow = document.getElementById('reverseRow');
    const showRoot = !isMultiplication && !isArithmetic;
    if(revRow) revRow.style.display = showRoot ? '' : 'none';
    if(revTog && !showRoot) revTog.checked = false;
    const focusOn = document.getElementById('focusTog').checked;
    if(focusOn) buildFocusGrid();
  }

  function setDiff(d, e){
    document.querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('active'));
    e.target.classList.add('active');
    const map = {easy:[1,10], medium:[1,20], hard:[1,50]};
    document.getElementById('rangeFrom').value = map[d][0];
    document.getElementById('rangeTo').value   = map[d][1];
    buildFocusGrid();
  }

  function buildFocusGrid(){
    const isTable = qType === 'multiplication' && multSubType === 'tables';
    const grid = document.getElementById('focusChips');
    const label = document.getElementById('focusGridLabel');
    grid.innerHTML = '';
    if(isTable){
      if(label) label.textContent = '🎯 Focus tables';
      const {from, to} = getTablesRange();
      for(let n=from; n<=to; n++){
        const chip = document.createElement('button');
        chip.className = 'focus-chip' + (selectedTables.has(n) ? ' selected' : '');
        chip.textContent = n + '×';
        chip.onclick = () => {
          if(selectedTables.has(n)){ selectedTables.delete(n); chip.classList.remove('selected'); }
          else { selectedTables.add(n); chip.classList.add('selected'); }
        };
        grid.appendChild(chip);
      }
    } else {
      if(label) label.textContent = '🎯 Focus numbers';
      const from = parseInt(document.getElementById('rangeFrom').value)||1;
      const to   = parseInt(document.getElementById('rangeTo').value)||20;
      for(let n=from; n<=to; n++){
        const chip = document.createElement('button');
        chip.className = 'focus-chip' + (focusNums.has(n) ? ' selected' : '');
        chip.textContent = n;
        chip.onclick = () => {
          if(focusNums.has(n)){ focusNums.delete(n); chip.classList.remove('selected'); }
          else { focusNums.add(n); chip.classList.add('selected'); }
        };
        grid.appendChild(chip);
      }
    }
  }

  function toggleFocusGrid(){
    const on = document.getElementById('focusTog').checked;
    const cell = document.getElementById('focusGridCell');
    if(cell) cell.style.display = on ? 'flex' : 'none';
    if(on) buildFocusGrid();
  }

  function focusSelectAll(){
    const isTable = qType === 'multiplication' && multSubType === 'tables';
    if(isTable){
      const {from, to} = getTablesRange();
      for(let n=from;n<=to;n++) selectedTables.add(n);
    } else {
      const from = parseInt(document.getElementById('rangeFrom').value)||1;
      const to   = parseInt(document.getElementById('rangeTo').value)||20;
      for(let n=from;n<=to;n++) focusNums.add(n);
    }
    buildFocusGrid();
  }
  function focusClearAll(){
    const isTable = qType === 'multiplication' && multSubType === 'tables';
    if(isTable){ selectedTables.clear(); }
    else { focusNums.clear(); }
    buildFocusGrid();
  }
  function toggleAllChips(){ focusSelectAll(); }

  function genQs(countOverride){
    const from=parseInt(document.getElementById('rangeFrom').value)||1;
    const to=parseInt(document.getElementById('rangeTo').value)||20;
    const count=countOverride || parseInt(document.getElementById('qCount').value)||10;
    const shuffle=document.getElementById('shuffleTog').checked;
    const pool=[];

    if(qType === 'multiplication'){
      if(multSubType === 'tables'){
        const {from: tFrom, to: tTo} = getTablesRange();
        let nSet;
        if(focusMode && selectedTables.size > 0){
          nSet = [...selectedTables].filter(n => n >= tFrom && n <= tTo).sort((a,b)=>a-b);
          if(!nSet.length) nSet = Array.from({length: tTo-tFrom+1}, (_,i)=>tFrom+i);
        } else {
          nSet = Array.from({length: tTo-tFrom+1}, (_,i)=>tFrom+i);
        }
        for(const n of nSet){
          for(let m=1; m<=multUpTo; m++){
            pool.push({n, m, type:'table', answer:n*m, reverse:false});
          }
        }
      } else {
        const diffMap = {easy:[10,19], medium:[10,49], hard:[10,99]};
        const [lo, hi] = diffMap[mult2dDiff] || [10,19];
        for(let i=0; i<200; i++){
          const a = Math.floor(Math.random()*(hi-lo+1))+lo;
          const b = Math.floor(Math.random()*(hi-lo+1))+lo;
          pool.push({n:a, m:b, type:'table', answer:a*b, reverse:false});
        }
      }
    } else if(qType === 'arithmetic'){
      const diffRanges = { '2digit': [10, 99], '3digit': [100, 999], '4digit': [1000, 9999] };
      const [aFrom, aTo] = diffRanges[arithDiff] || [10, 99];
      for(let i = 0; i < 300; i++){
        const a = Math.floor(Math.random()*(aTo - aFrom + 1)) + aFrom;
        const b = Math.floor(Math.random()*(aTo - aFrom + 1)) + aFrom;
        let op;
        if(arithSubType === 'add')      op = 'add';
        else if(arithSubType === 'sub') op = 'sub';
        else                            op = Math.random() < 0.5 ? 'add' : 'sub';
        if(op === 'add'){
          pool.push({n: a, m: b, type: 'add', answer: a + b, reverse: false});
        } else {
          const big = Math.max(a, b), small = Math.min(a, b);
          pool.push({n: big, m: small, type: 'sub', answer: big - small, reverse: false});
        }
      }
    } else {
      for(let n=from;n<=to;n++){
        if(focusMode && focusNums.size > 0 && !focusNums.has(n)) continue;
        if(qType==='squares'||qType==='both') pool.push({n,type:'square',answer:n*n,reverse:reverseMode});
        if(qType==='cubes'  ||qType==='both') pool.push({n,type:'cube',  answer:n*n*n,reverse:reverseMode});
      }
    }

    if(!pool.length) return [];
    if(shuffle) for(let i=pool.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [pool[i],pool[j]]=[pool[j],pool[i]];
    }
    return pool.slice(0,count);
  }

  function startTest(){
  sessionId++;
  const currentSession = sessionId;

  // Re-sync ALL button-driven state from DOM first so stale JS variables never win
  const activeTypeBtn = document.querySelector('.type-btn.active');
  if(activeTypeBtn) qType = activeTypeBtn.id.replace('btn-', '');

  const activeMultType = document.querySelector('#multTypeGrid .timer-opt.active');
  if(activeMultType) multSubType = activeMultType.dataset.mtype;

  const active2dDiff = document.querySelector('#mult2dDiffGrid .timer-opt.active');
  if(active2dDiff) mult2dDiff = active2dDiff.dataset['2ddiff'];

  const activeArithType = document.querySelector('#arithTypeGrid .timer-opt.active');
  if(activeArithType) arithSubType = activeArithType.dataset.atype;

  const activeArithDiff = document.querySelector('#arithDiffGrid .timer-opt.active');
  if(activeArithDiff) arithDiff = activeArithDiff.dataset.adiff;

  const activeTimerOpt = document.querySelector('#timerGrid .timer-opt.active');
  if(activeTimerOpt) timerMode = activeTimerOpt.dataset.value;

  // Derive isTimedMode AFTER timerMode is confirmed from DOM
  isTimedMode = (timerMode === 'timed');
  unlimitedMode = document.getElementById('unlimitedTog').checked;

  // Read all toggle states BEFORE generating questions so they are applied correctly
  instant    = document.getElementById('feedbackTog').checked;
  autoSub    = document.getElementById('autosubTog').checked;
  pickMode   = document.getElementById('pickModeTog').checked;
  reverseMode= document.getElementById('reverseTog').checked;
  livesMode  = document.getElementById('livesTog').checked;
  spacedMode = document.getElementById('spacedTog').checked;
  focusMode  = document.getElementById('focusTog').checked;

  // In timed mode, generate a large pool of questions to cycle through
  if(isTimedMode){
    // generate big pool (200 questions), we'll cycle infinitely
    qs = genQs(200);
    if(!qs.length){ alert('No questions — check your range!'); return; }
    // shuffle to start fresh
    for(let i=qs.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [qs[i],qs[j]]=[qs[j],qs[i]]; }
  } else if(unlimitedMode){
    // Generate large pool for unlimited — will recycle
    qs = genQs(500);
    if(!qs.length){ alert('No questions — check your range!'); return; }
  } else {
    qs=genQs();
    if(!qs.length){ alert('No questions — check your range!'); return; }
  }

  cur=0; score=0; results=[];
  streak=0; wrongQueue=[];retrySet=new Set();
  timedQAnswered=0;

  // ── Inject persistent SR items at the front of the queue ──
  if (spacedMode && !isTimedMode && !unlimitedMode) {
    const srItems = getSRQuestionsForSession();
    if (srItems.length) {
      // Mark them as SR retries and prepend
      const tagged = srItems.map(q => ({ ...q, _srRetry: true }));
      qs = [...tagged, ...qs];
      // Track their indices so we can show RETRY badge
      tagged.forEach((_, i) => retrySet.add(i));
    }
  }
  lives = 3;
  document.getElementById('livesPill').style.display = livesMode ? 'block' : 'none';
  updateLivesPill();
  document.getElementById('streakPill').classList.remove('active');

  const mode = timerMode;
  const custom = parseInt(document.getElementById('customTimerInput').value);
  timerMode = mode;

  if(mode === 'fixed') duration = 7;
  else if(mode === 'custom') duration = isNaN(custom) ? 7 : custom;

  // Show/hide timed mode bar
  const tmBar = document.getElementById('timedModeBar');
  if(isTimedMode){
    tmBar.classList.add('visible');
    document.getElementById('timedChip').style.display = 'flex';
    // hide per-question timer, progress bar
    document.getElementById('timerZone').style.display = 'none';
    document.getElementById('stopwatchZone').style.display = 'none';
    // update q pill to show infinite
    document.getElementById('qTotal').textContent = '∞';
  } else {
    tmBar.classList.remove('visible');
  }

  if(unlimitedMode){
    document.getElementById('qTotal').textContent = '∞';
    document.getElementById('endSessionBtn').classList.add('visible');
  } else {
    document.getElementById('endSessionBtn').classList.remove('visible');
  }

  show('s-test');
  loadQ();

  // Start global timed countdown AFTER loadQ
  if(isTimedMode){
    startTimedCountdown();
  }
}

  /* ── Generate 4 plausible wrong answers ── */
  function genOptions(correct, qObj){
    const type = qObj.type;
    const n    = qObj.n;
    const candidates = [];

    function rsh(arr){ for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr; }

    if(type === 'add' || type === 'sub'){
      // Plausible carry / mental-math errors — always same order of magnitude
      const offsets = [1, 2, 9, 10, 11, 18, 19, 20, 21, 99, 100, 101, 90, 110];
      rsh(offsets);
      for(const o of offsets){
        candidates.push(correct + o);
        if(correct - o > 0) candidates.push(correct - o);
      }

    } else if(type === 'table'){
      const m = qObj.m;
      // Adjacent-factor errors — the most natural mistakes for times tables
      const factorErrs = [];
      for(let d = 1; d <= 5; d++){
        factorErrs.push(n * (m + d));
        if(m - d > 0) factorErrs.push(n * (m - d));
        factorErrs.push((n + d) * m);
        if(n - d > 0) factorErrs.push((n - d) * m);
      }
      // Cross-factor swaps: (n+1)×(m-1) style
      factorErrs.push((n + 1) * (m > 1 ? m - 1 : m + 1));
      factorErrs.push((n > 1 ? n - 1 : n + 1) * (m + 1));
      candidates.push(...rsh(factorErrs));
      // Close raw offsets as last resort
      for(let d = 1; d <= 5; d++){
        candidates.push(correct + d);
        if(correct - d > 0) candidates.push(correct - d);
      }

    } else if(type === 'square'){
      const seenBases = new Set([n]);
      const addSquareBase = (k) => {
        if(k > 0 && !seenBases.has(k)){
          seenBases.add(k);
          candidates.push(k * k);
        }
      };
      const unit = n % 10;
      if(n >= 10 && unit !== 0){
        const mirror = n + (10 - 2 * unit);
        if(Math.floor(mirror / 10) === Math.floor(n / 10)){
          addSquareBase(mirror);
        }
      }
      [n - 2, n - 1, n + 1, n + 2].forEach(addSquareBase);
      for(const o of [1, -1, 2, -2]){
        if(correct + o > 0) candidates.push(correct + o);
      }

    } else if(type === 'cube'){
      const nearbyBases = [n - 2, n - 1, n + 1, n + 2].filter(k => k > 0);
      for(const k of nearbyBases){
        candidates.push(k * k * k);
      }
      for(const o of [1, -1, 2, -2]){
        if(correct + o > 0) candidates.push(correct + o);
      }
    }

    // Build final set of 4 (correct + 3 unique distractors)
    const opts = new Set([correct]);
    for(const c of candidates){
      if(Number.isInteger(c) && c > 0 && c !== correct && !opts.has(c)){
        opts.add(c);
        if(opts.size === 4) break;
      }
    }
    // Fallback: step away from correct until we have 4
    let fb = 1;
    while(opts.size < 4){ if(!opts.has(correct + fb)) opts.add(correct + fb); fb++; }

    // Shuffle final 4
    const arr = [...opts];
    for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
    return arr;
  }

  function loadQ(){
    clearAutoSubmitTimer();
    clearTimer(); answered=false; pendingPickAnswer = null;

    // In timed mode, cycle through question pool infinitely
    if(isTimedMode && cur >= qs.length){
      // reshuffle and restart pool
      for(let i=qs.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [qs[i],qs[j]]=[qs[j],qs[i]]; }
      cur = 0;
    }

    const q=qs[cur], total=qs.length, sym=q.type==='square'?'²':'³';
    document.getElementById('qNum').textContent = isTimedMode ? String(timedQAnswered+1) : String(cur+1).padStart(2,'0');
    document.getElementById('qTotal').textContent = isTimedMode ? '∞' : unlimitedMode ? '∞' : total;
    const _sp=document.getElementById('scorePill'); _sp.textContent=`Score: ${score}`; restartAnimationClass(_sp, 'pill-bump');
    document.getElementById('progFill').style.width  = `${(cur/total)*100}%`;
    const badge=document.getElementById('qBadge');
    if(q.type==='table'){
      badge.textContent = 'Tables';
      badge.className = 'q-badge badge-sq';
    } else if(q.type==='add'){
      badge.textContent = 'Addition';
      badge.className   = 'q-badge badge-sq';
    } else if(q.type==='sub'){
      badge.textContent = 'Subtraction';
      badge.className   = 'q-badge badge-cu';
    } else {
      badge.textContent = q.type==='square'?'Square':'Cube';
      badge.className   = 'q-badge '+(q.type==='square'?'badge-sq':'badge-cu');
    }
    const isRetry = retrySet.has(cur);
    const _qLabel = document.getElementById('qLabel'); if(_qLabel) _qLabel.innerHTML = `Question ${String(cur+1).padStart(2,'0')}` + (isRetry ? '<span class="retry-badge">RETRY</span>' : '');
    if(q.type==='table'){
      document.getElementById('qExpr').textContent = `${q.n} × ${q.m}`;
      document.getElementById('qSub').textContent = 'What is the answer?';
    } else if(q.type==='add'){
      document.getElementById('qExpr').textContent = `${q.n} + ${q.m}`;
      document.getElementById('qSub').textContent = 'What is the sum?';
    } else if(q.type==='sub'){
      document.getElementById('qExpr').textContent = `${q.n} − ${q.m}`;
      document.getElementById('qSub').textContent = 'What is the difference?';
    } else if(q.reverse){
      document.getElementById('qExpr').textContent = q.answer.toLocaleString();
      document.getElementById('qSub').textContent  = q.type==='square' ? 'What number squared gives this?' : 'What number cubed gives this?';
      badge.textContent = q.type==='square' ? '² Reverse Square' : '³ Reverse Cube';
      badge.className = 'q-badge badge-rev';
    } else {
      document.getElementById('qExpr').textContent = `${q.n}${sym}`;
    }
    const _fb = document.getElementById('fbBox');
    _fb.classList.remove('visible', 'fb-ok', 'fb-no');
    _fb.textContent = '';
    // nextBtn removed — checkBtn handles both check and next

    // Animate q-card pop
    const qCard = document.querySelector('.q-card');
    if(qCard){ restartAnimationClass(qCard, 'q-card-anim'); }
    // Animate expression
    const qExprEl = document.getElementById('qExpr');
    if(qExprEl){ restartAnimationClass(qExprEl, 'expr-anim'); }
    // Animate ans zone
    const ansZone = document.querySelector('.ans-zone');
    if(ansZone){ restartAnimationClass(ansZone, 'ans-zone-anim'); }
    document.getElementById('timerZone').style.display = (!isTimedMode && (timerMode === 'fixed' || timerMode === 'custom')) ? 'flex' : 'none';
    document.getElementById('stopwatchZone').style.display = (!isTimedMode && timerMode === 'stopwatch') ? 'flex' : 'none';
    document.getElementById('timedChip').style.display = isTimedMode ? 'flex' : 'none';

    if(pickMode){
      // PICK MODE
      document.getElementById('typeZone').style.display = 'none';
      document.getElementById('pickZone').style.display = 'block';
      document.getElementById('keyboard').style.display = 'none';
      document.getElementById('qSub').textContent = 'Choose the correct answer';
      const checkBtn = document.getElementById('checkBtn');
      checkBtn.disabled = false;
      checkBtn.classList.remove('is-next');
      checkBtn.textContent = 'Check';
      checkBtn.onclick = submitPendingPickAnswer;
      checkBtn.style.display = 'none';
      buildPickGrid(q);
    } else {
      // TYPE MODE
      document.getElementById('typeZone').style.display = 'block';
      document.getElementById('pickZone').style.display = 'none';
      const digits = q.reverse ? String(q.n).length : String(q.answer).length;
      if(!q.reverse && q.type !== 'add' && q.type !== 'sub'){
        document.getElementById('qSub').textContent = autoSub?`Answer has ${digits} digit${digits>1?'s':''}`:'What is the answer?';
      } else if(q.type === 'add' || q.type === 'sub'){
        document.getElementById('qSub').textContent = autoSub ? `Answer has ${digits} digit${digits>1?'s':''}` : (q.type==='add'?'What is the sum?':'What is the difference?');
      }
      const inp=document.getElementById('ansInput');
const keyboard = document.getElementById('keyboard');

if (isMobile) {
  inp.setAttribute('readonly', true);
  inp.setAttribute('inputmode', 'none');
  keyboard.style.display = 'block';
  const hint = document.getElementById('kbHint');
  if(hint) hint.style.display = 'none';
} else {
  inp.removeAttribute('readonly');
  inp.setAttribute('inputmode', 'numeric');
  keyboard.style.display = 'none';
  const hint = document.getElementById('kbHint');
  if(hint) hint.style.display = 'block';
}
      inp.value=''; inp.className='ans-input'; inp.disabled=false;
      const _wrap = document.getElementById('ansInputWrap');
      const _cap  = document.getElementById('ansCaption');
      if(_wrap) {
        _wrap.classList.remove('show-correct', 'split-wrong');
        const _old = _wrap.querySelector('.ans-split-overlay');
        if (_old) _old.remove();
      }
      if(_cap)  { _cap.className='ans-caption'; _cap.textContent=''; }
      const _fb = document.getElementById('fbBox');
      if(_fb)   { _fb.className='fb-box'; _fb.textContent=''; }
      document.getElementById('checkBtn').disabled     = false;
      const checkBtn = document.getElementById('checkBtn');

if (autoSub) {
  checkBtn.style.display = 'none';
} else {
  checkBtn.style.display = 'block';
  checkBtn.classList.remove('is-next');
  checkBtn.textContent = instant ? 'Check' : 'Next →';
  checkBtn.onclick = checkAnswer;
}
      if (!isMobile) {
  inp.focus();
}
    }

    if(timerMode === 'fixed' || timerMode === 'custom'){
  startTimer();
}

if(timerMode === 'stopwatch'){
  startStopwatch();
}
  }

  function buildPickGrid(q){
    let options, correctPick;
    if(q.type === 'table' || q.type === 'add' || q.type === 'sub'){
      correctPick = q.answer;
      options = genOptions(q.answer, q);
    } else if(q.reverse){
      correctPick = q.n;
      options = genBaseOptions(q.n);
    } else {
      correctPick = q.answer;
      options = genOptions(q.answer, q);
    }
    const grid = document.getElementById('pickGrid');
    grid.innerHTML = '';
    options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'pick-btn pick-btn-anim';
      btn.style.animationDelay = `${i * 0.06}s`;
      btn.innerHTML = `${opt.toLocaleString()}<span class="pick-icon"></span>`;
      btn.onclick = () => pickAnswer(opt, correctPick);
      grid.appendChild(btn);
    });
  }

  function genBaseOptions(n){
    // Generate 4 plausible base numbers near n
    const opts = new Set([n]);
    for(let d=1; opts.size<4; d++){
      if(n+d>0) opts.add(n+d);
      if(opts.size<4 && n-d>0) opts.add(n-d);
    }
    const arr=[...opts];
    for(let i=arr.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
    return arr;
  }

  function submitPendingPickAnswer(){
  if(answered){ nextQ(); return true; }
  if(!pendingPickAnswer) return false;
  return pickAnswer(pendingPickAnswer.chosen, pendingPickAnswer.correct, true);
}

  function pickAnswer(chosen, correct, forceSubmit){
  if(answered) return false;
  const selectedPickType = document.getElementById('pickModeType')?.value || 'auto';
  if(!forceSubmit && !isTimedMode && selectedPickType === 'manual'){
    pendingPickAnswer = { chosen, correct };
    document.querySelectorAll('.pick-btn').forEach(btn => {
      const val = parseInt(btn.textContent.replace(/,/g, ''));
      btn.classList.toggle('selected', val === chosen);
    });
    const actionBtn = document.getElementById('checkBtn');
    actionBtn.style.display = 'block';
    actionBtn.textContent = 'Check';
    actionBtn.classList.remove('is-next');
    actionBtn.onclick = () => pickAnswer(chosen, correct, true);
    return false;
  }
  clearTimer(); clearStopwatch();
  answered = true;
  pendingPickAnswer = null;

  const isCorrect = chosen === correct;
  if(isCorrect){ score++; streak++; if(streak>bestStreak) bestStreak=streak; }
  else { streak=0; if(spacedMode) wrongQueue.push(cur); }
  updateStreakPill();

  results.push({q:qs[cur], userAnswer:chosen, correct:isCorrect, timedOut:false});
  if(isTimedMode) timedQAnswered++;

  const btns = document.querySelectorAll('.pick-btn');
  btns.forEach(btn => {
    btn.disabled = true;
    const val = parseInt(btn.textContent.replace(/,/g, ''));
    if(val === correct){
      btn.classList.add(isCorrect ? 'correct' : 'reveal');
      btn.querySelector('.pick-icon').textContent = '✓ correct';
    } else if(val === chosen && !isCorrect){
      btn.classList.add('wrong');
    }
  });

  const _sp=document.getElementById('scorePill'); _sp.textContent=`Score: ${score}`; restartAnimationClass(_sp, 'pill-bump');

  if(!isCorrect && livesMode){
    lives--; updateLivesPill();
    if(lives <= 0){ const _sid=sessionId; setTimeout(()=>{ if(sessionId===_sid) gameOver(); }, 900); return; }
  }

  const pickType = document.getElementById('pickModeType')?.value || 'auto';
  const actionBtn = document.getElementById('checkBtn');
  if(!isTimedMode && pickType === 'manual'){
    actionBtn.style.display = 'block';
    actionBtn.textContent = cur < qs.length-1 ? 'Next question →' : 'See results →';
    actionBtn.classList.add('is-next');
    actionBtn.onclick = nextQ;
  } else {
    const _sid=sessionId; setTimeout(() => { if(sessionId===_sid) nextQ(); }, isTimedMode ? 500 : 900);
  }
}

  function clearTimer(){
  if(timerInterval){
    cancelAnimationFrame(timerInterval);
    timerInterval = null;
  }
  const chip = document.getElementById('timerZone');
  if (chip) chip.classList.remove('urgent');
}

function startTimer(){

  function timeUp(){
    answered = true;
    const q = qs[cur];

    if(pickMode){
      const btns = document.querySelectorAll('.pick-btn');
      const correctPick = q.reverse ? q.n : q.answer;
      btns.forEach(btn => {
        btn.disabled = true;
        if(parseInt(btn.textContent.replace(/,/g, '')) === correctPick){
          btn.classList.add('reveal');
        }
      });
      streak=0; updateStreakPill();
      if(spacedMode) wrongQueue.push(cur);
      if(spacedMode) srAddQuestion(q); // persist time-outs too
      if(livesMode){ lives--; updateLivesPill(); }
      results.push({q, userAnswer:'—', correct:false, timedOut:true});
    } else {
      const val = parseInt(document.getElementById('ansInput').value);
      const correctVal2 = q.type==='table' ? q.answer : (q.reverse ? q.n : q.answer);
      const correct = !isNaN(val) && val === correctVal2;

      if(correct){ score++; streak++; if(streak>bestStreak)bestStreak=streak; }
      else { streak=0; if(spacedMode) wrongQueue.push(cur); }
      updateStreakPill();

      results.push({q, userAnswer:isNaN(val)?'—':val, correct, timedOut:true});
      if(isTimedMode) timedQAnswered++;

      document.getElementById('ansInput').disabled = true;
      document.getElementById('checkBtn').disabled = true;
      if(!correct && livesMode){ lives--; updateLivesPill(); }
    }

    const _sp=document.getElementById('scorePill'); _sp.textContent=`Score: ${score}`; restartAnimationClass(_sp, 'pill-bump');
    const _sid=sessionId; setTimeout(() => { if(sessionId===_sid) nextQ(); }, 1300);
  }

  const start = performance.now();
  const chip = document.getElementById('timerZone');
  const secsEl = document.getElementById('timerSecs');

  // initialise label to full duration immediately
  if (secsEl) secsEl.textContent = Math.ceil(duration) + 's';
  if (chip) chip.classList.remove('urgent');

  function animate(now){
    const elapsed = (now - start) / 1000;
    const remaining = Math.max(0, duration - elapsed);

    const percent = (remaining / duration) * 100;

    const arc = document.getElementById('timerArc');
    if (arc) { arc.style.strokeDashoffset = 113.1 * (1 - percent / 100); }

    // update readable text label
    if (secsEl) secsEl.textContent = Math.ceil(remaining) + 's';

    // urgent state at ≤ 3 seconds
    if (chip) {
      if (remaining <= 3 && remaining > 0) {
        chip.classList.add('urgent');
      } else {
        chip.classList.remove('urgent');
      }
    }

    if (remaining > 0){
      timerInterval = requestAnimationFrame(animate);
    } else {
      if (chip) chip.classList.remove('urgent');
      if (!answered) timeUp();
    }
  }

  timerInterval = requestAnimationFrame(animate);
}
  function checkAnswer(){
  clearAutoSubmitTimer();
  const btn = document.getElementById('checkBtn');

  if(answered){
    nextQ();
    return;
  }

  const q = qs[cur];
  const val = parseInt(document.getElementById('ansInput').value);
  if(isNaN(val)) return;

  clearTimer();
  answered = true;

  const correctVal = (q.type==='table'||q.type==='add'||q.type==='sub') ? q.answer : (q.reverse ? q.n : q.answer);
  const correct = val === correctVal;
  if(correct){ score++; streak++; if(streak>bestStreak) bestStreak=streak; }
  else { streak=0; if(spacedMode) wrongQueue.push(cur); }

  updateStreakPill();
  results.push({q,userAnswer:val,correct,timedOut:false});
  if(isTimedMode) timedQAnswered++;

  const input = document.getElementById('ansInput');
  const wrap  = document.getElementById('ansInputWrap');
  const cap   = document.getElementById('ansCaption');
  input.disabled = true;

  // ── Input colour (always shown regardless of instant) ──
  input.className = 'ans-input ' + (correct ? 'correct' : 'wrong shake');

  // ── ✔ icon on correct ──
  if (wrap) wrap.classList.toggle('show-correct', correct);

  // ── Split-view on wrong: show user's answer left, correct right ──
  if (cap) { cap.className = 'ans-caption'; cap.textContent = ''; } // keep hidden
  if (!correct && wrap) {
    const sym = q.type==='square'?'²':'³';
    let correctDisplay = '';
    if      (q.type==='table') correctDisplay = String(q.answer);
    else if (q.type==='add')   correctDisplay = String(q.answer);
    else if (q.type==='sub')   correctDisplay = String(q.answer);
    else if (q.reverse)        correctDisplay = String(q.n);
    else                       correctDisplay = String(q.answer);

    // Remove any existing overlay
    const old = wrap.querySelector('.ans-split-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ans-split-overlay';
    overlay.innerHTML = `<span class="split-wrong-val">${val}</span><span class="split-sep"></span><span class="split-correct-val">${correctDisplay}</span>`;
    wrap.classList.add('split-wrong');
    wrap.appendChild(overlay);
  } else if (correct && wrap) {
    wrap.classList.remove('split-wrong');
    const old = wrap.querySelector('.ans-split-overlay');
    if (old) old.remove();
  }

  const _sp=document.getElementById('scorePill'); _sp.textContent=`Score: ${score}`; restartAnimationClass(_sp, 'pill-bump');

  if(!correct && livesMode){
    lives--;
    updateLivesPill();
    if(lives <= 0){
      const _sid=sessionId; setTimeout(()=>{ if(sessionId===_sid) gameOver(); }, 800);
      btn.textContent = 'Game Over';
      btn.classList.add('is-next');
      btn.onclick = nextQ;
    }
  }

  if(instant){
    if(!isTimedMode && !autoSub){
      btn.textContent = cur < qs.length-1 ? 'Next →' : 'See results →';
      btn.classList.add('is-next');
      btn.onclick = nextQ;
      if(!isMobile) setTimeout(() => btn.focus(), 150);
    }
    if(isTimedMode){
      const _sid=sessionId; setTimeout(() => { if(sessionId===_sid && answered) nextQ(); }, 600);
    }
  } else if(!autoSub) {
    // instant off — go straight to next, no feedback box needed
    if(!isTimedMode) {
      nextQ();
    } else {
      const _sid=sessionId; setTimeout(() => { if(sessionId===_sid && answered) nextQ(); }, 400);
    }
  }

  // ✅ FIXED: independent auto submit
  if(autoSub && !isTimedMode){
    const delay = instant ? 900 : 0;
    const _sid=sessionId; setTimeout(() => {
      if(sessionId===_sid && answered) nextQ();
    }, delay);
  }
}  function nextQ(){
    clearTimer();
    if(lives <= 0 && livesMode){ gameOver(); return; }
    if(isTimedMode){
      // In timed mode: keep going until time runs out
      cur++;
      loadQ();
      return;
    }
    if(unlimitedMode){
      cur++;
      // Reshuffle and cycle when pool is exhausted
      if(cur >= qs.length){
        for(let i=qs.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [qs[i],qs[j]]=[qs[j],qs[i]]; }
        cur = 0;
      }
      loadQ();
      return;
    }
    if(cur < qs.length-1){
      cur++; loadQ();
    } else if(spacedMode && wrongQueue.length > 0){
      // re-queue wrong answers once
      const requeue = [...wrongQueue];
      wrongQueue = [];
      requeue.forEach(idx => {
        qs.push({...qs[idx], _retry:true});
        retrySet.add(qs.length-1);
      });
      cur++; loadQ();
    } else {
      showResults();
    }
  }

  function gameOver(){
    clearTimer(); clearStopwatch();
    show('s-gameover');
    document.getElementById('goScore').textContent = score;
    document.getElementById('goSub').textContent = `${score} correct before running out of lives`;
  }

  function updateStreakPill(){
    const pill = document.getElementById('streakPill');
    if(streak >= 2){ pill.textContent = `🔥 ${streak}`; pill.classList.add('active'); }
    else { pill.classList.remove('active'); }
  }

  function updateLivesPill(){
    const full='❤️', empty='🖤';
    document.getElementById('livesPill').textContent = full.repeat(Math.max(0,lives)) + empty.repeat(Math.max(0,3-lives));
  }

  function showResults(){
    clearTimer(); clearStopwatch(); clearTimedInterval(); show('s-results');
    document.getElementById('endSessionBtn').classList.remove('visible');
    // Reset timed mode bar
    document.getElementById('timedModeBar').classList.remove('visible');
    document.getElementById('timedChip').style.display = 'none';

    setTimeout(()=>{ const bp=document.getElementById('resPct'); if(bp){ restartAnimationClass(bp, 'big-pct-anim'); } document.querySelectorAll('#timedStatRow .stat-c').forEach((el,i)=>{ el.style.animationDelay=`${0.15+i*0.07}s`; restartInlineAnimation(el); }); }, 50);

    const total=results.length, wrong=total-score, pct=total>0?Math.round((score/total)*100):0;

    // Toggle between normal and timed results view
    const normalSection = document.getElementById('normalScoreSection');
    const timedSection  = document.getElementById('timedScoreSection');
    const timedStatRow  = document.getElementById('timedStatRow');
    const resBento      = document.querySelector('.res-bento');
    const chartWrap     = document.getElementById('chartWrap');
    const resTitle      = document.getElementById('resultsTitle');

    const cwCard = resBento ? resBento.querySelector('.res-cw-card') : null;

    if(isTimedMode){
      resTitle.textContent = '⚡ Timed Results';
      normalSection.style.display = 'none';
      timedSection.style.display  = 'flex';
      timedStatRow.style.display  = 'grid';
      if(resBento) resBento.style.display = 'grid';
      if(cwCard) cwCard.style.display = 'none';

      // Timed hero numbers
      document.getElementById('timedResTotal').textContent = total;
      document.getElementById('timedResSub').textContent = `${score} correct · ${wrong} wrong`;
      document.getElementById('timedResCorrect').textContent = score;
      document.getElementById('timedResWrong').textContent = wrong;
      document.getElementById('timedResAcc').textContent = pct + '%';

      // Trigger animation
      const numEl = document.getElementById('timedResTotal');
      restartInlineAnimation(numEl);

      // confetti if >80% accuracy and >5 questions
      if(pct >= 80 && total >= 5) launchConfetti();

    } else {
      resTitle.textContent = 'Test complete';
      normalSection.style.display = '';
      timedSection.style.display  = 'none';
      timedStatRow.style.display  = 'none';
      if(resBento) resBento.style.display = 'grid';
      if(cwCard) cwCard.style.display = '';
    }

    document.getElementById('resPct').textContent = pct+'%';
    document.getElementById('resSub').textContent = `${score} of ${total} correct`;
    document.getElementById('sCorrect').textContent = score;
    document.getElementById('sWrong').textContent   = wrong;
    // fill XP bar in bento
    const xpD = getXPData();
    const xpBarEl = document.getElementById('resXpBar');
    if (xpBarEl) {
      const xpPct = Math.min(100, Math.round(((xpD.totalXP - xpForLevel(xpD.currentLevel)) / xpForCurrentLevel(xpD.currentLevel)) * 100));
      setTimeout(() => { xpBarEl.style.width = xpPct + '%'; }, 120);
    }

    // answer review + result summaries in one pass
    const summary = {
      square: { total: 0, correct: 0 },
      cube: { total: 0, correct: 0 },
      add: { total: 0, correct: 0 },
      sub: { total: 0, correct: 0 },
      weaknessAdd: { total: 0, wrong: 0 },
      weaknessSub: { total: 0, wrong: 0 },
      wrongMap: {}
    };
    document.getElementById('reviewList').innerHTML = results.map(r=>{
      const sym=r.q.type==='square'?'²':r.q.type==='cube'?'³':'';
      const cls=r.correct?'ri-ok':'ri-no', mark=r.correct?'✓':'✗';
      let disp;
      if(r.q.type==='table')       disp = `${r.q.n}×${r.q.m}`;
      else if(r.q.type==='add')    disp = `${r.q.n}+${r.q.m}`;
      else if(r.q.type==='sub')    disp = `${r.q.n}−${r.q.m}`;
      else if(r.q.reverse)         disp = r.q.answer.toLocaleString();
      else                         disp = `${r.q.n}${sym}`;
      const correctAns = (r.q.type==='table'||r.q.type==='add'||r.q.type==='sub') ? r.q.answer : (r.q.reverse ? r.q.n : r.q.answer);
      const note=r.correct?`${correctAns}`:r.timedOut?`${correctAns} (time's up)`:`${correctAns} (you: ${r.userAnswer})`;
      if (summary[r.q.type]) {
        summary[r.q.type].total++;
        if (r.correct) summary[r.q.type].correct++;
      }
      if (!isTimedMode || !r.timedOut) {
        if (r.q.type === 'add') {
          summary.weaknessAdd.total++;
          if (!r.correct) summary.weaknessAdd.wrong++;
        } else if (r.q.type === 'sub') {
          summary.weaknessSub.total++;
          if (!r.correct) summary.weaknessSub.wrong++;
        } else {
          const key = r.q.n+'_'+r.q.type;
          if(!summary.wrongMap[key]) summary.wrongMap[key]={n:r.q.n,type:r.q.type,wrong:0,total:0};
          summary.wrongMap[key].total++;
          if(!r.correct) summary.wrongMap[key].wrong++;
        }
      }
      return `<div class="review-item"><span class="ri-q">${disp}</span><span class="ri-a ${cls}">${mark} ${note}</span></div>`;
    }).join('');

    // accuracy chart — adapts to mode
    const chartWrapEl = document.getElementById('chartWrap');
    if(summary.add.total && summary.sub.total){
      // arithmetic mode: Add vs Sub
      const adPct = Math.round(summary.add.correct/summary.add.total*100);
      const sbPct = Math.round(summary.sub.correct/summary.sub.total*100);
      chartWrapEl.style.display = 'flex';
      document.getElementById('chartSqVal').textContent = adPct+'%';
      document.getElementById('chartCuVal').textContent = sbPct+'%';
      chartWrapEl.querySelector('.chart-title').textContent = 'Addition vs Subtraction accuracy';
      chartWrapEl.querySelectorAll('.chart-row-label')[0].textContent = 'Addition';
      chartWrapEl.querySelectorAll('.chart-row-label')[1].textContent = 'Subtract';
      document.getElementById('chartSqBar').style.width = '0%';
      document.getElementById('chartCuBar').style.width = '0%';
      setTimeout(()=>{
        document.getElementById('chartSqBar').style.width = adPct+'%';
        document.getElementById('chartCuBar').style.width = sbPct+'%';
      }, 80);
    } else if(summary.square.total && summary.cube.total){
      // squares/cubes mode
      const sqPct = Math.round(summary.square.correct/summary.square.total*100);
      const cuPct = Math.round(summary.cube.correct/summary.cube.total*100);
      chartWrapEl.style.display = 'flex';
      chartWrapEl.querySelector('.chart-title').textContent = 'Squares vs Cubes accuracy';
      chartWrapEl.querySelectorAll('.chart-row-label')[0].textContent = 'Squares';
      chartWrapEl.querySelectorAll('.chart-row-label')[1].textContent = 'Cubes';
      document.getElementById('chartSqVal').textContent = sqPct+'%';
      document.getElementById('chartCuVal').textContent = cuPct+'%';
      document.getElementById('chartSqBar').style.width = '0%';
      document.getElementById('chartCuBar').style.width = '0%';
      setTimeout(()=>{
        document.getElementById('chartSqBar').style.width = sqPct+'%';
        document.getElementById('chartCuBar').style.width = cuPct+'%';
      }, 80);
    } else {
      chartWrapEl.style.display = 'none';
    }

    // weakness section
    const wWrap = document.getElementById('weaknessWrap');
    // In timed mode, only count answers the player actively got wrong — not time-outs
    const isArithMixed = summary.weaknessAdd.total > 0 && summary.weaknessSub.total > 0;
    const isArithSingle = (qType === 'arithmetic') && !isArithMixed;

    if(isArithSingle){
      // Add-only or Sub-only: hide struggled section entirely
      wWrap.style.display = 'none';
    } else if(isArithMixed){
      // Mixed arithmetic: show Add vs Sub wrong/total comparison pills
      const adWrong = summary.weaknessAdd.wrong;
      const sbWrong = summary.weaknessSub.wrong;
      const hasTrouble = adWrong > 0 || sbWrong > 0;
      if(hasTrouble){
        wWrap.style.display = 'block';
        document.getElementById('weaknessList').innerHTML =
          `<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,80,60,0.12);border:1px solid rgba(255,100,80,0.22);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700;color:rgba(239,248,226,0.7);">
            + Addition <span style="color:#ff8070;margin-left:2px;">${adWrong}/${summary.add.total} wrong</span>
          </span>
          <span style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,80,60,0.12);border:1px solid rgba(255,100,80,0.22);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700;color:rgba(239,248,226,0.7);">
            − Subtraction <span style="color:#ff8070;margin-left:2px;">${sbWrong}/${summary.sub.total} wrong</span>
          </span>`;
      } else {
        wWrap.style.display = 'none';
      }
    } else {
      // Squares/cubes/tables mode: original per-number weakness chips
      const wrongMap = summary.wrongMap;
      const weak = Object.values(wrongMap).filter(w=>w.wrong/w.total>0.5).sort((a,b)=>b.wrong/b.total-a.wrong/a.total).slice(0,5);
      if(weak.length){
        wWrap.style.display='block';
        document.getElementById('weaknessList').innerHTML = weak.map(w=>{
          const sym = w.type==='square'?'²':w.type==='cube'?'³':'';
          return `<span style="display:inline-flex;align-items:center;background:rgba(255,80,60,0.12);border:1px solid rgba(255,100,80,0.22);border-radius:20px;padding:4px 10px;font-size:12px;font-weight:700;color:rgba(239,248,226,0.7);">${w.n}${sym}</span>`;
        }).join('');
      } else { wWrap.style.display='none'; }
    }

    // personal bests — handled by onSessionComplete() via MutationObserver
    const pb = getPB();
    const isNewBest    = pct > (pb.bestPct||0);
    const isNewStreak  = bestStreak > (pb.bestStreak||0);
    if(isNewBest)   pb.bestPct    = pct;
    if(isNewStreak) pb.bestStreak = bestStreak;
    savePB(pb);
    // pb row UI rendered by renderPBRow() in onSessionComplete — just init placeholders
    document.getElementById('pbBest').textContent   = (pb.bestPct||0)+'%';
    document.getElementById('pbBest').className     = 'pb-v';
    document.getElementById('pbStreak').textContent = pb.bestStreak||0;
    document.getElementById('pbStreak').className   = 'pb-v';

    // confetti — only on new best (onSessionComplete handles it); 100% still fires here
    if(pct===100 && !isNewBest) launchConfetti();

    saveHistory(score, total, pct, Math.max(0, getXPData().totalXP - _sessionStartXP));
  }

  document.getElementById('ansInput').addEventListener('input',()=>{
    maybeScheduleAutoSubmit(document.getElementById('ansInput'));
  });
  document.getElementById('ansInput').addEventListener('keydown',e=>{
    if(e.key==='Enter'){ answered?nextQ():checkAnswer(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const quizScreen = document.getElementById('s-quiz');
    if (!quizScreen || !quizScreen.classList.contains('active')) return;
    if (e.target && (e.target.tagName === 'BUTTON' || e.target.tagName === 'A')) return;
    if (answered) { e.preventDefault(); nextQ(); }
  });
const pickTog = document.getElementById('pickModeTog');
const autoTog = document.getElementById('autosubTog');
const feedbackTog = document.getElementById('feedbackTog');
const pickDropdown = document.getElementById('pickModeDropdown');

function setSetupReveal(el, show, displayValue) {
  if (!el) return;
  const display = displayValue || 'block';
  if (el._setupRevealTimer) clearTimeout(el._setupRevealTimer);
  if (el._setupRevealFrame) cancelAnimationFrame(el._setupRevealFrame);
  el.classList.add('setup-reveal');
  if (show) {
    el.style.display = display;
    el.classList.remove('closing');
    el._setupRevealFrame = requestAnimationFrame(() => {
      el.classList.add('open');
      el._setupRevealFrame = null;
    });
    return;
  }
  if (!el.classList.contains('open') && el.style.display === 'none') return;
  el.classList.remove('open');
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.remove('closing');
    el.style.display = 'none';
    return;
  }
  el.classList.add('closing');
  el._setupRevealTimer = setTimeout(() => {
    el.classList.remove('closing');
    el.style.display = 'none';
  }, 190);
}

pickTog.addEventListener('change', () => {
  if (pickTog.checked) {
    autoTog.checked = false;
    feedbackTog.checked = false;

    autoTog.disabled = true;
    feedbackTog.disabled = true;

    setSetupReveal(pickDropdown, true, 'block');
  } else {
    autoTog.disabled = false;
    feedbackTog.disabled = false;

    setSetupReveal(pickDropdown, false, 'block');
  }
});

// ───────── TIMER MINI GRID ─────────
const TIMED_DURATIONS_SETUP = [30, 60, 90, 120, 180, 300, 60]; // last entry updated by custom input

function onTimedSliderChange(slider) {
  const idx = parseInt(slider.value);
  const labels = ['30s','60s','90s','2m','3m','5m','✏️ Custom'];
  const ci = document.getElementById('timedCustomMinsInput');
  if (idx === 6) {
    setSetupReveal(ci, true, 'block');
    const mins = parseFloat(ci.value) || 1;
    timedDuration = Math.max(1, Math.round(mins * 60));
    document.getElementById('timedSliderVal').textContent = mins + 'm custom';
  } else {
    setSetupReveal(ci, false, 'block');
    timedDuration = TIMED_DURATIONS_SETUP[idx];
    document.getElementById('timedSliderVal').textContent = labels[idx];
  }
  // update tick highlights
  document.querySelectorAll('.timed-tick').forEach((t,i) => {
    t.classList.toggle('active-tick', i === idx);
  });
  // update slider gradient
  paintTimedSlider(slider);
}

function paintTimedSlider(slider) {
  if(!slider) return;
  const max = parseFloat(slider.max || '6') || 6;
  const min = parseFloat(slider.min || '0') || 0;
  const val = parseFloat(slider.value || '0');
  const pct = ((val - min) / (max - min)) * 100;
  const styles = getComputedStyle(document.documentElement);
  const sliderAcc = styles.getPropertyValue('--acc').trim() || '#B8D45C';
  const sliderBase = styles.getPropertyValue('--p0').trim() || 'rgba(20,20,24,0.8)';
  const sliderSurface = styles.getPropertyValue('--surf').trim() || sliderBase;
  slider.style.background = `linear-gradient(90deg, ${sliderAcc} ${pct}%, color-mix(in srgb, ${sliderBase}, ${sliderSurface} 42%) ${pct}%)`;
}

function refreshTimedSliderVisual() {
  paintTimedSlider(document.getElementById('timedDurationSlider'));
}

function onTimedCustomMinsChange(input) {
  const mins = parseFloat(input.value) || 1;
  timedDuration = Math.max(1, Math.round(mins * 60));
  document.getElementById('timedSliderVal').textContent = mins + 'm custom';
}

function setTimerOpt(el){
  // only remove active from timer grid buttons, not pick mode or other grids
  document.querySelectorAll('#timerGrid .timer-opt').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  timerMode = el.dataset.value;
  const ci = document.getElementById('customTimerInput');
  const tw = document.getElementById('timedSliderWrap');
  setSetupReveal(ci, timerMode === 'custom', 'block');
  setSetupReveal(tw, timerMode === 'timed', 'flex');
  tw.classList.toggle('visible', timerMode === 'timed');
  // update qCount label visibility
  const qCountCell = document.getElementById('qCount').closest('.bento-cell');
  // in timed mode, question count doesn't matter - show hint
  const qCountInput = document.getElementById('qCount');
  if (timerMode === 'timed') {
    qCountInput.style.opacity = '0.3';
    qCountInput.title = 'Not used in Timed Mode — answer as many as you can!';
  } else {
    qCountInput.style.opacity = '';
    qCountInput.title = '';
  }
}

// init slider gradient on page load
(function initTimedSlider(){
  const slider = document.getElementById('timedDurationSlider');
  if(slider) onTimedSliderChange(slider);
})();

// ───────── TIMER DROPDOWN (kept, disabled in HTML — guarded) ─────────
const dropdown = document.getElementById('timerDropdown');
const trigger = document.getElementById('timerTrigger');
const options = document.querySelectorAll('#timerMenu .select-option');
const customInput = document.getElementById('customTimerInput');

if(trigger){
  trigger.onclick = () => { dropdown.classList.toggle('open'); };
  options.forEach(opt => {
    opt.onclick = () => {
      options.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      timerMode = opt.dataset.value;
      trigger.textContent = opt.textContent;
      dropdown.classList.remove('open');
      setSetupReveal(customInput, timerMode === 'custom', 'block');
    };
  });
  document.addEventListener('click', (e) => {
    if(dropdown && !dropdown.contains(e.target)) dropdown.classList.remove('open');
  });
}

// ───────── PICK MODE INLINE BUTTONS ─────────
function setPickModeOpt(el) {
  document.querySelectorAll('#pickModeGrid .timer-opt').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const pickRealSel = document.getElementById('pickModeType');
  if (pickRealSel) pickRealSel.value = el.dataset.value;
}

const input = document.getElementById('ansInput');
const keys = document.querySelectorAll('.kb-key');

keys.forEach(key => {
  // Use pointerdown instead of click — eliminates ~300ms mobile tap delay
  key.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // prevent ghost click and focus steal
    if (input.disabled) return;

    // Instant visual feedback via class — no setTimeout lag
    key.classList.add('kb-pressed');
    const removePress = () => { key.classList.remove('kb-pressed'); key.removeEventListener('pointerup', removePress); key.removeEventListener('pointerleave', removePress); };
    key.addEventListener('pointerup',    removePress);
    key.addEventListener('pointerleave', removePress);

    if (key.classList.contains('kb-del')) {
      input.value = input.value.slice(0, -1);
      return;
    }

    if (key.classList.contains('kb-enter')) {
      checkAnswer();
      return;
    }

    input.value += key.textContent;

    // Fire native input event so the single auto-submit listener handles length check
    input.dispatchEvent(new Event('input'));
  });
});
document.getElementById('ansInput').addEventListener('focus', (e) => {
  if (isMobile) e.target.blur();
});

if (isMobile) {
  document.getElementById('keyboard').style.display = 'block';
}

// ───────── PERSONAL BESTS ─────────
function getPB(){
  try { return JSON.parse(localStorage.getItem(PB_KEY)) || {}; } catch(e){ return {}; }
}
function savePB(pb){
  try {
    localStorage.setItem(PB_KEY, JSON.stringify(pb));
    window.syncUserProgressToSupabase?.();
  } catch(e){}
}

// ───────── CONFETTI ─────────
function launchConfetti(){
  const _cs = getComputedStyle(document.documentElement);
  const colors=[
    _cs.getPropertyValue('--p4').trim()||'#573280',
    _cs.getPropertyValue('--p7').trim()||'#ada8b6',
    '#eff8e2',
    _cs.getPropertyValue('--acc').trim()||'#B8D45C',
    '#fff'
  ];
  for(let i=0;i<80;i++){
    setTimeout(()=>{
      const el=document.createElement('div');
      el.className='confetti-piece';
      el.style.cssText=`left:${Math.random()*100}vw;background:${colors[Math.floor(Math.random()*colors.length)]};animation-duration:${0.8+Math.random()*1.5}s;animation-delay:${Math.random()*0.5}s;transform:rotate(${Math.random()*360}deg);`;
      document.body.appendChild(el);
      setTimeout(()=>el.remove(), 2500);
    }, i*18);
  }
}

// init focus grid on range input change
document.getElementById('rangeFrom').addEventListener('change', buildFocusGrid);
document.getElementById('rangeTo').addEventListener('change', buildFocusGrid);
buildFocusGrid();

// ───────── STOPWATCH ─────────
// (vars declared at top of script)
stopwatchInterval = null;
stopwatchStart = null;

function startStopwatch() {
  clearStopwatch();
  stopwatchStart = performance.now();
  function tick(now) {
    const elapsed = (now - stopwatchStart) / 1000;
    const secs = Math.floor(elapsed);
    const mins = Math.floor(secs / 60);
    const rem  = secs % 60;
    document.getElementById('stopwatchNum').textContent = mins > 0
      ? mins + ':' + String(rem).padStart(2, '0')
      : secs + 's';
    stopwatchInterval = requestAnimationFrame(tick);
  }
  stopwatchInterval = requestAnimationFrame(tick);
}

function clearStopwatch() {
  if (stopwatchInterval) {
    cancelAnimationFrame(stopwatchInterval);
    stopwatchInterval = null;
  }
}

// ───────── TIMED MODE COUNTDOWN ─────────
function startTimedCountdown(){
  if(timedInterval){ cancelAnimationFrame(timedInterval); timedInterval=null; }
  timedStartTime = performance.now();

  function tick(now){
    const elapsed = (now - timedStartTime) / 1000;
    const remaining = Math.max(0, timedDuration - elapsed);
    const pct = (remaining / timedDuration) * 100;

    // Update timedChip arc and label
    const timedArcEl = document.getElementById('timedArc');
    const timedLabelEl = document.getElementById('timedChipLabel');
    if(timedArcEl){ timedArcEl.style.strokeDashoffset = 113.1 * (1 - pct/100); }
    if(timedLabelEl){
      if(remaining >= 60){ timedLabelEl.textContent = Math.ceil(remaining/60) + 'm'; }
      else { timedLabelEl.textContent = Math.ceil(remaining) + 's'; }
    }
    const countdownEl = document.getElementById('timedCountdown');
    const fillEl = document.getElementById('timedFill');
    const qCountEl = document.getElementById('timedQCount');

    if(countdownEl){
      if(remaining >= 60){
        countdownEl.textContent = Math.ceil(remaining/60) + 'm';
      } else {
        countdownEl.textContent = Math.ceil(remaining) + 's';
      }
      countdownEl.classList.toggle('urgent', remaining <= 10);
    }
    if(fillEl){
      fillEl.style.width = pct + '%';
      fillEl.classList.toggle('urgent', remaining <= 10);
    }
    if(qCountEl){
      qCountEl.textContent = timedQAnswered + ' answered';
    }

    if(remaining > 0){
      timedInterval = requestAnimationFrame(tick);
    } else {
      // Time's up!
      timedInterval = null;
      endTimedMode();
    }
  }
  timedInterval = requestAnimationFrame(tick);
}

function clearTimedInterval(){
  if(timedInterval){ cancelAnimationFrame(timedInterval); timedInterval=null; }
}

function endTimedMode(){
  clearTimedInterval();
  clearTimer();
  clearStopwatch();
  // If mid-question, record as timed out
  if(!answered){
    answered = true;
    const q = qs[cur];
    const val = parseInt(document.getElementById('ansInput').value);
    const correctVal = (q.type==='table'||q.type==='add'||q.type==='sub') ? q.answer : (q.reverse ? q.n : q.answer);
    const correct = !isNaN(val) && val === correctVal;
    results.push({q, userAnswer: isNaN(val)?'—':val, correct, timedOut:true});
    if(correct){ score++; }
  }
  showResults();
}

// ───────── HISTORY ─────────
// (HISTORY_KEY and MAX_HISTORY defined in profile section below)

function eraseHistoryAsk() {
  document.getElementById('eraseBtn').style.display = 'none';
  const ec = document.getElementById('eraseConfirm');
  ec.style.display = 'inline-flex';
}
function eraseHistoryCancel() {
  document.getElementById('eraseBtn').style.display = 'inline';
  document.getElementById('eraseConfirm').style.display = 'none';
}
function eraseHistoryConfirm() {
  try { localStorage.removeItem(HISTORY_KEY); } catch(e){}
  eraseHistoryCancel();
  renderHistory();
}

function saveSessionToSupabase(session) {
  window.syncSessionToSupabase?.(session);
}

function createSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function saveHistory(score, total, pct, xp) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch(e) {}
  const session = { session_id: createSessionId(), score, total, correct: score, pct, xp: xp || 0, date: new Date().toISOString(), timed: isTimedMode ? timedDuration : null };
  console.log('[session sync] created local session', {
    session_id: session.session_id,
    localCountBefore: Array.isArray(history) ? history.length : 0
  });
  history.unshift(session);
  history = history.slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    console.log('[session sync] saved local session', {
      session_id: session.session_id,
      localCountAfter: history.length
    });
    saveSessionToSupabase(session);
  } catch(e) {}
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (!list) return;
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch(e) {}
  if (!history.length) {
    list.innerHTML = '<div class="history-empty">No history yet</div>';
    return;
  }
  list.innerHTML = history.map(h => `
    <div class="review-item">
      <span class="ri-q">${new Date(h.date).toLocaleDateString(undefined, {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
      <span class="ri-a ${h.pct >= 70 ? 'ri-ok' : 'ri-no'}">${h.pct}% (${h.score}/${h.total})</span>
    </div>
  `).join('');
}

// ───────── HISTORY TOGGLE ─────────
function toggleHistory(){
  const col = document.getElementById('historyCollapsible');
  const arrow = document.getElementById('historyArrow');
  const isOpen = col.classList.contains('open');
  col.classList.toggle('open', !isOpen);
  arrow.classList.toggle('open', !isOpen);
}

// ═══════════════════════════════════════════════
//  PROFILE · WELCOME · DASHBOARD
// ═══════════════════════════════════════════════
const PROFILE_KEY = 'quiz_profile';
const PROFILE_AVATAR_KEY = 'quiz_profile_avatar';
const PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_AVATAR_OUTPUT_SIZE = 512;
const PROFILE_AVATAR_SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
const HISTORY_KEY = 'quiz_history';
const MAX_HISTORY = 200;

const QUOTES = [
  "Every expert was once a beginner.",
  "Repetition is the mother of mastery.",
  "The brain that works hardest, grows fastest.",
  "Speed comes from practice, not shortcuts.",
  "Champions aren't born. They calculate.",
  "One more session closer to excellence.",
  "Maths is the language of the universe.",
  "Hard problems now = easy exams later.",
  "Your future self will thank you for today.",
  "Consistency beats intensity every time.",
];

function getProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch(e) { return {}; }
}
function saveProfile(data) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
    window.syncProfileToSupabase?.();
  } catch(e) {}
}
function getProfileAvatar() {
  try { return localStorage.getItem(PROFILE_AVATAR_KEY) || ''; } catch(e) { return ''; }
}
function moveFocusBeforeHiding(container, fallback) {
  if (!container || !container.contains(document.activeElement)) return;
  if (fallback && typeof fallback.focus === 'function' && !fallback.disabled) {
    fallback.focus({ preventScroll: true });
    return;
  }
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}
function saveProfileAvatar(dataUrl, file) {
  try {
    localStorage.setItem(PROFILE_AVATAR_KEY, dataUrl);
    window.syncProfileAvatarToSupabase?.(dataUrl, file);
  } catch(e) {}
}
function removeProfileAvatar() {
  closeProfilePhotoMenu();
  try { localStorage.removeItem(PROFILE_AVATAR_KEY); } catch(e) {}
  const input = document.getElementById('profileAvatarInput');
  if (input) input.value = '';
  window.deleteProfileAvatarFromSupabase?.();
  renderProfileAvatar((getProfile().name || '?'));
}
function openProfileAvatarAction() {
  if (getProfileAvatar()) {
    toggleProfilePhotoMenu();
  } else {
    openProfileAvatarPicker();
  }
}
function openProfileAvatarPicker() {
  closeProfilePhotoMenu();
  document.getElementById('profileAvatarInput')?.click();
}
function toggleProfilePhotoMenu() {
  const menu = document.getElementById('profilePhotoMenu');
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  if (isOpen) {
    closeProfilePhotoMenu();
    return;
  }
  positionProfilePhotoMenu();
  menu.classList.add('open');
  menu.setAttribute('aria-hidden', 'false');
}
function positionProfilePhotoMenu() {
  const menu = document.getElementById('profilePhotoMenu');
  const wrap = document.getElementById('profileAvatarWrap');
  if (!menu || !wrap) return;
  const rect = wrap.getBoundingClientRect();
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - 156));
  const top = Math.min(rect.bottom + 8, window.innerHeight - 150);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}
function closeProfilePhotoMenu() {
  const menu = document.getElementById('profilePhotoMenu');
  if (!menu) return;
  moveFocusBeforeHiding(menu, document.querySelector('.profile-avatar-edit-btn') || document.getElementById('profileAvatar'));
  menu.classList.remove('open');
  menu.setAttribute('aria-hidden', 'true');
}
function viewProfileAvatar() {
  const image = getProfileAvatar();
  closeProfilePhotoMenu();
  if (!image) return;
  const modal = document.getElementById('profilePhotoViewer');
  const img = document.getElementById('profilePhotoViewerImg');
  if (!modal || !img) return;
  img.src = image;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}
function closeProfilePhotoViewer() {
  const modal = document.getElementById('profilePhotoViewer');
  const img = document.getElementById('profilePhotoViewerImg');
  if (!modal) return;
  moveFocusBeforeHiding(modal, document.querySelector('.profile-avatar-edit-btn') || document.getElementById('profileAvatar'));
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (img) img.removeAttribute('src');
}
function renderProfileAvatar(name) {
  const avatar = document.getElementById('profileAvatar');
  if (!avatar) return;
  const image = getProfileAvatar();
  if (image) {
    avatar.textContent = '';
    avatar.style.backgroundImage = `url("${image}")`;
  } else {
    avatar.style.backgroundImage = '';
    avatar.textContent = (name || '?').charAt(0).toUpperCase();
    closeProfilePhotoMenu();
  }
}
const profileAvatarCropState = {
  file: null,
  image: null,
  objectUrl: '',
  scale: 1,
  minScale: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  startOffsetX: 0,
  startOffsetY: 0
};

function setPhotoCropStatus(message) {
  const status = document.getElementById('photoCropStatus');
  if (status) status.textContent = message || '';
}
function resetPhotoCropState(keepObjectUrl) {
  const img = document.getElementById('photoCropImg');
  if (img) {
    img.removeAttribute('src');
    img.style.transform = '';
  }
  if (!keepObjectUrl && profileAvatarCropState.objectUrl) {
    URL.revokeObjectURL(profileAvatarCropState.objectUrl);
  }
  profileAvatarCropState.file = null;
  profileAvatarCropState.image = null;
  profileAvatarCropState.objectUrl = '';
  profileAvatarCropState.scale = 1;
  profileAvatarCropState.minScale = 1;
  profileAvatarCropState.offsetX = 0;
  profileAvatarCropState.offsetY = 0;
  profileAvatarCropState.dragging = false;
  setPhotoCropStatus('');
}
function clampPhotoCropOffsets() {
  const stage = document.getElementById('photoCropStage');
  const image = profileAvatarCropState.image;
  if (!stage || !image) return;
  const size = Math.min(stage.clientWidth || 280, stage.clientHeight || 280);
  const renderedW = image.naturalWidth * profileAvatarCropState.scale;
  const renderedH = image.naturalHeight * profileAvatarCropState.scale;
  const maxX = Math.max(0, (renderedW - size) / 2);
  const maxY = Math.max(0, (renderedH - size) / 2);
  profileAvatarCropState.offsetX = Math.max(-maxX, Math.min(maxX, profileAvatarCropState.offsetX));
  profileAvatarCropState.offsetY = Math.max(-maxY, Math.min(maxY, profileAvatarCropState.offsetY));
}
function applyPhotoCropTransform() {
  clampPhotoCropOffsets();
  const img = document.getElementById('photoCropImg');
  if (!img) return;
  img.style.transform = `translate(-50%, -50%) translate(${profileAvatarCropState.offsetX}px, ${profileAvatarCropState.offsetY}px) scale(${profileAvatarCropState.scale})`;
}
function resetPhotoCropPosition() {
  const stage = document.getElementById('photoCropStage');
  const image = profileAvatarCropState.image;
  const zoom = document.getElementById('photoCropZoom');
  if (!stage || !image) return;
  const size = Math.min(stage.clientWidth || 280, stage.clientHeight || 280);
  profileAvatarCropState.minScale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  profileAvatarCropState.scale = profileAvatarCropState.minScale;
  profileAvatarCropState.offsetX = 0;
  profileAvatarCropState.offsetY = 0;
  if (zoom) {
    zoom.min = String(profileAvatarCropState.minScale);
    zoom.max = String(profileAvatarCropState.minScale * 3);
    zoom.value = String(profileAvatarCropState.scale);
  }
  applyPhotoCropTransform();
}
function closePhotoCropModal() {
  const modal = document.getElementById('profilePhotoCropModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  resetPhotoCropState(false);
}
function openPhotoCropModal(file) {
  const modal = document.getElementById('profilePhotoCropModal');
  const img = document.getElementById('photoCropImg');
  if (!modal || !img || !file) return;
  resetPhotoCropState(false);
  profileAvatarCropState.file = file;
  profileAvatarCropState.objectUrl = URL.createObjectURL(file);
  img.onload = () => {
    profileAvatarCropState.image = img;
    resetPhotoCropPosition();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  };
  img.onerror = () => {
    resetPhotoCropState(false);
    alert('Could not load that image. Please try another photo.');
  };
  img.src = profileAvatarCropState.objectUrl;
}
function getPhotoCropBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}
async function buildCroppedProfileAvatar() {
  const image = profileAvatarCropState.image;
  const stage = document.getElementById('photoCropStage');
  const cropImage = document.getElementById('photoCropImg');
  if (!image || !stage) throw new Error('Photo is not ready yet.');
  if (!cropImage) throw new Error('Photo preview is not ready yet.');
  const outputSize = PROFILE_AVATAR_OUTPUT_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare photo canvas.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, outputSize, outputSize);
  const stageRect = stage.getBoundingClientRect();
  const imageRect = cropImage.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height || !imageRect.width || !imageRect.height) {
    throw new Error('Photo preview has no measurable size.');
  }

  let sourceX = (stageRect.left - imageRect.left) / imageRect.width * image.naturalWidth;
  let sourceY = (stageRect.top - imageRect.top) / imageRect.height * image.naturalHeight;
  let sourceW = stageRect.width / imageRect.width * image.naturalWidth;
  let sourceH = stageRect.height / imageRect.height * image.naturalHeight;

  sourceX = Math.max(0, Math.min(image.naturalWidth, sourceX));
  sourceY = Math.max(0, Math.min(image.naturalHeight, sourceY));
  sourceW = Math.max(1, Math.min(image.naturalWidth - sourceX, sourceW));
  sourceH = Math.max(1, Math.min(image.naturalHeight - sourceY, sourceH));
  ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, outputSize, outputSize);

  let quality = 0.88;
  let blob = await getPhotoCropBlob(canvas, quality);
  while (blob && blob.size > PROFILE_AVATAR_MAX_BYTES && quality > 0.62) {
    quality -= 0.08;
    blob = await getPhotoCropBlob(canvas, quality);
  }
  if (!blob) throw new Error('Could not compress profile photo.');
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const file = new File([blob], 'profile-avatar.jpg', { type: 'image/jpeg' });
  return { dataUrl, file };
}
async function saveCroppedProfileAvatar() {
  const saveBtn = document.getElementById('photoCropSaveBtn');
  try {
    if (saveBtn) saveBtn.disabled = true;
    setPhotoCropStatus('Saving photo...');
    const { dataUrl, file } = await buildCroppedProfileAvatar();
    saveProfileAvatar(dataUrl, file);
    renderProfileAvatar((getProfile().name || '?'));
    closePhotoCropModal();
  } catch(error) {
    console.warn('Could not save adjusted profile photo.', error);
    setPhotoCropStatus('Could not save that photo. Please try another image.');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}
function handleProfileAvatarFile(file) {
  if (!file) return;
  const type = (file.type || '').toLowerCase();
  if (!PROFILE_AVATAR_SUPPORTED_TYPES.includes(type)) {
    alert('Please choose a PNG, JPEG, or JPG image.');
    return;
  }
  openPhotoCropModal(file);
}
function getSessionHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch(e) { return []; }
}
function getTodaySessions(history) {
  const today = new Date().toDateString();
  return history.filter(h => new Date(h.date).toDateString() === today);
}

// Compute day streak from history
function computeDayStreak(history) {
  if (!history.length) return 0;
  const days = [...new Set(history.map(h => new Date(h.date).toDateString()))];
  // sort descending
  days.sort((a,b) => new Date(b) - new Date(a));
  const todayStr = new Date().toDateString();
  const ystStr   = new Date(Date.now()-86400000).toDateString();
  // Must have played today or yesterday to have active streak
  if (days[0] !== todayStr && days[0] !== ystStr) return 0;
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i-1]);
    const curr = new Date(days[i]);
    const diff = Math.round((prev - curr) / 86400000);
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ── Welcome ──
function saveWelcomeName() {
  const name = document.getElementById('welcomeNameInput').value.trim();
  if (!name) return;
  saveProfile({ name, joinedDate: new Date().toISOString() });
  showDashboard();
}

// ── Dashboard ──
function showDashboard() {
  const profile = getProfile();
  const history = getSessionHistory();
  const todaySessions = getTodaySessions(history);

  document.getElementById('dashGreeting').textContent = getGreeting();
  document.getElementById('dashNameSpan').textContent = profile.name || 'Friend';

  // Tagline
  if (!todaySessions.length) {
    document.getElementById('dashTagline').textContent = 'Ready to sharpen your skills?';
  } else {
    const avg = Math.round(todaySessions.reduce((s,h)=>s+h.pct,0)/todaySessions.length);
    document.getElementById('dashTagline').textContent =
      `${todaySessions.length} session${todaySessions.length>1?'s':''} today · avg ${avg}%`;
  }

  // Today stats
  document.getElementById('dashTodaySessions').textContent = todaySessions.length || '0';
  if (todaySessions.length) {
    const totalQ   = todaySessions.reduce((s,h)=>s+(h.total||0),0);
    const correctQ = todaySessions.reduce((s,h)=>s+(h.correct||0),0);
    const acc = totalQ ? Math.round(correctQ/totalQ*100) : Math.round(todaySessions.reduce((s,h)=>s+h.pct,0)/todaySessions.length);
    document.getElementById('dashTodayAcc').textContent = acc + '%';
  } else {
    document.getElementById('dashTodayAcc').textContent = '—';
  }
  document.getElementById('dashDayStreak').textContent = computeDayStreak(history) || '0';

  // Recent sessions list
  const list = document.getElementById('dashRecentList');
  if (!history.length) {
    list.innerHTML = '<div class="dash-empty">No sessions yet — start your first quiz!</div>';
  } else {
    list.innerHTML = history.slice(0,5).map(h => {
      const dateStr = new Date(h.date).toLocaleDateString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      const cls = h.pct >= 70 ? 'good' : 'bad';
      return `<div class="dash-session">
        <span class="dash-session-date">${dateStr}</span>
        <span class="dash-session-score">${h.score}/${h.total}</span>
        <span class="dash-session-pct ${cls}">${h.pct}%</span>
      </div>`;
    }).join('');
  }

  show('s-dashboard');
}

// ── Profile screen ──
function showProfile() {
  const profile  = getProfile();
  const history  = getSessionHistory();
  const pb       = getPB();
  updateProfileVersionDisplay();

  // Sync practice mode toggle
  const tog = document.getElementById('practiceModeTog');
  if (tog) tog.checked = isPracticeMode();

  // Avatar
  const name = profile.name || '?';
  renderProfileAvatar(name);
  document.getElementById('profileDisplayName').textContent = name;
  document.getElementById('profileSince').textContent = profile.joinedDate
    ? 'Member since ' + new Date(profile.joinedDate).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})
    : 'Member';

  // Lifetime stats
  document.getElementById('profTotalSessions').textContent  = history.length;
  const totalQ   = history.reduce((s,h)=>s+(h.total||0),0);
  const correctQ = history.reduce((s,h)=>s+(h.correct||0),0);
  document.getElementById('profTotalQuestions').textContent = totalQ || history.reduce((s,h)=>s+h.total,0);
  document.getElementById('profBestStreak').textContent     = pb.bestStreak || 0;
  document.getElementById('profDayStreak').textContent      = computeDayStreak(history);

  // Accuracy
  const avgPct = history.length
    ? Math.round(history.reduce((s,h)=>s+h.pct,0)/history.length)
    : 0;
  document.getElementById('profAccVal').textContent = avgPct ? avgPct+'%' : '—';
  setTimeout(()=>{ document.getElementById('profAccBar').style.width = (avgPct||0)+'%'; }, 80);

  // Best / avg
  const bestPct = pb.bestPct || (history.length ? Math.max(...history.map(h=>h.pct)) : 0);
  document.getElementById('profBestPct').textContent = bestPct ? bestPct+'%' : '—';
  document.getElementById('profAvgPct').textContent  = avgPct  ? avgPct+'%'  : '—';

  // Session list
  const slist = document.getElementById('profileSessionList');
  if (!history.length) {
    slist.innerHTML = '<div class="dash-empty">No sessions yet</div>';
  } else {
    slist.innerHTML = history.slice(0,20).map(h => {
      const dateStr = new Date(h.date).toLocaleDateString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      const cls = h.pct >= 70 ? 'good' : 'bad';
      return `<div class="dash-session">
        <span class="dash-session-date">${dateStr}</span>
        <span class="dash-session-score">${h.score}/${h.total}</span>
        <span class="dash-session-pct ${cls}">${h.pct}%</span>
      </div>`;
    }).join('');
  }

  // Daily challenge history
  const dcList = document.getElementById('dcHistoryList');
  if (dcList) {
    let dcHist = [];
    try { dcHist = JSON.parse(localStorage.getItem(DC_HISTORY_KEY)) || []; } catch(e) {}
    if (!dcHist.length) {
      dcList.innerHTML = '<div class="dash-empty">No challenges completed yet</div>';
    } else {
      dcList.innerHTML = dcHist.slice(0, 30).map(h => {
        const dateStr = new Date(h.date).toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'});
        const cls = h.pct >= 70 ? 'good' : 'bad';
        return `<div class="dash-session">
          <span class="dash-session-date">${dateStr}</span>
          <span class="dash-session-score" style="color:rgba(239,248,226,0.45);font-size:11px;">${h.bracket || '—'}</span>
          <span class="dash-session-score">${h.score}/${h.total}</span>
          <span class="dash-session-pct ${cls}">${h.pct}%</span>
        </div>`;
      }).join('');
    }
  }

  // Reset edit row
  document.getElementById('profileNameEditRow').classList.remove('open');
  show('s-profile');
}

function updateProfileVersionDisplay() {
  const el = document.getElementById('profileVersion');
  if (!el) return;
  el.textContent = window.APP_VERSION ? `Version ${window.APP_VERSION}` : '';
}

function toggleProfileNameEdit() {
  const row = document.getElementById('profileNameEditRow');
  const isOpen = row.classList.contains('open');
  if (!isOpen) document.getElementById('profileNameEditInput').value = getProfile().name || '';
  if (isOpen) {
    row.classList.add('closing');
    row.classList.remove('open');
    setTimeout(() => row.classList.remove('closing'), 180);
  } else {
    row.classList.remove('closing');
    row.classList.add('open');
  }
}

function saveProfileNameFromScreen() {
  const name = document.getElementById('profileNameEditInput').value.trim();
  if (!name) return;
  const profile = getProfile();
  profile.name = name;
  saveProfile(profile);
  document.getElementById('profileDisplayName').textContent = name;
  renderProfileAvatar(name);
  const row = document.getElementById('profileNameEditRow');
  row.classList.add('closing');
  row.classList.remove('open');
  setTimeout(() => row.classList.remove('closing'), 180);
  // update dashboard name too if visible
  const ns = document.getElementById('dashNameSpan');
  if (ns) ns.textContent = name;
}

let _resetModalLastFocus = null;

function confirmResetProfile() {
  openResetProfileModal();
}

function openResetProfileModal() {
  const modal = document.getElementById('resetProfileModal');
  const context = document.getElementById('resetModalContext');
  const confirmBtn = document.getElementById('resetConfirmBtn');
  if (!modal) return;
  const loggedIn = !!(window.authState && window.authState.isLoggedIn);
  if (context) {
    context.textContent = loggedIn
      ? 'Your account and profile name will stay. You will remain signed in.'
      : 'Your local profile and progress will be cleared.';
  }
  _resetModalLastFocus = document.activeElement;
  modal.classList.remove('closing');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => (confirmBtn || document.getElementById('resetCancelBtn'))?.focus(), 0);
}

function closeResetProfileModal() {
  const modal = document.getElementById('resetProfileModal');
  if (!modal) return;
  moveFocusBeforeHiding(modal, _resetModalLastFocus);
  modal.setAttribute('aria-hidden', 'true');
  const restoreFocus = () => {
    if (_resetModalLastFocus && typeof _resetModalLastFocus.focus === 'function') {
      _resetModalLastFocus.focus();
    }
    _resetModalLastFocus = null;
  };
  if (!modal.classList.contains('open')) {
    restoreFocus();
    return;
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    modal.classList.remove('open', 'closing');
    restoreFocus();
    return;
  }
  modal.classList.add('closing');
  setTimeout(() => {
    modal.classList.remove('open', 'closing');
    restoreFocus();
  }, 180);
}

async function performResetProfile() {
  closeResetProfileModal();
  const loggedIn = !!(window.authState && window.authState.isLoggedIn);
  const resetUserId = window.authState && window.authState.user && window.authState.user.id;
  console.log('[reset sync] reset started', { loggedIn, userId: resetUserId || null });
  const currentScreen = document.querySelector('.screen.active');
  const preservedProfile = getProfile();
  const preservedAvatar = getProfileAvatar();
  const keysToClear = [
    HISTORY_KEY,
    PB_KEY,
    XP_KEY,
    DAY_STREAK_KEY,
    GOAL_KEY,
    MILESTONES_KEY,
    WEAKNESS_KEY,
    SR_KEY,
    DAILY_CHAL_KEY,
    DC_HISTORY_KEY,
    PRACTICE_MODE_KEY,
    'quiz_custom_colors',
    'quiz_custom_colors_on',
    'quiz_base_theme',
    'quiz_theme',
    'quiz_last_session_summary',
    'quiz_weekly_xp',
    'quiz_sync_notice_dismissed',
    'quiz_local_data_synced',
    PROFILE_AVATAR_KEY
  ];

  if (!loggedIn) {
    try { localStorage.removeItem(PROFILE_KEY); } catch(e){}
    keysToClear.forEach(key => {
      try { localStorage.removeItem(key); } catch(e){}
    });
    console.log('[reset sync] local clear completed', { loggedIn: false });
    location.reload();
    return;
  }

  try {
    console.log('[reset sync] cloud reset requested', { userId: resetUserId || null });
    await window.resetSupabaseAppData?.({ preserveProfile: preservedProfile, requireSuccess: true, updateGeneration: true, generationSource: 'reset_profile' });
    console.log('[reset sync] cloud reset verified; local clear started', { userId: resetUserId || null });
    keysToClear.forEach(key => {
      try { localStorage.removeItem(key); } catch(e){}
    });
    if (resetUserId) {
      [
        'quiz_local_sync_marker_' + resetUserId,
        'quiz_sync_conflict_resolved_' + resetUserId
      ].forEach(key => {
        try { localStorage.removeItem(key); } catch(e){}
      });
      try { sessionStorage.removeItem('quiz_sync_conflict_dismissed_' + resetUserId); } catch(e){}
    }
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(preservedProfile)); } catch(e){}
    if (preservedAvatar) {
      try { localStorage.setItem(PROFILE_AVATAR_KEY, preservedAvatar); } catch(e){}
    }
    console.log('[reset sync] local clear completed', { loggedIn: true, userId: resetUserId || null });
    applyPracticeMode(false);
    if (typeof initTheme === 'function') initTheme();
    if (typeof initCustomColors === 'function') initCustomColors();
    if (typeof updateXPPill === 'function') updateXPPill();
    if (typeof updateDailyGoalUI === 'function') updateDailyGoalUI();
    if (typeof updateDailyChallengeBtn === 'function') updateDailyChallengeBtn();
    if (typeof renderSessionSummaryCard === 'function') renderSessionSummaryCard();
    if (typeof renderWeeklySummary === 'function') renderWeeklySummary();
    if (typeof renderHistory === 'function') renderHistory();
    if (currentScreen && currentScreen.id === 's-profile') showProfile();
    else if (currentScreen && currentScreen.id === 's-dashboard') showDashboard();
    else if (currentScreen) show(currentScreen.id);
    if (typeof updateAuthUI === 'function') updateAuthUI();
  } catch(error) {
    console.warn('[reset sync] reset failed; local data was kept intact:', error && error.message ? error.message : error);
  }
}

document.addEventListener('DOMContentLoaded', function initResetProfileModal() {
  const modal = document.getElementById('resetProfileModal');
  const closeBtn = document.getElementById('resetModalCloseBtn');
  const cancelBtn = document.getElementById('resetCancelBtn');
  const confirmBtn = document.getElementById('resetConfirmBtn');
  if (!modal) return;
  closeBtn?.addEventListener('click', closeResetProfileModal);
  cancelBtn?.addEventListener('click', closeResetProfileModal);
  confirmBtn?.addEventListener('click', performResetProfile);
  document.querySelectorAll('[data-reset-close]').forEach(el => {
    el.addEventListener('click', closeResetProfileModal);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('open')) closeResetProfileModal();
  });
});

document.addEventListener('DOMContentLoaded', function initProfileAvatarInput() {
  const input = document.getElementById('profileAvatarInput');
  if (!input) return;
  const cropStage = document.getElementById('photoCropStage');
  const cropZoom = document.getElementById('photoCropZoom');
  input.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    handleProfileAvatarFile(file);
    input.value = '';
  });
  document.addEventListener('click', event => {
    const wrap = document.getElementById('profileAvatarWrap');
    if (!wrap || wrap.contains(event.target)) return;
    closeProfilePhotoMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeProfilePhotoMenu();
      closeProfilePhotoViewer();
      closePhotoCropModal();
    }
  });
  document.getElementById('photoViewerCloseBtn')?.addEventListener('click', closeProfilePhotoViewer);
  document.querySelectorAll('[data-photo-viewer-close]').forEach(el => {
    el.addEventListener('click', closeProfilePhotoViewer);
  });
  document.getElementById('photoCropCloseBtn')?.addEventListener('click', closePhotoCropModal);
  document.getElementById('photoCropResetBtn')?.addEventListener('click', resetPhotoCropPosition);
  document.getElementById('photoCropSaveBtn')?.addEventListener('click', saveCroppedProfileAvatar);
  document.querySelectorAll('[data-photo-crop-cancel]').forEach(el => {
    el.addEventListener('click', closePhotoCropModal);
  });
  cropZoom?.addEventListener('input', event => {
    profileAvatarCropState.scale = Number(event.target.value) || profileAvatarCropState.minScale;
    applyPhotoCropTransform();
  });
  cropStage?.addEventListener('pointerdown', event => {
    if (!profileAvatarCropState.image) return;
    profileAvatarCropState.dragging = true;
    profileAvatarCropState.dragStartX = event.clientX;
    profileAvatarCropState.dragStartY = event.clientY;
    profileAvatarCropState.startOffsetX = profileAvatarCropState.offsetX;
    profileAvatarCropState.startOffsetY = profileAvatarCropState.offsetY;
    cropStage.setPointerCapture?.(event.pointerId);
  });
  cropStage?.addEventListener('pointermove', event => {
    if (!profileAvatarCropState.dragging) return;
    profileAvatarCropState.offsetX = profileAvatarCropState.startOffsetX + event.clientX - profileAvatarCropState.dragStartX;
    profileAvatarCropState.offsetY = profileAvatarCropState.startOffsetY + event.clientY - profileAvatarCropState.dragStartY;
    applyPhotoCropTransform();
  });
  function endPhotoCropDrag(event) {
    if (!profileAvatarCropState.dragging) return;
    profileAvatarCropState.dragging = false;
    cropStage?.releasePointerCapture?.(event.pointerId);
  }
  cropStage?.addEventListener('pointerup', endPhotoCropDrag);
  cropStage?.addEventListener('pointercancel', endPhotoCropDrag);
  window.addEventListener('resize', () => {
    if (document.getElementById('profilePhotoMenu')?.classList.contains('open')) positionProfilePhotoMenu();
    if (document.getElementById('profilePhotoCropModal')?.classList.contains('open')) resetPhotoCropPosition();
  });
  window.addEventListener('scroll', () => {
    if (document.getElementById('profilePhotoMenu')?.classList.contains('open')) positionProfilePhotoMenu();
  }, true);
});

// ── goHome ──
function abortTest() {
  sessionId++;          // kill all in-flight setTimeout callbacks
  clearTimer();
  clearStopwatch();
  clearTimedInterval();
  isTimedMode   = false;
  unlimitedMode = false;
  answered      = false;
  document.getElementById('timedModeBar').classList.remove('visible');
  document.getElementById('endSessionBtn').classList.remove('visible');
  show('s-setup');
}

function goHome() {
  sessionId++; // invalidate all in-flight setTimeout callbacks
  clearTimer();
  clearStopwatch();
  clearTimedInterval();
  isTimedMode   = false;
  unlimitedMode = false;
  answered      = false;
  document.getElementById('timedModeBar').classList.remove('visible');
  document.getElementById('endSessionBtn').classList.remove('visible');
  const profile = getProfile();
  if (profile.name) { showDashboard(); } else { show('s-setup'); }
}

// ── Initial screen routing ──
(function _deferredInit() {
  // init() has been moved to end of script — after all showDashboard patches are applied.
  // This stub intentionally left to preserve surrounding code structure.
})();



function exportResults(){
  const date    = new Date().toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'});
  const total   = results.length;
  const correct = results.filter(r => r.correct).length;
  const wrong   = total - correct;
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0;

  const rows = results.map((r, i) => {
    const q   = r.q;
    const sym = q.type === 'square' ? '²' : q.type === 'cube' ? '³' : '';
    let qStr;
    if(q.type === 'table')    qStr = `${q.n} × ${q.m}`;
    else if(q.type === 'add') qStr = `${q.n} + ${q.m}`;
    else if(q.type === 'sub') qStr = `${q.n} − ${q.m}`;
    else                      qStr = `${q.n}${sym}`;
    const correctAns = (q.type==='table'||q.type==='add'||q.type==='sub') ? q.answer : (q.reverse ? q.n : q.answer);
    const userAns = r.correct ? '—' : (r.timedOut ? "time's up" : r.userAnswer);
    const rowBg = r.correct ? '#f0fce8' : '#fff2f2';
    const mark  = r.correct ? '✓' : '✗';
    const markColor = r.correct ? '#4a8a1a' : '#cc2222';
    return `<tr style="background:${rowBg};">
      <td style="padding:7px 12px;color:#666;font-size:12px;">${i+1}</td>
      <td style="padding:7px 12px;font-weight:600;font-size:14px;">${qStr}</td>
      <td style="padding:7px 12px;font-size:13px;">${correctAns}</td>
      <td style="padding:7px 12px;font-size:13px;color:${r.correct?'#555':'#cc4444'}">${r.correct ? '—' : userAns}</td>
      <td style="padding:7px 12px;font-weight:700;color:${markColor};font-size:15px;">${mark}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Quiz Results – ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #1a1a1a; padding: 32px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
    .title { font-size: 22px; font-weight: 800; color: #1a0030; }
    .subtitle { font-size: 12px; color: #888; margin-top: 4px; }
    .stats { display: flex; gap: 14px; }
    .stat-box { background: #f5f0ff; border-radius: 10px; padding: 10px 16px; text-align: center; min-width: 64px; }
    .stat-val { font-size: 20px; font-weight: 800; color: #3a0070; }
    .stat-lbl { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
    .stat-box.ok .stat-val { color: #3a7a00; }
    .stat-box.no .stat-val { color: #cc2222; }
    table { width: 100%; border-collapse: collapse; border-radius: 10px; overflow: hidden; }
    thead tr { background: #1a0030; color: #fff; }
    thead td { padding: 9px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    tbody tr:hover { filter: brightness(0.97); }
    .footer { margin-top: 20px; font-size: 11px; color: #aaa; text-align: center; }
    @media print { body { padding: 16px; } }
  </style></head><body>
  <div class="header">
    <div>
      <div class="title">Quiz Results</div>
      <div class="subtitle">${date} &nbsp;·&nbsp; Squares &amp; Cubes</div>
    </div>
    <div class="stats">
      <div class="stat-box"><div class="stat-val">${pct}%</div><div class="stat-lbl">Score</div></div>
      <div class="stat-box ok"><div class="stat-val">${correct}</div><div class="stat-lbl">Correct</div></div>
      <div class="stat-box no"><div class="stat-val">${wrong}</div><div class="stat-lbl">Wrong</div></div>
    </div>
  </div>
  <table>
    <thead><tr>
      <td>#</td><td>Question</td><td>Answer</td><td>Your Answer</td><td>Result</td>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Generated by Squares &amp; Cubes Quiz App</div>
  </body></html>`;

  const win = window.open('', '_blank', 'width=700,height=900');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', () => {
    win.focus();
    win.print();
  });
}
// ═══════════════════════════════════════════════
//  MOTIVATION & RETENTION SYSTEM
// ═══════════════════════════════════════════════

const GOAL_KEY       = 'quiz_daily_goal';
const MILESTONES_KEY = 'quiz_milestones';

// ── Daily Goal ──
function getDailyGoal() {
  try { return parseInt(localStorage.getItem(GOAL_KEY)) || 20; } catch(e) { return 20; }
}
function saveDailyGoal(n) {
  try {
    localStorage.setItem(GOAL_KEY, n);
    window.syncUserProgressToSupabase?.();
  } catch(e) {}
}

function getTodayQuestionCount(history) {
  const today = new Date().toDateString();
  return history
    .filter(h => new Date(h.date).toDateString() === today)
    .reduce((s, h) => s + (h.total || 0), 0);
}

function toggleGoalEdit() {
  const row = document.getElementById('goalEditRow');
  const isOpen = row.classList.contains('open');
  if (!isOpen) document.getElementById('goalEditInput').value = getDailyGoal();
  if (isOpen) {
    row.classList.add('closing');
    row.classList.remove('open');
    setTimeout(() => row.classList.remove('closing'), 180);
  } else {
    row.classList.remove('closing');
    row.classList.add('open');
  }
}

function saveGoalEdit() {
  const val = parseInt(document.getElementById('goalEditInput').value);
  if (!val || val < 1) return;
  saveDailyGoal(val);
  const row = document.getElementById('goalEditRow');
  row.classList.add('closing');
  row.classList.remove('open');
  setTimeout(() => row.classList.remove('closing'), 180);
  updateDailyGoalUI();
}

function updateDailyGoalUI() {
  const history   = getSessionHistory();
  const goal      = getDailyGoal();
  const done      = getTodayQuestionCount(history);
  const pct       = Math.min(100, Math.round((done / goal) * 100));
  const isDone    = done >= goal;

  document.getElementById('goalDoneCount').textContent   = Math.min(done, goal);
  document.getElementById('goalTargetCount').textContent = goal;
  document.getElementById('dailyGoalFill').style.width   = pct + '%';
  document.getElementById('dailyGoalFill').classList.toggle('done', isDone);

  const gauge = document.getElementById('dailyGoalGauge');
  if (gauge) {
    gauge.style.setProperty('--goal-pct', pct + '%');
    gauge.style.setProperty('--goal-dash', pct);
    gauge.style.setProperty('--goal-deg', (pct * 1.8) + 'deg');
    gauge.classList.toggle('done', isDone);
    gauge.classList.toggle('zero', pct <= 0);
  }

  const status = document.getElementById('dailyGoalStatus');
  if (status) {
    status.innerHTML = isDone
      ? ''
      : '<span class="daily-goal-status-sub">Start with a quick session.</span>';
  }

  const badge = document.getElementById('goalDoneBadge');
  badge.classList.toggle('show', isDone);
  if (isDone) badge.textContent = '🏅 Daily goal complete! ' + goal + '/' + goal + ' done';
}

// ── Improvement Detection ──
function computeImprovementMessage(history, latestPct) {
  if (history.length < 2) return null;
  // compare latest session to the previous 5 sessions avg (excluding latest)
  const prev = history.slice(1, 6);
  const prevAvg = Math.round(prev.reduce((s, h) => s + h.pct, 0) / prev.length);
  const diff = latestPct - prevAvg;

  if (diff >= 20) return { icon: '🚀', title: 'Huge improvement!', sub: `+${diff}% above your recent average of ${prevAvg}%` };
  if (diff >= 10) return { icon: '📈', title: 'You improved!',     sub: `+${diff}% above your recent average of ${prevAvg}%` };
  if (diff >= 5)  return { icon: '✨', title: 'Nice progress!',    sub: `+${diff}% above your recent average of ${prevAvg}%` };
  if (latestPct === 100) return { icon: '🏆', title: 'Perfect score!', sub: 'Absolutely flawless — well done!' };
  if (diff < -10) return { icon: '💪', title: 'Keep going!',       sub: `Your avg is ${prevAvg}% — you'll get there` };
  return null;
}

function showImproveBanner(msg) {
  const banner = document.getElementById('improveBanner');
  if (!msg) { banner.classList.remove('show'); return; }
  document.getElementById('improveBannerIcon').textContent  = msg.icon;
  document.getElementById('improveBannerTitle').textContent = msg.title;
  document.getElementById('improveBannerSub').textContent   = msg.sub;
  banner.classList.add('show');
}

// ── Milestones Definition ──
const MILESTONE_DEFS = [
  { id: 'first_q',     icon: '🌱', name: 'First Steps',    desc: 'Answer your first question',      check: (h,pb) => getTotalQs(h) >= 1 },
  { id: 'q_50',        icon: '⭐', name: '50 Questions',   desc: '50 questions answered',            check: (h,pb) => getTotalQs(h) >= 50 },
  { id: 'q_100',       icon: '💯', name: 'Century',        desc: '100 questions answered',           check: (h,pb) => getTotalQs(h) >= 100 },
  { id: 'q_500',       icon: '🔥', name: 'On Fire',        desc: '500 questions answered',           check: (h,pb) => getTotalQs(h) >= 500 },
  { id: 'q_1000',      icon: '💎', name: '1K Club',        desc: '1,000 questions answered',         check: (h,pb) => getTotalQs(h) >= 1000 },
  { id: 'q_5000',      icon: '👑', name: 'Legend',         desc: '5,000 questions answered',         check: (h,pb) => getTotalQs(h) >= 5000 },
  { id: 'perfect',     icon: '🏆', name: 'Perfect',        desc: 'Score 100% on any quiz',           check: (h,pb) => (pb.bestPct||0) >= 100 },
  { id: 'streak_3',    icon: '🗓️', name: '3-Day Streak',   desc: 'Practice 3 days in a row',         check: (h,pb) => computeDayStreak(h) >= 3 },
  { id: 'streak_7',    icon: '📅', name: 'Week Warrior',   desc: 'Practice 7 days in a row',         check: (h,pb) => computeDayStreak(h) >= 7 },
  { id: 'streak_30',   icon: '🌟', name: 'Monthly Master', desc: '30-day streak',                    check: (h,pb) => computeDayStreak(h) >= 30 },
  { id: 'acc_80',      icon: '🎯', name: 'Sharp Shooter',  desc: 'Achieve 80%+ accuracy in a quiz',  check: (h,pb) => (pb.bestPct||0) >= 80 },
  { id: 'acc_90',      icon: '🦅', name: 'Eagle Eye',      desc: '90%+ in any quiz',                 check: (h,pb) => (pb.bestPct||0) >= 90 },
  { id: 'sessions_10', icon: '📚', name: 'Dedicated',      desc: 'Complete 10 sessions',             check: (h,pb) => h.length >= 10 },
  { id: 'sessions_50', icon: '🎓', name: 'Scholar',        desc: 'Complete 50 sessions',             check: (h,pb) => h.length >= 50 },
  { id: 'goal_done',   icon: '🏅', name: 'Goal Crusher',   desc: 'Complete your daily goal',         check: (h,pb) => getTodayQuestionCount(h) >= getDailyGoal() },
];

function getTotalQs(history) {
  return history.reduce((s, h) => s + (h.total || 0), 0);
}

function getUnlockedMilestones() {
  try { return JSON.parse(localStorage.getItem(MILESTONES_KEY)) || []; } catch(e) { return []; }
}
function saveUnlockedMilestone(id) {
  const unlocked = getUnlockedMilestones();
  if (!unlocked.includes(id)) {
    unlocked.push(id);
    try {
      localStorage.setItem(MILESTONES_KEY, JSON.stringify(unlocked));
      window.syncMilestonesToSupabase?.();
    } catch(e) {}
  }
}

let _milestoneQueue = [];
let _milestoneShowing = false;

function checkAndTriggerMilestones(history, pb) {
  const unlocked = getUnlockedMilestones();
  const newOnes  = [];
  MILESTONE_DEFS.forEach(m => {
    if (!unlocked.includes(m.id) && m.check(history, pb)) {
      saveUnlockedMilestone(m.id);
      newOnes.push(m);
    }
  });
  if (newOnes.length) {
    _milestoneQueue.push(...newOnes);
    if (!_milestoneShowing) drainMilestoneQueue();
  }
}

function drainMilestoneQueue() {
  if (!_milestoneQueue.length) { _milestoneShowing = false; return; }
  _milestoneShowing = true;
  const m = _milestoneQueue.shift();
  showMilestoneToast(m, () => setTimeout(drainMilestoneQueue, 400));
}

// ── Shared toast dismiss system ──
let _toastDismissTimer = null;
let _toastOnDone = null;

function _dismissToast(swipeDir) {
  const toast = document.getElementById('milestoneToast');
  if (!toast.classList.contains('show')) return;
  clearTimeout(_toastDismissTimer);
  _toastDismissTimer = null;

  const done = _toastOnDone;
  _toastOnDone = null;

  if (swipeDir) {
    toast.classList.add(swipeDir === 'left' ? 'swipe-left' : 'swipe-right');
    setTimeout(() => {
      toast.classList.remove('show', 'swipe-left', 'swipe-right');
      if (done) done();
    }, 230);
  } else {
    toast.classList.add('hide');
    setTimeout(() => {
      toast.classList.remove('show', 'hide');
      if (done) done();
    }, 280);
  }
}

function _showToast(autoHideMs, onDone) {
  const toast = document.getElementById('milestoneToast');
  // Cancel any in-progress dismiss
  clearTimeout(_toastDismissTimer);
  toast.classList.remove('hide', 'swipe-left', 'swipe-right');
  _toastOnDone = onDone || null;
  toast.classList.add('show');
  _toastDismissTimer = setTimeout(() => _dismissToast(null), autoHideMs);
}

// Attach swipe handler once
(function initToastSwipe() {
  const toast = document.getElementById('milestoneToast');
  if (!toast) return;
  let startX = 0, startY = 0, dragging = false, currentX = 0;
  const SWIPE_THRESHOLD = 60;
  const DRAG_THRESHOLD  = 8;

  toast.addEventListener('pointerdown', e => {
    if (!toast.classList.contains('show')) return;
    startX = e.clientX; startY = e.clientY;
    currentX = 0; dragging = true;
    toast.setPointerCapture(e.pointerId);
  }, { passive: true });

  toast.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // Cancel if more vertical than horizontal
    if (!currentX && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > DRAG_THRESHOLD) { dragging = false; return; }
    currentX = dx;
    // Drag the toast with resistance beyond threshold
    const resistance = Math.abs(dx) > SWIPE_THRESHOLD ? 0.4 : 1;
    const capped = Math.sign(dx) * (Math.min(Math.abs(dx), SWIPE_THRESHOLD) + Math.max(0, Math.abs(dx) - SWIPE_THRESHOLD) * resistance);
    toast.style.transition = 'none';
    toast.style.transform = `translateX(calc(-50% + ${capped}px))`;
    toast.style.opacity = String(Math.max(0.4, 1 - Math.abs(capped) / 160));
  }, { passive: true });

  const endSwipe = e => {
    if (!dragging) return;
    dragging = false;
    toast.style.transition = '';
    toast.style.transform  = '';
    toast.style.opacity    = '';
    if (Math.abs(currentX) >= SWIPE_THRESHOLD) {
      _dismissToast(currentX < 0 ? 'left' : 'right');
    }
  };
  toast.addEventListener('pointerup',     endSwipe, { passive: true });
  toast.addEventListener('pointercancel', endSwipe, { passive: true });
})();

function showDCCompleteToast(pct, onDone) {
  document.getElementById('milestoneToastIcon').textContent  = '🎯';
  document.getElementById('milestoneToastTitle').textContent = 'Daily Challenge Complete!';
  document.getElementById('milestoneToastSub').textContent   = `${pct}% — Come back tomorrow for a new one`;
  const labelEl = document.getElementById('milestoneToast').querySelector('.milestone-label');
  if (labelEl) labelEl.textContent = 'Daily Challenge';
  _showToast(3000, onDone);
}

function showMilestoneToast(m, onDone) {
  document.getElementById('milestoneToastIcon').textContent  = m.icon;
  document.getElementById('milestoneToastTitle').textContent = m.name;
  document.getElementById('milestoneToastSub').textContent   = m.desc;
  const labelEl = document.getElementById('milestoneToast').querySelector('.milestone-label');
  if (labelEl) labelEl.textContent = 'Milestone Unlocked!';
  launchConfetti();
  _showToast(3200, onDone);
}

function showLevelUpToast(level) {
  const emojis = ['⭐','🌟','💫','🔥','💎','👑','🏆','🦅','🌙','🎯'];
  const emoji  = emojis[Math.min(Math.floor((level - 1) / 5), emojis.length - 1)];
  document.getElementById('milestoneToastIcon').textContent  = emoji;
  document.getElementById('milestoneToastTitle').textContent = `Level ${level} — ${levelTitle(level)}!`;
  document.getElementById('milestoneToastSub').textContent   = 'You levelled up!';
  const labelEl = document.getElementById('milestoneToast').querySelector('.milestone-label');
  if (labelEl) labelEl.textContent = 'Level Up!';
  launchConfetti();
  _showToast(3500, null);
}

function renderMilestonesGrid() {
  const grid     = document.getElementById('milestonesGrid');
  if (!grid) return;
  const history  = getSessionHistory();
  const pb       = getPB();
  const unlocked = getUnlockedMilestones();
  grid.innerHTML = MILESTONE_DEFS.map(m => {
    const isUnlocked = unlocked.includes(m.id);
    return `<div class="milestone-badge ${isUnlocked ? 'unlocked' : ''}">
      <div class="milestone-badge-icon">${m.icon}</div>
      <div class="milestone-badge-name">${m.name}</div>
      <div class="milestone-badge-val">${m.desc}</div>
    </div>`;
  }).join('');
}

// ── Hook into showDashboard to update goal & banner ──
const _origShowDashboard = showDashboard;
showDashboard = function() {
  _origShowDashboard();
  updateDailyGoalUI();
  // Show improvement banner based on last session
  const history = getSessionHistory();
  if (history.length >= 2) {
    const msg = computeImprovementMessage(history, history[0].pct);
    showImproveBanner(msg);
  } else {
    document.getElementById('improveBanner').classList.remove('show');
  }
};

// ── Hook into showProfile to render milestones ──
const _origShowProfile = showProfile;
showProfile = function() {
  _origShowProfile();
  renderMilestonesGrid();
};

// ── Hook into saveHistory to trigger milestone checks ──
const _origSaveHistory = saveHistory;
saveHistory = function(s, total, pct, xp) {
  _origSaveHistory(s, total, pct, xp);
  if (isPracticeMode()) return;
  const history = getSessionHistory();
  const pb      = getPB();
  setTimeout(() => checkAndTriggerMilestones(history, pb), 800);
};

// ═══════════════════════════════════════════════
//  NEW RETENTION SYSTEMS
// ═══════════════════════════════════════════════

// ── Storage Keys ──
const DAY_STREAK_KEY    = 'quiz_day_streak2';   // {streak, bestStreak, lastDate}
const XP_KEY            = 'quiz_xp';             // {totalXP, currentLevel}
const WEAKNESS_KEY      = 'quiz_weakness';        // {"12": {correct, wrong}, ...}
const DAILY_CHAL_KEY    = 'quiz_daily_challenge'; // {date, completed, score, pct}
const DC_HISTORY_KEY    = 'quiz_dc_history';      // [{date, score, total, pct, bracket}]
const SR_KEY            = 'quiz_sr_queue';        // [{n, type, m, answer, reverse}] — cross-session retry queue

// ── XP Level Titles ──
// Level title tiers — 50 levels total
const LEVEL_TITLES = [
  'Beginner',     // 1–3
  'Beginner',
  'Beginner',
  'Apprentice',   // 4–7
  'Apprentice',
  'Apprentice',
  'Apprentice',
  'Student',      // 8–12
  'Student',
  'Student',
  'Student',
  'Student',
  'Practitioner', // 13–18
  'Practitioner',
  'Practitioner',
  'Practitioner',
  'Practitioner',
  'Practitioner',
  'Skilled',      // 19–25
  'Skilled',
  'Skilled',
  'Skilled',
  'Skilled',
  'Skilled',
  'Skilled',
  'Advanced',     // 26–32
  'Advanced',
  'Advanced',
  'Advanced',
  'Advanced',
  'Advanced',
  'Advanced',
  'Expert',       // 33–39
  'Expert',
  'Expert',
  'Expert',
  'Expert',
  'Expert',
  'Expert',
  'Master',       // 40–45
  'Master',
  'Master',
  'Master',
  'Master',
  'Master',
  'Grandmaster',  // 46–49
  'Grandmaster',
  'Grandmaster',
  'Grandmaster',
  'Legend',       // 50
];

// ─────────────────────────────────────────────
// 1. DAILY STREAK SYSTEM
// ─────────────────────────────────────────────

function getDayStreakData() {
  try { return JSON.parse(localStorage.getItem(DAY_STREAK_KEY)) || {streak:0, bestStreak:0, lastDate:''}; }
  catch(e) { return {streak:0, bestStreak:0, lastDate:''}; }
}
function saveDayStreakData(d) {
  try {
    localStorage.setItem(DAY_STREAK_KEY, JSON.stringify(d));
    window.syncUserProgressToSupabase?.();
  } catch(e) {}
}

/**
 * updateDayStreak — call on quiz completion.
 * Returns {streak, bestStreak, increased} for UI feedback.
 */
function updateDayStreak() {
  const today = new Date().toISOString().slice(0,10); // YYYY-MM-DD
  const data  = getDayStreakData();
  const prev  = data.lastDate;

  let increased = false;
  if (!prev || prev === today) {
    // same day or first play — no change
  } else {
    const prevD   = new Date(prev);
    const todayD  = new Date(today);
    const diffMs  = todayD - prevD;
    const diffDays= Math.round(diffMs / 86400000);
    if (diffDays === 1) {
      data.streak++;
      increased = true;
    } else {
      data.streak = 1;
    }
  }
  if (!prev) data.streak = 1;
  if (data.streak > data.bestStreak) data.bestStreak = data.streak;
  data.lastDate = today;
  saveDayStreakData(data);
  return { ...data, increased };
}

// ─────────────────────────────────────────────
// 2. XP + LEVEL SYSTEM
// ─────────────────────────────────────────────

function getXPData() {
  try { return JSON.parse(localStorage.getItem(XP_KEY)) || {totalXP: 0, currentLevel: 1}; }
  catch(e) { return {totalXP: 0, currentLevel: 1}; }
}
function saveXPData(d) {
  try {
    localStorage.setItem(XP_KEY, JSON.stringify(d));
    window.syncUserProgressToSupabase?.();
  } catch(e) {}
}

/** XP needed to reach a given level (cumulative total from 0).
 *  Formula: sum of floor(150 * 1.18^(i-1)) for i = 1..level-1
 *  Level 50 requires ~110,000+ XP total.
 */
function xpForLevel(level) {
  if (level <= 1) return 0;
  let total = 0;
  for (let i = 1; i < level; i++) total += Math.floor(100 * Math.pow(1.12, i - 1));
  return total;
}

function levelFromXP(xp) {
  let level = 1;
  while (level < 50 && xpForLevel(level + 1) <= xp) level++;
  return level;
}

/** XP required just for the current level span */
function xpForCurrentLevel(level) {
  if (level >= 50) return xpForLevel(50) - xpForLevel(49); // cap at 50
  return xpForLevel(level + 1) - xpForLevel(level);
}
function levelTitle(level) {
  return LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)];
}

function levelShapeClass(level) {
  return 'xp-shape-' + levelTitle(level).toLowerCase();
}

/**
 * addXP — called after each correct answer.
 * bonus=true when current session answer-streak is 3+
 */
function addXP(bonus) {
  const gain = bonus ? 15 : 10;
  const data = getXPData();
  data.totalXP += gain;
  data.currentLevel = levelFromXP(data.totalXP);
  saveXPData(data);
  return { gain, totalXP: data.totalXP, level: data.currentLevel };
}

function deductXP() {
  if (isPracticeMode()) return;
  const loss = 3; // 1/3 of base 10 XP
  const data = getXPData();
  data.totalXP = Math.max(0, data.totalXP - loss);
  data.currentLevel = levelFromXP(data.totalXP);
  saveXPData(data);
  showXPFloat(-loss);
}

/** Show floating "+10 XP" effect near the answer input */
function showXPFloat(gain) {
  const ref = document.getElementById('ansInput') || document.getElementById('checkBtn');
  if (!ref) return;
  const rect = ref.getBoundingClientRect();
  const float = document.createElement('div');
  float.className = 'xp-float';
  float.textContent = (gain > 0 ? '+' : '') + gain + ' XP';
  const _xpAcc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#B8D45C';
  float.style.color = gain > 0 ? _xpAcc : '#ff6b6b';
  float.style.textShadow = gain > 0 ? `0 0 10px ${_xpAcc}99` : '0 0 10px rgba(255,107,107,0.5)';
  float.style.left  = (rect.left + rect.width / 2 - 20) + 'px';
  float.style.top   = (rect.top + window.scrollY - 8) + 'px';
  document.body.appendChild(float);
  setTimeout(() => float.remove(), 950);
}

function updateXPPill() {
  // XP pill removed from test header — no-op
}

function updateDashXP(animateLevelUp) {
  const data  = getXPData();
  const level = data.currentLevel;
  const xpStart  = xpForLevel(level);
  const xpNeeded = xpForCurrentLevel(level);
  const xpIn     = data.totalXP - xpStart;
  const pct      = Math.min(100, Math.round((xpIn / xpNeeded) * 100));
  const el = {
    level:  document.getElementById('dashXpLevel'),
    title:  document.getElementById('dashXpTitle'),
    sub:    document.getElementById('dashXpSub'),
    bar:    document.getElementById('dashXpBar'),
  };
  if (el.level) {
    el.level.textContent = `Lv ${level}`;
    el.level.classList.remove(
      'xp-shape-beginner',
      'xp-shape-apprentice',
      'xp-shape-student',
      'xp-shape-practitioner',
      'xp-shape-skilled',
      'xp-shape-advanced',
      'xp-shape-expert',
      'xp-shape-master',
      'xp-shape-grandmaster',
      'xp-shape-legend'
    );
    el.level.classList.add(levelShapeClass(level));
  }
  if (el.title) el.title.textContent = levelTitle(level);
  if (el.sub)   el.sub.textContent   = `${xpIn} / ${xpNeeded} XP to next level`;

  if (el.bar) {
    // Reset bar to 0 first on level-up so the fill animates from empty
    if (animateLevelUp) {
      el.bar.style.transition = 'none';
      el.bar.style.width = '0%';
      requestAnimationFrame(() => {
        el.bar.style.transition = '';
        el.bar.style.width = pct + '%';
      });
    } else {
      el.bar.style.width = pct + '%';
    }
  }

  // Animate level number if levelling up
  if (animateLevelUp && el.level) {
    restartAnimationClass(el.level, 'levelup-pop');
    el.level.addEventListener('animationend', () => el.level.classList.remove('levelup-pop'), { once: true });
    if (el.bar) {
      restartAnimationClass(el.bar, 'levelup-flash');
      el.bar.addEventListener('animationend', () => el.bar.classList.remove('levelup-flash'), { once: true });
    }
  }
}

// ─────────────────────────────────────────────
// 3. PERSONAL BEST TRACKING (ENHANCED)
// ─────────────────────────────────────────────

/**
 * updatePersonalBests — call at end of session.
 * Returns flags for what was beaten.
 */
function updatePersonalBests(pct, sessionBestStreak, totalXP) {
  const pb = getPB();
  const flags = { newBestPct: false, newBestStreak: false };

  if (pct > (pb.bestPct || 0)) {
    pb.bestPct = pct;
    flags.newBestPct = true;
  }
  if (sessionBestStreak > (pb.bestStreak || 0)) {
    pb.bestStreak = sessionBestStreak;
    flags.newBestStreak = true;
  }
  savePB(pb);
  return { pb, flags };
}

// Render PB row with NEW BEST labels
function renderPBRow(pb, flags) {
  const pbBestEl   = document.getElementById('pbBest');
  const pbStreakEl = document.getElementById('pbStreak');
  const pbXPEl     = document.getElementById('pbXP');
  const xpData     = getXPData();

  if (pbBestEl) {
    pbBestEl.innerHTML = (pb.bestPct || 0) + '%' +
      (flags.newBestPct ? '<span class="pb-new-label">NEW BEST</span>' : '');
    pbBestEl.className = 'pb-v' + (flags.newBestPct ? ' pb-new-best' : '');
  }
  if (pbStreakEl) {
    pbStreakEl.innerHTML = (pb.bestStreak || 0) +
      (flags.newBestStreak ? '<span class="pb-new-label">NEW BEST</span>' : '');
    pbStreakEl.className = 'pb-v' + (flags.newBestStreak ? ' pb-new-best' : '');
  }
  if (pbXPEl) {
    const xpGained = Math.max(0, getXPData().totalXP - _sessionStartXP);
    pbXPEl.textContent = '+' + xpGained + ' XP';
    pbXPEl.className   = 'pb-v';
  }
}

// ─────────────────────────────────────────────
// 4. WEAKNESS TRACKING
// ─────────────────────────────────────────────

function getWeaknessData() {
  try { return JSON.parse(localStorage.getItem(WEAKNESS_KEY)) || {}; }
  catch(e) { return {}; }
}
function saveWeaknessData(d) {
  try {
    localStorage.setItem(WEAKNESS_KEY, JSON.stringify(d));
    window.syncWeaknessToSupabase?.();
  } catch(e) {}
}

/** Update per-number stats after each answer */
/** Get the digit-band label for a number (for arithmetic tracking) */
function getArithDiffBand(n) {
  if (n >= 1000) return '4digit';
  if (n >= 100)  return '3digit';
  return '2digit';
}

function trackWeaknessAnswer(n, type, correct) {
  const data = getWeaknessData();
  let key;
  if (type === 'add' || type === 'sub') {
    // Track by operation + digit-band, not by specific number
    const band = getArithDiffBand(n);
    key = `${type}_${band}`;
    if (!data[key]) data[key] = { type, band, correct: 0, wrong: 0, isArith: true };
  } else {
    key = `${n}_${type}`;
    if (!data[key]) data[key] = { n, type, correct: 0, wrong: 0 };
  }
  if (correct) data[key].correct++;
  else         data[key].wrong++;
  saveWeaknessData(data);
}

/**
 * getWeakNumbers — returns weak entries (accuracy < 70%, min 3 attempts).
 * For arithmetic: returns {type, band, isArith} objects.
 * For others: returns {n, type} objects.
 */
function getWeakNumbers() {
  const data = getWeaknessData();
  return Object.values(data).filter(d => {
    const total = d.correct + d.wrong;
    return total >= 3 && (d.correct / total) < 0.70;
  });
}

/** Returns only weak entries relevant to the currently selected qType */
function getContextualWeakAreas() {
  const all = getWeakNumbers();
  if (qType === 'arithmetic') {
    return all.filter(d => d.isArith);
  }
  return all.filter(d => !d.isArith);
}

function updateWeaknessBtn() {
  const weak = getContextualWeakAreas();
  const btn  = document.getElementById('weaknessPracticeBtn');
  const badge= document.getElementById('weakCountBadge');
  if (!btn) return;
  if (weak.length > 0) {
    btn.style.display = 'flex';
    if (badge) {
      if (qType === 'arithmetic') {
        // Describe which operations/bands are weak
        const labels = weak.map(w => {
          const op   = w.type === 'add' ? '+' : '−';
          const band = w.band === '4digit' ? '4-dig' : w.band === '3digit' ? '3-dig' : '2-dig';
          return `${op}${band}`;
        });
        badge.textContent = labels.join(', ') + ' weak';
      } else {
        badge.textContent = `${weak.length} weak`;
      }
    }
  } else {
    btn.style.display = 'none';
  }
}

/** Start a quiz focused only on weak areas */
function startWeaknessPractice() {
  const weak = getContextualWeakAreas();
  if (!weak.length) {
    alert('No weak areas yet! Practice more to identify areas to improve.');
    return;
  }

  if (qType === 'arithmetic') {
    // Determine which operation(s) and digit band(s) are weak
    const hasWeakAdd = weak.some(w => w.type === 'add');
    const hasWeakSub = weak.some(w => w.type === 'sub');

    // Pick operation sub-type
    if (hasWeakAdd && hasWeakSub) arithSubType = 'both';
    else if (hasWeakAdd)          arithSubType = 'add';
    else                          arithSubType = 'sub';

    // Pick the worst digit band (most wrong / total ratio)
    const worst = weak.slice().sort((a, b) => {
      const ra = a.wrong / (a.correct + a.wrong);
      const rb = b.wrong / (b.correct + b.wrong);
      return rb - ra;
    })[0];
    arithDiff = worst.band;

    // Sync the UI toggles
    document.querySelectorAll('#arithTypeGrid .timer-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.atype === arithSubType);
    });
    document.querySelectorAll('#arithDiffGrid .timer-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.adiff === arithDiff);
    });

    // Make sure arithmetic mode is active
    setType('arithmetic');
    startTest();
  } else {
    // Original number-based focus for squares/cubes/tables
    const weakNums = [...new Set(weak.map(w => w.n))];
    focusNums = new Set(weakNums);
    document.getElementById('focusTog').checked = true;
    focusMode = true;
    toggleFocusGrid();
    if (qType !== 'multiplication') {
      weakNums.forEach(n => focusNums.add(n));
    }
    startTest();
  }
}

// ─────────────────────────────────────────────
// SPACED REPETITION — cross-session persistence

const SR_MAX = 50;

function getSRQueue() {
  try { return JSON.parse(localStorage.getItem(SR_KEY)) || []; } catch(e) { return []; }
}
function saveSRQueue(q) {
  try {
    localStorage.setItem(SR_KEY, JSON.stringify(q.slice(0, SR_MAX)));
    window.syncSpacedRepetitionToSupabase?.();
  } catch(e) {}
}

/** Add a wrong question to the persistent SR queue */
function srAddQuestion(qObj) {
  const queue = getSRQueue();
  const key = qObj.type === 'table' ? `table_${qObj.n}_${qObj.m}` : `${qObj.type}_${qObj.n}`;
  if (!queue.some(q => q._srKey === key)) {
    queue.unshift({ ...qObj, _srKey: key, _srAdded: new Date().toISOString() });
    saveSRQueue(queue);
  }
}

/** Remove a question from SR queue after a correct answer */
function srRemoveQuestion(qObj) {
  const key = qObj.type === 'table' ? `table_${qObj.n}_${qObj.m}` : `${qObj.type}_${qObj.n}`;
  saveSRQueue(getSRQueue().filter(q => q._srKey !== key));
}

/**
 * Get SR items relevant to the current session type/range, max 5.
 * Called in startTest() when spacedMode is on.
 */
function getSRQuestionsForSession() {
  const queue = getSRQueue();
  const from = parseInt(document.getElementById('rangeFrom').value) || 1;
  const to   = parseInt(document.getElementById('rangeTo').value) || 20;
  return queue.filter(q => {
    if (qType === 'multiplication') return q.type === 'table';
    if (qType === 'squares' && q.type !== 'square') return false;
    if (qType === 'cubes'   && q.type !== 'cube')   return false;
    return q.n >= from && q.n <= to;
  }).slice(0, 5);
}


// ─────────────────────────────────────────────
// 5. DAILY CHALLENGE MODE
// ─────────────────────────────────────────────

function getTodayDateStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getDailyChallengeData() {
  try { return JSON.parse(localStorage.getItem(DAILY_CHAL_KEY)) || {}; }
  catch(e) { return {}; }
}
function saveDailyChallengeData(d) {
  let saved = false;
  try {
    localStorage.setItem(DAILY_CHAL_KEY, JSON.stringify(d));
    saved = true;
  } catch(e) {}
  // Also append to running DC history log
  if (d.completed) {
    try {
      const hist = JSON.parse(localStorage.getItem(DC_HISTORY_KEY)) || [];
      // Don't duplicate the same date
      if (!hist.length || hist[0].date !== d.date) {
        const cfg = getDailyChallengeConfig();
        hist.unshift({ date: d.date, score: d.score, total: d.total, pct: d.pct, bracket: cfg.label });
        localStorage.setItem(DC_HISTORY_KEY, JSON.stringify(hist.slice(0, 90))); // keep ~3 months
      }
    } catch(e) {}
  }
  if (saved) window.syncDailyChallengesToSupabase?.();
}

function isDailyChallengeCompleted() {
  const data = getDailyChallengeData();
  return data.date === getTodayDateStr() && data.completed;
}

/** Seeded random using date string as seed — deterministic per day */
function seededRandom(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return function() {
    h ^= h << 13; h ^= h >> 17; h ^= h << 5;
    return ((h >>> 0) / 0xffffffff);
  };
}

/**
 * getDailyChallengeConfig — returns challenge parameters based on current level bracket.
 * The seed includes the date AND the bracket so same-bracket users get same challenge.
 */
function getDailyChallengeConfig() {
  const level = getXPData().currentLevel;
  const label = levelTitle(level);

  // Level brackets → challenge config
  // range: [from, to], qCount, timerSecs (0 = off), type, reverseChance (0–1)
  let bracket, cfg;
  if      (level <= 3)  { bracket = 'beginner';     cfg = { from:1, to:10, qCount:10, timerSecs:0,  type:'squares', reverse:false }; }
  else if (level <= 7)  { bracket = 'apprentice';   cfg = { from:1, to:12, qCount:10, timerSecs:0,  type:'both',    reverse:false }; }
  else if (level <= 12) { bracket = 'student';      cfg = { from:1, to:15, qCount:12, timerSecs:0,  type:'both',    reverse:false }; }
  else if (level <= 18) { bracket = 'practitioner'; cfg = { from:1, to:15, qCount:12, timerSecs:12, type:'both',    reverse:false }; }
  else if (level <= 25) { bracket = 'skilled';      cfg = { from:1, to:20, qCount:15, timerSecs:10, type:'both',    reverse:false }; }
  else if (level <= 32) { bracket = 'advanced';     cfg = { from:1, to:22, qCount:15, timerSecs:9,  type:'both',    reverse:false }; }
  else if (level <= 39) { bracket = 'expert';       cfg = { from:1, to:25, qCount:15, timerSecs:8,  type:'both',    reverse:true  }; }
  else if (level <= 45) { bracket = 'master';       cfg = { from:1, to:30, qCount:20, timerSecs:7,  type:'both',    reverse:true  }; }
  else if (level <= 49) { bracket = 'grandmaster';  cfg = { from:1, to:30, qCount:20, timerSecs:7,  type:'both',    reverse:true  }; }
  else                  { bracket = 'legend';       cfg = { from:1, to:30, qCount:20, timerSecs:6,  type:'both',    reverse:true  }; }

  cfg.bracket = bracket;
  cfg.label = label;
  return cfg;
}

function generateDailyChallenge() {
  const dateStr = getTodayDateStr();
  const cfg = getDailyChallengeConfig();
  // Seed includes bracket so same day + same bracket = same challenge
  const rng = seededRandom(dateStr + '_' + cfg.bracket);
  const pool = [];

  for (let n = cfg.from; n <= cfg.to; n++) {
    if (cfg.type === 'squares' || cfg.type === 'both') {
      pool.push({ n, type:'square', answer:n*n,   reverse:cfg.reverse ? (rng() > 0.6) : false });
    }
    if (cfg.type === 'cubes' || cfg.type === 'both') {
      pool.push({ n, type:'cube',   answer:n*n*n, reverse:cfg.reverse ? (rng() > 0.7) : false });
    }
  }

  // Deterministic shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Recompute answers for any reverse questions (answer = n for reverse)
  return pool.slice(0, cfg.qCount).map(q => ({ ...q, answer: q.reverse ? q.n : q.answer }));
}

let isDailyChallenge = false;

function startDailyChallenge() {
  if (isDailyChallengeCompleted()) {
    const data = getDailyChallengeData();
    alert(`Today's challenge already done! Score: ${data.score}/${data.total} (${data.pct}%)\nCome back tomorrow for a new one.`);
    return;
  }

  const cfg = getDailyChallengeConfig();

  isDailyChallenge = true;
  qs = generateDailyChallenge();
  cur = 0; score = 0; results = [];
  streak = 0; wrongQueue = []; retrySet = new Set();
  timedQAnswered = 0;
  isTimedMode = false;

  instant    = true;
  autoSub    = false;
  pickMode   = false;
  reverseMode = cfg.reverse;
  livesMode  = false;
  spacedMode = false;
  focusMode  = false;
  lives = 3;

  if (cfg.timerSecs > 0) {
    timerMode = 'fixed';
    duration  = cfg.timerSecs;
  } else {
    timerMode = 'off';
    duration  = 0;
  }

  document.getElementById('livesPill').style.display = 'none';
  document.getElementById('streakPill').classList.remove('active');
  document.getElementById('timedModeBar').classList.remove('visible');
  const _tc=document.getElementById('timedChip'); if(_tc) _tc.style.display='none';

  // Show bracket info briefly in the q-card sub text on first load
  window._dailyChallengeLabel = cfg.label;

  show('s-test');
  loadQ();
}

function updateDailyChallengeBtn() {
  const btn   = document.getElementById('dailyChallengeBtn');
  const badge = document.getElementById('dailyChallengeBadge');
  const sub   = document.getElementById('dcFloatSub');
  if (!btn) return;
  const done = isDailyChallengeCompleted();
  if (done) {
    const data = getDailyChallengeData();
    if (badge) { badge.textContent = `Done · ${data.pct}%`; badge.className = 'daily-challenge-badge done'; }
    if (sub)   sub.textContent = `${data.score}/${data.total} correct · come back tomorrow`;
    btn.disabled = true;
  } else {
    const cfg = getDailyChallengeConfig();
    const typeStr = cfg.type === 'squares' ? 'Squares only' : cfg.type === 'cubes' ? 'Cubes only' : 'Squares & Cubes';
    const pillText = cfg.timerSecs ? `${cfg.label} • ${cfg.qCount} Qs • ${cfg.timerSecs}s` : `${cfg.label} • ${cfg.qCount} Qs`;
    if (badge) { badge.textContent = pillText; badge.className = 'daily-challenge-badge avail'; }
    if (sub)   sub.textContent = typeStr;
    btn.disabled = false;
  }

  // Set today's date on the pull-tab via CSS custom property
  // Format: day number + newline + short month (e.g. "3\nMAY")
  (function setDcTabDate() {
    const now = new Date();
    const dayEl = document.getElementById('dcTabDay');
    const monEl = document.getElementById('dcTabMon');
    if (dayEl) dayEl.textContent = now.getDate();
    if (monEl) monEl.textContent = now.toLocaleString('en', { month: 'short' }).toUpperCase();
  })();

  // Mobile tap-to-open, then tap-to-launch (hover doesn't work on touch)
  if (!btn._dcTapBound) {
    btn._dcTapBound = true;

    btn.addEventListener('touchend', function(e) {
      if (!btn.classList.contains('dc-open')) {
        // First touch: open the card, don't start the challenge yet
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('dc-open');
        const pl = document.getElementById('dcPullLabel');
        if (pl) pl.classList.remove('show');
        clearTimeout(btn._dcAutoClose);
        btn._dcAutoClose = setTimeout(() => {
          btn.classList.remove('dc-open');
          if (pl) pl.classList.add('show');
        }, 5000);
      } else {
        // Already open: let click fire naturally -> startDailyChallenge()
        clearTimeout(btn._dcAutoClose);
      }
    }, { passive: false });

    // Close when tapping anything outside the card
    document.addEventListener('touchend', function(e) {
      if (btn.classList.contains('dc-open') && !btn.contains(e.target)) {
        btn.classList.remove('dc-open');
        clearTimeout(btn._dcAutoClose);
        const pl = document.getElementById('dcPullLabel');
        if (pl) pl.classList.add('show');
      }
    }, { passive: true });
  }

  // Hide immediately if challenge was just completed
  const currentScreen = document.querySelector('.screen.active');
  if (currentScreen) updateDailyChallengeVisibility(currentScreen.id);
}

// ─────────────────────────────────────────────
// 6. SESSION FEEDBACK LOOP
// ─────────────────────────────────────────────

function getDifficultyNudge() {
  // Returns a suggestion string if there's a harder level to try, otherwise null
  if (qType === 'multiplication' && multSubType === '2digit') {
    if (mult2dDiff === 'easy')   return 'Try bumping to Medium (10–49) next time.';
    if (mult2dDiff === 'medium') return 'Try bumping to Hard (10–99) next time.';
  } else if (qType === 'arithmetic') {
    if (arithDiff === '2digit')  return 'Try bumping to 3-digit numbers next time.';
    if (arithDiff === '3digit')  return 'Try bumping to 4-digit numbers next time.';
  } else {
    // squares / cubes / both / multiplication tables — range based
    const from = parseInt(document.getElementById('rangeFrom').value) || 1;
    const to   = parseInt(document.getElementById('rangeTo').value)   || 20;
    if (to <= 10)  return 'Try expanding the range to 1–20 next time.';
    if (to <= 20)  return 'Try expanding the range to 1–50 next time.';
  }
  return null;
}

function showSessionNudge(pct, pb) {
  const el   = document.getElementById('sessionNudge');
  const icon = document.getElementById('sessionNudgeIcon');
  const text = document.getElementById('sessionNudgeText');
  if (!el) return;

  const best = pb.bestPct || 0;
  const diff = best - pct;
  let msg = null;

  if (pct === 100) {
    const bump = getDifficultyNudge();
    msg = { icon: '🏆', text: bump ? `Perfect score — you nailed it! ${bump}` : 'Perfect score — you nailed it!' };
  } else if (pct >= 90) {
    const bump = getDifficultyNudge();
    msg = { icon: '🔥', text: bump ? `So close to perfect — one more run? ${bump}` : 'So close to perfect — one more run?' };
  } else if (diff === 0) {
    msg = { icon: '🌟', text: 'You matched your best — beat it next time!' };
  } else if (diff > 0 && diff <= 5) {
    msg = { icon: '💪', text: `Just ${diff}% away from your personal best!` };
  } else if (diff > 5 && diff <= 15) {
    msg = { icon: '📈', text: `Your best is ${best}% — you can beat it!` };
  } else if (pct < 50) {
    msg = { icon: '🎯', text: 'Keep at it — each session builds speed.' };
  } else {
    msg = { icon: '✨', text: 'Good session! Try again to beat your score.' };
  }

  if (msg) {
    icon.textContent = msg.icon;
    text.textContent = msg.text;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

// ─────────────────────────────────────────────
// HOOK: called on every correct answer
// ─────────────────────────────────────────────
function onCorrectAnswer(sessionStreak) {
  if (isPracticeMode()) return;
  const bonus = sessionStreak >= 3;
  const xpResult = addXP(bonus);
  showXPFloat(xpResult.gain);
  updateXPPill();
}

// ─────────────────────────────────────────────
// HOOK: called at end of session (from showResults)
// ─────────────────────────────────────────────
function onSessionComplete(pct, sessionBestStreak, score, total) {
  // Day streak — always track (pure stats, not progression)
  const streakResult = updateDayStreak();

  if (isPracticeMode()) {
    // In practice mode: only save history + show session nudge, skip everything else
    showSessionNudge(pct, getPB());
    return;
  }

  // Update XP pill in test header
  updateXPPill();

  // Personal bests
  const { pb, flags } = updatePersonalBests(pct, sessionBestStreak, getXPData().totalXP);
  renderPBRow(pb, flags);

  // Confetti only on new best accuracy
  if (flags.newBestPct && pct > 0) launchConfetti();

  // Session nudge
  showSessionNudge(pct, pb);

  // Daily challenge completion
  if (isDailyChallenge) {
    saveDailyChallengeData({ date: getTodayDateStr(), completed: true, score, total, pct });
    isDailyChallenge = false;
    showDCCompleteToast(pct, () => {
      const activeScreen = document.querySelector('.screen.active');
      updateDailyChallengeVisibility(activeScreen ? activeScreen.id : 's-setup');
    });
  }

  // Pulse the day streak stat in dashboard if it increased
  if (streakResult.increased) {
    const streakStat = document.getElementById('dashDayStreak');
    if (streakStat) {
      restartAnimationClass(streakStat.closest('.dash-stat'), 'streak-pulse');
    }
  }
}

// ─────────────────────────────────────────────
// UNLIMITED MODE
// ─────────────────────────────────────────────
let unlimitedMode = false;

function toggleUnlimitedMode() {
  unlimitedMode = document.getElementById('unlimitedTog').checked;
  const qCountEl = document.getElementById('qCount');
  qCountEl.classList.toggle('qcount-dimmed', unlimitedMode);
}

function endUnlimitedSession() {
  unlimitedMode = false;
  document.getElementById('endSessionBtn').classList.remove('visible');
  showResults();
}

// ─────────────────────────────────────────────
function updateSetupMotivation() {
  updateDailyChallengeBtn();
  updateWeaknessBtn();
}

// Patch show() to refresh setup motivation state + control daily challenge card visibility
const _origShow = show;
show = function(id) {
  _origShow(id);
  if (id === 's-setup') updateSetupMotivation();
  updateDailyChallengeVisibility(id);
};

function updateDailyChallengeVisibility(screenId) {
  const btn = document.getElementById('dailyChallengeBtn');
  if (!btn) return;
  const allowedScreens = ['s-setup', 's-dashboard'];
  const visible = allowedScreens.includes(screenId) && !isDailyChallengeCompleted();
  btn.style.transition = visible
    ? 'transform 0.32s cubic-bezier(0.22,1,0.36,1), opacity 0.22s ease, box-shadow 0.25s ease, border-color 0.2s'
    : 'transform 0.22s ease, opacity 0.18s ease';
  btn.style.opacity = visible ? '1' : '0';
  btn.style.pointerEvents = visible ? 'auto' : 'none';

  if (visible) {
    restartAnimationClass(btn, 'dc-bounce');
    setTimeout(() => btn.classList.remove('dc-bounce'), 700);

    // Periodic nudge every 8s while retracted
    if (!btn._dcNudgeInterval) {
      btn._dcNudgeInterval = setInterval(() => {
        if (!btn.classList.contains('dc-open') && !btn.classList.contains('dc-bounce')) {
          restartAnimationClass(btn, 'dc-nudge');
          setTimeout(() => btn.classList.remove('dc-nudge'), 650);
        }
      }, 8000);
    }
  } else {
    clearInterval(btn._dcNudgeInterval);
    btn._dcNudgeInterval = null;
  }

  const pullLabel = document.getElementById('dcPullLabel');
  if (!visible) {
    btn.classList.remove('dc-open');
    if (pullLabel) pullLabel.classList.remove('show');
  } else {
    if (pullLabel) pullLabel.classList.add('show');
  }
}

// ─────────────────────────────────────────────
// PATCH checkAnswer & pickAnswer to track XP + weakness
// ─────────────────────────────────────────────
const _origCheckAnswer = checkAnswer;
checkAnswer = function() {
  const prevScore = score;
  _origCheckAnswer();
  const q = qs[cur];
  if (score > prevScore) {
    onCorrectAnswer(streak);
    if (q) {
      trackWeaknessAnswer(q.n, q.type, true);
      if (spacedMode) srRemoveQuestion(q); // graduated — remove from SR
    }
  } else {
    if (q && answered) {
      trackWeaknessAnswer(q.n, q.type, false);
      if (spacedMode) srAddQuestion(q); // failed — persist for next session
      deductXP();
    }
  }
};

const _origPickAnswer = pickAnswer;
pickAnswer = function(chosen, correct, forceSubmit) {
  const submitted = _origPickAnswer(chosen, correct, forceSubmit);
  if (submitted === false) return false;
  const q = qs[cur];
  if (q) {
    const isCorrect = chosen === correct;
    trackWeaknessAnswer(q.n, q.type, isCorrect);
    if (isCorrect) {
      onCorrectAnswer(streak);
      if (spacedMode) srRemoveQuestion(q);
    } else {
      if (spacedMode) srAddQuestion(q);
      deductXP();
    }
  }
  return submitted;
};

// ─────────────────────────────────────────────
// PATCH showResults to call onSessionComplete
// ─────────────────────────────────────────────
const _origShowResults = showResults;
(function patchShowResults() {
  const observer = new MutationObserver(() => {
    const resultsScreen = document.getElementById('s-results');
    if (resultsScreen && resultsScreen.classList.contains('active')) {
      if (resultsScreen.dataset.nudgeFired !== 'true') {
        resultsScreen.dataset.nudgeFired = 'true';
        const total = results.length;
        const pct   = total > 0 ? Math.round((score / total) * 100) : 0;
        onSessionComplete(pct, bestStreak, score, total);
        // Show level-up toast if a level-up occurred during this session
        if (_pendingLevelUp !== null) {
          const lvl = _pendingLevelUp.level;
          setTimeout(() => showLevelUpToast(lvl), 900);
          // Don't clear _pendingLevelUp here — dashboard still needs it for the modal
        }
      }
    } else if (resultsScreen) {
      resultsScreen.dataset.nudgeFired = 'false';
    }
  });
  observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
})();

// ─────────────────────────────────────────────
// PATCH showDashboard — single authoritative refresh
// Ensures XP, day streak, daily goal, DC button are
// all current on every app open / dashboard visit.
// ─────────────────────────────────────────────
// Track level when leaving to results, so dashboard knows if level changed
let _levelAtResults = null;

const _origShowDash2 = showDashboard;
showDashboard = function() {
  _origShowDash2();
  const pending = _pendingLevelUp;
  _pendingLevelUp = null; // consume
  const didLevelUp = pending !== null;
  // Animate the level number if levelled up
  setTimeout(() => updateDashXP(didLevelUp), didLevelUp ? 350 : 0);
  // Show full-screen modal only if the title changed
  if (didLevelUp) {
    const newTitle = levelTitle(pending.level);
    if (newTitle !== pending.oldTitle) {
      setTimeout(() => showLevelUpModal(pending.level), 600);
    }
  }
  updateDailyGoalUI();
  updateDailyChallengeBtn();
  updateSetupMotivation();
  const _h = getSessionHistory();
  const _streakEl = document.getElementById('dashDayStreak');
  if (_streakEl) _streakEl.textContent = computeDayStreak(_h) || '0';
};

// ─────────────────────────────────────────────
// PATCH showProfile to include XP + day streak data
// ─────────────────────────────────────────────
const _origShowProf2 = showProfile;
showProfile = function() {
  _origShowProf2();
  // Update day streak on profile from new system
  const ds = getDayStreakData();
  const dsDayEl = document.getElementById('profDayStreak');
  if (dsDayEl && ds.streak) dsDayEl.textContent = ds.streak;
  const dsBestEl = document.getElementById('profBestStreak');
  // bestStreak in profile shows session streak (existing), leave that
  // also update XP on dashboard
  updateDashXP();
};

// ─────────────────────────────────────────────
// INIT: update XP pill and setup screen on load
// ─────────────────────────────────────────────
(function initRetentionSystems() {
  updateXPPill();
  function refreshDailyChallengeCard() {
    updateSetupMotivation();
    // Set initial visibility based on whatever screen is active at load
    const activeScreen = document.querySelector('.screen.active');
    if (activeScreen) updateDailyChallengeVisibility(activeScreen.id);
    else updateDailyChallengeVisibility('s-setup'); // default
  }
  // Defer setup screen update slightly (after init routing runs)
  setTimeout(refreshDailyChallengeCard, 120);
  document.addEventListener('DOMContentLoaded', refreshDailyChallengeCard);
  window.addEventListener('load', refreshDailyChallengeCard);
})();
