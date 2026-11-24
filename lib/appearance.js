// How the Gateway looks: theme, colors per theme, font, text size, density and motion. Saved in state.appearance so it
// is the same on every device and also themes the sign-in and What's new pages. Like the other Waypoints apps, each of
// the light and dark themes can override five colors; an empty one means the default.
const MODES = ['system', 'light', 'dark'];
const FONTS = ['system', 'serif', 'mono', 'rounded'];
const SIZES = ['small', 'normal', 'large'];
const DENSITIES = ['comfortable', 'compact'];
const COLOR_KEYS = ['text', 'textSecondary', 'bg', 'accent', 'menuText', 'menuBg'];
const HEX = /^#[0-9a-fA-F]{6}$/;

// `cards` is an optional color per app (by app id) for its card on the home page, to make the apps you use stand out.
const defaults = () => ({ mode: 'system', light: {}, dark: {}, font: 'system', size: 'normal', density: 'comfortable', motion: false, cards: {} });

// Returns { errors, value }. Unknown or missing fields fall back to the defaults.
function validate(input) {
    const given = input && typeof input === 'object' ? input : {};
    const out = defaults();
    const errors = [];
    if (given.mode !== undefined) { if (MODES.includes(given.mode)) out.mode = given.mode; else errors.push('Pick a theme.'); }
    if (given.font !== undefined) { if (FONTS.includes(given.font)) out.font = given.font; else errors.push('Pick a font.'); }
    if (given.size !== undefined) { if (SIZES.includes(given.size)) out.size = given.size; else errors.push('Pick a text size.'); }
    if (given.density !== undefined) { if (DENSITIES.includes(given.density)) out.density = given.density; else errors.push('Pick a density.'); }
    out.motion = given.motion === true;
    for (const theme of ['light', 'dark']) {
        const src = given[theme] && typeof given[theme] === 'object' ? given[theme] : {};
        for (const k of COLOR_KEYS) {
            const v = src[k];
            if (v === undefined || v === null || v === '') continue; // the default
            if (HEX.test(String(v))) out[theme][k] = String(v).toLowerCase(); else errors.push(`${k} must be a color like #1d5fd1.`);
        }
    }
    // Card colors: only for apps in the catalog, and only real colors.
    const catalog = require('./catalog');
    const cards = given.cards && typeof given.cards === 'object' ? given.cards : {};
    for (const [id, v] of Object.entries(cards)) {
        if (v === undefined || v === null || v === '') continue;
        if (!catalog.get(id)) continue;
        if (HEX.test(String(v))) out.cards[id] = String(v).toLowerCase(); else errors.push(`The card color for ${id} must be a color like #1d5fd1.`);
    }
    return { errors, value: out };
}

module.exports = { defaults, validate };
