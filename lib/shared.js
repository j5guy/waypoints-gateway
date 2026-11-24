const catalog = require('./catalog');

// Settings that are the same for several apps (email, directory sign-in, single sign-on, backups, time zone) are set
// once on the Shared settings page and carried to the apps you choose. Each app names them differently, so MAP says
// which of its own settings each shared field becomes. A mapping is a variable name, or { env, map } to translate the
// value (Loadout turns LDAP on with AUTH_MODE).
const GROUPS = [
    {
        id: 'email', label: 'Email', help: 'The mail server apps use for invitations, reminders and password resets.',
        fields: [
            { key: 'smtp.host', label: 'Mail server', type: 'text' },
            { key: 'smtp.port', label: 'Mail server port', type: 'number', default: '587', help: '465 uses a secure connection from the start.' },
            { key: 'smtp.user', label: 'Mail user name', type: 'text' },
            { key: 'smtp.pass', label: 'Mail password', type: 'secret' },
            { key: 'smtp.from', label: 'Send as', type: 'text', help: 'For example: Waypoints <noreply@example.com>' },
            { key: 'smtp.secure', label: 'Secure connection', type: 'choice', default: '', help: 'Leave on Automatic unless your mail server needs otherwise.',
              options: [{ value: '', label: 'Automatic (secure on port 465)' }, { value: 'true', label: 'Always secure from the start' }, { value: 'false', label: 'Not from the start (STARTTLS)' }] }
        ]
    },
    {
        id: 'ldap', label: 'Sign in with your company directory (LDAP)', help: 'Lets people sign in with their directory account.',
        fields: [
            { key: 'ldap.enabled', label: 'Offer LDAP sign-in', type: 'bool', default: 'false' },
            { key: 'ldap.url', label: 'Directory address', type: 'text', help: 'For example ldaps://dc.example.com' },
            { key: 'ldap.bindDn', label: 'Service account', type: 'text', help: 'The distinguished name (DN) of the account used to look people up.' },
            { key: 'ldap.bindPassword', label: 'Service account password', type: 'secret' },
            { key: 'ldap.searchBase', label: 'Where to search for people', type: 'text' },
            { key: 'ldap.searchFilter', label: 'Search filter', type: 'text', default: '(sAMAccountName={{username}})', help: 'Must contain {{username}}.' },
            { key: 'ldap.tlsReject', label: 'Check the directory\'s certificate', type: 'choice', default: '', help: 'Checking needs the certificate to be trusted by the app.',
              options: [{ value: '', label: 'Not set' }, { value: 'true', label: 'Check it (recommended)' }, { value: 'false', label: 'Accept any certificate' }] }
        ]
    },
    {
        id: 'sso', label: 'Single sign-on (OIDC)', help: 'Lets people sign in through an identity provider.',
        fields: [
            { key: 'oidc.enabled', label: 'Offer single sign-on', type: 'bool', default: 'false' },
            { key: 'oidc.issuerUrl', label: 'Provider address', type: 'text', help: 'The provider\'s issuer URL.' },
            { key: 'oidc.clientId', label: 'Client ID', type: 'text' },
            { key: 'oidc.clientSecret', label: 'Client secret', type: 'secret' },
            { key: 'oidc.scopes', label: 'Scopes', type: 'text', default: 'openid profile email' }
        ]
    },
    {
        id: 'backups', label: 'Automatic backups', help: 'Scheduled backups made by the app itself.',
        fields: [
            { key: 'backup.enabled', label: 'Back up automatically', type: 'bool', default: 'false' },
            { key: 'backup.frequencyHours', label: 'Hours between backups', type: 'number', default: '24' },
            { key: 'backup.retentionCount', label: 'Backups to keep', type: 'number', default: '14' }
        ]
    },
    {
        id: 'general', label: 'Time zone', help: 'The time zone people see dates in.',
        fields: [{ key: 'general.timezone', label: 'Time zone', type: 'text', help: 'For example America/New_York.' }]
    }
];

