‎// backend/server.js
‎require('dotenv').config();
‎const express = require('express');
‎const http = require('http');
‎const WebSocket = require('ws');
‎const path = require('path');
‎const fetch = require('node-fetch');
‎
‎const compute = require('./computeStrategy');
‎const aiLearner = require('./aiLearner');
‎const manipulationDetector = require('./manipulationDetector');
‎const patternAnalyzer = require('./patternAnalyzer');
‎const strategyAdvanced = require('./strategyAdvanced');
‎const autoTimeSync = require('./autoTimeSync');
‎const db = require('./db');
‎const resultResolver = require('./resultResolver');
‎const optimizer = require('./optimizer');
‎const martingaleAdvisor = require('./martingaleAdvisor');
‎const deepSentiment = require('./deepSentiment');
‎const modeDetector = require('./modeDetector');
‎const liquidityDetector = require('./liquidityDetector');
‎const divergenceFilter = require('./divergenceFilter');
‎const masterOverseer = require('./masterOverseer');
‎const userManager = require('./userManager');
‎const cloudSync = require('./cloudSync');
‎const quotexAdapter = require('./quotexAdapter');
‎const { startBinanceStream } = require('./brokerAdapters/binanceAdapter');
‎
‎const app = express();
‎const server = http.createServer(app);
‎const wss = new WebSocket.Server({ server, path: '/ws' });
‎
‎app.use(express.static(path.join(__dirname, '..', 'public')));
‎app.use(express.json());
‎
‎/* Config */
‎const PORT = parseInt(process.env.PORT || '3000', 10);
‎const SIGNAL_INTERVAL_MS = parseInt(process.env.SIGNAL_INTERVAL_MS || '3000', 10);
‎const MIN_CONF = parseInt(process.env.MIN_BROADCAST_CONF || '55', 10);
‎const BINARY_EXPIRY_SECONDS = parseInt(process.env.BINARY_EXPIRY_SECONDS || '60', 10);
‎const AUTO_PICK = (process.env.AUTO_PICK || 'true') === 'true';
‎const AUTO_PICK_MIN_SCORE = parseInt(process.env.AUTO_PICK_MIN_SCORE || '60', 10);
‎const OWNER = process.env.OWNER_NAME || 'Owner';
‎const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_token';
‎
‎/* Pairs */
‎let PAIRS = (process.env.WATCH_SYMBOLS || '').split(',').map(s => s.trim()).filter(Boolean);
‎if (!PAIRS.length) {
‎  PAIRS = ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','BTC (OTC)','Gold (OTC)'];
‎}
‎
‎/* Globals */
‎const bars = {};            // bars[symbol] = [{time,open,high,low,close,volume}, ...]
‎const signals = [];         // stored signal records
‎
‎global.barsGlobal = bars;
‎
‎/* Standard appendTick creating 1s OHLC bars */
‎function appendTick(sym, price, qty, tsSec) {
‎  if (!sym) return;
‎  sym = String(sym).toUpperCase();
‎  bars[sym] = bars[sym] || [];
‎  const arr = bars[sym];
‎  const last = arr[arr.length - 1];
‎  if (!last || last.time !== tsSec) {
‎    arr.push({ time: tsSec, open: price, high: price, low: price, close: price, volume: qty || 0 });
‎    if (arr.length > 10000) arr.shift();
‎  } else {
‎    last.close = price;
‎    if (price > last.high) last.high = price;
‎    if (price < last.low) last.low = price;
‎    last.volume = (last.volume || 0) + (qty || 0);
‎  }
‎  global.barsGlobal = bars;
‎}
‎
‎/* simulateTick for pairs (safe fallback) */
‎function simulateTick(sym) {
‎  const ts = Math.floor(Date.now() / 1000);
‎  const isCrypto = /BTC|DOGE|SHIBA|PEPE|ARB|APTOS|TRON|BINANCE/i.test(sym);
‎  const base = isCrypto ? (30000 + (Math.random() - 0.5) * 2000) : (sym.startsWith('EUR') ? 1.09 : 1.0);
‎  const volatility = isCrypto ? 20 : 0.004;
‎  const price = +(base + (Math.random() - 0.5) * volatility).toFixed(isCrypto ? 2 : 5);
‎  const qty = Math.random() * (isCrypto ? 3 : 100);
‎  appendTick(sym, price, qty, ts);
‎}
‎
‎/* Warmup historic bars for each pair to ensure computeStrategy has past candles */
‎function warmupPairs(countPerPair = 600) {
‎  const nowSec = Math.floor(Date.now() / 1000);
‎  for (const s of PAIRS) {
‎    bars[s] = bars[s] || [];
‎    for (let i = countPerPair; i >= 1; i--) {
‎      const ts = nowSec - i;
‎      const isCrypto = /BTC|DOGE|SHIBA|PEPE|ARB|APTOS|TRON|BINANCE/i.test(s);
‎      const base = isCrypto ? (30000 + (Math.random() - 0.5) * 2000) : (s.startsWith('EUR') ? 1.09 : 1.0);
‎      const volatility = isCrypto ? 20 : 0.004;
‎      const price = +(base + (Math.random() - 0.5) * volatility).toFixed(isCrypto ? 2 : 5);
‎      appendTick(s, price, Math.random() * (isCrypto ? 3 : 100), ts);
‎    }
‎  }
‎  console.log('Warmup completed — pairs warmup bars created');
‎}
‎
‎/* Kick off warmup */
‎warmupPairs(600);
‎
‎/* Sync time periodically (autoTimeSync module uses a public API) */
‎let serverOffsetMs = 0;
‎async function syncTime() {
‎  try {
‎    const t = await autoTimeSync.sync();
‎    if (t && t.serverTimeMs) serverOffsetMs = t.serverTimeMs - Date.now();
‎  } catch (e) {}
‎}
‎setInterval(syncTime, 60 * 1000);
‎syncTime();
‎
‎/* Debug & API endpoints */
‎app.get('/pairs', (req, res) => {
‎  const structured = PAIRS.map(p => {
‎    const type = (/\(OTC\)/i.test(p) || /OTC$/i.test(p)) ? 'otc'
‎      : /(BTC|DOGE|SHIBA|PEPE|ARB|APTOS|TRON|BITCOIN|BINANCE)/i.test(p) ? 'crypto'
‎      : /(GOLD|SILVER|CRUDE|UKBRENT|USCRUDE)/i.test(p) ? 'commodity'
‎      : 'real';
‎    return { symbol: p, type };
‎  });
‎  res.json({ ok: true, pairs: structured, server_time: new Date(Date.now() + serverOffsetMs).toISOString() });
‎});
‎
‎app.get('/signals/history', (req, res) => {
‎  const rows = db.listRecent(500);
‎  res.json({ ok: true, rows, server_time: new Date(Date.now() + serverOffsetMs).toISOString() });
‎});
‎
‎/* Debug endpoints */
‎app.get('/debug/status', (req, res) => {
‎  try {
‎    const info = PAIRS.map(sym => {
‎      const b = bars[sym] || [];
‎      const last = b[b.length - 1] || null;
‎      let sigPreview = null;
‎      try { sigPreview = compute.computeSignalForSymbol(sym, bars, { require100: false }); } catch (e) { sigPreview = { error: e.message }; }
‎      return { symbol: sym, barsCount: b.length, last, signalPreview: sigPreview };
‎    });
‎    return res.json({ ok: true, serverTime: new Date().toISOString(), info });
‎  } catch (e) { return res.json({ ok: false, err: e.message }); }
‎});
‎
‎/* Force a signal (debugging only) */
‎app.get('/debug/force/:sym', (req, res) => {
‎  const sym = req.params.sym;
‎  try {
‎    const fakeSig = compute.computeSignalForSymbol(sym, bars, { require100: false }) || {};
‎    const forced = Object.assign({}, fakeSig || {}, {
‎      id: signals.length + 1,
‎      symbol: sym,
‎      confidence: (fakeSig && fakeSig.confidence) ? fakeSig.confidence : 65,
‎      entry: (fakeSig && fakeSig.entry) ? fakeSig.entry : (bars[sym] && bars[sym].length ? bars[sym][bars[sym].length - 1].close : null),
‎      entry_time_iso: new Date().toISOString(),
‎      server_time_iso: new Date(Date.now() + serverOffsetMs).toISOString(),
‎      expiry_ts: Math.floor(Date.now() / 1000) + (BINARY_EXPIRY_SECONDS)
‎    });
‎    db.insertSignal(forced);
‎    broadcast({ type: 'signal', data: forced });
‎    res.json({ ok: true, forced });
‎  } catch (e) {
‎    res.json({ ok: false, err: e.message });
‎  }
‎});
‎
‎/* Broadcast helper */
‎function broadcast(obj) {
‎  const raw = JSON.stringify(obj);
‎  wss.clients.forEach(c => {
‎    if (c.readyState === WebSocket.OPEN) c.send(raw);
‎  });
‎}
‎
‎/* Start adapters (Quotex adapter will be placeholder unless credentials provided) */
‎quotexAdapter.startQuotexAdapter({
‎  apiUrl: process.env.QUOTEX_API_URL,
‎  username: process.env.QUOTEX_USERNAME,
‎  password: process.env.QUOTEX_PASSWORD,
‎  wsUrl: process.env.QUOTEX_WS_URL
‎}, {
‎  appendTick: (sym, price, qty, ts) => appendTick(sym.toUpperCase(), Number(price), Number(qty || 1), ts)
‎}).catch(() => {});
‎
‎startBinanceStream(PAIRS, appendTick); // placeholder adapter
‎
‎/* Main scanner loop: picks candidate pairs and decides signals */
‎setInterval(async () => {
‎  try {
‎    const candidates = [];
‎    for (const s of PAIRS) {
‎      try {
‎        if (!bars[s] || bars[s].length < 120) { simulateTick(s); continue; }
‎        const manip = manipulationDetector.detect([], bars[s].slice(-120));
‎        if (manip && manip.score >= 90) continue; // too manipulated
‎        const sig = compute.computeSignalForSymbol(s, bars, { require100: false });
‎        if (!sig) continue;
‎        const div = (require('./divergenceFilter') || { check: () => ({ forbid: false }) }).check(bars[s].slice(-200));
‎        if (div.forbid) continue;
‎        const sentiment = (require('./sentimentEngine') || { getSentiment: () => 50 }).getSentiment(s);
‎        sig.sentiment = sentiment;
‎        candidates.push({ symbol: s, cand: sig, score: sig.confidence + (sentiment - 50) * 0.4 - (manip.score || 0) * 0.2 });
‎      } catch (e) { /* ignore pair error */ }
‎    }
‎    if (!candidates.length) return;
‎    candidates.sort((a, b) => b.score - a.score);
‎    const top = candidates[0];
‎    // decide based on master overseer & strategy
‎    const verdict = strategyAdvanced.evaluateCandidate(top.cand, bars[top.symbol]);
‎    if (!verdict || verdict.confirmation < MIN_CONF) return;
‎    // prepare record
‎    const id = signals.length + 1;
‎    const expiry_ts = Math.floor(Date.now() / 1000) + BINARY_EXPIRY_SECONDS;
‎    const rec = {
‎      id,
‎      symbol: top.symbol,
‎      market: 'binary',
‎      direction: top.cand.direction,
‎      confidence: verdict.confirmation,
‎      entry: top.cand.entry,
‎      entry_ts: top.cand.entry_ts || Math.floor(Date.now() / 1000),
‎      entry_time_iso: top.cand.entry_time_iso || new Date().toISOString(),
‎      expiry_ts,
‎      notes: top.cand.notes || '',
‎      time: new Date().toISOString(),
‎      server_time_iso: new Date(Date.now() + serverOffsetMs).toISOString(),
‎      result: null,
‎      candleSize: top.cand.candleSize || null
‎    };
‎    signals.push(rec);
‎    db.insertSignal(rec);
‎    broadcast({ type: 'signal', data: rec });
‎    broadcast({ type: 'log', data: `Signal ${rec.symbol} ${rec.direction} conf:${rec.confidence}% id:${rec.id}` });
‎  } catch (e) {
‎    console.warn('scanner err', e && (e.message || e));
‎  }
‎}, SIGNAL_INTERVAL_MS);
‎
‎/* WebSocket connection behavior */
‎wss.on('connection', ws => {
‎  // send hello + pairs
‎  ws.send(JSON.stringify({ type: 'hello', server_time: new Date(Date.now() + serverOffsetMs).toISOString(), pairs: PAIRS.map(s => ({ symbol: s, type: (/OTC/i.test(s) ? 'otc' : 'real') })), owner: OWNER }));
‎
‎  ws.on('message', async (msg) => {
‎    try {
‎      const m = JSON.parse(msg.toString());
‎      if (m.type === 'start' || m.type === 'next') {
‎        // determine symbol (auto-pick if not provided)
‎        let sym = (m.symbol || '').toString().trim();
‎        if (!sym && AUTO_PICK) {
‎          // score all pairs quickly
‎          const scores = [];
‎          for (const s of PAIRS) {
‎            try {
‎              const p = compute.computeSignalForSymbol(s, bars, { require100: false });
‎              if (p) scores.push({ symbol: s, score: p.confidence });
‎            } catch (e) {}
‎          }
‎          scores.sort((a, b) => b.score - a.score);
‎          if (scores.length && scores[0].score >= AUTO_PICK_MIN_SCORE) sym = scores[0].symbol;
‎        }
‎        if (!sym) { ws.send(JSON.stringify({ type: 'hold', data: { reason: 'No suitable pair found' } })); return; }
‎        let sig = compute.computeSignalForSymbol(sym, bars, { require100: m.type !== 'next' });
‎        if (!sig) sig = compute.computeSignalForSymbol(sym, bars, { require100: false });
‎        if (!sig) { ws.send(JSON.stringify({ type: 'hold', data: { symbol: sym, reason: 'No confirmed opportunity now — hold' } })); return; }
‎        // apply advanced checks
‎        const decision = strategyAdvanced.evaluateCandidate(sig, bars[sym] || []);
‎        if (!decision || decision.confirmation < MIN_CONF) { ws.send(JSON.stringify({ type: 'hold', data: { symbol: sym, reason: 'Confidence too low' } })); return; }
‎        const expiry_ts = Math.floor(Date.now() / 1000) + BINARY_EXPIRY_SECONDS;
‎        const rec = {
‎          id: signals.length + 1,
‎          symbol: sym,
‎          market: 'binary',
‎          direction: decision.direction || sig.direction,
‎          confidence: decision.confirmation,
‎          entry: sig.entry,
‎          entry_ts: sig.entry_ts || Math.floor(Date.now() / 1000),
‎          entry_time_iso: sig.entry_time_iso || new Date().toISOString(),
‎          expiry_ts,
‎          notes: (sig.notes || '') + '|' + (decision.notes || ''),
‎          time: new Date().toISOString(),
‎          server_time_iso: new Date(Date.now() + serverOffsetMs).toISOString(),
‎          result: null,
‎          candleSize: sig.candleSize || null
‎        };
‎        signals.push(rec);
‎        db.insertSignal(rec);
‎        ws.send(JSON.stringify({ type: 'signal', data: rec }));
‎      } else if (m.type === 'reqDebug' && m.token === ADMIN_TOKEN) {
‎        ws.send(JSON.stringify({ type: 'debug', data: { pairs: PAIRS.length, signals: signals.length } }));
‎      }
‎    } catch (e) {}
‎  });
‎});
‎
‎/* start result resolver to mark WIN/LOSS on expiry */
‎resultResolver.start({ signalsRef: signals, barsRef: bars, broadcast });
‎
‎/* Start server */
‎server.listen(PORT, () => {
‎  console.log(`Binary Sniper GOD running on port ${PORT} — pairs: ${PAIRS.length}`);
‎});
‎
