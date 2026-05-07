// ── CUSTOM COLOUR THEME ──
const COLOR_THEME_KEY   = 'quiz_custom_colors';
const COLOR_ENABLED_KEY = 'quiz_custom_colors_on';
const BASE_THEME_KEY    = 'quiz_base_theme';
const CC_VARS = [
  '--p0','--p1','--p2','--p3','--p4','--p5','--p6','--p7',
  '--acc','--acc-hi','--acc-lo','--acc-vlo','--acc-2','--acc-2-hi','--acc-2-lo','--btn-txt',
  '--bg','--app-bg','--surf','--surf-d','--inp','--hov','--bar-bg',
  '--ok','--ok-text','--ok-bg','--ok-fb','--ok-bd','--err','--err-bg','--no-bd',
  '--text-primary','--text-secondary','--text-muted','--border','--border-strong',
  '--surface-glass','--surface-raised','--surface-soft','--app-gradient','--header-gradient',
  '--shadow-app','--shadow-card','--focus-ring'
];

function hexToHSL(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0,2),16)/255, g = parseInt(hex.slice(2,4),16)/255, b = parseInt(hex.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getLuminance(hex) {
  const ch = hex.replace(/^#/, '');
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(ch.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrastRatio(fgHex, bgHex) {
  const fg = getLuminance(fgHex);
  const bg = getLuminance(bgHex);
  const light = Math.max(fg, bg);
  const dark = Math.min(fg, bg);
  return (light + 0.05) / (dark + 0.05);
}

function getReadableLightAccent(h, s, maxLightness) {
  const surface = '#fbfaf7';
  for (let l = maxLightness; l >= 18; l -= 1) {
    const candidate = hslToHex(h, s, l);
    if (getContrastRatio(candidate, surface) >= 4.5) return candidate;
  }
  return hslToHex(h, s, 18);
}

function getReadableOnAccent(colors) {
  const darkText = '#101114';
  const lightText = '#ffffff';
  const darkScore = Math.min(...colors.map(color => getContrastRatio(darkText, color)));
  const lightScore = Math.min(...colors.map(color => getContrastRatio(lightText, color)));
  return darkScore >= lightScore ? darkText : lightText;
}


function normalizeHex(hex, fallback) {
  if (typeof hex !== 'string') return fallback;
  let v = hex.trim();
  if (!v.startsWith('#')) v = '#' + v;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    v = '#' + v.slice(1).split('').map(c => c + c).join('');
  }
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

function getSavedBaseTheme() {
  try {
    const saved = localStorage.getItem(BASE_THEME_KEY);
    if (saved === 'vibrant' || saved === 'dark' || saved === 'light') return saved;
    localStorage.setItem(BASE_THEME_KEY, 'dark');
  } catch(e) {}
  return 'dark';
}

function buildAccentFamily(accentHex, baseTheme, hueShift = 0) {
  const safeHex = normalizeHex(accentHex, '#B8D45C');
  const [rawH, s0, l0] = hexToHSL(safeHex);
  const h = ((s0 < 8 ? 215 : rawH) + hueShift + 360) % 360;
  const s = baseTheme === 'light' ? clampN(s0 + 12, 54, 88) : clampN(s0, 38, 86);
  const l = baseTheme === 'light' ? clampN(l0 - 8, 28, 42) : clampN(l0, 52, 68);
  if (baseTheme === 'light') {
    const vividS = clampN(s0 + 8, 44, 92);
    const vividL = clampN(l0, 42, 76);
    const acc = hslToHex(h, vividS, vividL);
    const readable = getReadableLightAccent(h, s, clampN(vividL - 10, 28, 44));
    const [, , readableL] = hexToHSL(readable);
    return {
      acc,
      hi: hslToHex(h, clampN(vividS - 6, 34, 86), clampN(vividL + 10, 50, 84)),
      lo: readable,
      vlo: hslToHex(h, clampN(s + 2, 36, 86), clampN(readableL - 12, 14, 30)),
    };
  }
  const acc = hslToHex(h, s, l);
  return {
    acc,
    hi: hslToHex(h, clampN(s - 4, 30, 82), baseTheme === 'light' ? clampN(l + 10, 44, 62) : clampN(l + 8, 58, 76)),
    lo: hslToHex(h, clampN(s + 4, 42, 90), baseTheme === 'light' ? clampN(l - 12, 24, 42) : clampN(l - 14, 36, 54)),
    vlo: hslToHex(h, clampN(s + 2, 36, 86), baseTheme === 'light' ? clampN(l - 20, 18, 34) : clampN(l - 24, 24, 42)),
  };
}


function buildVibrantCustomPalette(accentHex, baseHex) {
  const [aH, aS0, aL0] = hexToHSL(accentHex);
  const [bH, bS0, bL0] = hexToHSL(baseHex);

  const baseLightnesses = [4, 9, 14, 19, 35, 42, 46, 69];
  const accentLightnesses = [32, 43, 60, 64];
  const baseSaturations = [100, 92, 72, 79, 44, 43, 42, 9];
  const accentSaturations = [54, 54, 58, 58];
  const origBaseS = 79;
  const origAccS = 58;
  const aS = clampN(aS0, 30, 100);
  const bS = clampN(bS0, 20, 100);
  const baseScaleFactor = bS / origBaseS;
  const accentScaleFactor = aS / origAccS;

  const baseShades = baseLightnesses.map((l, i) => {
    const s = baseSaturations[i] * baseScaleFactor;
    return hslToHex(bH, clampN(Math.round(s), 5, 100), l);
  });
  const [p0, p1, p2, p3, p4, p5, p6, p7] = baseShades;
  const accentShades = accentLightnesses.map((l, i) => {
    const s = accentSaturations[i] * accentScaleFactor;
    return hslToHex(aH, clampN(Math.round(s), 20, 100), l);
  });
  const [accVlo, accLo, acc, accHi] = accentShades;
  const okBg = hslToHex(aH, clampN(Math.round(aS * 0.70), 15, 60), 6);
  const okFb = hslToHex(aH, clampN(Math.round(aS * 0.55), 12, 50), 3);
  const btnTxt = getLuminance(acc) > 0.22 ? '#0d0015' : '#eff8e2';

  // Derive --acc-2 from the base hue at a mid-lightness so it reads as a
  // visible secondary colour against the dark p-shade backgrounds.
  const baseAccS = clampN(Math.round(bS * 0.65), 28, 88);
  const acc2    = hslToHex(bH, baseAccS, clampN(bL0 + 28, 44, 68));
  const acc2Hi  = hslToHex(bH, clampN(baseAccS - 6, 22, 80), clampN(bL0 + 38, 54, 76));
  const acc2Lo  = hslToHex(bH, clampN(baseAccS + 2, 30, 90), clampN(bL0 + 10, 30, 52));

  return {
    '--p0': p0, '--p1': p1, '--p2': p2, '--p3': p3,
    '--p4': p4, '--p5': p5, '--p6': p6, '--p7': p7,
    '--acc': acc, '--acc-hi': accHi, '--acc-lo': accLo, '--acc-vlo': accVlo,
    '--acc-2': acc2, '--acc-2-hi': acc2Hi, '--acc-2-lo': acc2Lo, '--btn-txt': btnTxt,
    '--bg': p0, '--app-bg': p1, '--surf': p4, '--surf-d': p3,
    '--inp': p2, '--hov': p5, '--bar-bg': p2,
    '--ok-bg': okBg, '--ok-fb': okFb, '--ok-bd': okFb, '--no-bd': p3,
  };
}

function buildNeutralPalette(baseTheme, accentHex, secondaryHex) {
  const accent = buildAccentFamily(accentHex, baseTheme);
  const secondary = buildAccentFamily(accentHex, baseTheme, baseTheme === 'light' ? 24 : -24);
  const dark = baseTheme !== 'light';
  const base = dark
    ? {
        p: ['#101114','#17191d','#202329','#2a2e34','#343941','#424851','#565d66','#a8adb4'],
        text: '#f3f1eb', sub: '#b7b3aa', muted: '#86827a',
        border: 'rgba(255,255,255,0.10)', borderStrong: 'rgba(255,255,255,0.18)',
        ok: '#46b86a', okText: '#eaffef', okBg: '#12281a', okFb: '#0d2114', okBd: '#2f7d46',
        err: '#e06161', errBg: 'rgba(224,97,97,0.14)',
        shadowApp: '0 26px 70px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.06)',
        shadowCard: '0 12px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.05)',
      }
    : {
        p: ['#ece9e1','#f1eee7','#f6f4ee','#fbfaf7','#fbfaf7','#f6f4ee','#d7d1c5','#504b43'],
        text: '#171817', sub: '#44433f', muted: '#69645b',
        border: 'rgba(48,45,39,0.08)', borderStrong: 'rgba(48,45,39,0.16)',
        ok: '#287d47', okText: '#12371f', okBg: '#e2f2e7', okFb: '#d7eadf', okBd: '#78b88c',
        err: '#bd4545', errBg: 'rgba(189,69,69,0.12)',
        shadowApp: '0 1px 2px rgba(48,45,39,0.07), 0 8px 20px rgba(48,45,39,0.10), inset 0 1px 0 rgba(255,255,255,0.82)',
        shadowCard: '0 1px 1px rgba(48,45,39,0.06), 0 5px 12px rgba(48,45,39,0.10), inset 0 1px 0 rgba(255,255,255,0.86)',
      };
  const [p0,p1,p2,p3,p4,p5,p6,p7] = base.p;
  const btnTxt = dark
    ? (getLuminance(accent.acc) > 0.38 ? '#101114' : '#ffffff')
    : getReadableOnAccent([accent.acc, accent.hi]);
  return {
    '--p0': p0, '--p1': p1, '--p2': p2, '--p3': p3,
    '--p4': p4, '--p5': p5, '--p6': p6, '--p7': p7,
    '--acc': accent.acc, '--acc-hi': accent.hi, '--acc-lo': accent.lo, '--acc-vlo': accent.vlo,
    '--acc-2': secondary.acc, '--acc-2-hi': secondary.hi, '--acc-2-lo': secondary.lo, '--btn-txt': btnTxt,
    '--bg': p0, '--app-bg': p1,
    '--surface-raised': dark ? p4 : p2,
    '--surf': dark ? p4 : p2,
    '--surf-d': dark ? p3 : p1,
    '--inp': dark ? p2 : p2,
    '--hov': dark ? p5 : p3,
    '--bar-bg': dark ? p2 : p1,
    ...(dark ? {} : {
      '--surface-page': p0,
      '--surface-section': p1,
      '--surface-raised': p2,
      '--surface-selected': p3,
    }),
    '--ok': base.ok, '--ok-text': base.okText, '--ok-bg': base.okBg, '--ok-fb': base.okFb, '--ok-bd': base.okBd,
    '--err': base.err, '--err-bg': base.errBg, '--no-bd': base.err,
    '--text-primary': base.text, '--text-secondary': base.sub, '--text-muted': base.muted,
    '--border': base.border, '--border-strong': base.borderStrong,
    '--surface-glass': dark ? 'color-mix(in srgb, var(--surf), transparent 8%)' : 'var(--surface-raised)',
    '--surface-soft': dark ? p2 : p1,
    ...(dark ? {} : {
      '--shadow-small': '0 1px 1px rgba(48,45,39,0.05), 0 4px 10px rgba(48,45,39,0.08), inset 0 1px 0 rgba(255,255,255,0.82)',
      '--shadow-hover': '0 1px 2px rgba(48,45,39,0.07), 0 8px 16px rgba(48,45,39,0.12), inset 0 1px 0 rgba(255,255,255,0.9)',
      '--shadow-inset': 'inset 0 2px 4px rgba(48,45,39,0.11), inset 0 -1px 0 rgba(255,255,255,0.70)',
    }),
    '--app-gradient': dark
      ? 'linear-gradient(160deg, color-mix(in srgb, var(--p4), transparent 90%) 0%, color-mix(in srgb, var(--p0), transparent 55%) 100%)'
      : 'linear-gradient(160deg, #fbfaf6 0%, #eeeae1 100%)',
    '--header-gradient': dark
      ? 'linear-gradient(145deg, color-mix(in srgb, var(--p5), transparent 72%) 0%, color-mix(in srgb, var(--p2), transparent 22%) 100%)'
      : 'linear-gradient(145deg, #fbfaf6 0%, #e8e2d6 100%)',
    '--shadow-app': base.shadowApp,
    '--shadow-card': base.shadowCard,
    '--focus-ring': `0 0 0 3px color-mix(in srgb, ${accent.acc}, transparent ${dark ? '76%' : '66%'})`,
  };
}

function applyPaletteVars(palette) {
  const html = document.documentElement;
  Object.entries(palette).forEach(([k, v]) => html.style.setProperty(k, v));
  if (typeof refreshTimedSliderVisual === 'function') requestAnimationFrame(refreshTimedSliderVisual);
}

let _themeUIRefreshFrame = null;
function refreshThemeDependentUI() {
  if (_themeUIRefreshFrame) cancelAnimationFrame(_themeUIRefreshFrame);
  _themeUIRefreshFrame = requestAnimationFrame(() => {
    _themeUIRefreshFrame = null;
    const html = document.documentElement;
    window.updateAuthUI?.();
    window.updateSyncNotice?.();
    if (typeof showProfile === 'function' && document.getElementById('s-profile')?.classList.contains('active')) {
      showProfile();
    }
    html.classList.add('theme-ui-refreshing');
    void html.offsetHeight;
    requestAnimationFrame(() => html.classList.remove('theme-ui-refreshing'));
  });
}

function getCurrentColorPicks() {
  return {
    accent: normalizeHex(document.getElementById('colorPickAccent')?.value, '#B8D45C'),
    base: normalizeHex(document.getElementById('colorPickBase')?.value, '#3d0a57'),
  };
}

function applyBaseThemeTokens() {
  const html = document.documentElement;
  const baseTheme = getSavedBaseTheme();
  const { accent, base } = getCurrentColorPicks();
  const customOn = (() => { try { return localStorage.getItem(COLOR_ENABLED_KEY) === '1'; } catch(e) { return false; } })();
  if (baseTheme === 'vibrant') {
    html.removeAttribute('data-base-theme');
    if (!customOn) {
      CC_VARS.forEach(k => html.style.removeProperty(k));
    }
    return;
  }
  html.setAttribute('data-base-theme', baseTheme);
  const palette = buildNeutralPalette(baseTheme, customOn ? accent : '#B8D45C', customOn ? base : '#8fb7ff');
  applyPaletteVars(palette);
  if (html.getAttribute('data-theme') === 'minimal') {
    html.style.setProperty('--surf',   palette['--p2']);
    html.style.setProperty('--surf-d', palette['--p1']);
    html.style.setProperty('--hov',    palette['--p3']);
    html.style.setProperty('--bar-bg', palette['--p2']);
  }
}

function generateCustomPalette(accentHex, baseHex) {
  const baseTheme = getSavedBaseTheme();
  if (baseTheme === 'vibrant') return buildVibrantCustomPalette(accentHex, baseHex);
  return buildNeutralPalette(baseTheme, accentHex, baseHex);
}

function applyPreset(btn) {
  const ap = document.getElementById('colorPickAccent');
  const bp = document.getElementById('colorPickBase');
  if (ap) ap.value = btn.dataset.accent;
  if (bp) bp.value = btn.dataset.base;
  syncColorSwatches();
  applyCustomColors();
}

function syncColorSwatches() {
  const acc  = document.getElementById('colorPickAccent')?.value;
  const base = document.getElementById('colorPickBase')?.value;
  const aBtn = document.getElementById('accentBtnSwatch');
  const bBtn = document.getElementById('baseBtnSwatch');
  if (aBtn && acc)  aBtn.style.background = acc;
  if (bBtn && base) bBtn.style.background = base;
  syncAnalogousAccentSwatch();
  document.querySelectorAll('.preset-card').forEach(btn => {
    const match = btn.dataset.accent?.toLowerCase() === acc?.toLowerCase()
               && btn.dataset.base?.toLowerCase()   === base?.toLowerCase();
    btn.classList.toggle('active', match);
  });
}

function getAnalogousAccentHex(accentHex, baseTheme) {
  if (baseTheme === 'vibrant') return normalizeHex(document.getElementById('colorPickBase')?.value, '#3d0a57');
  return buildAccentFamily(accentHex, baseTheme, baseTheme === 'light' ? 24 : -24).acc;
}

function syncBaseColorLabel() {
  const baseTheme = getSavedBaseTheme();
  const lbl = document.getElementById('baseColorPickerLbl');
  if (lbl) lbl.textContent = baseTheme === 'vibrant' ? 'Base Color' : 'Accent 2';
}

function syncAnalogousAccentSwatch() {
  syncBaseColorLabel();
  const baseTheme = getSavedBaseTheme();
  if (baseTheme === 'vibrant') return;
  const acc = normalizeHex(document.getElementById('colorPickAccent')?.value, '#B8D45C');
  const analog = getAnalogousAccentHex(acc, baseTheme);
  const bBtn = document.getElementById('baseBtnSwatch');
  if (bBtn) bBtn.style.background = analog;
}

// ── Custom Colour Picker (in-app, no native OS picker) ───────────────────
let _cpTarget = 'accent';
let _cpH = 80, _cpS = 100, _cpV = 85; // current HSV (H: 0-360, S/V: 0-100)

function hexToHSV(hex) {
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  const r=parseInt(hex.slice(0,2),16)/255, g=parseInt(hex.slice(2,4),16)/255, b=parseInt(hex.slice(4,6),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  const v=max, s=max===0?0:d/max;
  let h=0;
  if(d!==0){
    switch(max){
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return [h*360, s*100, v*100];
}

function hsvToHex(h,s,v){
  s/=100; v/=100;
  const i=Math.floor(h/60), f=h/60-i;
  const p=v*(1-s), q=v*(1-f*s), t=v*(1-(1-f)*s);
  let r,g,b;
  switch(i%6){
    case 0:r=v;g=t;b=p;break; case 1:r=q;g=v;b=p;break;
    case 2:r=p;g=v;b=t;break; case 3:r=p;g=q;b=v;break;
    case 4:r=t;g=p;b=v;break; case 5:r=v;g=p;b=q;break;
  }
  return '#'+[r,g,b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
}

function drawCPCanvas() {
  const canvas = document.getElementById('cpCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  // Pure hue fill
  ctx.fillStyle = `hsl(${_cpH},100%,50%)`;
  ctx.fillRect(0,0,w,h);
  // White saturation overlay (left=white, right=hue)
  const sg = ctx.createLinearGradient(0,0,w,0);
  sg.addColorStop(0,'rgba(255,255,255,1)');
  sg.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = sg; ctx.fillRect(0,0,w,h);
  // Black value overlay (top=bright, bottom=black)
  const vg = ctx.createLinearGradient(0,0,0,h);
  vg.addColorStop(0,'rgba(0,0,0,0)');
  vg.addColorStop(1,'rgba(0,0,0,1)');
  ctx.fillStyle = vg; ctx.fillRect(0,0,w,h);
  // Cursor circle
  const cx = (_cpS/100)*w, cy = (1-_cpV/100)*h;
  ctx.beginPath(); ctx.arc(cx,cy,9,0,Math.PI*2);
  ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=3; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,9,0,Math.PI*2);
  ctx.strokeStyle='rgba(255,255,255,0.95)'; ctx.lineWidth=2; ctx.stroke();
}

function updateHueThumb() {
  const thumb = document.getElementById('cpHueThumb');
  if (!thumb) return;
  const pct = _cpH/360;
  thumb.style.left = `calc(${pct*100}% - 10px)`;
  thumb.style.background = `hsl(${_cpH},100%,50%)`;
}

function updateCPLive() {
  let hex = hsvToHex(_cpH, _cpS, _cpV);
  const baseTheme = getSavedBaseTheme();
  if (_cpTarget !== 'accent' && baseTheme !== 'vibrant') {
    hex = getAnalogousAccentHex(document.getElementById('colorPickAccent')?.value || '#B8D45C', baseTheme);
  }
  const prev = document.getElementById('cpPreviewSwatch');
  if (prev) prev.style.background = hex;
  const hexInp = document.getElementById('cpHexInput');
  if (hexInp && document.activeElement !== hexInp)
    hexInp.value = hex.replace('#','').toUpperCase();
  const inputId = _cpTarget === 'accent' ? 'colorPickAccent' : 'colorPickBase';
  const inp = document.getElementById(inputId);
  if (inp) inp.value = hex;
  syncColorSwatches();
  applyCustomColors();
}

// Shared trigger reference so resize can re-position
let _cpTriggerEl = null;

function positionCPPanel() {
  const panel = document.getElementById('cpPanel');
  if (!panel || !_cpTriggerEl) return;
  const tRect = _cpTriggerEl.getBoundingClientRect();
  const vw = window.innerWidth;
  // Use visualViewport height if available (accounts for iOS keyboard)
  const vh = (window.visualViewport?.height) || window.innerHeight;
  const panelW = Math.min(284, vw - 16);
  let left = tRect.left + tRect.width / 2 - panelW / 2;
  left = Math.max(8, Math.min(vw - panelW - 8, left));
  // Clamp arrow position within the panel
  const arrowX = Math.max(20, Math.min(panelW - 20,
    (tRect.left + tRect.width / 2) - left
  ));
  panel.style.setProperty('--arrow-left', arrowX + 'px');
  panel.style.width = panelW + 'px';
  panel.style.left  = left + 'px';
  // Decide: place above or below trigger
  const panelH = panel.offsetHeight || 290;
  const spaceAbove = tRect.top - 16;
  const spaceBelow = vh - tRect.bottom - 16;
  if (spaceAbove >= panelH || spaceAbove >= spaceBelow) {
    panel.style.bottom = (vh - tRect.top + 12) + 'px';
    panel.style.top    = '';
    panel.dataset.arrow = 'down';
  } else {
    panel.style.top    = (tRect.bottom + 12) + 'px';
    panel.style.bottom = '';
    panel.dataset.arrow = 'up';
  }
}

function openCustomPicker(target, triggerEl) {
  _cpTarget = target;
  _cpTriggerEl = triggerEl || null;
  const hex = (_cpTarget === 'accent'
    ? document.getElementById('colorPickAccent')?.value
    : document.getElementById('colorPickBase')?.value) || '#B8D45C';
  const [h,s,v] = hexToHSV(hex);
  _cpH=h; _cpS=s; _cpV=v;
  const _isVibrant = getSavedBaseTheme() === 'vibrant';
  document.getElementById('cpTitle').textContent =
    target === 'accent' ? 'Accent Color' : (_isVibrant ? 'Base Color' : 'Accent 2 Color');
  const hexInp = document.getElementById('cpHexInput');
  if (hexInp) hexInp.value = hex.replace('#','').toUpperCase();
  updateHueThumb();
  const modal = document.getElementById('customPickerModal');
  modal.classList.remove('closing');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  // Scroll the trigger into view if it's obscured, then position
  if (triggerEl) triggerEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  requestAnimationFrame(() => {
    positionCPPanel();
    drawCPCanvas();
    updateCPLive();
  });
}

function closeCustomPicker() {
  const modal = document.getElementById('customPickerModal');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'true');
  if (!modal.classList.contains('open')) {
    modal.classList.remove('closing');
    return;
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    modal.classList.remove('open', 'closing');
    return;
  }
  modal.classList.add('closing');
  setTimeout(() => {
    modal.classList.remove('open', 'closing');
  }, 180);
}

// Pointer interaction helpers
function initCPInteractions() {
  function getPointer(e) {
    // Works for mouse, touchstart, touchmove, and touchend
    const t = e.touches?.[0] ?? e.changedTouches?.[0];
    return t ? { x: t.clientX, y: t.clientY } : { x: e.clientX, y: e.clientY };
  }

  function addDragListeners(el, onMove) {
    if (!el) return;
    let active = false;
    const start = e => {
      active = true;
      onMove(e);
      e.preventDefault();
      e.stopPropagation(); // don't let drag-start close the popover
    };
    const move = e => {
      if (!active) return;
      onMove(e);
      e.preventDefault();
    };
    const stop = () => { active = false; };
    el.addEventListener('mousedown',  start);
    el.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup',   stop);
    window.addEventListener('touchend',  stop);
  }

  // 2-D saturation/value canvas
  const canvas = document.getElementById('cpCanvas');
  addDragListeners(canvas, e => {
    const rect = canvas.getBoundingClientRect();
    const { x, y } = getPointer(e);
    _cpS = Math.max(0, Math.min(100, (x - rect.left) / rect.width  * 100));
    _cpV = Math.max(0, Math.min(100, (1 - (y - rect.top) / rect.height) * 100));
    drawCPCanvas();
    updateCPLive();
  });

  // Hue rainbow slider
  const hueTrack = document.getElementById('cpHueTrack');
  addDragListeners(hueTrack, e => {
    const rect = hueTrack.getBoundingClientRect();
    const { x } = getPointer(e);
    _cpH = Math.max(0, Math.min(360, (x - rect.left) / rect.width * 360));
    updateHueThumb();
    drawCPCanvas();
    updateCPLive();
  });

  // Hex input
  const hexInp = document.getElementById('cpHexInput');
  if (hexInp) {
    hexInp.addEventListener('input', () => {
      const raw = hexInp.value.replace(/[^0-9a-fA-F]/g, '');
      if (raw.length === 6) {
        const [h, s, v] = hexToHSV('#' + raw);
        _cpH = h; _cpS = s; _cpV = v;
        updateHueThumb();
        drawCPCanvas();
        updateCPLive();
      }
    });
    hexInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { hexInp.blur(); closeCustomPicker(); }
    });
  }

  // Transparent overlay: click-away closes popover
  const overlay = document.getElementById('cpOverlay');
  if (overlay) overlay.addEventListener('click', closeCustomPicker);
  document.addEventListener('click', e => {
    const modal = document.getElementById('customPickerModal');
    if (!modal?.classList.contains('open')) return;
    const panel = document.getElementById('cpPanel');
    if (panel && !panel.contains(e.target)) closeCustomPicker();
  }, true);

  // Re-position on viewport resize / iOS keyboard open-close
  const reposition = () => {
    const modal = document.getElementById('customPickerModal');
    if (modal?.classList.contains('open')) positionCPPanel();
  };
  window.addEventListener('resize', reposition);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', reposition);
    window.visualViewport.addEventListener('scroll', reposition);
  }
}
document.addEventListener('DOMContentLoaded', initCPInteractions);

function applyCustomColors() {
  const accentHex = document.getElementById('colorPickAccent')?.value;
  const baseHex   = document.getElementById('colorPickBase')?.value;
  if (!accentHex || !baseHex) return;
  syncColorSwatches();
  const palette = generateCustomPalette(accentHex, baseHex);
  const html = document.documentElement;
  applyPaletteVars(palette);
  if (html.getAttribute('data-theme') === 'minimal') {
    html.style.setProperty('--surf',   palette['--p2']);
    html.style.setProperty('--surf-d', palette['--p1']);
    html.style.setProperty('--hov',    palette['--p3']);
    html.style.setProperty('--bar-bg', palette['--p2']);
  }
  html.setAttribute('data-custom-color', 'active');
  localStorage.setItem(COLOR_THEME_KEY, JSON.stringify({ accent: accentHex, base: baseHex }));
  window.syncUserSettingsToSupabase?.();
  syncAnalogousAccentSwatch();
  refreshThemeDependentUI();
}

function clearCustomColors() {
  const html = document.documentElement;
  CC_VARS.forEach(k => html.style.removeProperty(k));
  html.removeAttribute('data-custom-color');
  applyBaseThemeTokens();
  refreshThemeDependentUI();
}

function setCustomColorEnabled(enabled) {
  const tog   = document.getElementById('customColorTog');
  const panel = document.getElementById('colorPickerPanel');
  if (tog)   tog.checked          = enabled;
  if (panel) panel.style.display  = enabled ? '' : 'none';
  localStorage.setItem(COLOR_ENABLED_KEY, enabled ? '1' : '0');
  window.syncUserSettingsToSupabase?.();
  if (enabled) {
    applyCustomColors();
  } else {
    clearCustomColors();
  }
}

function loadSavedCustomColorInputs() {
  // Restore saved colour picks into the pickers
  const savedColors = localStorage.getItem(COLOR_THEME_KEY);
  if (savedColors) {
    try {
      const { accent, base } = JSON.parse(savedColors);
      const ap = document.getElementById('colorPickAccent');
      const bp = document.getElementById('colorPickBase');
      if (ap && accent) ap.value = accent;
      if (bp && base)   bp.value = base;
    } catch(e) { localStorage.removeItem(COLOR_THEME_KEY); }
  }
}

function initCustomColors() {
  loadSavedCustomColorInputs();
  syncColorSwatches(); // also marks matching preset as active
  syncBaseColorLabel(); // set correct label for current base theme
  // Restore enabled/disabled state (persists across refreshes)
  if (localStorage.getItem(COLOR_ENABLED_KEY) === '1') {
    setCustomColorEnabled(true);
  }
}

// THEME SYSTEM
const THEME_KEY = 'quiz_theme';

function initTheme() {
  const baseTheme = getSavedBaseTheme();
  const saved = localStorage.getItem(THEME_KEY) || 'default';
  applyBaseTheme(baseTheme, false);
  applyTheme(saved, false);
}

function setBaseTheme(baseTheme) {
  const next = baseTheme === 'light' ? 'light' : (baseTheme === 'dark' ? 'dark' : 'vibrant');
  localStorage.setItem(BASE_THEME_KEY, next);
  window.syncUserSettingsToSupabase?.();
  applyBaseTheme(next, true);
}

function applyBaseTheme(baseTheme, animate) {
  const html = document.documentElement;
  const next = baseTheme === 'light' ? 'light' : (baseTheme === 'dark' ? 'dark' : 'vibrant');
  html.setAttribute('data-base-theme', next);
  applyBaseThemeTokens();
  if (localStorage.getItem(COLOR_ENABLED_KEY) === '1') {
    applyCustomColors();
  }
  const btnVibrant = document.getElementById('baseThemeOptVibrant');
  const btnDark = document.getElementById('baseThemeOptDark');
  const btnLight = document.getElementById('baseThemeOptLight');
  if (btnVibrant && btnDark && btnLight) {
    btnVibrant.classList.toggle('active', next === 'vibrant');
    btnDark.classList.toggle('active', next === 'dark');
    btnLight.classList.toggle('active', next === 'light');
  }
  syncAnalogousAccentSwatch();
  refreshThemeDependentUI();
}

function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  window.syncUserSettingsToSupabase?.();
  applyTheme(theme, true);
}

function applyTheme(theme, animate) {
  const html = document.documentElement;
  if (theme === 'minimal') {
    html.setAttribute('data-theme', 'minimal');
  } else {
    html.removeAttribute('data-theme');
    theme = 'default';
  }
  applyBaseThemeTokens();
  if (localStorage.getItem(COLOR_ENABLED_KEY) === '1') {
    applyCustomColors();
  }
  const btnDefault = document.getElementById('themeOptDefault');
  const btnMinimal = document.getElementById('themeOptMinimal');
  if (btnDefault && btnMinimal) {
    btnDefault.classList.toggle('active', theme === 'default');
    btnMinimal.classList.toggle('active', theme === 'minimal');
  }
  refreshThemeDependentUI();
}


// ═══════════════════════════════════════════════
//  NEW FEATURES JS
// ═══════════════════════════════════════════════

// ── STORAGE KEYS ──
const SESSION_SUMMARY_KEY = 'quiz_last_session_summary';
const WEEKLY_XP_KEY       = 'quiz_weekly_xp';

// ─────────────────────────────────────────────
// 1. LEVEL-UP MODAL
// ─────────────────────────────────────────────
let _prevLevel = null;

function checkLevelUp(newLevel) {
  if (_prevLevel !== null && newLevel > _prevLevel) {
    showLevelUpModal(newLevel);
  }
  _prevLevel = newLevel;
}

function showLevelUpModal(level) {
  const emojis = ['⭐','🌟','💫','🔥','💎','👑','🏆','🦅','🌙','🎯'];
  const emoji  = emojis[Math.min(Math.floor((level-1)/5), emojis.length-1)];
  document.getElementById('levelUpGlow').textContent  = emoji;
  document.getElementById('levelUpNum').textContent   = 'Level ' + level;
  document.getElementById('levelUpTitle').textContent = levelTitle(level);

  // Unique story line for each title transition
  const storyEl = document.getElementById('levelUpStory');
  const prevTitle = levelTitle(level - 1);
  const newTitle  = levelTitle(level);
  const TRANSITION_LINES = {
    'Beginner→Apprentice':     "The journey begins in earnest.",
    'Apprentice→Student':      "Curiosity becomes discipline.",
    'Student→Practitioner':    "You stopped guessing. You started knowing.",
    'Practitioner→Skilled':    "The numbers bend to your will.",
    'Skilled→Advanced':        "Few make it here.",
    'Advanced→Expert':         "Most stop before this point.",
    'Expert→Master':           "This is where legends are made.",
    'Master→Grandmaster':      "Beyond mastery, there is this.",
    'Grandmaster→Legend':      "There is no higher.",
  };
  if (storyEl) {
    if (level > 1 && prevTitle !== newTitle) {
      const line = TRANSITION_LINES[`${prevTitle}→${newTitle}`] || '';
      storyEl.innerHTML = line
        ? `<span class="to-title">${line}</span>`
        : `<span class="from-title">${prevTitle}</span> becomes <span class="to-title">${newTitle}</span>`;
      storyEl.style.display = '';
    } else {
      storyEl.style.display = 'none';
    }
  }

  const xpD    = getXPData();
  const xpIn   = xpD.totalXP - xpForLevel(level);
  const xpNeed = xpForCurrentLevel(level);
  document.getElementById('levelUpSub').textContent =
    level >= 50
      ? "You've reached the pinnacle \u2014 Legend!"
      : `${xpIn} / ${xpNeed} XP to Level ${level + 1}`;

  const modal = document.getElementById('levelUpModal');
  modal.classList.add('show');
  launchConfetti();

  // Burst particles from card centre
  const container = document.getElementById('levelUpParticles');
  if (container) {
    container.innerHTML = '';
    const count = 18;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'lup-particle';
      const angle = (i / count) * 360;
      const dist  = 60 + Math.random() * 80;
      const rad   = angle * Math.PI / 180;
      p.style.setProperty('--tx', Math.cos(rad) * dist + 'px');
      p.style.setProperty('--ty', Math.sin(rad) * dist + 'px');
      p.style.left = '50%'; p.style.top = '40%';
      p.style.animationDelay = (Math.random() * 0.15) + 's';
      p.style.animationDuration = (0.9 + Math.random() * 0.5) + 's';
      p.style.width = p.style.height = (2 + Math.random() * 3) + 'px';
      container.appendChild(p);
    }
  }

  // Animate bar after paint
  setTimeout(() => {
    const pct = level >= 50 ? 100 : Math.min(100, Math.round(xpIn / xpNeed * 100));
    document.getElementById('levelUpBar').style.width = pct + '%';
  }, 120);
}

function dismissLevelUp() {
  const modal = document.getElementById('levelUpModal');
  modal.classList.remove('show');
}

// Patch addXP to detect level-up
// _pendingLevelUp stores {level, oldTitle} if a level-up just occurred.
let _pendingLevelUp = null;
const _origAddXP = addXP;
addXP = function(bonus) {
  if (isPracticeMode()) return { gain: 0, totalXP: getXPData().totalXP, level: getXPData().currentLevel };
  const before = getXPData().currentLevel;
  const oldTitle = levelTitle(before);
  const result = _origAddXP(bonus);
  const after  = getXPData().currentLevel;
  if (after > before) {
    // Store for results toast and dashboard modal
    if (_pendingLevelUp === null) {
      _pendingLevelUp = { level: after, oldTitle };
    } else {
      _pendingLevelUp.level = after; // update to latest level
    }
  }
  _prevLevel = after;
  return result;
};

// Init prevLevel on load
(function() { _prevLevel = getXPData().currentLevel; })();

// ─────────────────────────────────────────────
// 2. VISIBLE XP MULTIPLIER ON FLOAT
// ─────────────────────────────────────────────
// Override showXPFloat to show multiplier badge when bonus
const _origShowXPFloat = showXPFloat;
showXPFloat = function(gain, isBonus) {
  if (typeof instant !== 'undefined' && !instant) return;
  const ref = document.getElementById('ansInput') || document.getElementById('checkBtn');
  if (!ref) return;
  const rect = ref.getBoundingClientRect();
  const float = document.createElement('div');
  float.className = 'xp-float';
  const _xpAcc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#B8D45C';
  float.style.color = gain > 0 ? _xpAcc : '#ff6b6b';
  float.style.textShadow = gain > 0 ? `0 0 10px ${_xpAcc}99` : '0 0 10px rgba(255,107,107,0.5)';
  float.style.left = (rect.left + rect.width / 2 - 24) + 'px';
  float.style.top  = (rect.top + window.scrollY - 8) + 'px';
  let text = (gain > 0 ? '+' : '') + gain + ' XP';
  if (isBonus) text += '<span class="xp-mult-badge">🔥×1.5</span>';
  float.innerHTML = text;
  document.body.appendChild(float);
  setTimeout(() => float.remove(), 950);
};

// Override onCorrectAnswer to pass bonus flag to showXPFloat
const _origOnCorrectAnswer = onCorrectAnswer;
onCorrectAnswer = function(sessionStreak) {
  if (isPracticeMode()) return;
  const bonus = sessionStreak >= 3;
  const xpResult = addXP(bonus);
  showXPFloat(xpResult.gain, bonus);
  updateXPPill();
};

// ─────────────────────────────────────────────
// 3. SESSION SUMMARY CARD
// ─────────────────────────────────────────────
function saveSessionSummary(pct, correct, total, xpGained, bestStreak) {
  try {
    localStorage.setItem(SESSION_SUMMARY_KEY, JSON.stringify({
      pct, correct, total, xpGained, bestStreak, ts: Date.now()
    }));
  } catch(e) {}
}

function getSessionSummary() {
  try { return JSON.parse(localStorage.getItem(SESSION_SUMMARY_KEY)) || null; }
  catch(e) { return null; }
}

function dismissSessionSummary() {
  const card = document.getElementById('sessionSummaryCard');
  if (!card) return;
  card.classList.add('dismiss-right');
  try { localStorage.removeItem(SESSION_SUMMARY_KEY); } catch(e) {}
  window.setTimeout(() => {
    card.classList.remove('show', 'dismiss-right');
  }, 280);
}

function renderSessionSummaryCard() {
  const s = getSessionSummary();
  const card = document.getElementById('sessionSummaryCard');
  if (!s || !card) { card && card.classList.remove('show'); return; }
  // Only show if from last 4 hours
  if (Date.now() - s.ts > 4 * 3600 * 1000) { card.classList.remove('show'); return; }

  document.getElementById('sscScore').textContent  = s.pct + '%';
  document.getElementById('sscLabel').textContent  = `${s.correct} of ${s.total} correct`;
  document.getElementById('sscSub').textContent    = s.pct >= 80 ? '🎯 Great session!' : s.pct >= 60 ? '📈 Solid effort!' : '💪 Keep practicing!';
  document.getElementById('sscXP').textContent     = '+' + s.xpGained + ' XP';
  const streakEl = document.getElementById('sscStreak');
  if (s.bestStreak >= 3) {
    streakEl.textContent = '🔥 ' + s.bestStreak + ' streak';
    streakEl.style.display = '';
  } else {
    streakEl.style.display = 'none';
  }
  card.classList.remove('dismiss-right');
  card.classList.add('show');
}

// Track XP gained during session
let _sessionStartXP = 0;
let _dashboardPulsePending = false;
function onSessionStartHook() { _sessionStartXP = getXPData().totalXP; }

// Hook into startTest to record start XP
const _origStartTest = startTest;
startTest = function() {
  onSessionStartHook();
  _origStartTest();
};

// Hook into onSessionComplete to save summary
const _origOnSessionComplete = onSessionComplete;
onSessionComplete = function(pct, sessionBestStreak, score, total) {
  _origOnSessionComplete(pct, sessionBestStreak, score, total);
  const xpGained = Math.max(0, getXPData().totalXP - _sessionStartXP);
  saveSessionSummary(pct, score, total, xpGained, sessionBestStreak);
  _dashboardPulsePending = true;
};

function pulseDashboardStatsAfterSession() {
  if (!_dashboardPulsePending) return;
  _dashboardPulsePending = false;
  const ids = [
    'dashTodaySessions',
    'dashTodayAcc',
    'dashDayStreak',
    'dashXpLevel',
    'dashXpTitle',
    'dashXpSub',
    'dashXpBar',
    'goalDoneCount',
    'goalTargetCount',
    'dailyGoalFill',
    'wkQs',
    'wkAcc',
    'wkXP'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('dash-value-pulse');
    void el.offsetWidth;
    el.classList.add('dash-value-pulse');
    el.addEventListener('animationend', () => el.classList.remove('dash-value-pulse'), { once: true });
  });
}

// ─────────────────────────────────────────────
// 4. STREAK WARNING (comeback nudge)
// ─────────────────────────────────────────────
function renderStreakWarning() {
  const el = document.getElementById('streakWarning');
  if (!el) return;
  const history = getSessionHistory();
  const streak  = computeDayStreak(history);
  if (streak < 2) { el.classList.remove('show'); return; }

  const todayStr = new Date().toDateString();
  const playedToday = history.some(h => new Date(h.date).toDateString() === todayStr);
  if (playedToday) { el.classList.remove('show'); return; }

  // Check played yesterday
  const ystStr = new Date(Date.now() - 86400000).toDateString();
  const playedYesterday = history.some(h => new Date(h.date).toDateString() === ystStr);
  if (!playedYesterday) { el.classList.remove('show'); return; }

  // Streak is active but user hasn't played today
  document.getElementById('streakWarningTitle').textContent = `🔥 ${streak}-day streak at risk!`;
  document.getElementById('streakWarningSub').textContent   = "You haven't played today \u2014 don't break the chain!";
  el.classList.add('show');
}

// ─────────────────────────────────────────────
// 5. WEEKLY SUMMARY (shown on Mondays for prev week)
// ─────────────────────────────────────────────
function getWeeklyXP() {
  try { return JSON.parse(localStorage.getItem(WEEKLY_XP_KEY)) || {}; } catch(e) { return {}; }
}
function saveWeeklyXP(d) {
  try { localStorage.setItem(WEEKLY_XP_KEY, JSON.stringify(d)); } catch(e) {}
}

// Save XP snapshot per day for weekly tracking
function recordDailyXP() {
  const today = new Date().toISOString().slice(0,10);
  const d = getWeeklyXP();
  d[today] = getXPData().totalXP;
  // Keep only last 14 days
  const keys = Object.keys(d).sort();
  if (keys.length > 14) keys.slice(0, keys.length-14).forEach(k => delete d[k]);
  saveWeeklyXP(d);
}

function renderWeeklySparkline(history) {
  const wrap = document.getElementById('weeklySparkline');
  if (!wrap) return;
  const labels = ['Mo','Tu','We','Th','Fr','Sa','Su'];
  const today = new Date();
  const todayStr = today.toDateString();

  // Find Monday of current week
  const dayOfWeek = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0,0,0,0);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dStr = d.toDateString();
    const qs = history
      .filter(h => new Date(h.date).toDateString() === dStr)
      .reduce((s,h) => s + (h.total||0), 0);
    days.push({ label: labels[i], qs, isToday: dStr === todayStr, isFuture: d > today });
  }
  const maxQs = Math.max(...days.map(d=>d.qs), 1);
  const midQs = Math.max(0, Math.round(maxQs / 2));
  const dayMarkup = days.map(d => {
    const h = d.qs === 0 ? 3 : Math.max(8, Math.round((d.qs / maxQs) * 64));
    const dimmed = (d.qs === 0 || d.isFuture) ? ' style="opacity:0.18"' : '';
    return `<div class="sparkline-day">
      <div class="sparkline-bar${d.isToday?' today':''}" style="height:${h}px;"${dimmed} title="${d.qs} questions"></div>
      <div class="sparkline-label">${d.label}</div>
    </div>`;
  }).join('');
  wrap.innerHTML = `<div class="sparkline-y-axis" aria-hidden="true"><span>${maxQs}</span><span>${midQs}</span><span>0</span></div>
    <div class="sparkline-plot">
      <div class="sparkline-grid" aria-hidden="true"><span></span><span></span><span></span></div>
      ${dayMarkup}
    </div>`;
}

