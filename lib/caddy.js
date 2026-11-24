const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const apps = require('./catalog');
const certs = require('./certs');
const { run } = require('./run');

const CADDYFILE_DIR = path.join(cfg.dataDir, 'caddy');
const CADDYFILE = path.join(CADDYFILE_DIR, 'Caddyfile');

// The Caddyfile for the current state. LAN mode uses Caddy's own local CA (every device trusts its root
// certificate once); domain mode asks Let's Encrypt for real certificates.
function build(state) {
    const lines = ['# Written by the Waypoints Gateway. Changes made here are overwritten the next time you run setup.', '{'];
    // A domain install uses the person's own certificate when they gave one, otherwise Let's Encrypt.
    const custom = state.access === 'domain' && state.customCert;
    const customTls = `\ttls ${certs.CADDY_CERT} ${certs.CADDY_KEY}`;
    if (state.access === 'domain' && state.acmeEmail && !custom) lines.push(`\temail ${state.acmeEmail}`);
    if (state.access === 'lan') lines.push('\tlocal_certs');
    lines.push('\tskip_install_trust', '}', '');
    // The gateway's own secure address (the container is attached to the proxy network during setup).
    if (state.gatewayHost) {
        lines.push(`${state.gatewayHost} {`);
        if (state.access === 'lan') lines.push('\ttls internal');
        else if (custom) lines.push(customTls);
        lines.push('\treverse_proxy waypoints-gateway:8080', '}', '');
    }
    for (const [id, a] of Object.entries(state.apps)) {
        const meta = apps.get(id);
        if (!meta) continue;
        lines.push(`${a.host} {`);
        if (state.access === 'lan') lines.push('\ttls internal');
        else if (custom) lines.push(customTls);
        lines.push('\tencode zstd gzip');
        lines.push(`\treverse_proxy ${meta.container}:${meta.port}`);
        lines.push('}', '');
    }
    return lines.join('\n');
}

function write(state) {
    fs.mkdirSync(CADDYFILE_DIR, { recursive: true });
    fs.writeFileSync(CADDYFILE, build(state));
}

// Ask a running Caddy to pick up the new file (it also watches it; this just makes it immediate).
async function reload() {
    return run('docker', ['exec', cfg.caddyContainer, 'caddy', 'reload', '--config', '/gateway/caddy/Caddyfile', '--adapter', 'caddyfile'], { timeout: 30000 });
}

function rootCertPath() {
    return path.join(cfg.caddyDataDir, 'caddy', 'pki', 'authorities', 'local', 'root.crt');
}

module.exports = { build, write, reload, rootCertPath, CADDYFILE };
