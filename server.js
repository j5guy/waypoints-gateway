const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cfg = require('./lib/config');
const auth = require('./lib/auth');
const catalog = require('./lib/catalog');
const state = require('./lib/state');
const caddy = require('./lib/caddy');
const snippets = require('./lib/snippets');
const installer = require('./lib/installer');
const manage = require('./lib/manage');
const uninstaller = require('./lib/uninstall');
const adopt = require('./lib/adopt');
const shared = require('./lib/shared');
const compose = require('./lib/compose');
const secrets = require('./lib/secrets');
const icons = require('./lib/icons');
const tls = require('./lib/tls');
const certs = require('./lib/certs');
const hardware = require('./lib/hardware');
const appearance = require('./lib/appearance');
const community = require('./lib/community');
const whatsNew = require('./lib/whatsNew');
const updates = require('./lib/updates');
const selfUpdate = require('./lib/selfupdate');
const { detect } = require('./lib/detect');

const COOKIE = 'gw.sid';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const STATIC = new Set(['index.html', 'app.js', 'style.css', 'footer.js', 'theme.js', 'whats-new.html', 'whatsnew.js']);

const SECURITY_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
};

const send = (res, code, body, headers = {}) => {
    const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
    res.end(isObj ? JSON.stringify(body) : body);
};

const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, v.join('=')]));
const authed = (req) => auth.valid(cookies(req)[COOKIE]);

// The raw request body, refused once it passes `limit` bytes.
function readRaw(req, limit) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => { size += c.length; if (size > 64 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
        req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('bad json')); } });
        req.on('error', reject);
    });
}

// A page on another site must not be able to drive this one: POSTs must be JSON and, when the browser says where
// they came from, come from this same address.
function sameOrigin(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}

// The saved state without its secrets: shared settings, each app's saved settings (which can hold passwords) and its
// free-form rows never reach the browser. The page only gets what it draws: addresses, ports and the sign-up fields.
function publicState(st) {
    const out = { ...st };
    delete out.shared;
    out.apps = {};
    for (const id of Object.keys(st.apps)) {
        const a = st.apps[id];
        const meta = catalog.get(id);
        const env = {};
        for (const f of (meta && meta.fields) || []) if (a.env && a.env[f.env] !== undefined) env[f.env] = a.env[f.env];
        out.apps[id] = { host: a.host, port: a.port, env };
    }
    return out;
}

const hostsInState = () => new Set(Object.values(state.read().apps).map(a => a.host));

// Is the app answering through the address people will use? (In LAN mode its certificate is from the local CA,
// which this container does not trust, so only reachability is checked here.)
function probe(host) {
    return new Promise((resolve) => {
        const req = https.request({ host, port: 443, path: '/healthz', method: 'GET', timeout: 8000, rejectUnauthorized: false }, (res) => {
            res.resume();
            resolve({ reachable: true, status: res.statusCode, server: String(res.headers.server || ''), via: String(res.headers.via || '') });
        });
        req.on('timeout', () => { req.destroy(); resolve({ reachable: false, error: 'No answer within 8 seconds.' }); });
        req.on('error', (e) => resolve({ reachable: false, error: e.code || e.message }));
        req.end();
    });
}

