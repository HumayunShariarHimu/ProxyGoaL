/* ═══════════════════════════════════════════════════════════
   ProxyGoaL — Frontend Engine
   ═══════════════════════════════════════════════════════════ */

// ─────────────  DOM  ─────────────
const $ = (id) => document.getElementById(id);

const statusPill   = $('statusPill');
const statusText   = $('statusText');
const setupBanner  = $('setupBanner');
const modeBadge    = $('modeBadge');
const ipValue      = $('ipValue');
const chainProxy   = $('chainProxy');
const copyBtn      = $('copyBtn');
const poolInfo     = $('poolInfo');

const mCountry = $('mCountry'), mCity = $('mCity'), mRegion = $('mRegion');
const mIsp     = $('mIsp'),     mOrg  = $('mOrg'),  mAsn    = $('mAsn');
const mTz      = $('mTz'),      mCoords = $('mCoords');

const modeSel     = $('modeSel');
const intervalSel = $('intervalSel');
const startBtn    = $('startBtn');
const stopBtn     = $('stopBtn');
const onceBtn     = $('onceBtn');
const clearBtn    = $('clearBtn');

const statRotations = $('statRotations');
const statUniqueIps = $('statUniqueIps');
const statCountries = $('statCountries');
const statLatency   = $('statLatency');

const recentList  = $('recentList');
const recentCount = $('recentCount');
const logEl       = $('log');
const toastEl     = $('toast');

// ─────────────  STATE  ─────────────
const state = {
  running: false,
  timer: null,
  rotations: 0,
  uniqueIps: new Set(),
  countries: new Set(),
  latencies: [],
  recent: [],
  busy: false
};

