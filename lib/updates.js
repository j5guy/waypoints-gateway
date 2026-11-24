const https = require('https');
const { run } = require('./run');
const catalog = require('./catalog');

const GATEWAY_IMAGE = 'ghcr.io/j5guy/waypoints-gateway';
const ACCEPT = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json'
].join(', ');

function request(host, path, headers, method) {
    return new Promise((resolve) => {
        const req = https.request({ host, path, method: method || 'GET', headers, timeout: 10000 }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, body: '' }); });
        req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
        req.end();
    });
}

// The digest the registry currently has for `:latest`, using an anonymous pull token (the packages are public).
async function registryDigest(image) {
    const [host, ...rest] = image.split('/');
    const repo = rest.join('/');
    const tok = await request(host, `/token?service=${encodeURIComponent(host)}&scope=${encodeURIComponent(`repository:${repo}:pull`)}`, {});
    let token = '';
    try { token = JSON.parse(tok.body).token || ''; } catch (_) { /* no token */ }
    if (!token) return '';
    const m = await request(host, `/v2/${repo}/manifests/latest`, { Authorization: `Bearer ${token}`, Accept: ACCEPT }, 'HEAD');
    return m.status === 200 ? String(m.headers['docker-content-digest'] || '') : '';
}

// The digests the local copy of `:latest` was pulled as.
async function localDigests(image) {
    const r = await run('docker', ['image', 'inspect', `${image}:latest`, '--format', '{{json .RepoDigests}}'], { timeout: 15000 });
    if (!r.ok) return null;
    try { return JSON.parse(r.stdout.trim()) || []; } catch (_) { return []; }
}

// 'yes' (a newer image exists), 'no' (up to date), or 'unknown' (registry or local image not readable).
async function status(image) {
    const [remote, local] = await Promise.all([registryDigest(image), localDigests(image)]);
    if (!remote || local === null) return 'unknown';
    return local.some(d => d.endsWith('@' + remote)) ? 'no' : 'yes';
}

async function check(stateApps) {
    const out = { gateway: await status(GATEWAY_IMAGE), apps: {} };
    for (const id of Object.keys(stateApps)) {
        const meta = catalog.get(id);
        // An app pinned to a version on its Advanced box is not offered updates (that would undo the pin).
        const pinned = stateApps[id] && stateApps[id].extra && stateApps[id].extra.tag;
        out.apps[id] = pinned ? 'pinned' : (meta && meta.image ? await status(meta.image) : 'unknown');
    }
    return out;
}

module.exports = { check, GATEWAY_IMAGE };
