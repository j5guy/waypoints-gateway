const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

// A certificate and key a person already has (for example for *.example.com), used instead of free Let's Encrypt
// certificates in a domain install. The Gateway checks it before using it, and saves it where the proxy can read it.
//
// The private key is saved as a file (the proxy has to read it), in the Gateway's data volume with owner-only
// permissions. It is not encrypted like the Gateway's saved passwords, for that reason: see docs-admin security.
const DIR = path.join(cfg.dataDir, 'certs');
const CERT_FILE = path.join(DIR, 'custom.pem');
const KEY_FILE = path.join(DIR, 'custom.key');
// The same files as the proxy sees them (the data volume is mounted at /gateway in its container).
const CADDY_CERT = '/gateway/certs/custom.pem';
const CADDY_KEY = '/gateway/certs/custom.key';

const DAY = 24 * 3600 * 1000;
const BEGIN_CERT = /-----BEGIN CERTIFICATE-----/g;

function names(x509) {
    const san = String(x509.subjectAltName || '');
    const dns = san.split(',').map(s => s.trim()).filter(s => /^DNS:/i.test(s)).map(s => s.slice(4));
    if (dns.length) return dns;
    const cn = /CN=([^\n,]+)/.exec(String(x509.subject || ''));
    return cn ? [cn[1].trim()] : [];
}

// Look at a certificate and key. Returns { ok, errors, warnings, info, x509 }. `hosts` are the addresses it has to
// cover (each is an error if it does not). `now` is for testing.
function inspect(certPem, keyPem, { hosts = [], now = Date.now() } = {}) {
    const errors = [];
    const warnings = [];
    const cert = String(certPem || '').trim();
    const key = String(keyPem || '').trim();
    let x509 = null;
    let info = null;

    if (!cert) errors.push('Paste or choose the certificate file.');
    else {
        try { x509 = new crypto.X509Certificate(cert); }
        catch (_) { errors.push('That does not look like a certificate. It should start with -----BEGIN CERTIFICATE-----.'); }
    }

    let privateKey = null;
    if (!key) errors.push('Paste or choose the private key file.');
    else if (/ENCRYPTED/.test(key)) errors.push('That private key is protected by a passphrase. Remove the passphrase first (for example: openssl rsa -in key.pem -out key-open.pem), then use the new file.');
    else {
        try { privateKey = crypto.createPrivateKey(key); }
        catch (_) { errors.push('That does not look like a private key. It should start with -----BEGIN PRIVATE KEY----- (or RSA PRIVATE KEY).'); }
    }

    if (x509) {
        const notAfter = new Date(x509.validTo).getTime();
        const notBefore = new Date(x509.validFrom).getTime();
        const daysLeft = Math.floor((notAfter - now) / DAY);
        info = { subject: String(x509.subject || '').replace(/\n/g, ', '), names: names(x509), notAfter: new Date(notAfter).toISOString(), daysLeft };

        if (notAfter < now) errors.push(`That certificate expired on ${new Date(notAfter).toDateString()}.`);
        else if (notBefore > now) errors.push(`That certificate is not valid until ${new Date(notBefore).toDateString()}.`);
        else if (daysLeft < 30) warnings.push(`That certificate expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Replace it before then.`);

        if (privateKey && !x509.checkPrivateKey(privateKey)) errors.push('That private key does not belong to that certificate.');

        for (const h of hosts) {
            if (!x509.checkHost(h)) errors.push(`That certificate does not cover ${h}. It is valid for: ${info.names.join(', ') || 'no names'}.`);
        }

        const selfSigned = x509.issuer === x509.subject;
        if (selfSigned) warnings.push('That certificate is self-signed, so every device has to be told to trust it.');
        else if ((cert.match(BEGIN_CERT) || []).length < 2) warnings.push('The file holds only one certificate. Browsers also need the intermediate certificates, so use the full chain file if your provider gave you one.');
    }
    return { ok: errors.length === 0, errors, warnings, info, x509 };
}

// Save a checked certificate and key for the proxy.
function save(certPem, keyPem) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(CERT_FILE, String(certPem).trim() + '\n', { mode: 0o600 });
    fs.writeFileSync(KEY_FILE, String(keyPem).trim() + '\n', { mode: 0o600 });
}

const exists = () => fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);

// The saved certificate, for showing its details or checking it against new addresses.
function current() {
    if (!exists()) return null;
    return { cert: fs.readFileSync(CERT_FILE, 'utf8'), key: fs.readFileSync(KEY_FILE, 'utf8') };
}

function remove() {
    for (const f of [CERT_FILE, KEY_FILE]) { try { fs.unlinkSync(f); } catch (_) { /* none */ } }
}

module.exports = { inspect, save, exists, current, remove, CADDY_CERT, CADDY_KEY, CERT_FILE, KEY_FILE };
