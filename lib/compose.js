const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');
const secrets = require('./secrets');

// Per-app overrides saved from the Advanced box on an app's page become an extra Compose file that is layered on top
// of the catalog's compose.yml. It lives in the data volume, so it survives updates.
const OVERRIDE_DIR = path.join(cfg.dataDir, 'overrides');
const overridePath = (id) => path.join(OVERRIDE_DIR, `${id}.yml`);

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const BLOCKED = new Set(['PORT']); // changing it would break the proxy's route to the app
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const MEM_RE = /^\d{2,5}[mMgG]$/;

// A value as a double-quoted YAML string, with $ doubled so Compose does not treat it as a variable.
const q = (v) => JSON.stringify(String(v).replace(/\$/g, '$$$$'));

function validate(input) {
    const errors = [];
    const out = { env: [], tag: '', memory: '' };
    const given = input && typeof input === 'object' ? input : {};

    const seen = new Set();
    for (const row of Array.isArray(given.env) ? given.env : []) {
        const name = String((row && row.name) || '').trim();
        const value = String((row && row.value) === undefined || (row && row.value) === null ? '' : row.value);
        if (!name && !value) continue; // an empty row
        if (!NAME_RE.test(name)) { errors.push(`"${name}" is not a valid name. Use letters, numbers and underscores.`); continue; }
        if (BLOCKED.has(name)) { errors.push(`${name} is set by the Gateway and cannot be changed here.`); continue; }
        if (seen.has(name)) { errors.push(`${name} is listed twice.`); continue; }
        if (/[\r\n\0]/.test(value) || value.length > 2000) { errors.push(`The value for ${name} is not valid.`); continue; }
        seen.add(name);
        out.env.push({ name, value });
    }
    const tag = String(given.tag || '').trim();
    if (tag && !TAG_RE.test(tag)) errors.push('The version can only contain letters, numbers, dots, dashes and underscores.');
    else out.tag = tag;
    const mem = String(given.memory || '').trim();
    if (mem && !MEM_RE.test(mem)) errors.push('The memory limit looks like 512m or 2g.');
    else out.memory = mem;
    return { errors, value: out };
}

// Write (or remove) the override file for one app. `a` is the app's saved state: `settings` (values from the
// settings lists, ENV -> value) and `extra` (free-form rows, a pinned version and a memory limit). The free-form
// rows win over a listed setting with the same name.
function writeOverride(id, a) {
    const meta = catalog.get(id);
    const app = a || {};
    const e = app.extra || {};
    const env = new Map();
    for (const [name, value] of Object.entries(app.settings || {})) env.set(name, String(value));
    for (const { name, value } of e.env || []) env.set(name, String(value));
    if (!env.size && !e.tag && !e.memory) { try { fs.unlinkSync(overridePath(id)); } catch (_) { /* none */ } return; }
    const lines = ['# Written by the Waypoints Gateway from the app\'s Settings. Edit it there, not here.', 'services:', '  app:'];
    if (e.tag && meta && meta.image) lines.push(`    image: ${meta.image}:${e.tag}`);
    if (e.memory) lines.push(`    mem_limit: ${e.memory}`);
    if (env.size) {
        lines.push('    environment:');
        // A secret is not written to this file: it is a placeholder, and the Gateway supplies the real value from
        // memory whenever it runs Docker Compose (installer.composeEnv).
        for (const [name, value] of env) lines.push(`      ${name}: ${secrets.isSecretSetting(id, name) && value !== '' ? `"\${${name}}"` : q(value)}`);
    }
    fs.mkdirSync(OVERRIDE_DIR, { recursive: true });
    fs.writeFileSync(overridePath(id), lines.join('\n') + '\n', { mode: 0o600 });
}

// The `-f` arguments for one app: its compose.yml, the own-proxy port file if needed, and its override if it has one.
function files(id, meta, st) {
    const list = ['-f', path.join(meta.dir, 'compose.yml')];
    if (st.mode === 'own') list.push('-f', path.join(meta.dir, 'own-proxy.yml'));
    if (fs.existsSync(overridePath(id))) list.push('-f', overridePath(id));
    return list;
}

module.exports = { validate, writeOverride, files, overridePath };
