// public/script.js
const ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws');
const pairSelect = document.getElementById('pairSelect');
const modeSelect = document.getElementById('modeSelect');
const startBtn = document.getElementById('startBtn');
const nextBtn = document.getElementById('nextBtn');
const autoBtn = document.getElementById('autoBtn');
const ttsBtn = document.getElementById('ttsBtn');
const signalTitle = document.getElementById('signalTitle');
const signalBody = document.getElementById('signalBody');
const countdownEl = document.getElementById('countdown');
const logBox = document.getElementById('logBox');
const spark = document.getElementById('spark');
const ctx = spark.getContext('2d');
const stat_conf = document.getElementById('stat_conf');
const stat_mode = document.getElementById('stat_mode');
const stat_mtg = document.getElementById('stat_mtg');
const stat_pred = document.getElementById('stat_pred');
let currentPair = null;
let countdownTimer = null;

function pushLog(t){ const d=new Date().toLocaleTimeString(); logBox.innerHTML = `<div>[${d}] ${t}</div>` + logBox.innerHTML; }

ws.onopen = ()=> pushLog('WS connected to backend');
ws.onmessage = (evt) => {
  try {
    const msg = JSON.parse(evt.data);
    if(msg.type === 'hello' || msg.type === 'pairs'){
      pushLog('Server: ' + (msg.server_time || new Date().toISOString()));
      const pairs = msg.pairs || [];
      if(Array.isArray(pairs) && pairs.length && typeof pairs[0] === 'object') populatePairs(pairs);
      if(msg.server_time) document.getElementById('serverTime').innerText = `Server: ${msg.server_time}`;
    } else if(msg.type === 'server_time'){
      document.getElementById('serverTime').innerText = `Server: ${msg.server_time} (UTC) • BD: ${new Date(msg.server_time).toLocaleString('en-US',{timeZone:'Asia/Dhaka'})}`;
    } else if(msg.type === 'pre_signal'){
      pushLog(`PRE-SIGNAL ${msg.data.symbol} -> ${msg.data.hint} score:${msg.data.score}`);
      stat_pred.innerText = `Pre-signal: ${msg.data.hint} (${msg.data.score})`;
    } else if(msg.type === 'signal'){
      showSignal(msg.data);
    } else if(msg.type === 'hold'){
      // per requirement: don't show hold; but log it
      pushLog(`[HOLD] ${msg.data.symbol || ''} -> ${msg.data.reason || msg.data}`);
    } else if(msg.type === 'log'){
      pushLog(msg.data);
    } else if(msg.type === 'signal_result'){
      pushLog(`Result ${msg.data.symbol} => ${msg.data.result} @ ${msg.data.finalPrice}`);
    }
  } catch (e) { console.warn('ws parse err', e); }
};

function populatePairs(pairsStructured){
  pairSelect.innerHTML = '';
  const groups = {};
  pairsStructured.forEach(p => { (groups[p.type] = groups[p.type] || []).push(p.symbol); });
  const order = ['real','otc','crypto','commodity'];
  order.forEach(type => {
    if(!groups[type]) return;
    const labelOpt = document.createElement('option'); labelOpt.disabled = true; labelOpt.textContent = `--- ${type.toUpperCase()} ---`; pairSelect.appendChild(labelOpt);
    groups[type].forEach(sym => { const o = document.createElement('option'); o.value = sym; o.textContent = sym; pairSelect.appendChild(o); });
  });
  if(pairSelect.options.length > 0) currentPair = pairSelect.value;
}
pairSelect.onchange = ()=> currentPair = pairSelect.value;

function showSignal(rec){
  clearInterval(countdownTimer);
  const candleTag = rec.candleSize ? `<span class="candleSizeTag ${rec.candleSize}">${rec.candleSize}</span>` : '';
  signalTitle.innerHTML = `${rec.symbol} — ${rec.direction}  (conf ${rec.confidence}%) ${candleTag}`;
  const entryTime = rec.entry_time_iso || (rec.entry_ts ? new Date(rec.entry_ts*1000).toISOString() : null);
  const bdEntry = entryTime ? new Date(entryTime).toLocaleString('en-US',{timeZone:'Asia/Dhaka'}) : '—';
  const mtgLine = rec.mtg ? `<div style="margin-top:8px;font-weight:800;color:#ffd9d9">MTG: ${rec.mtg.decision} — ${rec.mtg.reason || ''}</div>` : '';
  signalBody.innerHTML = `<div>Entry price: <span class="confidence">${rec.entry}</span> ${candleTag}</div>
                          <div>Entry(UTC): ${entryTime || '—'}</div>
                          <div>Entry(BD): ${bdEntry}</div>
                          <div style="margin-top:6px">Notes: ${rec.notes || '-'}</div>
                          ${mtgLine}`;
  stat_conf.innerText = `Confidence: ${rec.confidence}%`;
  stat_mode.innerText = `Mode: ${modeSelect.value.toUpperCase() || '—'}`;
  stat_mtg.innerText = `MTG: ${rec.mtg ? rec.mtg.decision : '-'}`;
  let nowTs = Math.floor(Date.now()/1000);
  let secs = Math.max(0, (rec.expiry_ts || Math.floor(new Date(rec.expiry_at||rec.expiry).getTime()/1000)) - nowTs);
  countdownEl.textContent = `Countdown: ${secs}s`;
  countdownTimer = setInterval(()=> {
    secs--;
    if(secs <= 0){ clearInterval(countdownTimer); countdownEl.textContent = 'Signal closed — awaiting result'; }
    else countdownEl.textContent = `Countdown: ${secs}s`;
  }, 1000);
  drawGauge(rec.confidence || 0);
  speak(`Signal ${rec.symbol} ${rec.direction} confidence ${rec.confidence} percent`);
  pushLog(`Signal: ${rec.symbol} ${rec.direction} conf:${rec.confidence}% entry:${rec.entry}`);
}

startBtn.onclick = ()=> {
  const mode = modeSelect.value;
  if(!currentPair){ ws.send(JSON.stringify({ type:'start', mode })); pushLog('Requested start (auto-pick)'); return; }
  ws.send(JSON.stringify({ type:'start', symbol: currentPair, mode }));
  pushLog('Requested start for ' + currentPair);
};
nextBtn.onclick = ()=> {
  const mode = modeSelect.value;
  if(!currentPair){ ws.send(JSON.stringify({ type:'next', mode })); pushLog('Requested next (auto-pick)'); return; }
  ws.send(JSON.stringify({ type:'next', symbol: currentPair, mode }));
  pushLog('Requested next for ' + currentPair);
};
autoBtn.onclick = ()=> { ws.send(JSON.stringify({ type:'start' })); pushLog('Requested Auto-Pick Best'); };
ttsBtn.onclick = ()=> { speak('TTS test. Binary sniper ready'); };

function drawGauge(val){
  const el = document.getElementById('gauge');
  el.innerHTML = `<div style="padding:20px;font-weight:800;color:#001">${val}%</div>`;
}
function speak(text){
  try{ const synth = window.speechSynthesis; if(!synth) return; const u = new SpeechSynthesisUtterance(text); synth.cancel(); synth.speak(u); }catch(e){}
  }
