const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');
const state = require('./state');
const installer = require('./installer');
const caddy = require('./caddy');
const compose = require('./compose');
const { run, runStreaming, runToFile } = require('./run');

// Backups are single .tar.gz files in the gateway's data volume. They hold the app's database dump and its
// volumes (uploads, backups, secrets), so they are sensitive: mode 0600, listed and deletable on the Settings page.
const EXPORT_DIR = path.join(cfg.dataDir, 'exports');
const NAME_RE = /^[a-z0-9-]+-\d{8}-\d{6}\.tar\.gz$/;
const HELPER_IMAGE = 'docker:27-cli'; // already needed by the self-update; it has tar

const dbContainer = (meta) => meta.container.replace(/-app$/, '-mongo');
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})$/, '$1-$2');

function list() {
    try {
        return fs.readdirSync(EXPORT_DIR).filter(n => NAME_RE.test(n)).map((n) => {
            const s = fs.statSync(path.join(EXPORT_DIR, n));
            return { name: n, size: s.size, created: s.mtimeMs };
        }).sort((a, b) => b.created - a.created);
    } catch (_) { return []; }
}

const filePath = (name) => (NAME_RE.test(String(name)) ? path.join(EXPORT_DIR, name) : null);

function remove(name) {
    const f = filePath(name);
    if (!f || !fs.existsSync(f)) return false;
    fs.unlinkSync(f);
    return true;
}

// Save the database and the data volumes of one app to a single file. Returns the file name, or '' after failing.
// `opts` lets this back up an install the Gateway does not manage yet (before bringing it in): the database container
// to dump and, for each data location (by volume name), the Docker volume or folder to read it from.
async function backup(job, id, opts = {}) {
    const log = (l) => job.lines.push(l);
    const meta = catalog.get(id);
    const name = `${id}-${stamp()}`;
    const stage = path.join(EXPORT_DIR, `.tmp-${name}`);
    try {
        fs.mkdirSync(stage, { recursive: true, mode: 0o700 });

        log('Saving the database...');
        const dump = await runToFile('docker', ['exec', opts.dbContainer || dbContainer(meta), 'mongodump', '--archive', '--gzip'], path.join(stage, 'database.archive.gz'));
        if (!dump.ok) { job.error = 'The database could not be saved, so nothing was removed. ' + dump.stderr.trim().split('\n').pop(); return ''; }

        // Every data location except the database (saved as a dump above): the Docker volume, or the folder the data
        // was moved to from the app's Storage card.
        const folders = (state.read().apps[id] || {}).storage || {};
        for (const loc of meta.storage || []) {
            if (loc.volume === 'mongo-data') continue;
            const source = opts.sources ? opts.sources[loc.volume] : (folders[loc.env] || `waypoints-${id}_${loc.volume}`);
            if (!source) continue; // the old install had nothing there
            log(`Saving ${loc.volume}...`);
            const t = await run('docker', [
                'run', '--rm', '-e', `N=${name}`, '-e', `V=${loc.volume}`,
                '-v', `${source}:/in:ro`, '-v', `${cfg.gatewayVolume}:/out`,
                '--entrypoint', 'sh', HELPER_IMAGE, '-c', 'tar czf "/out/exports/.tmp-$N/$V.tar.gz" -C /in .'
            ], { timeout: 600000 });
            if (!t.ok) { job.error = `${loc.volume} could not be saved, so nothing was removed. ` + t.stderr.trim().split('\n').pop(); return ''; }
        }

        fs.writeFileSync(path.join(stage, 'README.txt'), [
            `Backup of ${meta.name}, made ${new Date().toISOString()} by the Waypoints Gateway.`,
            '',
            'database.archive.gz   MongoDB dump. Restore: mongorestore --archive --gzip < database.archive.gz',
            '<volume>.tar.gz       A copy of one data volume (uploads, backups, secrets). Unpack it into a volume with tar.',
            '',
            'This file holds your data and the app\'s secrets. Keep it private.',
            ''
        ].join('\n'));

        log('Packing the backup...');
        const file = `${name}.tar.gz`;
        const pack = await run('tar', ['czf', path.join(EXPORT_DIR, file), '-C', stage, '.'], { timeout: 600000 });
        if (!pack.ok) { job.error = 'The backup could not be packed, so nothing was removed.'; return ''; }
        fs.chmodSync(path.join(EXPORT_DIR, file), 0o600);
        return file;
    } finally {
        try { fs.rmSync(stage, { recursive: true, force: true }); } catch (_) { /* leave it */ }
    }
}

// Remove an app. keepData: leave its volumes so installing it again brings the data back. Otherwise they are deleted.
async function uninstall(job, id, { keepData, backup: wantBackup, confirm }) {
    const log = (l) => job.lines.push(l);
    const fail = (msg) => { job.status = 'failed'; job.error = msg; log(msg); };
    try {
        const st = state.read();
        const meta = catalog.get(id);
        if (!meta || !st.apps[id]) return fail('Unknown app.');
        if (!keepData && String(confirm || '').trim().toLowerCase() !== meta.name.toLowerCase()) return fail(`Type "${meta.name}" to confirm deleting its data.`);

        if (wantBackup) {
            job.steps.push({ name: 'Back up', status: 'running' });
            const file = await backup(job, id);
            if (!file) { job.steps[0].status = 'failed'; return fail(job.error || 'The backup failed, so nothing was removed.'); }
            job.exportFile = file;
            job.steps[0].status = 'done';
        }

        job.steps.push({ name: `Remove ${meta.name}`, status: 'running' });
        log(keepData ? `Removing ${meta.name} and keeping its data...` : `Removing ${meta.name} and deleting its data...`);
        const args = ['compose', '-p', `waypoints-${id}`, ...compose.files(id, meta, st), 'down', ...(keepData ? [] : ['-v'])];
        const down = await runStreaming('docker', args, { env: installer.composeEnv(st, id), onLine: log, cwd: meta.dir });
        if (!down.ok) { job.steps[job.steps.length - 1].status = 'failed'; return fail(`${meta.name} could not be removed. See the lines above.`); }

        // Docker only deletes its own volumes. A folder the data was moved to is yours, so it is left in place.
        const kept = Object.values(st.apps[id].storage || {});
        if (!keepData && kept.length) {
            job.keptFolders = kept;
            log(`Not deleted, because it is a folder you chose: ${kept.join(', ')}. Delete it yourself if you no longer need it.`);
        }

        delete st.apps[id];
        compose.writeOverride(id, null);
        state.write(st);
        if (st.mode === 'builtin') { caddy.write(st); await caddy.reload(); }
        job.steps[job.steps.length - 1].status = 'done';
        job.status = 'done';
        log('Done.');
    } catch (e) {
        fail(`Unexpected error: ${e.message}`);
    }
}

module.exports = { uninstall, backup, list, remove, filePath, EXPORT_DIR };