function toggleWeeklySummary() {
  const body    = document.getElementById('weeklySummaryBody');
  const chevron = document.getElementById('weeklyChevron');
  if (!body) return;
  const open = body.classList.toggle('open');
  if (chevron) chevron.classList.toggle('open', open);
}

function renderWeeklySummary() {
  const card = document.getElementById('weeklySummaryCard');
  if (!card) return;

  const today = new Date();
  const history = getSessionHistory();

  // Always render sparkline (shows current week activity)
  renderWeeklySparkline(history);

  // Compute current week's window (Mon–today)
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0,0,0,0);
  const weekEnd = new Date(today); weekEnd.setHours(23,59,59,999);

  const lastWeekSessions = history.filter(h => {
    const d = new Date(h.date);
    return d >= monday && d <= weekEnd;
  });

  if (lastWeekSessions.length) {
    const totalQs     = lastWeekSessions.reduce((s,h) => s+(h.total||0), 0);
    const totalCorrect= lastWeekSessions.reduce((s,h) => s+(h.correct||0), 0);
    const acc         = totalQs ? Math.round(totalCorrect/totalQs*100) : 0;
    const xpGained    = lastWeekSessions.reduce((s,h) => s+(h.xp||0), 0);
    document.getElementById('wkQs').textContent  = totalQs;
    document.getElementById('wkAcc').textContent = acc ? acc+'%' : '—';
    document.getElementById('wkXP').textContent  = xpGained ? xpGained : '0';
  } else {
    document.getElementById('wkQs').textContent  = '0';
    document.getElementById('wkAcc').textContent = '—';
    document.getElementById('wkXP').textContent  = '0';
  }

  // Always show the card
  card.classList.add('show');
}

