const fs = require('fs');
const path = require('path');
const { catalogDir } = require('./config');

// Every folder in catalog/ with an app.json is an app the gateway can install. To add one: a folder with
// app.json, compose.yml (joins the external `proxy` network, publishes no ports) and own-proxy.yml (publishes
// one port for people using their own reverse proxy).
function load() {
    const apps = [];
    for (const entry of fs.readdirSync(catalogDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(catalogDir, entry.name);
        const file = path.join(dir, 'app.json');
        if (!fs.existsSync(file)) continue;
        const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
        apps.push({ ...meta, dir });
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name));
}

const apps = load();
const byId = new Map(apps.map(a => [a.id, a]));

module.exports = {
    all: () => apps,
    get: (id) => byId.get(id) || null,
    // What the browser needs to know, without server paths.
    publicList: () => apps.map(({ id, name, description, port, fields, postInstall, insideApp, settings }) => ({ id, name, description, port, fields: fields || [], postInstall: postInstall || '', insideApp: insideApp || [], settings: settings || [] }))
};
