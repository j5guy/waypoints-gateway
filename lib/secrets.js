const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');
const shared = require('./shared');

// Saved passwords and secrets are encrypted before they are written to state.json (AES-256-GCM), and are only
// decrypted in memory. The key lives in its own Docker volume (mounted at /key), apart from the data volume, so a
// copy or backup of the data volume holds only encrypted secrets. If that volume is not mounted the key is kept in
// the data volume instead (and the Settings page says so): it still keeps secrets out of casual view, but not out of
// a copy of that volume.
//
// What this cannot do: the Gateway has to be able to decrypt secrets to start apps, and the apps receive them as
// environment variables (visible with `docker inspect`). Root on the host or access to the Docker socket reaches both.
const PREFIX = 'enc:v1:';
const KEY_FILE = 'master.key';

// A setting is a secret when its catalog definition says so, or its name looks like one.
const SECRET_NAME = /secret|pass|token|key|pwd|pw$/i;

function isMountPoint(dir) {
    try {
        const target = path.resolve(dir);
        return fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(l => l.split(' ')[4] === target);
    } catch (_) { return false; }
}

let cached = null;

function load() {
    if (cached) return cached;
    const separate = isMountPoint(cfg.keyDir);
    const dataKey = path.join(cfg.dataDir, KEY_FILE);
    const sepKey = path.join(cfg.keyDir, KEY_FILE);
    let file = separate ? sepKey : dataKey;

    // Prefer an existing key wherever it is. If the key volume has appeared since the key was made in the data
    // volume, move it across so it ends up apart from the data.
    if (separate && !fs.existsSync(sepKey) && fs.existsSync(dataKey)) {
        fs.copyFileSync(dataKey, sepKey);
        fs.chmodSync(sepKey, 0o600);
        fs.unlinkSync(dataKey);
    }
    let key;
    try { key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex'); } catch (_) { key = null; }
    if (!key || key.length !== 32) {
        key = crypto.randomBytes(32);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 });
    }
    if (!separate) console.warn('Secrets key is stored in the data volume. Add the key volume to the compose file to keep it separate.');
    cached = { key, separate };
    return cached;
}

const status = () => ({ separate: load().separate });

const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);

function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', load().key, iv);
    const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return PREFIX + [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join(':');
}

// Returns the plain text, or null when it cannot be read (the key was lost or changed).
function decrypt(token) {
    try {
        const [iv, tag, data] = token.slice(PREFIX.length).split(':').map(s => Buffer.from(s, 'base64'));
        const d = crypto.createDecipheriv('aes-256-gcm', load().key, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(data), d.final()]).toString('utf8');
    } catch (_) { return null; }
}

function isSecretSetting(appId, env) {
    const meta = catalog.get(appId);
    const s = meta && (meta.settings || []).find(x => x.env === env);
    return !!(s && s.type === 'secret') || SECRET_NAME.test(env);
}

const isSharedSecret = (key) => shared.GROUPS.some(g => g.fields.some(f => f.key === key && f.type === 'secret'));

// Visit every value that is stored as a secret: fn(owner, key, value) returns the replacement.
function walk(st, fn) {
    for (const [id, a] of Object.entries(st.apps || {})) {
        for (const [k, v] of Object.entries(a.settings || {})) if (isSecretSetting(id, k) && v !== '') a.settings[k] = fn(v);
        for (const row of (a.extra && a.extra.env) || []) if (isSecretSetting(id, row.name) && row.value !== '') row.value = fn(row.value);
    }
    for (const s of Object.values(st.shared || {})) {
        for (const [k, v] of Object.entries(s.values || {})) if (isSharedSecret(k) && v !== '') s.values[k] = fn(v);
    }
}

// A copy of the state, with every secret encrypted, for writing to disk.
function seal(st) {
    const out = JSON.parse(JSON.stringify(st));
    walk(out, (v) => (isEncrypted(v) ? v : encrypt(v)));
    return out;
}

// Decrypt the state in place after reading it. A secret that cannot be decrypted becomes empty (and is logged).
function open(st) {
    walk(st, (v) => {
        if (!isEncrypted(v)) return v; // not yet encrypted (an older version): sealed on the next write
        const plain = decrypt(v);
        if (plain === null) { console.error('A saved secret could not be decrypted (the key was lost or changed). Enter it again.'); return ''; }
        return plain;
    });
    return st;
}

// The secrets of one app as environment variables, so they reach Docker Compose without being written to a file.
function composeSecrets(id, a) {
    const env = {};
    for (const [k, v] of Object.entries(a.settings || {})) if (isSecretSetting(id, k) && v !== '') env[k] = String(v);
    for (const row of (a.extra && a.extra.env) || []) if (isSecretSetting(id, row.name) && row.value !== '') env[row.name] = String(row.value);
    return env;
}

module.exports = { status, seal, open, isSecretSetting, composeSecrets, isEncrypted };