async function route(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/whats-new' || STATIC.has(p.slice(1)))) {
        const name = p === '/' ? 'index.html' : (p === '/whats-new' ? 'whats-new.html' : p.slice(1));
        const file = path.join(cfg.publicDir, name);
        return send(res, 200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream' });
    }
    if (req.method === 'GET' && p === '/healthz') return send(res, 200, 'ok');

    // An app's icon (custom, or the stock one). Served with a policy that stops an SVG running anything.
    const ic = p.match(/^\/icons\/([a-z0-9-]+)$/);
    if (ic && req.method === 'GET') {
        if (!authed(req)) return send(res, 401, 'Sign in first.');
        const f = icons.find(ic[1]);
        if (!f) return send(res, 404, 'No icon.');
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Content-Type': f.type, 'Cache-Control': 'no-cache' });
        return fs.createReadStream(f.file).pipe(res);
    }

    // Public (no sign-in): the footer's details and the release notes, like the other Waypoints apps.
    if (p === '/api/site' && req.method === 'GET') return send(res, 200, { version: cfg.version, xUrl: community.xUrl, docsUrl: community.docsUrl, appearance: state.read().appearance });
    if (p === '/api/whats-new' && req.method === 'GET') return send(res, 200, { version: cfg.version, releases: whatsNew });

    // Public: is there a password yet, and may this visitor create it?
    if (p === '/api/auth' && req.method === 'GET') return send(res, 200, { claimed: auth.claimed(), canClaim: auth.canClaim(), signedIn: authed(req), version: cfg.version });

    const sessionCookie = (req, token) => {
        // Secure when the connection is encrypted: through the proxy (x-forwarded-proto) or the Gateway's own https port.
        const secure = (req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') ? '; Secure' : '';
        return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(auth.SESSION_MS / 1000)}${secure}`;
    };

    if ((p === '/api/login' || p === '/api/claim') && req.method === 'POST') {
        if (!sameOrigin(req)) return send(res, 400, { error: 'Bad request.' });
        let body;
        try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
        if (p === '/api/claim') {
            const c = auth.claim(body.password);
            if (c.weak) return send(res, 422, { error: 'Use at least 8 characters.' });
            if (!c.ok) return send(res, 403, { error: 'A password can no longer be created here. Restart the Gateway to try again.' });
            return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, c.token) });
        }
        const r = auth.login(req.socket.remoteAddress || '', body.password);
        if (r.limited) return send(res, 429, { error: 'Too many wrong tries. Wait 15 minutes.' });
        if (!r.ok) return send(res, 401, { error: 'That password is not right.' });
        return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, r.token) });
    }

    if (p.startsWith('/api/')) {
        if (!authed(req)) return send(res, 401, { error: 'Sign in first.' });
        // Icon uploads are images, not JSON, and do their own request check below.
        if (req.method === 'POST' && !p.startsWith('/api/app-icon/') && !sameOrigin(req)) return send(res, 400, { error: 'Bad request.' });

        // An app's icon: upload your own (a raw image body), or go back to the stock one.
        const ai = p.match(/^\/api\/app-icon\/([a-z0-9-]+)(\/reset)?$/);
        if (ai && req.method === 'POST') {
            const origin = req.headers.origin;
            let originOk = true;
            if (origin) { try { originOk = new URL(origin).host === req.headers.host; } catch (_) { originOk = false; } }
            if (!originOk) return send(res, 400, { error: 'Bad request.' });
            if (ai[2]) { icons.reset(ai[1]); return send(res, 200, { ok: true }); }
            if (!String(req.headers['content-type'] || '').startsWith('image/')) return send(res, 400, { error: 'Send an image.' });
            let buf;
            try { buf = await readRaw(req, icons.MAX_BYTES); } catch (e) { return send(res, 413, { error: 'The icon is larger than 512 KB.' }); }
            const r = icons.save(ai[1], buf);
            return r.error ? send(res, 422, r) : send(res, 200, { ok: true });
        }

        // Appearance: theme, colors, font, text size, density, motion. Saved for every device.
        if (p === '/api/appearance' && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            const v = appearance.validate(body.appearance);
            if (v.errors.length) return send(res, 422, { errors: v.errors });
            const st = state.read();
            st.appearance = v.value;
            state.write(st);
            return send(res, 200, { ok: true, appearance: v.value });
        }

        if (p === '/api/logout' && req.method === 'POST') { auth.end(cookies(req)[COOKIE]); return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` }); }

        if (p === '/api/state' && req.method === 'GET') {
            const st = state.read();
            return send(res, 200, { version: cfg.version, state: publicState(st), catalog: catalog.publicList(), hardware: hardware.detect(), sharedEnv: shared.envGroups(), sharedInfo: shared.info(st), mongoOld: hardware.MONGO_OLD, secretsKey: secrets.status(), preselect: cfg.preselect, gatewayHost: st.gatewayHost || '', statuses: await installer.appStatuses(st), caCertReady: fs.existsSync(caddy.rootCertPath()) });
        }
        if (p === '/api/password' && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            if (!auth.changePassword(body.current, body.next)) return send(res, 422, { error: 'The current password is wrong, or the new one is under 8 characters.' });
            return send(res, 200, { ok: true });
        }

        // One app's page: info, controls, logs, checks and settings.
        const m = p.match(/^\/api\/app\/([a-z0-9-]+)\/(info|logs|checks|action|settings|storage-check|storage|uninstall)$/);
        if (m) {
            const [, id, what] = m;
            if (what === 'info' && req.method === 'GET') {
                const i = await manage.info(id);
                return i ? send(res, 200, i) : send(res, 404, { error: 'Unknown app.' });
            }
            if (what === 'logs' && req.method === 'GET') {
                const text = await manage.logs(id, url.searchParams.get('lines'));
                return text === null ? send(res, 404, { error: 'Unknown app.' }) : send(res, 200, { text });
            }
            if (what === 'checks' && req.method === 'GET') {
                const c = await manage.checks(id);
                return c ? send(res, 200, { checks: c }) : send(res, 404, { error: 'Unknown app.' });
            }
            if (req.method === 'POST' && (what === 'action' || what === 'settings' || what === 'storage-check' || what === 'storage' || what === 'uninstall')) {
                let body;
                try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
                if (what === 'uninstall') {
                    if (!state.read().apps[id]) return send(res, 404, { error: 'Unknown app.' });
                    const job = installer.newJob();
                    uninstaller.uninstall(job, id, { keepData: body.keepData !== false, backup: body.backup === true, confirm: body.confirm });
                    return send(res, 202, { job: job.id });
                }
                // The checks before a move, run without stopping the app.
                if (what === 'storage-check') {
                    if (!state.read().apps[id]) return send(res, 404, { error: 'Unknown app.' });
                    return send(res, 200, await manage.checkStorage(id, String(body.env || ''), body.folder, body.existing === true));
                }
                if (what === 'storage') {
                    const r = manage.moveStorage(id, String(body.env || ''), body.folder, body.existing === true);
                    if (r.errors) return send(res, 422, { errors: r.errors });
                    return send(res, 202, { job: r.job });
                }
                if (what === 'action') {
                    const r = await manage.action(id, String(body.action || ''));
                    return send(res, r.ok ? 200 : 422, r);
                }
                // The Settings card: the listed settings and the Advanced rows are saved together.
                const r = manage.applySettings(id, body);
                if (r.errors) return send(res, 422, { errors: r.errors });
                return send(res, 202, { job: r.job });
            }
        }

        // A certificate the person already has (domain installs): check one before using it, or replace the saved one.
        if (p === '/api/cert-check' && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            const hosts = (Array.isArray(body.hosts) ? body.hosts : []).map(String).filter(h => /^[a-z0-9.*-]{1,253}$/i.test(h)).slice(0, 50);
            // With nothing pasted, check the one that is already saved.
            const given = body.cert ? { cert: body.cert, key: body.key } : (certs.current() || {});
            const r = certs.inspect(given.cert, given.key, { hosts });
            return send(res, 200, { ok: r.ok, errors: r.errors, warnings: r.warnings, info: r.info });
        }
        if (p === '/api/certificate' && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            const st = state.read();
            if (!st.customCert) return send(res, 422, { errors: ['This setup uses free certificates, not your own. Change the network settings to use your own certificate.'] });
            const hosts = [st.gatewayHost, ...Object.values(st.apps).map(a => a.host)].filter(Boolean);
            const r = certs.inspect(body.cert, body.key, { hosts });
            if (!r.ok) return send(res, 422, { errors: r.errors });
            certs.save(body.cert, body.key);
            st.customCertInfo = { names: r.info.names, notAfter: r.info.notAfter, subject: r.info.subject };
            state.write(st);
            await caddy.reload();
            return send(res, 200, { ok: true, info: r.info, warnings: r.warnings });
        }

        // Apps installed by hand before the Gateway, and bringing one in.
        if (p === '/api/adoptable' && req.method === 'GET') return send(res, 200, await adopt.scan());
        if (p === '/api/adopt' && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            const id = String(body.id || '');
            if (!catalog.get(id)) return send(res, 404, { error: 'Unknown app.' });
            const job = installer.newJob();
            adopt.adopt(job, id, body.host, body.backup !== false);
            return send(res, 202, { job: job.id });
        }

        // Backups made before an uninstall: list, download, delete.
        if (p === '/api/exports' && req.method === 'GET') return send(res, 200, { exports: uninstaller.list() });
        const ex = p.match(/^\/api\/exports\/([A-Za-z0-9._-]+?)(\/delete)?$/);
        if (ex) {
            const file = uninstaller.filePath(ex[1]);
            if (!file || !fs.existsSync(file)) return send(res, 404, { error: 'No such backup.' });
            if (ex[2] && req.method === 'POST') { uninstaller.remove(ex[1]); return send(res, 200, { ok: true }); }
            if (!ex[2] && req.method === 'GET') {
                res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/gzip', 'Content-Length': fs.statSync(file).size, 'Content-Disposition': `attachment; filename="${ex[1]}"` });
                return fs.createReadStream(file).pipe(res);
            }
        }

        // Update the gateway itself. The gateway restarts a few seconds later, which signs everyone out.
        if (p === '/api/self-update' && req.method === 'POST') {
            const r = await selfUpdate.start();
            return send(res, r.ok ? 202 : 422, r);
        }

        if (p === '/api/updates' && req.method === 'GET') return send(res, 200, await updates.check(state.read().apps));

        if (p === '/api/update' && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            const st = state.read();
            const ids = (Array.isArray(body.apps) ? body.apps : []).map(String).filter(id => st.apps[id]);
            if (!ids.length) return send(res, 422, { error: 'Pick an app to update.' });
            const job = installer.newJob();
            installer.updateApps(job, ids);
            return send(res, 202, { job: job.id });
        }

        // Automatic updates: which apps, on which day, at what hour, and whether to back up first.
        if (p === '/api/auto-update' && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            const st = state.read();
            const hour = Number(body.hour);
            const day = body.day === 'daily' ? 'daily' : Number(body.day);
            if (!(Number.isInteger(hour) && hour >= 0 && hour <= 23)) return send(res, 422, { error: 'Pick an hour.' });
            if (day !== 'daily' && !(Number.isInteger(day) && day >= 0 && day <= 6)) return send(res, 422, { error: 'Pick a day.' });
            const apps = {};
            Object.keys(body.apps && typeof body.apps === 'object' ? body.apps : {}).forEach((id) => { if (st.apps[id] && body.apps[id] === true) apps[id] = true; });
            st.updates = { ...st.updates, apps, hour, day, backup: body.backup === true };
            state.write(st);
            return send(res, 200, { ok: true, updates: st.updates });
        }

        // Shared settings: email, directory sign-in, single sign-on, backups and time zone, applied to chosen apps.
        if (p === '/api/shared' && req.method === 'GET') return send(res, 200, { groups: shared.info(state.read()) });
        const sh = p.match(/^\/api\/shared\/([a-z]+)$/);
        if (sh && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            const r = manage.saveShared(sh[1], body);
            if (r.errors) return send(res, 422, { errors: r.errors });
            return send(res, 202, { job: r.job });
        }
        if (p === '/api/detect' && req.method === 'GET') return send(res, 200, await detect());

        if (p === '/api/setup' && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            const { errors } = installer.validate(body);
            if (errors.length) return send(res, 422, { errors });
            const job = installer.newJob();
            installer.apply(job, body); // runs in the background; the page polls /api/job/<id>
            return send(res, 202, { job: job.id });
        }
        if (p.startsWith('/api/job/') && req.method === 'GET') {
            const job = installer.getJob(p.slice('/api/job/'.length));
            if (!job) return send(res, 404, { error: 'Unknown job.' });
            return send(res, 200, job);
        }

        if (p === '/api/ca' && req.method === 'GET') {
            const file = caddy.rootCertPath();
            if (!fs.existsSync(file)) return send(res, 404, 'The certificate is not ready yet. Open one of your apps once, wait a few seconds, then try again.');
            return send(res, 200, fs.readFileSync(file), { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="waypoints-local-ca.crt"' });
        }

        if (p === '/api/snippets' && req.method === 'GET') {
            const st = state.read();
            const id = url.searchParams.get('app');
            const a = st.apps[id];
            if (!a) return send(res, 404, { error: 'Unknown app.' });
            const addr = st.bindAddr === '0.0.0.0' ? '<this server\'s LAN address>' : '127.0.0.1';
            return send(res, 200, snippets.all({ id, host: a.host, target: `${addr}:${a.port}` }));
        }

        if (p === '/api/test' && req.method === 'POST') {
            let body;
            try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
            const host = String(body.host || '').toLowerCase();
            if (!hostsInState().has(host)) return send(res, 400, { error: 'That address is not one of yours.' });
            return send(res, 200, await probe(host));
        }
    }
    return send(res, 404, 'Not found');
}

