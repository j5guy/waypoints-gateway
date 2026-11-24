const crypto = require('crypto');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');
const state = require('./state');
const caddy = require('./caddy');
const compose = require('./compose');
const shared = require('./shared');
const secrets = require('./secrets');
const certs = require('./certs');
const hardware = require('./hardware');
const { applyListed } = require('./settingsutil');
const { run, runStreaming } = require('./run');

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function validate(input) {
    const errors = [];
    const out = { mode: input.mode, access: input.access, baseName: '', acmeEmail: '', bindAddr: '127.0.0.1', apps: {} };

    if (!['builtin', 'own'].includes(input.mode)) errors.push('Choose built-in proxy or your own proxy.');
    if (input.mode === 'builtin' && !['lan', 'domain'].includes(input.access)) errors.push('Choose home network or domain.');
    if (input.mode === 'own') out.access = 'own';
    out.gatewayHost = '';

    if (input.mode === 'builtin') {
        out.baseName = String(input.baseName || '').trim().toLowerCase();
        if (!HOST_RE.test(out.baseName)) errors.push('Enter a valid base name, like home.example.com or 192-168-0-5.sslip.io.');
        else out.gatewayHost = `gateway.${out.baseName}`;
        if (input.access === 'domain') {
            // Either the person's own certificate, or free ones from Let's Encrypt (which needs an email address).
            if (input.certSource === 'custom') out.customCert = true;
            else {
                out.acmeEmail = String(input.acmeEmail || '').trim();
                if (!EMAIL_RE.test(out.acmeEmail)) errors.push('Enter an email address for the certificate account.');
            }
        }
    }
    if (input.mode === 'own') {
        out.bindAddr = input.bindAddr === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
    }

    const known = state.read().apps; // apps that are already installed
    const selected = input.apps && typeof input.apps === 'object' ? input.apps : {};
    const ids = Object.keys(selected).filter(id => selected[id]);
    if (!ids.length) errors.push('Pick at least one app.');
    for (const id of ids) {
        const meta = catalog.get(id);
        if (!meta) { errors.push(`Unknown app "${id}".`); continue; }
        const a = selected[id];
        const host = String(a.host || '').trim().toLowerCase();
        if (!HOST_RE.test(host)) errors.push(`${meta.name}: enter a valid address.`);
        const entry = { host, port: meta.port, env: {} };
        if (input.mode === 'own') {
            const port = parseInt(a.port, 10);
            if (!(port >= 1 && port <= 65535)) errors.push(`${meta.name}: enter a port between 1 and 65535.`);
            entry.port = port || meta.port;
        }
        for (const f of meta.fields || []) {
            const v = String((a.fields || {})[f.env] || '').trim();
            if (f.required && !v) errors.push(`${meta.name}: ${f.label} is required.`);
            if (v && f.type === 'email' && !EMAIL_RE.test(v)) errors.push(`${meta.name}: ${f.label} must be an email address.`);
            if (/[\r\n\0]/.test(v) || v.length > 254) errors.push(`${meta.name}: ${f.label} is not valid.`);
            entry.env[f.env] = v;
        }
        // An app that is being installed for the first time can be given its settings now, the same ones its page
        // offers afterwards: the listed settings, the Advanced rows, and which shared groups to use.
        if (!known[id]) {
            errors.push(...applyListed(meta, entry, a.settings));
            if (a.extra !== undefined) {
                const ex = compose.validate(a.extra);
                errors.push(...ex.errors);
                entry.extra = ex.value;
            }
            entry.useShared = Array.isArray(a.useShared) ? a.useShared.filter(g => shared.group(g) && shared.covers(id, g) > 0) : null;
        }
        out.apps[id] = entry;
    }
    const hosts = Object.values(out.apps).map(a => a.host);
    if (new Set(hosts).size !== hosts.length) errors.push('Each app needs its own address.');

    // A certificate the person already has: it must be valid, match its key, and cover every address that will use it.
    // (When none is sent, the one saved earlier is kept and checked against the addresses.)
    if (out.customCert) {
        const given = input.cert ? { cert: input.cert, key: input.key } : (certs.current() || {});
        const check = certs.inspect(given.cert, given.key, { hosts: [out.gatewayHost, ...hosts].filter(Boolean) });
        check.errors.forEach(e => errors.push(e));
    }
    return { errors, value: out };
}

