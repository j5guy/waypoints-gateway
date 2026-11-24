const https = require('https');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');
const state = require('./state');
const installer = require('./installer');
const compose = require('./compose');
const shared = require('./shared');
const { validateSetting, applyListed } = require('./settingsutil');
const { run, runStreaming } = require('./run');

const dbName = (meta) => meta.container.replace(/-app$/, '-mongo');

function composeBase(st, id) {
    const meta = catalog.get(id);
    return ['compose', '-p', `waypoints-${id}`, ...compose.files(id, meta, st)];
}

async function inspect(name) {
    const r = await run('docker', ['inspect', '-f', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Created}}|{{.Image}}|{{.State.StartedAt}}', name], { timeout: 15000 });
    if (!r.ok) return { exists: false };
    const [status, health, created, image, started] = r.stdout.trim().split('|');
    return { exists: true, status, health, created, image: String(image || '').replace('sha256:', '').slice(0, 12), started };
}

// The value a setting currently has: what was saved, otherwise its default. Settings aimed at Docker Compose itself
// (like the database image) are kept with the app's environment, the rest in `settings`.
const savedValue = (a, s) => (s.target === 'compose' ? (a.env || {})[s.env] : (a.settings || {})[s.env]);

async function info(id) {
    const st = state.read();
    const meta = catalog.get(id);
    const a = st.apps[id];
    if (!meta || !a) return null;
    const c = await inspect(meta.container);
    const secrets = {};
    const values = {};
    for (const s of meta.settings || []) {
        const v = savedValue(a, s);
        if (s.type === 'secret') secrets[s.env] = !!v;
        else values[s.env] = v !== undefined ? v : (s.default || '');
    }
    const storage = (meta.storage || []).map((s) => ({
        env: s.env, label: s.label, help: s.help,
        folder: (a.storage || {})[s.env] || '',
        volume: `waypoints-${id}_${s.volume}`
    }));
    return {
        id, name: meta.name, description: meta.description, host: a.host, port: a.port, mode: st.mode,
        container: c, settings: meta.settings || [], values, secrets, storage,
        extra: { env: (a.extra && a.extra.env) || [], tag: (a.extra && a.extra.tag) || '', memory: (a.extra && a.extra.memory) || '' }
    };
}

async function action(id, act) {
    const st = state.read();
    if (!st.apps[id] || !catalog.get(id)) return { ok: false, error: 'Unknown app.' };
    if (!['start', 'stop', 'restart'].includes(act)) return { ok: false, error: 'Unknown action.' };
    const r = await run('docker', [...composeBase(st, id), act], { env: installer.composeEnv(st, id), timeout: 120000, cwd: catalog.get(id).dir });
    return { ok: r.ok, error: r.ok ? '' : (r.stderr.trim().split('\n').pop() || 'Docker could not do that.') };
}

async function logs(id, lines) {
    const meta = catalog.get(id);
    if (!meta || !state.read().apps[id]) return null;
    const n = Math.min(Math.max(parseInt(lines, 10) || 200, 20), 1000);
    const r = await run('docker', ['logs', '--tail', String(n), '--timestamps', meta.container], { timeout: 20000 });
    return (r.stdout + r.stderr).trim();
}

function probe(host) {
    return new Promise((resolve) => {
        const req = https.request({ host, port: 443, path: '/healthz', method: 'GET', timeout: 8000, rejectUnauthorized: false }, (res) => { res.resume(); resolve({ reachable: true, status: res.statusCode }); });
        req.on('timeout', () => { req.destroy(); resolve({ reachable: false, error: 'no answer' }); });
        req.on('error', (e) => resolve({ reachable: false, error: e.code || e.message }));
        req.end();
    });
}