// Automatic updates (per app, off by default; Updates page). Every 15 minutes: if it is the chosen hour (in the
// Gateway's time zone) and the chosen day, check each ticked app that has not been looked at today, and update the
// ones with a newer image. An app is marked as checked for the day first, so a problem cannot make it retry all
// hour. With "back up first" on, an app whose backup fails is not updated. Needs the gateway to stay running.
const QUARTER_HOUR = 15 * 60 * 1000;
async function autoUpdate() {
    try {
        const st = state.read();
        const u = st.updates;
        if (!st.configured) return;
        const ids = Object.keys(u.apps || {}).filter(id => u.apps[id] && st.apps[id]);
        if (!ids.length) return;
        const now = new Date();
        if (now.getHours() !== Number(u.hour)) return;
        if (u.day !== 'daily' && now.getDay() !== Number(u.day)) return;
        const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        const due = ids.filter(id => (u.last || {})[id] !== today);
        if (!due.length) return;

        const fresh = state.read();
        fresh.updates.last = { ...(fresh.updates.last || {}) };
        due.forEach((id) => { fresh.updates.last[id] = today; });
        state.write(fresh);

        const found = await updates.check(st.apps);
        let todo = due.filter(id => found.apps[id] === 'yes');
        if (!todo.length) return;
        if (u.backup) {
            const ok = [];
            for (const id of todo) {
                const file = await uninstaller.backup(installer.newJob(), id);
                if (file) ok.push(id); else console.error(`Automatic update skipped for ${id}: the backup failed.`);
            }
            todo = ok;
        }
        if (!todo.length) return;
        const job = installer.newJob();
        console.log('Automatic update: ' + todo.join(', '));
        await installer.updateApps(job, todo);
        console.log('Automatic update finished: ' + job.status);
    } catch (e) {
        console.error('Automatic update failed: ' + e.message);
    }
}
setInterval(autoUpdate, QUARTER_HOUR).unref();

// At start: encrypt any secrets an older version saved in plain text, and rewrite the apps' override files so they
// hold placeholders instead of passwords.
try {
    state.migrate();
    const st = state.read();
    Object.keys(st.apps).forEach((id) => compose.writeOverride(id, st.apps[id]));
} catch (e) {
    console.error('Could not protect saved secrets at start: ' + e.message);
}

const handle = (req, res) => {
    route(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' }); else res.end(); });
};

http.createServer(handle).listen(cfg.port, () => {
    console.log('');
    console.log(`Waypoints Gateway ${cfg.version} is running on port ${cfg.port}.`);
    console.log('Open it in your browser:  http://<this server\'s address>:' + cfg.port);
    console.log(auth.claimed() ? '' : 'Open it within 15 minutes to create your password.');
    console.log('');
});

// The same page on an encrypted address, so the password is not sent in plain text while setting up. The certificate is
// self-signed, so the browser warns once.
if (cfg.httpsPort) {
    const creds = tls.load();
    if (creds) {
        https.createServer(creds, handle).listen(cfg.httpsPort, () => {
            console.log(`Encrypted address:  https://<this server's address>:${cfg.httpsPort}  (the browser will warn once: the certificate is the Gateway's own)`);
            console.log('');
        });
    }
}
