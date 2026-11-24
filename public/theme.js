// Applies the saved appearance (theme, colors, font, text size, density, motion) to every page. It is loaded in the
// <head> so the page is not shown in the wrong colors first: the last appearance is cached in this browser and
// applied at once, then the saved one is fetched and applied.
(function () {
    'use strict';
    var KEY = 'gw.appearance';
    var FONTS = {
        system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        serif: 'Georgia, "Times New Roman", serif',
        mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif'
    };
    var SIZES = { small: '14px', normal: '16px', large: '18px' };
    var PADS = { comfortable: ['18px', '14px'], compact: ['12px', '8px'] };
    var DEFAULTS = {
        light: { text: '#17202a', textSecondary: '#5d6b7a', bg: '#f6f7f9', accent: '#1d5fd1', menuText: '#5d6b7a', menuBg: '#ffffff' },
        dark: { text: '#e8edf2', textSecondary: '#9aa8b6', bg: '#11161c', accent: '#5b95f0', menuText: '#9aa8b6', menuBg: '#19212a' }
    };
    // Which CSS variable each color sets.
    var VARS = { text: '--text', textSecondary: '--muted', bg: '--bg', accent: '--accent', menuText: '--menu-text', menuBg: '--menu-bg' };

    var root = document.documentElement;
    var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var current = null;

    // Black or white text, whichever reads better on this color (for buttons in the accent color).
    function readable(hex) {
        var n = parseInt(hex.slice(1), 16);
        var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0b1118' : '#ffffff';
    }

    function activeTheme(a) {
        if (a.mode === 'dark') return 'dark';
        if (a.mode === 'light') return 'light';
        return dark && dark.matches ? 'dark' : 'light';
    }

    function apply(a) {
        if (!a) return;
        current = a;
        var theme = activeTheme(a);
        if (a.mode === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', a.mode);

        // Clear what an earlier appearance set, then set this theme's overrides.
        Object.keys(VARS).forEach(function (k) { root.style.removeProperty(VARS[k]); });
        root.style.removeProperty('--accent-text');
        var over = a[theme] || {};
        Object.keys(over).forEach(function (k) { if (VARS[k] && /^#[0-9a-fA-F]{6}$/.test(over[k])) root.style.setProperty(VARS[k], over[k]); });
        if (over.accent) root.style.setProperty('--accent-text', readable(over.accent));

        root.style.setProperty('--font', FONTS[a.font] || FONTS.system);
        root.style.fontSize = SIZES[a.size] || SIZES.normal;
        var pad = PADS[a.density] || PADS.comfortable;
        root.style.setProperty('--pad', pad[0]);
        root.style.setProperty('--gap', pad[1]);
        if (a.motion) root.setAttribute('data-motion', 'reduce'); else root.removeAttribute('data-motion');
    }

    try { var cached = JSON.parse(localStorage.getItem(KEY) || 'null'); if (cached) apply(cached); } catch (e) { /* no cache */ }

    fetch('/api/site').then(function (r) { return r.json(); }).then(function (s) {
        if (!s.appearance) return;
        apply(s.appearance);
        try { localStorage.setItem(KEY, JSON.stringify(s.appearance)); } catch (e) { /* not cached */ }
    }).catch(function () { /* keep what is applied */ });

    // Following the device's light/dark setting.
    if (dark && dark.addEventListener) dark.addEventListener('change', function () { if (current && current.mode === 'system') apply(current); });

    // For Settings > Appearance: preview a draft, remember the saved one, and the default colors.
    window.WPTheme = {
        apply: apply,
        defaults: DEFAULTS,
        saved: function (a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* not cached */ } apply(a); }
    };
})();
