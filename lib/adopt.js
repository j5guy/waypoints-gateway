const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');
const state = require('./state');
const caddy = require('./caddy');
const compose = require('./compose');
const installer = require('./installer');
const uninstaller = require('./uninstall');
const { run, runStreaming } = require('./run');

// Bring an app that was installed by hand (before the Gateway) under the Gateway's management.
//
// The old install is never modified until its data has a copy to go to: it is stopped, renamed (so the Gateway's
// own container can take the name) and kept as a backup. If any step fails the old install is started again.
const HELPER_IMAGE = 'docker:27-cli';
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

// Where each data location is mounted inside the app's container (the database is in the mongo container).
const MOUNTS = {
    'mongo-data': '/data/db',
    'uploads-data': '/app/public/uploads',
    'logs-data': '/app/logs',
    'secrets-data': '/app/.secrets',
    'appdata-data': '/app/.data',
    'data-store': '/app/.data'
};
const mountPath = (id, volume) => (volume === 'backups-data' ? (id === 'charging' ? '/app/.backups' : '/app/backups') : MOUNTS[volume]);

const repoOf = (image) => { const i = image.lastIndexOf(':'); return i > image.lastIndexOf('/') ? image.slice(0, i) : image; };

async function containers() {
    const r = await run('docker', ['ps', '-a', '--format', '{{.Names}}|{{.Image}}|{{.State}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}'], { timeout: 20000 });
    if (!r.ok) return [];
    return r.stdout.split('\n').filter(Boolean).map((l) => { const [name, image, st, project, service] = l.split('|'); return { name, image, state: st, project, service }; });
}

// Look for apps running on this computer that use a Waypoints image but are not managed by the Gateway. `apps` are
// the ones that can be brought in; `notes` explain, in plain words, anything that looks like one of ours but cannot
// be brought in automatically, so a person is not left wondering why nothing was found.
async function scan() {
    const st = state.read();
    const all = await containers();
    const apps = [];
    const notes = [];
    for (const meta of catalog.all()) {
        if (!meta.image || st.apps[meta.id]) continue;
        const app = all.find(c => repoOf(c.image) === meta.image && c.project !== `waypoints-${meta.id}`);
        if (app) {
            const db = all.find(c => c.project && c.project === app.project && c.service === 'mongo');
            if (db) apps.push({ id: meta.id, name: meta.name, container: app.name, state: app.state, database: db.name });
            else notes.push({ id: meta.id, name: meta.name, reason: `Found ${app.name}, but not its MongoDB container. It can only be brought in if the database was started from the same compose file.` });
            continue;
        }
        // Something named like this app that is not running from the published image (for example built from source).
        const look = new RegExp(`${meta.id}[-_]?waypoints`, 'i');
        const alike = all.find(c => look.test(c.name + ' ' + c.image) && !/mongo/i.test(c.name + ' ' + c.image) && c.project !== `waypoints-${meta.id}`);
        if (alike) notes.push({ id: meta.id, name: meta.name, reason: `Found ${alike.name}, but it is not running from the published image (it looks built from source), so it cannot be brought in automatically. Install ${meta.name} from the Gateway and restore a backup into it instead.` });
    }
    return { apps, notes };
}

// Just the apps that can be brought in.
async function detect() { return (await scan()).apps; }

async function inspectJson(name) {
    const r = await run('docker', ['inspect', name], { timeout: 20000 });
    if (!r.ok) return null;
    try { return JSON.parse(r.stdout)[0]; } catch (_) { return null; }
}

