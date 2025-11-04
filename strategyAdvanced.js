// backend/strategyAdvanced.js
const ai = require('./aiLearner');
const manipulationDetector = require('./manipulationDetector');
module.exports = {
  evaluateCandidate: (candidate, bars) => {
    if (!candidate) return null;
    // Base score from candidate.confidence (10-99)
    let base = candidate.confidence || 50;
    // penalty for manipulation
    const manip = manipulationDetector.detect([], bars ? bars.slice(-120) : []);
    if (manip && manip.score > 50) base -= Math.round(manip.score * 0.25);
    // apply AI boost from aiLearner (fv parse)
    const fv = {
      fvg: candidate.notes && candidate.notes.includes('fvg'),
      volumeSpike: candidate.notes && candidate.notes.includes('volSpike'),
      ob: candidate.notes && candidate.notes.includes('ob'),
      manipulation: manip.score > 30
    };
    const boost = ai.predictBoost ? ai.predictBoost(fv) : 0;
    let confirmation = Math.max(1, Math.min(99, Math.round(base + boost)));
    // mode adjustments can be implemented externally (God/Normal)
    return { ok: confirmation >= 10, confirmation, direction: candidate.direction, notes: `boost:${boost}|manip:${manip.score||0}` };
  }
};