// ─────────────  UTIL  ─────────────
function tsNow(){
  const d = new Date();
  const p = (n) => String(n).padStart(2,'0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function log(msg, kind = 'info'){
  const line = document.createElement('div');
  line.className = 'log-line ' + kind;
  line.innerHTML = `<span class="t">[${tsNow()}]</span>${escapeHtml(msg)}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 400) logEl.removeChild(logEl.firstChild);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let toastTimer;
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function setStatus(stateName, label){
  statusPill.dataset.state = stateName;
  statusText.textContent = label;
}

function flagEmoji(cc){
  if (!cc || cc.length !== 2) return '🌐';
  const A = 0x1F1E6, base = 'A'.charCodeAt(0);
  return String.fromCodePoint(
    A + (cc.toUpperCase().charCodeAt(0) - base),
    A + (cc.toUpperCase().charCodeAt(1) - base)
  );
}

// ─────────────  INFO (pool status)  ─────────────
async function loadInfo(){
  try{
    const r = await fetch('/api/info', { cache: 'no-store' });
    const d = await r.json();

    const poolTxt = d.poolSize ? `${d.poolSize} proxies` : 'empty';
    const epTxt   = d.hasEndpoint ? 'configured' : 'none';
    poolInfo.innerHTML = `POOL: <b>${poolTxt}</b> · ENDPOINT: <b>${epTxt}</b> · MODE: <b>${d.mode.toUpperCase()}</b>`;

    if (d.mode === 'direct'){
      setupBanner.hidden = false;
      log('no proxy configured → running in DIRECT mode', 'warn');
    } else {
      setupBanner.hidden = true;
      log(`proxy source ready: ${d.mode} (pool=${d.poolSize})`, 'ok');
    }
  } catch(e){
    log('failed to load /api/info: ' + e.message, 'err');
  }
}

// ─────────────  ROTATION  ─────────────
async function rotateOnce(){
  if (state.busy) return;
  state.busy = true;

  const mode = modeSel.value;
  modeBadge.textContent = mode.toUpperCase();

  try{
    const r = await fetch(`/api/rotate?mode=${mode}&_=${Date.now()}`, { cache: 'no-store' });
    const d = await r.json();

    if (d.ok){
      applyResult(d);
    } else {
      applyError(d);
    }
  } catch(e){
    log('network error: ' + e.message, 'err');
    setStatus('error', 'ERROR');
  } finally {
    state.busy = false;
  }
}

function applyResult(d){
  state.rotations++;
  state.uniqueIps.add(d.ip);
  if (d.country) state.countries.add(d.country);
  if (typeof d.latency === 'number') state.latencies.push(d.latency);
  if (state.latencies.length > 200) state.latencies.shift();

  ipValue.textContent = d.ip;
  ipValue.classList.remove('flash');
  void ipValue.offsetWidth;
  ipValue.classList.add('flash');

  chainProxy.textContent = d.proxy && d.proxy !== 'direct'
    ? d.proxy.toUpperCase()
    : 'DIRECT';

  mCountry.textContent = d.country ? `${flagEmoji(d.country)} ${d.country}` : '--';
  mCity.textContent    = d.city   || '--';
  mRegion.textContent  = d.region || '--';
  mIsp.textContent     = d.isp    || '--';
  mOrg.textContent     = d.org    || '--';
  mAsn.textContent     = d.asn    || '--';
  mTz.textContent      = d.timezone || '--';
  mCoords.textContent  = (d.lat && d.lon) ? `${d.lat}, ${d.lon}` : '--';

  pushRecent({
    ip: d.ip,
    country: d.country,
    city: d.city,
    latency: d.latency,
    bad: false
  });

  updateStats();
  log(`ROTATED → ${d.ip}  [${d.city || '?'}${d.country ? ', ' + d.country : ''}]  via ${d.proxy || 'direct'}  ${d.latency}ms`, 'ok');
  setStatus(state.running ? 'active' : 'idle', state.running ? 'ROTATING' : 'IDLE');
}

function applyError(d){
  log(`ROTATION FAILED (${d.proxy || 'direct'}): ${d.error}`, 'err');
  pushRecent({
    ip: 'ERR',
    country: '',
    city: d.error || 'failed',
    latency: d.latency || 0,
    bad: true
  });
  setStatus('error', 'ERROR');
  updateStats();
}

function pushRecent(item){
  state.recent.unshift(item);
  if (state.recent.length > 8) state.recent.pop();
  renderRecent();
}

function renderRecent(){
  recentCount.textContent = state.recent.length;
  if (!state.recent.length){
    recentList.innerHTML = '<div class="recent-empty">// awaiting first rotation…</div>';
    return;
  }
  recentList.innerHTML = state.recent.map(r => {
    if (r.bad){
      return `<div class="recent-item bad">
        <span class="rip">⚠ ${escapeHtml(r.city)}</span>
        <span class="rlat">${r.latency}ms</span>
      </div>`;
    }
    return `<div class="recent-item">
      <span class="rip">${flagEmoji(r.country)} ${escapeHtml(r.ip)}</span>
      <span class="rloc">${escapeHtml(r.city || '?')}${r.country ? ', ' + escapeHtml(r.country) : ''}</span>
      <span class="rlat">${r.latency}ms</span>
    </div>`;
  }).join('');
}

function updateStats(){
  statRotations.textContent = state.rotations;
  statUniqueIps.textContent = state.uniqueIps.size;
  statCountries.textContent = state.countries.size;
  if (state.latencies.length){
    const avg = Math.round(state.latencies.reduce((a,b)=>a+b,0) / state.latencies.length);
    statLatency.textContent = avg + 'ms';
  } else {
    statLatency.textContent = '--';
  }
}

// ─────────────  CONTROL  ─────────────
function startRotation(){
  if (state.running) return;
  state.running = true;

  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus('active', 'ROTATING');
  log(`rotation started @ ${intervalSel.value}ms interval (mode=${modeSel.value})`, 'ok');

  rotateOnce();
  state.timer = setInterval(rotateOnce, parseInt(intervalSel.value, 10));
}

function stopRotation(){
  if (!state.running) return;
  state.running = false;

  clearInterval(state.timer);
  state.timer = null;

  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus('idle', 'IDLE');
  log('rotation stopped', 'warn');
}

// ─────────────  EVENTS  ─────────────
startBtn.addEventListener('click', startRotation);
stopBtn.addEventListener('click', stopRotation);
onceBtn.addEventListener('click', () => {
  log('manual rotation triggered', 'info');
  rotateOnce();
});
clearBtn.addEventListener('click', () => {
  logEl.innerHTML = '';
  state.recent = [];
  state.rotations = 0;
  state.uniqueIps.clear();
  state.countries.clear();
  state.latencies = [];
  updateStats();
  renderRecent();
  log('telemetry + log cleared', 'warn');
});

intervalSel.addEventListener('change', () => {
  if (state.running){
    clearInterval(state.timer);
    state.timer = setInterval(rotateOnce, parseInt(intervalSel.value, 10));
    log(`interval changed → ${intervalSel.value}ms`, 'info');
  }
});

copyBtn.addEventListener('click', async () => {
  try{
    await navigator.clipboard.writeText(ipValue.textContent);
    toast('IP copied to clipboard');
  } catch {
    toast('copy failed');
  }
});

// ─────────────  MATRIX BACKGROUND  ─────────────
(function matrix(){
  const canvas = document.getElementById('matrix');
  const ctx = canvas.getContext('2d');
  const chars = 'アカサタナハマヤラワ0123456789ABCDEF<>/\\{}[]$#@%&*'.split('');
  const fontSize = 14;
  let cols = 0, drops = [];

  function resize(){
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Math.floor(canvas.width / fontSize);
    drops = Array(cols).fill(1);
  }
  window.addEventListener('resize', resize);
  resize();

  let last = 0;
  function tick(t){
    if (t - last < 55){ requestAnimationFrame(tick); return; }
    last = t;

    ctx.fillStyle = 'rgba(4,6,10,0.08)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = fontSize + 'px monospace';
    for (let i = 0; i < drops.length; i++){
      const ch = chars[Math.floor(Math.random() * chars.length)];
      const x = i * fontSize;
      const y = drops[i] * fontSize;

      ctx.fillStyle = Math.random() > 0.985 ? '#00e5ff' : '#00ff9c';
      ctx.fillText(ch, x, y);

      if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

// ─────────────  BOOT  ─────────────
log('ProxyGoaL engine initialized', 'ok');
setStatus('idle', 'IDLE');
loadInfo();