// ─────────────────────────────────────────────
// 6. ANSWER HINT (costs XP)
// ─────────────────────────────────────────────
const HINT_XP_COST = 5;
let _hintUsedThisQ = false;

function useHint() {
  if (_hintUsedThisQ || answered) return;
  const q = qs[cur];
  if (!q) return;

  let hint = '';

  // ── Squares & Cubes: digit-prefix hint ──
  if (q.type === 'square' || q.type === 'cube') {
    const correctVal = q.reverse ? q.n : q.answer;
    const str = String(Math.abs(correctVal));
    if (q.reverse) {
      // Reverse mode: hint about the base
      if (q.type === 'square') hint = `Think: what number × itself = ${q.answer.toLocaleString()}?`;
      else hint = `Think: what number × itself × itself = ${q.answer.toLocaleString()}?`;
    } else {
      if (str.length <= 1) hint = 'Single digit answer';
      else if (str.length === 2) hint = `Starts with ${str[0]}…`;
      else hint = `Starts with ${str.slice(0,2)}…`;
    }

  // ── Multiplication Tables: Vedic method ──
  } else if (q.type === 'table') {
    const a = q.n, b = q.m;
    // Choose the most helpful Vedic technique
    if (b === 10) {
      hint = `×10 trick: just add a 0 → ${a}0`;
    } else if (b === 9) {
      hint = `×9 trick: ${a}×10 − ${a} = ${a*10} − ${a} = ${a*9}`;
    } else if (b === 11) {
      hint = `×11 trick: ${a}×10 + ${a} = ${a*10} + ${a} = ${a*11}`;
    } else if (b === 5) {
      hint = `×5 trick: halve ${a} and ×10 → ${a}÷2×10`;
    } else if (b === 4) {
      hint = `×4 trick: double twice → ${a}×2=${a*2}, then ×2=${a*4}`;
    } else if (b === 8) {
      hint = `×8 trick: double 3× → ${a}→${a*2}→${a*4}→${a*8}`;
    } else if (b === 6) {
      hint = `×6 trick: ×5 + ×1 → ${a*5} + ${a} = ${a*6}`;
    } else if (b === 7) {
      hint = `×7 trick: ×5 + ×2 → ${a*5} + ${a*2} = ${a*7}`;
    } else if (b === 12) {
      hint = `×12 trick: ×10 + ×2 → ${a*10} + ${a*2} = ${a*12}`;
    } else if (b === 15) {
      hint = `×15 trick: ×10 + half → ${a*10} + ${a*5} = ${a*15}`;
    } else if (a >= 11 && a <= 19 && b >= 11 && b <= 19) {
      // Vedic: (a+units_b)×10 + units_a×units_b
      const ua = a - 10, ub = b - 10;
      hint = `Vedic: (${a}+${ub})×10 + ${ua}×${ub} = ${(a+ub)*10} + ${ua*ub} = ${a*b}`;
    } else {
      // Split method: a×b = a×(nearest10 ± remainder)
      const near = Math.round(b / 10) * 10;
      const diff = b - near;
      if (near > 0 && diff !== 0) {
        const sign = diff > 0 ? '+' : '−';
        hint = `Split: ${a}×${near} ${sign} ${a}×${Math.abs(diff)} = ${a*near} ${sign} ${a*Math.abs(diff)}`;
      } else {
        const str = String(q.answer);
        hint = str.length <= 1 ? 'Single digit' : `Starts with ${str.slice(0,2)}…`;
      }
    }

  // ── Addition: Vedic / mental math ──
  } else if (q.type === 'add') {
    const a = q.n, b = q.m;
    // Round one operand to nearest 10, compensate
    const nearA = Math.round(a / 10) * 10, diffA = a - nearA;
    const nearB = Math.round(b / 10) * 10, diffB = b - nearB;
    // Pick the operand with smaller remainder
    if (Math.abs(diffA) <= Math.abs(diffB) && nearA !== a) {
      const sign = diffA > 0 ? '−' : '+';
      hint = `Round: ${nearA} + ${b} = ${nearA + b}, then ${sign}${Math.abs(diffA)} → ${a+b}`;
    } else if (nearB !== b) {
      const sign = diffB > 0 ? '−' : '+';
      hint = `Round: ${a} + ${nearB} = ${a + nearB}, then ${sign}${Math.abs(diffB)} → ${a+b}`;
    } else {
      hint = `Break it: ${a} + ${b} = ${Math.floor(b/10)*10} + ${b%10} → add tens then units`;
    }

  // ── Subtraction: Vedic complement method ──
  } else if (q.type === 'sub') {
    const a = q.n, b = q.m;
    // Round the subtrahend to nearest 10
    const nearB = Math.round(b / 10) * 10, diffB = b - nearB;
    if (nearB !== b && nearB > 0) {
      const sign = diffB > 0 ? '+' : '−';
      hint = `Round: ${a} − ${nearB} = ${a - nearB}, then ${sign}${Math.abs(diffB)} → ${a-b}`;
    } else {
      // complement from next 10
      const next10 = Math.ceil(b / 10) * 10;
      const comp = next10 - b;
      hint = `Complement: ${b} needs ${comp} to reach ${next10}; ${a}−${next10}=${a-next10}, +${comp}=${a-b}`;
    }
  }

  // ── Deduct XP ──
  const data = getXPData();
  data.totalXP = Math.max(0, data.totalXP - HINT_XP_COST);
  data.currentLevel = levelFromXP(data.totalXP);
  saveXPData(data);
  showXPFloat(-HINT_XP_COST, false);
  updateDashXP();

  // ── Show hint ──
  const hintReveal = document.getElementById('hintReveal');
  hintReveal.textContent = '💡 ' + hint;
  hintReveal.classList.add('show');

  // ── Disable button ──
  const hintBtn = document.getElementById('hintBtn');
  hintBtn.disabled = true;
  hintBtn.textContent = '−' + HINT_XP_COST + ' XP';
  _hintUsedThisQ = true;
}

