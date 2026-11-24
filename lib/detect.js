const http = require('http');
const https = require('https');
const { run } = require('./run');
const cfg = require('./config');

// Best-effort look at the host before offering the built-in proxy. From inside a container we can see Docker and
// the ports it can publish, not every process on the machine, so the wizard always lets the person decide.
const PROXY_IMAGE = /(traefik|nginx|caddy|haproxy|envoy|httpd|apache|swag|linuxserver\/nginx|jc21\/nginx-proxy-manager|nginx-proxy|cloudflared)/i;

function sniff(port, secure) {
    return new Promise((resolve) => {
        const lib = secure ? https : http;
        const req = lib.request({ host: 'host.docker.internal', port, path: '/', method: 'HEAD', timeout: 3000, rejectUnauthorized: false }, (res) => {
            resolve({ answered: true, status: res.statusCode, server: String(res.headers.server || '') });
            res.resume();
        });
        req.on('timeout', () => { req.destroy(); resolve({ answered: false }); });
        req.on('error', () => resolve({ answered: false }));
        req.end();
    });
}

async function docker() {
    const v = await run('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 15000 });
    const c = await run('docker', ['compose', 'version', '--short'], { timeout: 15000 });
    return { ok: v.ok, version: v.stdout.trim(), composeOk: c.ok, error: v.ok ? '' : (v.stderr.trim() || 'Docker did not answer') };
}

async function containers() {
    const out = await run('docker', ['ps', '--format', '{{json .}}'], { timeout: 20000 });
    if (!out.ok) return [];
    return out.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}

async function detect() {
    const d = await docker();
    const result = { docker: d, hardware: require('./hardware').detect(), ownCaddyRunning: false, ports: { free: null, detail: '' }, proxies: [], hostProxy: {}, apps: [] };
    if (!d.ok) return result;

    const list = await containers();
    result.ownCaddyRunning = list.some(c => c.Names === cfg.caddyContainer);
    result.apps = list.map(c => c.Names).filter(n => /^waypoints-/.test(n) === false);
    result.proxies = list
        .filter(c => c.Names !== cfg.caddyContainer && c.Names !== 'waypoints-gateway')
        .filter(c => PROXY_IMAGE.test(c.Image || '') || /:(80|443)->/.test(c.Ports || ''))
        .map(c => ({ name: c.Names, image: c.Image, ports: c.Ports }));

    if (result.ownCaddyRunning) {
        result.ports = { free: true, detail: 'The built-in proxy is already running here.' };
        return result;
    }

    // Can Docker publish 80 and 443? Try a throwaway container (the Caddy image is needed anyway).
    await run('docker', ['pull', '-q', cfg.caddyImage], { timeout: 180000 });
    const t = await run('docker', ['run', '--rm', '--entrypoint', 'true', '-p', '80:80', '-p', '443:443', cfg.caddyImage], { timeout: 60000 });
    if (t.ok) result.ports = { free: true, detail: 'Ports 80 and 443 are free.' };
    else result.ports = { free: false, detail: (t.stderr.trim().split('\n').pop() || 'Ports 80 and 443 could not be used.').slice(0, 300) };

    // Something on the host itself (not a container) answering on 80/443?
    const [p80, p443] = await Promise.all([sniff(80, false), sniff(443, true)]);
    result.hostProxy = { http: p80, https: p443 };
    return result;
}

module.exports = { detect };