async function adopt(job, id, hostInput, wantBackup) {
    const log = (l) => job.lines.push(l);
    const step = (name, status) => { const s = job.steps.find(x => x.name === name); if (s) s.status = status; else job.steps.push({ name, status }); };
    const fail = (msg) => { job.status = 'failed'; job.error = msg; log(msg); };
    const stopped = []; // old containers we stopped and renamed: [{ from, to }]
    const createdVolumes = [];
    let wroteState = false;

    async function rollback() {
        log('Putting your old install back as it was...');
        if (wroteState) {
            const st = state.read();
            delete st.apps[id];
            state.write(st);
            compose.writeOverride(id, null);
            if (st.mode === 'builtin') { caddy.write(st); await caddy.reload(); }
        }
        await run('docker', ['compose', '-p', `waypoints-${id}`, '-f', path.join(catalog.get(id).dir, 'compose.yml'), 'down'], { timeout: 120000, cwd: catalog.get(id).dir, env: { WEB_FQDN: 'localhost' } });
        for (const v of createdVolumes) await run('docker', ['volume', 'rm', '-f', v], { timeout: 30000 });
        for (const c of [...stopped].reverse()) {
            await run('docker', ['rename', c.to, c.from], { timeout: 20000 });
        }
        // The database first, then the app.
        for (const c of [...stopped].reverse()) await run('docker', ['start', c.from], { timeout: 60000 });
        log('Your old install is running again.');
    }

    try {
        const meta = catalog.get(id);
        const st0 = state.read();
        if (!meta) return fail('Unknown app.');
        if (!st0.configured) return fail('Finish the Gateway setup first, then bring the app in.');
        if (st0.apps[id]) return fail(`${meta.name} is already managed by the Gateway.`);
        const host = String(hostInput || '').trim().toLowerCase();
        if (!HOST_RE.test(host)) return fail('Enter a valid address for the app.');

        const found = (await detect()).find(f => f.id === id);
        if (!found) return fail(`Could not find ${meta.name} running on this computer.`);
        const oldApp = await inspectJson(found.container);
        const oldDb = found.database ? await inspectJson(found.database) : null;
        if (!oldApp) return fail('Could not read the existing install.');
        if (!oldDb) return fail('Could not find the existing install\'s database. Only installs that came with their own MongoDB container can be brought in automatically.');

        // Its settings: the environment it was started with.
        const oldEnv = {};
        (oldApp.Config.Env || []).forEach((e) => { const i = e.indexOf('='); if (i > 0) oldEnv[e.slice(0, i)] = e.slice(i + 1); });
        if ((oldEnv.mongoHost && oldEnv.mongoHost !== 'mongo') || oldEnv.mongoUser || oldEnv.mongoPass || oldEnv.MONGO_URI) {
            return fail('This install uses its own database server or a database login, so it cannot be brought in automatically. Nothing was changed.');
        }

        // Where each data location of the old install lives now (a Docker volume, or a folder it was started with).
        const sources = {};
        for (const loc of meta.storage || []) {
            const holder = loc.volume === 'mongo-data' ? oldDb : oldApp;
            const m = (holder.Mounts || []).find(x => x.Destination === mountPath(id, loc.volume));
            if (m) sources[loc.volume] = m.Type === 'volume' ? m.Name : m.Source;
        }

        // A backup first, while the old install is still running and before anything is touched. If it fails,
        // nothing is changed.
        if (wantBackup) {
            step('Back up', 'running');
            const file = await uninstaller.backup(job, id, { dbContainer: found.database, sources });
            if (!file) { step('Back up', 'failed'); return fail(job.error || 'The backup failed, so nothing was changed.'); }
            job.exportFile = file;
            step('Back up', 'done');
        }

        step('Stop the old install', 'running');
        const fields = {};
        for (const f of meta.fields || []) if (oldEnv[f.env]) fields[f.env] = oldEnv[f.env];
        const settings = {};
        for (const s of meta.settings || []) {
            if (s.target === 'compose' || oldEnv[s.env] === undefined || oldEnv[s.env] === '') continue;
            if (s.default !== undefined && oldEnv[s.env] === s.default) continue;
            settings[s.env] = oldEnv[s.env];
        }

        // Everything else the old install was given (an LDAP setup, a hand-set secret, a custom database name...) is
        // carried over too, as "anything else" rows, so no setting is lost. Skipped: what Docker's image sets itself and
        // what the Gateway controls.
        const image = await inspectJson(oldApp.Image);
        const baked = new Set(((image && image.Config && image.Config.Env) || []));
        const MANAGED = new Set(['PORT', 'WEB_FQDN', 'WEB_PROTOCOL', 'TRUST_PROXY', 'PUBLIC_URL', 'NODE_ENV', 'mongoHost', 'mongoPort', 'mongoUser', 'mongoPass', 'MONGO_URI', 'PATH', 'HOME', 'HOSTNAME', 'TERM', 'PWD', 'SHLVL']);
        const known = new Set([...(meta.fields || []).map(f => f.env), ...(meta.settings || []).map(s => s.env)]);
        const extras = [];
        for (const [name, value] of Object.entries(oldEnv)) {
            if (baked.has(`${name}=${value}`) || MANAGED.has(name) || known.has(name) || value === '') continue;
            if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) || /[\r\n\0]/.test(value) || value.length > 2000) continue;
            // The database name decides which data the app finds, so it must match what was copied.
            if (name === 'mongoDBName' && value === `${id}waypoints`) continue;
            extras.push({ name, value });
        }
        log(`Bringing across ${Object.keys(fields).length + Object.keys(settings).length} listed settings and ${extras.length} other settings.`);

        log(`Stopping ${found.container}...`);
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const rename = async (name) => {
            await run('docker', ['stop', name], { timeout: 120000 });
            await run('docker', ['update', '--restart=no', name], { timeout: 20000 });
            const to = `${name}-before-gateway-${stamp}`;
            const r = await run('docker', ['rename', name, to], { timeout: 20000 });
            if (!r.ok) throw new Error(`Could not rename ${name}: ${r.stderr.trim()}`);
            stopped.push({ from: name, to });
        };
        await rename(found.container);
        await rename(found.database);
        step('Stop the old install', 'done');

        step('Copy the data', 'running');
        const have = await run('docker', ['network', 'inspect', cfg.network], { timeout: 20000 });
        if (!have.ok) await run('docker', ['network', 'create', cfg.network], { timeout: 30000 });

        // Keep the old install's database version: its data is in that version's format, and a different one may not
        // open it (or may not run on this computer at all).
        const dbImage = (oldDb.Config && oldDb.Config.Image) || '';
        if (dbImage && dbImage !== 'mongo:7') fields.MONGO_IMAGE = dbImage;

        const st = state.read();
        st.apps[id] = { host, port: meta.port, env: fields, settings, extra: { env: extras, tag: '', memory: '' } };
        state.write(st);
        compose.writeOverride(id, st.apps[id]);
        wroteState = true;
        if (st.mode === 'builtin') { caddy.write(st); await caddy.reload(); }

        for (const loc of meta.storage || []) {
            const source = sources[loc.volume];
            if (!source) { log(`Nothing to copy for ${loc.label.toLowerCase()}.`); continue; }
            const volume = `waypoints-${id}_${loc.volume}`;
            log(`Copying ${loc.label.toLowerCase()}...`);
            await run('docker', ['volume', 'create', '--label', `com.docker.compose.project=waypoints-${id}`, '--label', `com.docker.compose.volume=${loc.volume}`, volume], { timeout: 20000 });
            createdVolumes.push(volume);
            const copy = await runStreaming('docker', ['run', '--rm', '-v', `${source}:/from:ro`, '-v', `${volume}:/to`, '--entrypoint', 'sh', HELPER_IMAGE, '-c', 'cp -a /from/. /to/'], { onLine: log });
            if (!copy.ok) throw new Error(`Copying ${loc.label.toLowerCase()} failed.`);
        }
        step('Copy the data', 'done');

        step(`Start ${meta.name}`, 'running');
        log(`Starting ${meta.name} under the Gateway...`);
        const up = await runStreaming('docker', ['compose', '-p', `waypoints-${id}`, ...compose.files(id, meta, st), 'up', '-d'], { env: installer.composeEnv(st, id), onLine: log, cwd: meta.dir });
        if (!up.ok) throw new Error(`${meta.name} did not start under the Gateway.`);
        step(`Start ${meta.name}`, 'done');

        job.oldContainers = stopped.map(c => c.to);
        job.status = 'done';
        log(`Done. ${meta.name} is now managed by the Gateway at https://${host}.`);
        log(`Your old install is stopped and kept as ${job.oldContainers.join(' and ')}. Once you have checked that everything is there, you can remove them.`);
    } catch (e) {
        job.steps.forEach(s => { if (s.status === 'running') s.status = 'failed'; });
        log(e.message);
        await rollback();
        fail(`${e.message} Your old install was put back, so nothing was lost.`);
    }
}

module.exports = { detect, scan, adopt };
