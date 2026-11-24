const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');

// Each app has a stock icon shipped in public/icons, and people can replace it with their own. A custom icon is a
// file in the data volume (/data/icons/<id>.<ext>). It is served with a locked-down policy so an SVG cannot run
// anything, and is checked by its first bytes, not by what the browser says it is.
const STOCK_DIR = path.join(cfg.publicDir, 'icons');
const CUSTOM_DIR = path.join(cfg.dataDir, 'icons');
const MAX_BYTES = 512 * 1024;

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

function sniff(buf) {
    if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
    if (buf.length > 6 && buf.slice(0, 4).toString() === 'GIF8') return 'gif';
    const head = buf.slice(0, 512).toString('utf8').trimStart().toLowerCase();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
    return null;
}

// An SVG with scripts, event handlers or embedded content is refused.
function svgIsSafe(buf) {
    const s = buf.toString('utf8').toLowerCase();
    return !/<script|<foreignobject|<iframe|<object|<embed|\son[a-z]+\s*=|javascript:|<!entity/.test(s);
}

// The file to serve for an app: the custom one if there is one, otherwise the stock icon.
function find(id) {
    const meta = catalog.get(id);
    if (!meta) return null;
    for (const ext of Object.keys(TYPES)) {
        const f = path.join(CUSTOM_DIR, `${id}.${ext}`);
        if (fs.existsSync(f)) return { file: f, type: TYPES[ext], custom: true };
    }
    const stock = path.join(STOCK_DIR, `${id}.svg`);
    return fs.existsSync(stock) ? { file: stock, type: TYPES.svg, custom: false } : null;
}

function save(id, buf) {
    if (!catalog.get(id)) return { error: 'Unknown app.' };
    if (!buf.length) return { error: 'That file is empty.' };
    if (buf.length > MAX_BYTES) return { error: 'The icon is larger than 512 KB.' };
    const ext = sniff(buf);
    if (!ext) return { error: 'Use a PNG, JPEG, WebP, GIF or SVG image.' };
    if (ext === 'svg' && !svgIsSafe(buf)) return { error: 'That SVG contains scripts or embedded content, so it was not used.' };
    reset(id);
    fs.mkdirSync(CUSTOM_DIR, { recursive: true });
    fs.writeFileSync(path.join(CUSTOM_DIR, `${id}.${ext}`), buf, { mode: 0o600 });
    return { ok: true };
}

function reset(id) {
    if (!catalog.get(id)) return false;
    for (const ext of Object.keys(TYPES)) { try { fs.unlinkSync(path.join(CUSTOM_DIR, `${id}.${ext}`)); } catch (_) { /* none */ } }
    return true;
}

const hasCustom = (id) => !!(find(id) && find(id).custom);

module.exports = { find, save, reset, hasCustom, MAX_BYTES };
