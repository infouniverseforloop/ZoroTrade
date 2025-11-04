/* computeStrategy.js — computeSignalForSymbol with candleSize classification */
function sma(arr, period){ if(!arr || arr.length < period) return null; const a = arr.slice(-period); return a.reduce((s,v)=>s+v,0)/period; }
function simpleRSI(closes, period=14){
  if(!closes || closes.length < period+1) return 50;
  let gains=0, losses=0;
  for(let i=closes.length-period;i<closes.length;i++){ const d = closes[i] - closes[i-1]; if(d>0) gains+=d; else losses += Math.abs(d); }
  const avgG = gains/period, avgL = (losses/period) || 1e-6;
  const rs = avgG/avgL; return 100 - (100/(1+rs));
}
function aggregate(bars, secondsPerBar){
  if(!bars || bars.length===0) return [];
  const out=[]; let bucket=null;
  for(const b of bars){
    const t = Math.floor(b.time/secondsPerBar)*secondsPerBar;
    if(!bucket || bucket.time !== t){ bucket = { time:t, open:b.open, high:b.high, low:b.low, close:b.close, volume:b.volume||0 }; out.push(bucket); }
    else { bucket.high = Math.max(bucket.high, b.high); bucket.low = Math.min(bucket.low, b.low); bucket.close = b.close; bucket.volume += b.volume||0; }
  }
  return out;
}
function detectFVG(barsM1){ if(!barsM1 || barsM1.length < 3) return false; const a = barsM1[barsM1.length-3], b = barsM1[barsM1.length-2]; if(!a||!b) return false; if(a.high < b.low) return true; if(a.low > b.high) return true; return false; }
function detectOrderBlock(m1){ if(!m1 || m1.length < 4) return false; const prev = m1[m1.length-2], last = m1[m1.length-1]; const prevBody = Math.abs(prev.close - prev.open); const avgBody = Math.max(1e-6, m1.slice(-10).reduce((s,b)=> s + Math.abs(b.close-b.open),0)/Math.min(10,m1.length)); if(prevBody > avgBody * 1.4 && ((last.close > last.open && prev.close < prev.open) || (last.close < last.open && prev.close > prev.open))){ return true; } return false; }
function detectBOS_CHoCH(m5){ if(!m5 || m5.length < 6) return null; const last = m5[m5.length-1], prev = m5[m5.length-2]; if(last.close > prev.close) return 'BOS_UP'; if(last.close < prev.close) return 'BOS_DOWN'; return null; }
function isRoundNumber(price){ if(!price || price<=0) return false; const rounded = Math.round(price); return Math.abs(rounded - price) < (price * 0.0008); }

function classifyCandleSize(bar, avgBody){
  if(!bar) return 'Normal';
  const body = Math.abs(bar.close - bar.open);
  if(avgBody <= 0) return 'Normal';
  const ratio = body / avgBody;
  if(ratio <= 0.4) return 'Micro';
  if(ratio > 0.4 && ratio <= 1.6) return 'Normal';
  if(ratio > 1.6 && ratio <= 3.5) return 'Impulse';
  if(ratio > 3.5) return 'Exhaustion';
  return 'Normal';
}

function computeSignalForSymbol(symbol, barsRef, opts = {}){
  const bars = barsRef[symbol] || [];
  if(!bars || bars.length < 60) return null;
  const sample = bars.slice(-200);
  const closes = sample.map(b=>b.close);
  const sma5 = sma(closes, Math.min(5, closes.length));
  const sma20 = sma(closes, Math.min(20, closes.length));
  const rsiVal = simpleRSI(closes, 14);
  const volArr = sample.map(b=>b.volume||0);
  const avgVol = volArr.slice(0, Math.max(1,volArr.length-1)).reduce((a,b)=>a+b,0)/Math.max(1,volArr.length-1);
  const lastVol = volArr[volArr.length-1] || 0;
  const volSpike = lastVol > avgVol * 2.2;
  const m1 = aggregate(bars, 60);
  const m5 = aggregate(bars, 300);
  const m15 = aggregate(bars, 900);
  if(m1.length < 20) return null;
  const last = sample[sample.length-1];
  const prev = sample[sample.length-2];
  const priceDelta = last.close - prev.close;
  const ob = detectOrderBlock(m1);
  const fvg = detectFVG(m1);
  const bosCho = detectBOS_CHoCH(m5);
  const bullishMomentum = priceDelta > 0 && sma5 > sma20;
  const bearishMomentum = priceDelta < 0 && sma5 < sma20;
  let score = 50;
  if(bullishMomentum) score += 11;
  if(bearishMomentum) score -= 11;
  if(rsiVal < 30) score += 8;
  if(rsiVal > 70) score -= 8;
  if(volSpike) score += 7;
  if(ob) score += 7;
  if(fvg) score += 6;
  if(bosCho === 'BOS_UP') score += 4;
  if(bosCho === 'BOS_DOWN') score -= 4;
  const wickUp = last.high - Math.max(last.open, last.close);
  const wickDown = Math.min(last.open, last.close) - last.low;
  if(Math.max(wickUp, wickDown) > Math.abs(last.close - last.open) * 3) score -= 8;
  if(isRoundNumber(last.close)) score += 3;
  const m15trend = (m15.length>3) ? (m15[m15.length-1].close > m15[m15.length-2].close ? 1 : -1) : 0;
  if(m15trend === 1 && bullishMomentum) score += 6;
  if(m15trend === -1 && bearishMomentum) score -= 6;
  let layers = 0;
  if(bullishMomentum || bearishMomentum) layers++;
  if(ob || fvg) layers++;
  if(volSpike) layers++;
  if(rsiVal < 40 || rsiVal > 60) layers++;
  if(opts.require100 && layers < 2 && !opts.forceNext) return null;
  score = Math.max(10, Math.min(99, Math.round(score)));
  const direction = score >= 60 ? 'CALL' : (score <= 40 ? 'PUT' : (bullishMomentum ? 'CALL' : 'PUT'));
  const expirySeconds = parseInt(process.env.BINARY_EXPIRY_SECONDS || '60', 10);
  const expiry_at = new Date(Date.now() + expirySeconds*1000).toISOString();
  const entry_ts = Math.floor(Date.now()/1000);
  const entry_time_iso = new Date().toISOString();
  const notes = `rsi:${Math.round(rsiVal)}|volSpike:${volSpike}|ob:${ob}|fvg:${fvg}|bos:${bosCho}|round:${isRoundNumber(last.close)}`;
  const bodies = sample.slice(-30).map(b => Math.abs(b.close - b.open));
  const avgBody = Math.max(1e-8, bodies.reduce((a,b)=>a+b,0) / Math.max(1,bodies.length));
  const candleSize = classifyCandleSize(last, avgBody);
  return {
    market: 'binary',
    symbol,
    direction,
    confidence: score,
    entry: last.close,
    entry_ts,
    entry_time_iso,
    notes,
    time: new Date().toISOString(),
    expiry_at,
    candleSize
  };
}

module.exports = { computeSignalForSymbol, detectFVG, aggregate };