// Reset hint state on each new question by observing qExpr changes
(function() {
  const qExprEl = document.getElementById('qExpr');
  if (!qExprEl) return;
  new MutationObserver(() => {
    _hintUsedThisQ = false;
    const hintBtn = document.getElementById('hintBtn');
    const hintReveal = document.getElementById('hintReveal');
    if (hintBtn) { hintBtn.disabled = false; hintBtn.textContent = '💡 Hint'; hintBtn.style.display = ''; hintBtn.style.fontSize = ''; hintBtn.style.padding = ''; }
    if (hintReveal) { hintReveal.textContent=''; hintReveal.classList.remove('show'); }
    // Hide in pick mode
    setTimeout(() => {
      const hb = document.getElementById('hintBtn');
      if (hb && document.getElementById('pickZone') && document.getElementById('pickZone').style.display !== 'none') {
        hb.style.display = 'none';
      }
    }, 30);
  }).observe(qExprEl, { childList: true, characterData: true, subtree: true });
})();

// ─────────────────────────────────────────────
// 7. DC XP BONUS
// ─────────────────────────────────────────────
const DC_XP_BONUS = 50;
const _origOnSessionComplete2 = onSessionComplete;
onSessionComplete = function(pct, sessionBestStreak, score, total) {
  _origOnSessionComplete2(pct, sessionBestStreak, score, total);
  if (!isPracticeMode() && window._wasDailyChallenge) {
    const data = getXPData();
    const bonus = Math.round(DC_XP_BONUS * (pct / 100)); // scale by accuracy
    if (bonus > 0) {
      data.totalXP += bonus;
      data.currentLevel = levelFromXP(data.totalXP);
      saveXPData(data);
      setTimeout(() => showXPFloat(bonus, false), 1200);
    }
  }
};

