// Checking and saving the settings a catalog app lists. Used when an app's Settings are saved, and for the settings
// chosen while installing, so both treat a value the same way.

function validateSetting(s, raw) {
    const v = raw === null || raw === undefined ? '' : String(raw).trim();
    if (/[\r\n\0]/.test(v) || v.length > 2000) return { error: `${s.label} is not valid.` };
    if (s.type === 'bool') return { value: (raw === true || v === 'true') ? 'true' : 'false' };
    if (s.type === 'number' && v && !/^\d{1,9}$/.test(v)) return { error: `${s.label} must be a number.` };
    if (s.type === 'email' && v && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)) return { error: `${s.label} must be an email address.` };
    if (s.type === 'choice' && !(s.options || []).some(o => o.value === v)) return { error: `${s.label} is not one of the choices.` };
    return { value: v };
}

// Put the values from a form into an app's saved state: `a.env` for settings aimed at Docker Compose itself (the
// database image), `a.settings` for the rest. An empty value, or one equal to its default, is removed rather than
// saved, and a secret left as null is kept. Returns the problems found (nothing is changed for a value with one).
function applyListed(meta, a, given) {
    const errors = [];
    a.env = { ...(a.env || {}) };
    a.settings = { ...(a.settings || {}) };
    const values = given && typeof given === 'object' ? given : {};
    for (const s of meta.settings || []) {
        if (!(s.env in values)) continue;
        const raw = values[s.env];
        if (s.type === 'secret' && (raw === null || raw === undefined)) continue; // unchanged
        const r = validateSetting(s, raw);
        if (r.error) { errors.push(r.error); continue; }
        const bag = s.target === 'compose' ? a.env : a.settings;
        if (r.value === '' || (s.type !== 'bool' && r.value === (s.default || '') && s.default)) delete bag[s.env];
        else bag[s.env] = r.value;
    }
    return errors;
}

module.exports = { validateSetting, applyListed };