// Plain-language checks. Each result is { ok, label, fix } and the fix is one short sentence.
async function checks(id) {
    const st = state.read();
    const meta = catalog.get(id);
    const a = st.apps[id];
    if (!meta || !a) return null;
    const out = [];
    const app = await inspect(meta.container);
    const db = await inspect(dbName(meta));

    out.push(app.exists && app.status === 'running'
        ? { ok: true, label: `${meta.name} is running` }
        : { ok: false, label: `${meta.name} is not running`, fix: 'Press Start.' });
    if (app.exists && app.status === 'running' && app.health) {
        out.push(app.health === 'healthy'
            ? { ok: true, label: 'It reports healthy' }
            : { ok: false, label: `It reports ${app.health}`, fix: app.health === 'starting' ? 'Wait a minute, it is still starting.' : 'Open the log below and look for the first error.' });
    }
    out.push(db.exists && db.status === 'running' && (db.health === '' || db.health === 'healthy')
        ? { ok: true, label: 'The database is running' }
        : { ok: false, label: 'The database is not ready', fix: 'Press Restart. If it keeps happening, the computer may be low on memory or disk space.' });

    if (st.mode === 'builtin') {
        const proxy = await inspect(cfg.caddyContainer);
        out.push(proxy.exists && proxy.status === 'running'
            ? { ok: true, label: 'The secure proxy is running' }
            : { ok: false, label: 'The secure proxy is not running', fix: 'Open Settings, choose Change network settings, and finish setup again.' });
    }

    const p = await probe(a.host);
    if (p.reachable && p.status < 500) out.push({ ok: true, label: `https://${a.host} answers` });
    else if (p.reachable) out.push({ ok: false, label: `https://${a.host} answers with an error (${p.status})`, fix: 'Press Restart, then look at the log below.' });
    else out.push({
        ok: false,
        label: `https://${a.host} does not answer`,
        fix: st.mode === 'own'
            ? 'Your proxy is not forwarding to this app yet. Open the proxy settings on this page and copy them in.'
            : (st.access === 'domain'
                ? 'Check that this name points at this computer and that ports 80 and 443 are open.'
                : 'Check that this computer is on and the address is right. Names ending in sslip.io need internet access to resolve.')
    });
    return out;
}

// ---- settings: the lists in the catalog, plus the free-form rows, a pinned version and a memory limit ----

// Save the Settings card (listed settings, then the Advanced "anything else" rows) and recreate the app with them.
function applySettings(id, body) {
    const st = state.read();
    const meta = catalog.get(id);
    const a = st.apps[id];
    if (!meta || !a) return { errors: ['Unknown app.'] };
    const given = body && body.values && typeof body.values === 'object' ? body.values : {};
    // Work on a copy, so nothing is saved if a value is wrong.
    const draft = { env: a.env, settings: a.settings };
    const errors = applyListed(meta, draft, given);

    let extra = a.extra || { env: [], tag: '', memory: '' };
    if (body && body.extra !== undefined) {
        const v = compose.validate(body.extra);
        v.errors.forEach(e => errors.push(e));
        extra = v.value;
    }
    if (errors.length) return { errors };

    a.env = draft.env;
    a.settings = draft.settings;
    a.extra = extra;
    state.write(st);
    compose.writeOverride(id, a);

    const job = installer.newJob();
    (async () => {
        job.steps.push({ name: `Restart ${meta.name}`, status: 'running' });
        const base = composeBase(st, id);
        const opts = { env: installer.composeEnv(st, id), onLine: (l) => job.lines.push(l), cwd: meta.dir };
        // A pinned version has to be downloaded before it can run.
        if (extra.tag) await runStreaming('docker', [...base, 'pull', 'app'], opts);
        const up = await runStreaming('docker', [...base, 'up', '-d'], opts);
        job.steps[0].status = up.ok ? 'done' : 'failed';
        if (up.ok) { job.status = 'done'; job.lines.push('Saved.'); }
        else { job.status = 'failed'; job.error = `${meta.name} did not restart with those settings. See the lines above. Clear the field you changed and save to go back to the default.`; }
    })();
    return { job: job.id };
}

// ---- storage: keep a data location in a Docker volume, or in a folder on this computer ----