// What a newly installed app starts with besides the settings it was given: the shared groups chosen for it (or, when
// none were chosen, the groups set to all apps), and the older MongoDB where this computer's processor needs it.
function seedNewApp(value, id, hw, log) {
    const entry = value.apps[id];
    const groups = entry.useShared;
    delete entry.useShared;
    if (groups === null || groups === undefined) shared.seedNew(value, id);
    else {
        for (const g of groups) {
            shared.applyValues(value, id, g);
            // Using a shared group means taking part in it from now on, so a later save of the group reaches this app.
            const s = value.shared && value.shared[g];
            if (s && s.apps !== 'all') s.apps = Array.from(new Set([...(Array.isArray(s.apps) ? s.apps : []), id]));
        }
    }
    entry.env = entry.env || {};
    if (hw && hw.needsOldMongo && !entry.env.MONGO_IMAGE) {
        entry.env.MONGO_IMAGE = hardware.MONGO_OLD;
        if (log) log(`${hw.reason}`);
    }
}

const jobs = new Map();

function newJob() {
    const id = crypto.randomBytes(8).toString('hex');
    const job = { id, status: 'running', lines: [], steps: [], error: '' };
    jobs.set(id, job);
    if (jobs.size > 20) jobs.delete(jobs.keys().next().value);
    return job;
}

const getJob = (id) => jobs.get(id) || null;

function composeEnv(st, id) {
    const a = st.apps[id];
    return {
        WEB_FQDN: a.host,
        BIND_ADDR: st.bindAddr,
        HOST_PORT: String(a.port),
        ...a.env,
        // Secrets (passwords, keys) reach Compose here, from memory, so the override file only holds placeholders.
        ...secrets.composeSecrets(id, a),
        // Data locations moved to a folder on this computer (the compose files read these for their volumes).
        ...(a.storage || {})
    };
}

async function ensureNetwork(log) {
    const have = await run('docker', ['network', 'inspect', cfg.network], { timeout: 20000 });
    if (have.ok) return true;
    log(`Creating the ${cfg.network} network...`);
    const made = await run('docker', ['network', 'create', cfg.network], { timeout: 30000 });
    if (!made.ok) log(made.stderr.trim() || 'Could not create the network.');
    return made.ok;
}

async function apply(job, input) {
    const log = (l) => job.lines.push(l);
    const step = (name, status) => {
        const s = job.steps.find(x => x.name === name);
        if (s) s.status = status; else job.steps.push({ name, status });
    };
    const fail = (msg) => { job.status = 'failed'; job.error = msg; log(msg); };

    try {
        const { errors, value } = validate(input);
        if (errors.length) return fail(errors.join(' '));

        // Running setup again must not wipe settings saved on an app's page.
        const prev = state.read();
        for (const id of Object.keys(value.apps)) {
            const old = (prev.apps[id] && prev.apps[id].env) || {};
            value.apps[id].env = { ...old, ...value.apps[id].env };
            for (const k of ['extra', 'settings', 'storage']) if (prev.apps[id] && prev.apps[id][k]) value.apps[id][k] = prev.apps[id][k];
        }
        // Automatic-update choices and shared settings survive running setup again. A newly installed app takes the
        // shared groups that are set to "all apps".
        value.updates = prev.updates;
        value.shared = prev.shared || {};
        const hw = hardware.detect();
        if (hw.unsupported) return fail(hw.reason);
        for (const id of Object.keys(value.apps)) {
            if (prev.apps[id]) continue;
            seedNewApp(value, id, hw, log);
            compose.writeOverride(id, value.apps[id]);
        }

        step('Prepare', 'running');
        if (!(await ensureNetwork(log))) return fail('Docker would not create the shared network. Is the Docker socket mounted?');
        // Save the certificate the person gave (for the proxy to read), or drop an old one if they went back to
        // Let's Encrypt or the home network. Only its names and expiry are kept in the saved state.
        if (value.customCert) {
            if (input.cert) certs.save(input.cert, input.key);
            const saved = certs.current();
            const info = saved && certs.inspect(saved.cert, saved.key).info;
            value.customCertInfo = info ? { names: info.names, notAfter: info.notAfter, subject: info.subject } : null;
        } else {
            value.customCert = false;
            certs.remove();
        }

        value.configured = false;
        state.write(value);
        // Let the proxy reach this page too, so the Gateway has its own secure address.
        if (value.mode === 'builtin') await run('docker', ['network', 'connect', cfg.network, 'waypoints-gateway'], { timeout: 20000 });
        step('Prepare', 'done');

        if (value.mode === 'builtin') {
            step('Start the proxy', 'running');
            caddy.write(value);
            log('Starting Caddy...');
            const up = await runStreaming('docker', ['compose', '-p', 'waypoints-caddy', '-f', path.join(cfg.caddyDir, 'compose.yml'), 'up', '-d'], { onLine: log, cwd: cfg.caddyDir });
            if (!up.ok) return fail('Caddy would not start. If something else uses ports 80 and 443, go back and choose "my own proxy".');
            await caddy.reload();
            step('Start the proxy', 'done');
        } else {
            // Own proxy: make sure our Caddy is not holding ports 80/443 someone else needs.
            await run('docker', ['rm', '-f', cfg.caddyContainer], { timeout: 30000 });
        }

        for (const id of Object.keys(value.apps)) {
            const meta = catalog.get(id);
            const name = `Install ${meta.name}`;
            // An app that is already installed is left alone unless its address, port or settings changed, so adding
            // another app never updates or restarts it.
            const was = prev.apps[id];
            const now = value.apps[id];
            if (was && prev.mode === value.mode && prev.bindAddr === value.bindAddr && was.host === now.host && was.port === now.port
                && JSON.stringify(was.env || {}) === JSON.stringify(now.env || {})) {
                log(`${meta.name} is already installed and does not need changes.`);
                step(name, 'done');
                continue;
            }
            step(name, 'running');
            log(`Installing ${meta.name} (this downloads the app and its database the first time)...`);
            const files = compose.files(id, meta, value);
            const up = await runStreaming('docker', ['compose', '-p', `waypoints-${id}`, ...files, 'up', '-d'], { env: composeEnv(value, id), onLine: log, cwd: meta.dir });
            if (!up.ok) return fail(`${meta.name} did not start. See the lines above.`);
            step(name, 'done');
        }

        value.configured = true;
        state.write(value);
        job.status = 'done';
        log('All done.');
    } catch (e) {
        fail(`Unexpected error: ${e.message}`);
    }
}