const LDAP_ON = { true: 'ldap', false: 'local' };
const MAP = {
    fond: {
        'smtp.host': 'SMTP_HOST', 'smtp.port': 'SMTP_PORT', 'smtp.user': 'SMTP_USER', 'smtp.pass': 'SMTP_PASS', 'smtp.from': 'SMTP_FROM',
        'backup.enabled': 'BACKUP_ENABLED', 'backup.frequencyHours': 'BACKUP_FREQUENCY_HOURS', 'backup.retentionCount': 'BACKUP_RETENTION_COUNT'
    },
    loadout: {
        'smtp.host': 'SMTP_HOST', 'smtp.port': 'SMTP_PORT', 'smtp.user': 'SMTP_USER', 'smtp.pass': 'SMTP_PASS', 'smtp.from': 'MAIL_FROM', 'smtp.secure': 'SMTP_SECURE',
        'ldap.enabled': { env: 'AUTH_MODE', map: LDAP_ON }, 'ldap.url': 'ldapURL', 'ldap.bindDn': 'ldapBindDN', 'ldap.bindPassword': 'ldapBindPW',
        'ldap.searchBase': 'ldapSearchBase', 'ldap.searchFilter': 'ldapSearchFilter', 'ldap.tlsReject': 'LDAP_TLS_REJECT_UNAUTHORIZED',
        'general.timezone': 'TZ'
    },
    balanced: {
        'smtp.host': 'SMTP_HOST', 'smtp.port': 'SMTP_PORT', 'smtp.user': 'SMTP_USER', 'smtp.pass': 'SMTP_PASS', 'smtp.from': 'MAIL_FROM', 'smtp.secure': 'SMTP_SECURE',
        'ldap.enabled': 'LDAP_ENABLED', 'ldap.url': 'LDAP_URL', 'ldap.bindDn': 'LDAP_BIND_DN', 'ldap.bindPassword': 'LDAP_BIND_PASSWORD',
        'ldap.searchBase': 'LDAP_SEARCH_BASE', 'ldap.searchFilter': 'LDAP_SEARCH_FILTER',
        'general.timezone': 'DEFAULT_TIMEZONE'
    },
    charging: {
        'ldap.enabled': 'LDAP_ENABLED', 'ldap.url': 'LDAP_URL', 'ldap.bindDn': 'LDAP_BIND_DN', 'ldap.bindPassword': 'LDAP_BIND_PASSWORD',
        'ldap.searchBase': 'LDAP_SEARCH_BASE', 'ldap.searchFilter': 'LDAP_SEARCH_FILTER', 'ldap.tlsReject': 'LDAP_TLS_REJECT_UNAUTHORIZED',
        'oidc.enabled': 'OIDC_ENABLED', 'oidc.issuerUrl': 'OIDC_ISSUER_URL', 'oidc.clientId': 'OIDC_CLIENT_ID', 'oidc.clientSecret': 'OIDC_CLIENT_SECRET', 'oidc.scopes': 'OIDC_SCOPES'
    }
};

const group = (id) => GROUPS.find(g => g.id === id) || null;

// How many of a group's fields an app can take (0 means the app does not use this group).
function covers(appId, groupId) {
    const g = group(groupId);
    const m = MAP[appId] || {};
    return g ? g.fields.filter(f => m[f.key]).length : 0;
}

// Set an app's own settings from a group's saved values. Returns true if anything changed.
function applyValues(st, appId, groupId) {
    const a = st.apps[appId];
    const g = group(groupId);
    const saved = (st.shared && st.shared[groupId] && st.shared[groupId].values) || {};
    const m = MAP[appId] || {};
    if (!a || !g) return false;
    const before = JSON.stringify(a.settings || {});
    a.settings = { ...(a.settings || {}) };
    for (const f of g.fields) {
        const target = m[f.key];
        if (!target) continue;
        // The Shared page is the source of truth for the apps it is applied to: a field that is empty there is
        // removed from them too.
        const value = saved[f.key];
        const env = typeof target === 'string' ? target : target.env;
        const out = typeof target === 'string' ? value : (target.map && value in target.map ? target.map[value] : value);
        if (value === undefined || out === '' || out === undefined) delete a.settings[env]; else a.settings[env] = String(out);
    }
    return JSON.stringify(a.settings) !== before;
}

// A newly installed app takes the groups that are set to "all apps" (or that name it).
function seedNew(st, appId) {
    for (const g of GROUPS) {
        const s = st.shared && st.shared[g.id];
        if (!s || covers(appId, g.id) === 0) continue;
        if (s.apps === 'all' || (Array.isArray(s.apps) && s.apps.includes(appId))) applyValues(st, appId, g.id);
    }
}

// What the page needs: the groups, their saved values (secrets only as "set"), and which apps can use each group.
function info(st) {
    return GROUPS.map((g) => {
        const s = (st.shared && st.shared[g.id]) || { values: {}, apps: [] };
        const values = {};
        const secrets = {};
        for (const f of g.fields) {
            if (f.type === 'secret') secrets[f.key] = !!s.values[f.key];
            else values[f.key] = s.values[f.key] !== undefined ? s.values[f.key] : (f.default || '');
        }
        const apps = catalog.all().map(c => ({ id: c.id, name: c.name, installed: !!st.apps[c.id], covers: covers(c.id, g.id), of: g.fields.length })).filter(x => x.covers > 0);
        // `configured`: something has been saved for this group (as opposed to only showing its defaults).
        const configured = Object.keys(s.values).length > 0;
        return { id: g.id, label: g.label, help: g.help, fields: g.fields, values, secrets, apps, selected: s.apps, configured };
    });
}

// For each app, which of its own settings (by variable name) a shared group sets: { appId: { SMTP_HOST: 'email' } }.
// The page uses it to show which settings are managed from Shared settings.
const PREFIX_GROUP = { smtp: 'email', ldap: 'ldap', oidc: 'sso', backup: 'backups', general: 'general' };
function envGroups() {
    const out = {};
    for (const [appId, map] of Object.entries(MAP)) {
        out[appId] = {};
        for (const [key, target] of Object.entries(map)) {
            out[appId][typeof target === 'string' ? target : target.env] = PREFIX_GROUP[key.split('.')[0]];
        }
    }
    return out;
}

module.exports = { GROUPS, MAP, group, covers, applyValues, seedNew, info, envGroups };