// Folders that must never be used as data locations.
const FORBIDDEN = new Set(['/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/root', '/run', '/sbin', '/sys', '/usr', '/var', '/var/lib', '/var/lib/docker', '/var/run', '/home', '/tmp']);

function cleanFolder(input) {
    const raw = String(input || '').trim();
    if (!raw) return { value: '' }; // back to a Docker-managed volume
    if (!/^\/[A-Za-z0-9_.\/-]*$/.test(raw)) return { error: 'Use a full path that starts with / and has only letters, numbers, dots, dashes and underscores.' };
    if (raw.split('/').includes('..')) return { error: 'The path cannot contain "..".' };
    const norm = path.posix.normalize(raw).replace(/\/+$/, '') || '/';
    if (FORBIDDEN.has(norm) || norm.startsWith('/var/lib/docker/')) return { error: 'Pick a folder made for this, like /srv/waypoints/fond, not a system folder.' };
    return { value: norm };
}

const fmtSize = (kb) => (kb >= 1048576 ? (kb / 1048576).toFixed(1) + ' GB' : kb >= 1024 ? Math.round(kb / 1024) + ' MB' : Math.max(1, kb) + ' KB');
const NETWORK_FS = /^(nfs|nfs4|cifs|smb|smb2|smbfs|fuse\.sshfs|sshfs|afs|ncpfs|9p)$/i;

