const path = require('path');

module.exports = {
    version: require('../package.json').version,
    port: parseInt(process.env.PORT, 10) || 8080,
    // The encrypted setup address (self-signed). 0 turns it off.
    httpsPort: process.env.HTTPS_PORT === '0' ? 0 : (parseInt(process.env.HTTPS_PORT, 10) || 8443),
    dataDir: process.env.DATA_DIR || '/data',
    // A separate volume for the key that encrypts saved secrets (see lib/secrets.js).
    keyDir: process.env.KEY_DIR || '/key',
    // The Caddy data volume, mounted read-only, so the local CA's root certificate can be offered for download.
    caddyDataDir: process.env.CADDY_DATA_DIR || '/caddy-data',
    catalogDir: path.join(__dirname, '..', 'catalog'),
    caddyDir: path.join(__dirname, '..', 'caddy'),
    publicDir: path.join(__dirname, '..', 'public'),
    // Apps to tick by default in the wizard, e.g. PRESELECT=balanced or PRESELECT=fond,loadout (a product's install
    // page gives its own compose file with this set).
    preselect: String(process.env.PRESELECT || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    // One Docker network shared by the proxy and every app that sits behind it.
    network: 'waypoints-proxy',
    caddyContainer: 'waypoints-caddy',
    caddyImage: 'caddy:2',
    // Named volume holding the generated Caddyfile (the gateway writes it, Caddy reads it).
    gatewayVolume: 'waypoints-gateway-data'
};