// Track DC start so bonus fires correctly
const _origStartDC = startDailyChallenge;
startDailyChallenge = function() {
  window._wasDailyChallenge = true;
  _origStartDC();
};

// ─────────────────────────────────────────────
// HOOK: render all new dashboard widgets
// ─────────────────────────────────────────────
const _origShowDash3 = showDashboard;
showDashboard = function() {
  _origShowDash3();
  renderSessionSummaryCard();
  renderStreakWarning();
  renderWeeklySummary();
  recordDailyXP();
  pulseDashboardStatsAfterSession();
};

function toggleDashRecentSessions(btn) {
  const list = document.getElementById('dashRecentList');
  if (!list) return;
  list.classList.add('is-animating');
  const isCollapsed = list.classList.toggle('collapsed');
  if (btn) btn.textContent = isCollapsed ? 'View All' : 'Show Less';
  window.setTimeout(() => {
    list.classList.remove('is-animating');
  }, 340);
}

const SYNC_NOTICE_DISMISSED_KEY = 'quiz_sync_notice_dismissed';
const LOCAL_DATA_SYNCED_KEY = 'quiz_local_data_synced';
const PWA_INSTALL_DISMISSED_KEY = 'quiz_pwa_install_dismissed';
let deferredPwaInstallPrompt = null;

function readLocalJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch(e) {
    return fallback;
  }
}

function hasMeaningfulLocalProgress() {
  const history = readLocalJSON('quiz_history', []);
  if (Array.isArray(history) && history.length) return true;
  const profile = readLocalJSON('quiz_profile', null);
  if (profile && Object.keys(profile).length) return true;
  const xp = readLocalJSON('quiz_xp', null);
  if (xp && ((xp.totalXP || 0) > 0 || (xp.currentLevel || 1) > 1)) return true;
  const pb = readLocalJSON('quiz_pb', null);
  if (pb && Object.keys(pb).length) return true;
  const dayStreak = readLocalJSON('quiz_day_streak2', null);
  if (dayStreak && Object.keys(dayStreak).length) return true;
  const milestones = readLocalJSON('quiz_milestones', []);
  if (Array.isArray(milestones) && milestones.length) return true;
  const weakness = readLocalJSON('quiz_weakness', null);
  if (weakness && Object.keys(weakness).length) return true;
  const srQueue = readLocalJSON('quiz_sr_queue', []);
  if (Array.isArray(srQueue) && srQueue.length) return true;
  const dailyChallenge = readLocalJSON('quiz_daily_challenge', null);
  if (dailyChallenge && Object.keys(dailyChallenge).length) return true;
  const dcHistory = readLocalJSON('quiz_dc_history', []);
  return Array.isArray(dcHistory) && dcHistory.length;
}