// Everything worth knowing before data is moved, found out without stopping the app. Each check is
// { ok, level ('ok', 'info', 'warn' or 'error'), label, fix }; only an 'error' blocks the move. The move runs this
// again before it touches anything, so it cannot be skipped.
async function checkStorage(id, env, target, existing) {
    const st = state.read();
    const meta = catalog.get(id);
    const a = st.apps[id];
    const loc = meta && (meta.storage || []).find(s => s.env === env);
    const checks = [];
    const add = (level, label, fix) => checks.push({ ok: level === 'ok' || level === 'info', level, label, fix: fix || '' });
    const finish = (extra) => ({ ok: !checks.some(c => c.level === 'error'), checks, ...(extra || {}) });

    if (!meta || !a || !loc) { add('error', 'Unknown storage location.'); return finish(); }
    const c = cleanFolder(target);
    if (c.error) { add('error', c.error); return finish(); }
    const now = (a.storage || {})[env] || '';
    if (c.value === now) { add('error', 'The data is already there.'); return finish(); }
    add('ok', c.value ? `The folder name is fine: ${c.value}` : 'Moving back to Docker-managed storage.');

    // The folder must not be, hold, or sit inside another location of this app or any other app.
    if (c.value) {
        for (const [appId, app] of Object.entries(st.apps)) {
            for (const [e, p] of Object.entries(app.storage || {})) {
                if (appId === id && e === env) continue;
                if (p === c.value || p.startsWith(c.value + '/') || c.value.startsWith(p + '/')) {
                    const other = catalog.get(appId);
                    const part = ((other && other.storage) || []).find(s => s.env === e);
                    add('error', `That folder overlaps the ${part ? part.label.toLowerCase() : 'data'} of ${other ? other.name : appId} (${p}).`, 'Pick a separate folder for each part of each app.');
                }
            }
        }
    }

    // No point probing a folder that has already failed.
    if (checks.some(c => c.level === 'error')) return finish();

    // Look at the source and (for a folder) the destination from inside a helper container.
    const volume = `waypoints-${id}_${loc.volume}`;
    const from = now || volume;
    const mounts = ['-v', `${from}:/from:ro`];
    if (c.value) mounts.push('-v', `${c.value}:/to`);
    const script = [
        'echo size=$(du -sk /from 2>/dev/null | cut -f1)',
        c.value ? 'echo writable=$([ -w /to ] && echo 1 || echo 0)' : '',
        c.value ? 'echo empty=$([ -z "$(ls -A /to 2>/dev/null)" ] && echo 1 || echo 0)' : '',
        c.value ? "echo avail=$(df -Pk /to | tail -1 | awk '{print $4}')" : '',
        c.value ? 'echo fstype=$(stat -f -c %T /to 2>/dev/null)' : ''
    ].filter(Boolean).join('\n');
    const probe = await run('docker', ['run', '--rm', ...mounts, '--entrypoint', 'sh', 'docker:27-cli', '-c', script], { timeout: 180000 });
    if (!probe.ok) { add('error', 'Could not look at that location.', probe.stderr.trim().split('\n').pop() || 'Check that the path exists and Docker may use it.'); return finish(); }
    const facts = {};
    probe.stdout.split('\n').forEach((l) => { const i = l.indexOf('='); if (i > 0) facts[l.slice(0, i)] = l.slice(i + 1).trim(); });
    const sizeKb = parseInt(facts.size, 10) || 0;
    const availKb = parseInt(facts.avail, 10) || 0;

    if (!c.value) {
        add('info', `${fmtSize(sizeKb)} will be copied back into a Docker volume. ${meta.name} stops while it copies.`);
        return finish({ sizeKb });
    }
    if (facts.writable !== '1') add('error', 'Docker cannot write to that folder.', 'Check the path, and that the folder (or its parent) is not read-only.');
    else add('ok', 'The folder can be written to.');

    if (existing) {
        if (facts.empty === '1') add('error', 'That folder is empty, so there is no data in it to use.', 'Untick "This folder already holds my data" to copy your data into it instead.');
        else add('info', 'The folder already has files. They will be used as they are, and nothing is copied.');
    } else {
        if (facts.empty !== '1') add('error', 'That folder is not empty.', 'Pick an empty folder so two sets of data are never mixed, or tick "This folder already holds my data".');
        else add('ok', 'The folder is empty.');
        const need = Math.ceil(sizeKb * 1.1);
        if (availKb && availKb < need) add('error', `Not enough free space there: about ${fmtSize(need)} needed, ${fmtSize(availKb)} free.`, 'Pick a folder on a disk with more room.');
        else if (availKb && availKb < sizeKb * 1.5) add('warn', `Space is tight: ${fmtSize(availKb)} free for ${fmtSize(sizeKb)} of data.`, 'It fits, but the disk will be nearly full.');
        else if (availKb) add('ok', `There is enough free space (${fmtSize(availKb)} free, ${fmtSize(sizeKb)} needed).`);
        add('info', `${fmtSize(sizeKb)} will be copied. ${meta.name} stops while it copies and starts again after. Your old copy is kept.`);
    }
    if (NETWORK_FS.test(facts.fstype || '') && loc.volume === 'mongo-data') {
        add('warn', `That folder looks like a network drive (${facts.fstype}). MongoDB can lose or damage data on network drives.`, 'Keep the Database on a disk inside this computer, and put Backups on the network drive instead.');
    }
    return finish({ sizeKb, availKb });
}

// Wait for an app to be running (and healthy if it reports health) after a change. A container that is up but has no
// health check has to stay up for a few seconds before it counts.
async function waitRunning(name, seconds) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
        const c = await inspect(name);
        if (c.exists && (c.status === 'exited' || c.health === 'unhealthy')) return false;
        if (c.exists && c.status === 'running' && c.health === 'healthy') return true;
        if (c.exists && c.status === 'running' && !c.health) {
            await new Promise(r => setTimeout(r, 8000));
            const again = await inspect(name);
            return !!(again.exists && again.status === 'running');
        }
        await new Promise(r => setTimeout(r, 3000));
    }
    return false;
}

