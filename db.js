// backend/db.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'signals.json');
let signals = [];
try { if (fs.existsSync(FILE)) signals = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
function save() { try { fs.writeFileSync(FILE, JSON.stringify(signals, null, 2)); } catch (e) { } }
function insertSignal(s) { signals.push(s); save(); }
function listRecent(n = 200) { return signals.slice(-n).map(s => s); }
module.exports = { insertSignal, listRecent, getAll: () => signals };
