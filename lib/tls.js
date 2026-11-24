const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cfg = require('./config');

// The Gateway's own encrypted address for the time before it has a proper one: https on its own port (8443), with a
// certificate the Gateway makes for itself the first time it starts. It is self-signed, so the browser warns once;
// the connection is still encrypted, which keeps the password from crossing the network in plain text.
//
// It does not use ports 80 or 443, so it cannot clash with a proxy someone already runs. After setup the Gateway also
// gets its normal address (https://gateway.<name>) from the built-in proxy.
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// The names and addresses the certificate should be valid for.
function subjectAltNames() {
    const names = ['DNS:localhost', 'DNS:waypoints-gateway', 'IP:127.0.0.1'];
    const ip = String(process.env.GATEWAY_IP || '').trim();
    if (IPV4.test(ip)) names.push(`IP:${ip}`);
    return names.join(',');
}

// Where the key and certificate live: next to the secrets key when that has its own volume, otherwise in the data
// volume. The file with the list of names is how a change of address is noticed.
function dir() {
    try {
        if (fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(l => l.split(' ')[4] === path.resolve(cfg.keyDir))) return cfg.keyDir;
    } catch (_) { /* not Linux */ }
    return cfg.dataDir;
}

// Returns { key, cert } to start the https listener with, or null if a certificate could not be made (the Gateway then
// keeps working on its plain address).
function load() {
    const d = dir();
    const keyFile = path.join(d, 'gateway-tls.key');
    const certFile = path.join(d, 'gateway-tls.crt');
    const sanFile = path.join(d, 'gateway-tls.san');
    const wanted = subjectAltNames();

    let current = '';
    try { current = fs.readFileSync(sanFile, 'utf8').trim(); } catch (_) { /* none yet */ }

    // Make a new one when there is none, the names changed, or it expires within 30 days.
    let needNew = !(fs.existsSync(keyFile) && fs.existsSync(certFile)) || current !== wanted;
    if (!needNew) {
        try {
            const x = new (require('crypto').X509Certificate)(fs.readFileSync(certFile));
            if (new Date(x.validTo).getTime() - Date.now() < 30 * 24 * 3600 * 1000) needNew = true;
        } catch (_) { needNew = true; }
    }
    if (needNew) {
        try {
            fs.mkdirSync(d, { recursive: true });
            execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
                '-keyout', keyFile, '-out', certFile, '-subj', '/CN=Waypoints Gateway', '-addext', `subjectAltName=${wanted}`], { stdio: 'ignore' });
            fs.chmodSync(keyFile, 0o600);
            fs.writeFileSync(sanFile, wanted + '\n');
        } catch (e) {
            console.warn('Could not make a certificate for the encrypted setup address: ' + e.message);
            return null;
        }
    }
    try { return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }; } catch (_) { return null; }
}

module.exports = { load, subjectAltNames };