// Move one data location of an app, copying what is there so nothing looks wiped. The checks run first, before the app
// is touched. The app stops while it copies, the copy is verified, and the app starts again from the new place; if it
// does not come up the old place is put back automatically. The old copy is always kept.
function moveStorage(id, env, target, existing) {
    const st = state.read();
    const meta = catalog.get(id);
    const a = st.apps[id];
    const loc = meta && (meta.storage || []).find(s => s.env === env);
    if (!meta || !a || !loc) return { errors: ['Unknown storage location.'] };
    const c = cleanFolder(target);
    if (c.error) return { errors: [c.error] };
    const now = (a.storage || {})[env] || '';
    if (c.value === now) return { errors: ['It is already there.'] };

    const volume = `waypoints-${id}_${loc.volume}`;
    const job = installer.newJob();
    (async () => {
        const log = (l) => job.lines.push(l);
        const fail = (m) => { job.status = 'failed'; job.error = m; log(m); };
        const base = composeBase(st, id);
        const opts = (e) => ({ env: e, onLine: log, cwd: meta.dir });
        try {
            // 1. The checks, before anything is stopped. Nothing is changed if one fails.
            job.steps.push({ name: 'Check', status: 'running' });
            log('Checking the new location...');
            const chk = await checkStorage(id, env, c.value, existing);
            chk.checks.forEach(x => log(`${x.ok ? 'OK' : (x.level === 'warn' ? 'Note' : 'Problem')}: ${x.label}${x.fix ? ' ' + x.fix : ''}`));
            if (!chk.ok) {
                job.steps[0].status = 'failed';
                return fail('Nothing was changed. ' + chk.checks.filter(x => x.level === 'error').map(x => x.label).join(' '));
            }
            job.steps[0].status = 'done';

            job.steps.push({ name: `Move ${loc.label.toLowerCase()}`, status: 'running' });
            log(`Stopping ${meta.name} while your data is copied...`);
            await runStreaming('docker', [...base, 'stop'], opts(installer.composeEnv(st, id)));

            // Source and destination, as Docker mount arguments.
            const from = now ? now : volume;
            const to = c.value ? c.value : volume;
            if (!c.value) await run('docker', ['volume', 'create', '--label', `com.docker.compose.project=waypoints-${id}`, '--label', `com.docker.compose.volume=${loc.volume}`, volume], { timeout: 20000 });

            const restore = () => runStreaming('docker', [...base, 'up', '-d'], opts(installer.composeEnv(st, id)));
            if (existing && c.value) {
                // The folder already holds this app's data (for example after "keep my data"): point at it, copy nothing.
                log('Using the data already in that folder, without copying.');
            } else {
                log('Copying your data...');
                const copy = await runStreaming('docker', ['run', '--rm', '-v', `${from}:/from:ro`, '-v', `${to}:/to`, '--entrypoint', 'sh', 'docker:27-cli', '-c', 'cp -a /from/. /to/ && echo copied'], opts(process.env));
                if (!copy.ok) { await restore(); return fail('The copy failed, so nothing was changed and the app is running as before.'); }

                // The copy has to match what it was copied from before the app is pointed at it.
                log('Checking the copy...');
                const verify = await run('docker', ['run', '--rm', '-v', `${from}:/from:ro`, '-v', `${to}:/to:ro`, '--entrypoint', 'sh', 'docker:27-cli', '-c',
                    'a=$(cd /from && find . | wc -l); b=$(cd /to && find . | wc -l); if [ "$a" = "$b" ]; then echo same; else echo "different $a $b"; fi'], { timeout: 600000 });
                if (!verify.ok || verify.stdout.trim() !== 'same') {
                    await restore();
                    return fail(`The copy does not match the original (${verify.stdout.trim() || 'could not compare'}), so nothing was changed and the app is running as before.`);
                }
                log('The copy matches.');
            }

            const fresh = state.read();
            const app = fresh.apps[id];
            app.storage = { ...(app.storage || {}) };
            if (c.value) app.storage[env] = c.value; else delete app.storage[env];
            state.write(fresh);

            log(`Starting ${meta.name} with its data in the new place...`);
            const up = await runStreaming('docker', [...composeBase(fresh, id), 'up', '-d'], opts(installer.composeEnv(fresh, id)));
            const healthy = up.ok && await waitRunning(meta.container, 120);

            // If the app does not come up from the new place, put the old place back and start it again.
            if (!healthy) {
                log(`${meta.name} did not start properly from the new place. Putting it back where it was...`);
                const back = state.read();
                back.apps[id].storage = { ...(back.apps[id].storage || {}) };
                if (now) back.apps[id].storage[env] = now; else delete back.apps[id].storage[env];
                state.write(back);
                await runStreaming('docker', [...composeBase(back, id), 'up', '-d'], opts(installer.composeEnv(back, id)));
                return fail(`${meta.name} would not start from the new place, so it was put back and nothing was lost. Your data is still at ${from}. The folder you chose now holds an unused copy.`);
            }
            job.steps[job.steps.length - 1].status = 'done';
            job.status = 'done';
            job.oldCopy = now ? now : volume;
            log(`Done. Your old copy was kept at ${job.oldCopy}. Delete it once you have checked everything works.`);
        } catch (e) {
            fail(`Unexpected error: ${e.message}`);
        }
    })();
    return { job: job.id };
}

