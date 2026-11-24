const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./config');

// The gateway can start containers (it holds the Docker socket), so it is behind a password. The first person to
// open a brand-new gateway creates it; to stop an old, forgotten gateway from staying open to whoever finds it, that
// is only possible for the first 15 minutes after it starts (restarting it opens a new window).
const FILE = path.join(dataDir, 'auth.json');
const CLAIM_WINDOW_MS = 15 * 60 * 1000;
const startedAt = Date.now();

function readAuth() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return null; }
}

const hash = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

const claimed = () => !!readAuth();
const canClaim = () => !claimed() && Date.now() - startedAt < CLAIM_WINDOW_MS;

function setPassword(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) return false;
    const salt = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ salt, hash: hash(password, salt) }), { mode: 0o600 });
    return true;
}

const sessions = new Map(); // token -> expires
const SESSION_MS = 12 * 60 * 60 * 1000;

// After 8 wrong passwords from one address, wait 15 minutes. A global cap stops many addresses sharing the work.
const attempts = new Map(); // ip -> { n, until }
let globalFails = [];
const MAX_PER_IP = 8;
const LOCK_MS = 15 * 60 * 1000;

function limited(ip) {
    const now = Date.now();
    globalFails = globalFails.filter(t => now - t < LOCK_MS);
    if (globalFails.length >= 40) return true;
    const a = attempts.get(ip);
    return !!(a && a.until && a.until > now);
}

function newSession() {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    return token;
}

function login(ip, password) {
    if (limited(ip)) return { ok: false, limited: true };
    const rec = readAuth();
    let same = false;
    if (rec && typeof password === 'string' && password.length <= 200) {
        const a = Buffer.from(hash(password, rec.salt), 'hex');
        const b = Buffer.from(rec.hash, 'hex');
        same = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (same) { attempts.delete(ip); return { ok: true, token: newSession() }; }
    const r = attempts.get(ip) || { n: 0, until: 0 };
    r.n += 1;
    if (r.n >= MAX_PER_IP) { r.until = Date.now() + LOCK_MS; r.n = 0; }
    attempts.set(ip, r);
    globalFails.push(Date.now());
    return { ok: false, limited: false };
}

// Create the first password and sign in.
function claim(password) {
    if (!canClaim()) return { ok: false };
    if (!setPassword(password)) return { ok: false, weak: true };
    return { ok: true, token: newSession() };
}

function changePassword(current, next) {
    const rec = readAuth();
    if (!rec) return false;
    const a = Buffer.from(hash(String(current || ''), rec.salt), 'hex');
    const b = Buffer.from(rec.hash, 'hex');
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return false;
    return setPassword(next);
}

function valid(token) {
    const exp = sessions.get(token);
    if (!exp) return false;
    if (exp < Date.now()) { sessions.delete(token); return false; }
    return true;
}

const end = (token) => sessions.delete(token);

module.exports = { claimed, canClaim, claim, login, changePassword, valid, end, SESSION_MS };
