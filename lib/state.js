const fs = require('fs');
const path = require('path');
const { dataDir } = require('./config');
const secrets = require('./secrets');

// Everything the gateway remembers lives in one small JSON file in the data volume:
// { mode: 'builtin'|'own', access: 'lan'|'domain', baseName, acmeEmail, bindAddr, gatewayHost,
//   apps: { id: { host, port, env, settings, extra, storage } },
//   updates: { apps: { id: true }, hour, day, backup, last: { id: 'YYYY-MM-DD' } },   // automatic updates, per app
//   shared: { groupId: { values, apps: 'all' | [ids] } } }                            // Shared settings page
// Secrets in it (passwords, keys, tokens) are encrypted on disk and plain only in memory (lib/secrets.js).
const FILE = path.join(dataDir, 'state.json');

const defaultUpdates = () => ({ apps: {}, hour: 3, day: 'daily', backup: false, last: {} });
const empty = () => ({ configured: false, mode: '', access: '', baseName: '', acmeEmail: '', bindAddr: '127.0.0.1', apps: {}, updates: defaultUpdates(), shared: {}, appearance: require('./appearance').defaults() });

function read() {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return empty(); }
    const st = { ...empty(), ...saved };
    st.updates = { ...defaultUpdates(), ...(saved.updates || {}) };
    st.appearance = { ...require('./appearance').defaults(), ...(saved.appearance || {}) };
    // An older gateway had one switch for every app: carry it over as "on" for each app.
    if (saved.autoUpdate === true && !saved.updates) {
        Object.keys(st.apps || {}).forEach((id) => { st.updates.apps[id] = true; });
    }
    delete st.autoUpdate;
    delete st.lastAutoUpdate;
    return secrets.open(st);
}

function write(state) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(secrets.seal(state), null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
}

// At start: encrypt any secrets an older version saved in plain text.
function migrate() {
    if (!fs.existsSync(FILE)) return false;
    const before = fs.readFileSync(FILE, 'utf8');
    write(read());
    return fs.readFileSync(FILE, 'utf8') !== before;
}

module.exports = { read, write, migrate, FILE, dir: path.dirname(FILE) };