// ---- shared settings: set once, carried to the apps you choose ----

// Save one group (email, LDAP, SSO, backups, time zone) and apply it to the chosen apps, restarting those whose
// settings changed. `body.apps` is 'all' (every app that uses the group, including ones installed later) or a list.
// Apps that were ticked before and are not now keep what they already have.
function saveShared(groupId, body) {
    const g = shared.group(groupId);
    if (!g) return { errors: ['Unknown group.'] };
    const st = state.read();
    const given = body && body.values && typeof body.values === 'object' ? body.values : {};
    const errors = [];
    st.shared = st.shared || {};
    const cur = st.shared[groupId] || { values: {}, apps: [] };
    const values = { ...cur.values };

    for (const f of g.fields) {
        if (!(f.key in given)) continue;
        const raw = given[f.key];
        if (f.type === 'secret' && (raw === null || raw === undefined)) continue; // unchanged
        const r = validateSetting({ label: f.label, type: f.type, options: f.options }, raw);
        if (r.error) { errors.push(r.error); continue; }
        // Empty means "not set": remove it. A switch is always kept so turning one off is remembered.
        if (r.value === '' ) delete values[f.key]; else values[f.key] = r.value;
    }
    if (errors.length) return { errors };

    const usable = (id) => shared.covers(id, groupId) > 0;
    let apps;
    if (body && body.apps === 'all') apps = 'all';
    else apps = (Array.isArray(body && body.apps) ? body.apps : []).map(String).filter(id => catalog.get(id) && usable(id));
    st.shared[groupId] = { values, apps };

    const targets = (apps === 'all' ? Object.keys(st.apps) : apps).filter(id => st.apps[id] && usable(id));
    const restart = [];
    for (const id of targets) {
        if (shared.applyValues(st, id, groupId)) { compose.writeOverride(id, st.apps[id]); restart.push(id); }
    }
    state.write(st);

    const job = installer.newJob();
    (async () => {
        if (!restart.length) { job.status = 'done'; job.lines.push('Saved. No app needed to change.'); return; }
        let failed = false;
        for (const id of restart) {
            const meta = catalog.get(id);
            job.steps.push({ name: `Restart ${meta.name}`, status: 'running' });
            const up = await runStreaming('docker', [...composeBase(st, id), 'up', '-d'], { env: installer.composeEnv(st, id), onLine: (l) => job.lines.push(l), cwd: meta.dir });
            job.steps[job.steps.length - 1].status = up.ok ? 'done' : 'failed';
            if (!up.ok) { failed = true; job.lines.push(`${meta.name} did not restart with these settings.`); }
        }
        if (failed) { job.status = 'failed'; job.error = 'An app did not restart with these settings. See the lines above, then check its page.'; }
        else { job.status = 'done'; job.lines.push('Saved and applied.'); }
    })();
    return { job: job.id };
}

module.exports = { info, action, logs, checks, applySettings, moveStorage, checkStorage, cleanFolder, saveShared };