function shouldShowSyncNotice() {
  if (window.authState && window.authState.isLoggedIn) return false;
  try {
    if (localStorage.getItem(SYNC_NOTICE_DISMISSED_KEY) === '1') return false;
    if (localStorage.getItem(LOCAL_DATA_SYNCED_KEY) === '1') return false;
  } catch(e) {
    return false;
  }
  return hasMeaningfulLocalProgress();
}

function updateSyncNotice() {
  const notice = document.getElementById('syncNotice');
  if (!notice) return;
  notice.classList.toggle('show', shouldShowSyncNotice());
}

function dismissSyncNotice() {
  try { localStorage.setItem(SYNC_NOTICE_DISMISSED_KEY, '1'); } catch(e) {}
  updateSyncNotice();
}

function openSyncNoticeAuth() {
  const notice = document.getElementById('syncNotice');
  if (notice) notice.classList.remove('show');
  window.openAuthModal?.('login');
}

function initSyncNotice() {
  document.getElementById('syncNoticeDismissBtn')?.addEventListener('click', dismissSyncNotice);
  document.getElementById('syncNoticeSignInBtn')?.addEventListener('click', openSyncNoticeAuth);
  setTimeout(updateSyncNotice, 500);
}

window.updateSyncNotice = updateSyncNotice;
document.addEventListener('DOMContentLoaded', initSyncNotice);

function isRunningStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function shouldShowPwaInstallNotice() {
  if (isRunningStandalone()) return false;
  try {
    return localStorage.getItem(PWA_INSTALL_DISMISSED_KEY) !== '1';
  } catch(e) {
    return false;
  }
}

function hidePwaInstallNotice() {
  document.getElementById('pwaInstallNotice')?.classList.remove('show');
}

function showPwaInstallNotice() {
  const notice = document.getElementById('pwaInstallNotice');
  if (!notice || !deferredPwaInstallPrompt || !shouldShowPwaInstallNotice()) return;
  notice.classList.add('show');
}

function dismissPwaInstallNotice() {
  try { localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, '1'); } catch(e) {}
  deferredPwaInstallPrompt = null;
  hidePwaInstallNotice();
}

async function promptPwaInstall() {
  if (!deferredPwaInstallPrompt) return;
  const promptEvent = deferredPwaInstallPrompt;
  deferredPwaInstallPrompt = null;
  hidePwaInstallNotice();
  try {
    promptEvent.prompt();
    await promptEvent.userChoice;
  } catch(e) {
    console.warn('PWA install prompt failed', e);
  }
}

function initPwaInstallPrompt() {
  document.getElementById('pwaInstallDismissBtn')?.addEventListener('click', dismissPwaInstallNotice);
  document.getElementById('pwaInstallBtn')?.addEventListener('click', promptPwaInstall);

  window.addEventListener('beforeinstallprompt', event => {
    if (!shouldShowPwaInstallNotice()) return;
    event.preventDefault();
    deferredPwaInstallPrompt = event;
    window.setTimeout(showPwaInstallNotice, 1400);
  });

  window.addEventListener('appinstalled', () => {
    try { localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, '1'); } catch(e) {}
    deferredPwaInstallPrompt = null;
    hidePwaInstallNotice();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Service worker registration failed', error);
    });
  });
}

document.addEventListener('DOMContentLoaded', initPwaInstallPrompt);
registerServiceWorker();

loadSavedCustomColorInputs();
initTheme();
initCustomColors();

// ── Init routing — runs LAST so all showDashboard patches are applied ──
(function init() {
  const profile = getProfile();
  if (!profile.name) {
    document.getElementById('s-welcome').classList.add('active');
    document.getElementById('s-setup').classList.remove('active');
    document.body.dataset.activeScreen = 's-welcome';
    document.getElementById('welcomeQuote').textContent = QUOTES[Math.floor(Math.random()*QUOTES.length)];
  } else {
    document.getElementById('s-setup').classList.remove('active');
    showDashboard();
  }
})();