const appFiles = (id, meta, st) => compose.files(id, meta, st);

// Pull newer images and recreate the containers of the given apps. Data lives in named volumes, so it is kept.
// The settings come from the saved state, the same ones used to install.
async function updateApps(job, ids) {
    const log = (l) => job.lines.push(l);
    const step = (name, status) => {
        const s = job.steps.find(x => x.name === name);
        if (s) s.status = status; else job.steps.push({ name, status });
    };
    const fail = (msg) => { job.status = 'failed'; job.error = msg; log(msg); };
    try {
        const st = state.read();
        const todo = ids.filter(id => st.apps[id] && catalog.get(id));
        if (!todo.length) return fail('Nothing to update.');

        if (st.mode === 'builtin') {
            step('Update the proxy', 'running');
            const caddyFile = path.join(cfg.caddyDir, 'compose.yml');
            const pull = await runStreaming('docker', ['compose', '-p', 'waypoints-caddy', '-f', caddyFile, 'pull'], { onLine: log, cwd: cfg.caddyDir });
            if (pull.ok) await runStreaming('docker', ['compose', '-p', 'waypoints-caddy', '-f', caddyFile, 'up', '-d'], { onLine: log, cwd: cfg.caddyDir });
            else log('Could not check for a newer proxy; leaving it as it is.');
            step('Update the proxy', 'done');
        }

        for (const id of todo) {
            const meta = catalog.get(id);
            const name = `Update ${meta.name}`;
            step(name, 'running');
            const base = ['compose', '-p', `waypoints-${id}`, ...appFiles(id, meta, st)];
            const opts = { env: composeEnv(st, id), onLine: log, cwd: meta.dir };
            log(`Downloading the newest ${meta.name}...`);
            const pull = await runStreaming('docker', [...base, 'pull'], opts);
            if (!pull.ok) return fail(`Could not download ${meta.name}. Nothing was changed.`);
            const up = await runStreaming('docker', [...base, 'up', '-d'], opts);
            if (!up.ok) return fail(`${meta.name} did not restart. See the lines above.`);
            step(name, 'done');
        }
        job.status = 'done';
        log('All done.');
    } catch (e) {
        fail(`Unexpected error: ${e.message}`);
    }
}

async function appStatuses(st) {
    const out = {};
    for (const id of Object.keys(st.apps)) {
        const meta = catalog.get(id);
        if (!meta) continue;
        const r = await run('docker', ['inspect', '-f', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}', meta.container], { timeout: 15000 });
        const [status, health] = r.ok ? r.stdout.trim().split('|') : ['missing', ''];
        out[id] = { status, health };
    }
    return out;
}

module.exports = { validate, newJob, getJob, apply, updateApps, appStatuses, composeEnv, seedNewApp };
