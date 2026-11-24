(function () {
    'use strict';

    var root = document.getElementById('app');
    var data = null;       // /api/state
    var detected = null;   // /api/detect
    var step = 1;
    var wiz = null;

    // ---- tiny DOM helper: text is always set with textContent, never as HTML ----
    function h(tag, attrs) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            var v = attrs[k];
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
            else if (v === true) el.setAttribute(k, '');
            else if (v !== false && v != null) el.setAttribute(k, v);
        });
        for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
        return el;
    }
    function add(el, c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) return c.forEach(function (x) { add(el, x); });
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    function render() {
        root.textContent = '';
        for (var i = 0; i < arguments.length; i++) add(root, arguments[i]);
        window.scrollTo(0, 0);
    }

    function api(path, opts) {
        opts = opts || {};
        var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
        if (opts.body !== undefined) { init.method = 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
        return fetch(path, init).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
        });
    }

    function dashed(ip) { return ip.replace(/\./g, '-'); }
    function isIPv4(s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s); }

    // ---- login ----
    function loginView() {
        return api('/api/auth').then(function (a) {
            if (a.signedIn) return start();
            // On the plain address the password would cross the network unencrypted: point to the encrypted one.
            var secureUrl = 'https://' + location.hostname + ':8443';
            var plainNotice = location.protocol === 'http:'
                ? h('div', { class: 'notice warn' }, h('strong', { text: 'This page is not encrypted. ' }),
                    'For a safer sign-in open ', h('a', { href: secureUrl, text: secureUrl }),
                    ' instead. Your browser will warn once because the certificate is the Gateway\'s own: that is expected.')
                : null;
            var err = h('p', { class: 'notice bad', hidden: true });
            var pw = h('input', { type: 'password', id: 'pw', autocomplete: a.claimed ? 'current-password' : 'new-password' });
            var pw2 = h('input', { type: 'password', id: 'pw2', autocomplete: 'new-password' });
            function fail(m) { err.hidden = false; err.textContent = m; }
            function go() {
                if (!a.claimed) {
                    if (pw.value.length < 8) return fail('Use at least 8 characters.');
                    if (pw.value !== pw2.value) return fail('The two passwords are different.');
                    return api('/api/claim', { body: { password: pw.value } }).then(function (r) { if (r.ok) start(); else fail(r.error || 'Could not save it.'); });
                }
                api('/api/login', { body: { password: pw.value } }).then(function (r) { if (r.ok) start(); else fail(r.error || 'Could not sign in.'); });
            }
            [pw, pw2].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); }); });
            if (!a.claimed && !a.canClaim) {
                return render(h('h1', { text: 'Restart to set a password' }),
                    h('div', { class: 'card' }, h('p', { text: 'For safety, a password can only be created in the first 15 minutes after the Gateway starts.' }),
                        h('p', { text: 'Restart it, then open this page again:' }), h('pre', { text: 'docker restart waypoints-gateway' })));
            }
            render(
                h('h1', { text: a.claimed ? 'Sign in' : 'Welcome' }),
                h('div', { class: 'card' },
                    plainNotice,
                    a.claimed ? null : h('p', { text: 'Create a password for this Gateway.' }),
                    h('label', { for: 'pw', text: 'Password' }), pw,
                    a.claimed ? null : [h('label', { for: 'pw2', text: 'Again' }), pw2],
                    err,
                    h('div', { class: 'row' }, h('button', { onclick: go, text: a.claimed ? 'Sign in' : 'Create password' }))
                ),
                a.claimed ? h('p', { class: 'muted' }, 'Forgot it? Run ', h('code', { text: 'docker exec waypoints-gateway node reset-password.js' }), ' on the computer that runs the Gateway.') : null
            );
            pw.focus();
        });
    }

    // ---- start: load state, show dashboard or wizard ----
    function start() {
        return api('/api/state').then(function (r) {
            if (r._status === 401) { document.getElementById('logout').hidden = true; navEl.hidden = true; return loginView(); }
            if (r.error) return render(h('p', { class: 'notice bad', text: r.error }));
            data = r;
            document.getElementById('logout').hidden = false;
            navEl.hidden = !r.state.configured;
            // Apps installed by hand before the Gateway, so the home page can offer to bring them in.
            return api('/api/adoptable').then(function (a) {
                data.adoptable = a.apps || [];
                if (r.state.configured) dashboardView(); else beginWizard();
            });
        });
    }

    // ---- wizard ----
    // addOnly: skip the network questions and go straight to choosing more apps (the existing setup is kept).
    function beginWizard(addOnly, preselectId) {
        var st = data.state;
        var host = location.hostname;
        var ip = isIPv4(host) ? host : '';
        wiz = {
            mode: st.mode || '',
            access: st.access === 'domain' ? 'domain' : 'lan',
            ip: ip,
            ownName: false,
            baseName: st.baseName || (ip ? dashed(ip) + '.sslip.io' : ''),
            acmeEmail: st.acmeEmail || '',
            // A domain install can use free Let's Encrypt certificates, or a certificate the person already has.
            certSource: st.customCert ? 'custom' : 'letsencrypt',
            cert: '',
            key: '',
            bindAddr: st.bindAddr || '127.0.0.1',
            addOnly: addOnly === true && !!st.configured,
            apps: {}
        };
        data.catalog.forEach(function (a) {
            var prev = st.apps[a.id];
            // An installed app stays installed: it cannot be unticked or installed a second time.
            wiz.apps[a.id] = { installed: !!prev, on: !!prev, host: prev ? prev.host : '', port: prev ? prev.port : a.port, fields: prev ? prev.env : {} };
        });
        // Clicking a grayed card on the home page ticks that app.
        if (preselectId && wiz.apps[preselectId] && !wiz.apps[preselectId].installed) wiz.apps[preselectId].on = true;
        // A product's install page can start the gateway with PRESELECT set, so its app is already ticked.
        if (!Object.keys(st.apps).length) (data.preselect || []).forEach(function (id) { if (wiz.apps[id]) wiz.apps[id].on = true; });
        if (wiz.addOnly) {
            // The proxy mode and address were chosen already; carry them over without asking again.
            wiz.ownName = true;
            step = 3;
        } else {
            step = 1;
        }
        detected = null;
        wizardView();
    }

    function stepper() {
        var names = ['Check', 'Address', 'Apps', 'Install'];
        return h('ol', { class: 'steps' }, names.map(function (n, i) {
            return h('li', { class: i + 1 === step ? 'on' : (i + 1 < step ? 'done' : ''), text: (i + 1) + '. ' + n });
        }));
    }

    function wizardView() {
        if (step === 1) return checkView();
        if (step === 2) return addressView();
        if (step === 3) return appsView();
        return reviewView();
    }

    function choice(name, value, current, title, body, onPick, tag) {
        var input = h('input', { type: 'radio', name: name, value: value, checked: current === value });
        var box = h('label', { class: 'choice' + (current === value ? ' sel' : '') }, input,
            h('span', null, h('strong', null, title, tag ? h('span', { class: 'tag', text: tag }) : null), h('span', { class: 'help', text: body })));
        input.addEventListener('change', function () { onPick(value); });
        return box;
    }

    function checkView() {
        if (!detected) {
            render(stepper(), h('div', { class: 'card' }, h('h2', { text: 'Checking this computer...' }), h('p', { class: 'muted', text: 'Looking at Docker and whether another web server already uses ports 80 and 443. The first check downloads the proxy image, so it can take a minute.' })));
            return api('/api/detect').then(function (d) { detected = d; if (!wiz.mode) wiz.mode = recommend(d); checkView(); });
        }
        var d = detected;
        var notes = [];
        if (!d.docker.ok) notes.push(h('div', { class: 'notice bad', text: 'Docker did not answer: ' + d.docker.error + ' Make sure the Docker socket is mounted (see the compose file).' }));
        else if (!d.docker.composeOk) notes.push(h('div', { class: 'notice bad', text: 'Docker Compose is not available inside the gateway.' }));
        else notes.push(h('div', { class: 'notice ok', text: 'Docker ' + d.docker.version + ' is working.' }));
        // Older hardware cannot run the newest MongoDB: say so, and that the Gateway chooses the older one itself.
        if (d.hardware && d.hardware.reason) notes.push(h('div', { class: d.hardware.unsupported ? 'notice bad' : 'notice', text: d.hardware.reason }));

        var busy = (d.proxies || []).length > 0 || (d.hostProxy && ((d.hostProxy.http && d.hostProxy.http.answered) || (d.hostProxy.https && d.hostProxy.https.answered)) && !d.ownCaddyRunning);
        if (d.ownCaddyRunning) notes.push(h('div', { class: 'notice ok', text: 'The built-in proxy is already running here. You can change its settings below.' }));
        else if (d.ports.free === false) notes.push(h('div', { class: 'notice warn', text: 'Ports 80 and 443 are in use: ' + d.ports.detail }));
        else if (d.ports.free) notes.push(h('div', { class: 'notice ok', text: 'Ports 80 and 443 are free.' }));
        (d.proxies || []).forEach(function (p) { notes.push(h('div', { class: 'notice warn', text: 'A proxy is running already: ' + p.name + ' (' + p.image + ').' })); });
        ['http', 'https'].forEach(function (k) {
            var p = d.hostProxy && d.hostProxy[k];
            if (p && p.answered && !d.ownCaddyRunning) notes.push(h('div', { class: 'notice warn', text: 'Something on this computer answers on port ' + (k === 'http' ? '80' : '443') + (p.server ? ' (' + p.server + ')' : '') + '.' }));
        });

        var rec = recommend(d);
        render(stepper(),
            h('h1', { text: 'How should your apps get HTTPS?' }),
            h('p', { class: 'muted', text: 'Your apps encrypt everything in the browser, and browsers only allow that over HTTPS. Something has to provide the secure address.' }),
            h('div', { class: 'card' }, notes),
            h('div', { class: 'card' },
                choice('mode', 'builtin', wiz.mode, 'Set it up for me (built-in proxy)', 'Installs Caddy, which handles certificates and routes every app. Best if nothing else uses ports 80 and 443.', function (v) { wiz.mode = v; checkView(); }, rec === 'builtin' ? 'Recommended' : ''),
                choice('mode', 'own', wiz.mode, 'I already have a reverse proxy', 'Nginx, Apache, Traefik, Caddy, Nginx Proxy Manager or another. Each app publishes one port and you get ready-to-paste settings for your proxy.', function (v) { wiz.mode = v; checkView(); }, rec === 'own' ? 'Recommended' : ''),
                busy && wiz.mode === 'builtin' ? h('div', { class: 'notice warn', text: 'Something already seems to use ports 80/443, so the built-in proxy will probably fail to start. Choose "I already have a reverse proxy" unless you know it is free.' }) : null
            ),
            h('div', { class: 'row' },
                h('button', { disabled: !d.docker.ok || !d.docker.composeOk || !!(d.hardware && d.hardware.unsupported), onclick: function () { step = 2; wizardView(); }, text: 'Continue' }),
                h('button', { class: 'secondary', onclick: function () { detected = null; checkView(); }, text: 'Check again' })
            )
        );
    }

    function recommend(d) {
        var anyHost = d.hostProxy && ((d.hostProxy.http && d.hostProxy.http.answered) || (d.hostProxy.https && d.hostProxy.https.answered));
        if (d.ownCaddyRunning) return 'builtin';
        if ((d.proxies || []).length || d.ports.free === false || anyHost) return 'own';
        return 'builtin';
    }

    function addressView() {
        if (wiz.mode === 'own') {
            return render(stepper(),
                h('h1', { text: 'Your own proxy' }),
                h('div', { class: 'card' },
                    h('p', { text: 'Each app will publish one port for your proxy to forward to. Where should it listen?' }),
                    choice('bind', '127.0.0.1', wiz.bindAddr, 'Only on this computer', 'Your proxy runs on this same computer. Safest: nobody can reach the app except through the proxy.', function (v) { wiz.bindAddr = v; addressView(); }, 'Recommended'),
                    choice('bind', '0.0.0.0', wiz.bindAddr, 'On my whole network', 'Your proxy runs on another computer. Anyone on your network could also reach the app directly over plain HTTP, so firewall it if that matters.', function (v) { wiz.bindAddr = v; addressView(); })
                ),
                navRow(function () { step = 3; wizardView(); })
            );
        }
        var lan = wiz.access === 'lan';
        var ipInput = h('input', { type: 'text', id: 'ip', value: wiz.ip, placeholder: '192.168.1.20', inputmode: 'decimal' });
        var base = h('input', { type: 'text', id: 'base', value: wiz.baseName, placeholder: lan ? 'home.lan' : 'example.com', autocapitalize: 'off' });
        var email = h('input', { type: 'email', id: 'email', value: wiz.acmeEmail, placeholder: 'you@example.com' });
        var preview = h('p', { class: 'muted' });
        function refresh() {
            wiz.ip = ipInput.value.trim();
            if (lan && !wiz.ownName && isIPv4(wiz.ip)) { wiz.baseName = dashed(wiz.ip) + '.sslip.io'; base.value = wiz.baseName; }
            wiz.baseName = base.value.trim().toLowerCase();
            wiz.acmeEmail = email.value.trim();
            preview.textContent = wiz.baseName ? 'Your apps will be at addresses like https://fond.' + wiz.baseName : '';
        }
        [ipInput, base, email].forEach(function (i) { i.addEventListener('input', refresh); });
        var own = h('input', { type: 'checkbox', id: 'own', checked: wiz.ownName });
        own.addEventListener('change', function () { wiz.ownName = own.checked; addressView(); });
        var err = h('p', { class: 'notice bad', hidden: true });

        render(stepper(),
            h('h1', { text: 'Where will you open your apps?' }),
            h('div', { class: 'card' },
                choice('access', 'lan', wiz.access, 'Only on my home network', 'No domain needed. Each device trusts a certificate from this computer once (the last page shows how).', function (v) { wiz.access = v; addressView(); }, 'Easiest'),
                choice('access', 'domain', wiz.access, 'I have a domain name', 'Gets real certificates from Let\'s Encrypt, so there are no warnings on any device. Needs your domain pointed at this computer and ports 80 and 443 open to the internet.', function (v) { wiz.access = v; addressView(); })
            ),
            h('div', { class: 'card' },
                lan ? [
                    h('label', { for: 'ip', text: 'This computer\'s address on your network' }),
                    h('span', { class: 'help', text: 'Usually looks like 192.168.1.20. It is the address you used to open this page.' }),
                    ipInput,
                    h('label', { class: 'choice' }, own, h('span', null, h('strong', { text: 'I have my own local name (advanced)' }), h('span', { class: 'help', text: 'If your router or DNS already maps a name like home.lan to this computer. Otherwise leave this off: the address works through sslip.io, which needs internet DNS.' }))),
                    wiz.ownName ? [h('label', { for: 'base', text: 'Base name' }), base] : h('input', { type: 'hidden', id: 'base', value: wiz.baseName })
                ] : [
                    h('label', { for: 'base', text: 'Your domain' }),
                    h('span', { class: 'help', text: 'Each app gets its own name under it, like fond.example.com. Point *.example.com (or each name) at this computer.' }),
                    base
                ],
                preview, err
            ),
            // Domain installs: free certificates, or the person's own.
            lan ? null : h('div', { class: 'card' },
                h('h2', { text: 'Certificate' }),
                choice('certsrc', 'letsencrypt', wiz.certSource, 'Get free certificates for me (Let\'s Encrypt)', 'Automatic and renewed for you. Needs ports 80 and 443 open to the internet.', function (v) { wiz.certSource = v; addressView(); }, 'Easiest'),
                choice('certsrc', 'custom', wiz.certSource, 'Use a certificate I already have', 'For example a wildcard certificate for *.example.com from your company or provider. You renew it yourself, and can replace it on the Certificates page.', function (v) { wiz.certSource = v; addressView(); }),
                wiz.certSource === 'letsencrypt' ? [
                    h('label', { for: 'email', text: 'Email for the certificate account' }),
                    h('span', { class: 'help', text: 'Let\'s Encrypt uses it only for expiry notices.' }),
                    email
                ] : customCertBox()
            ),
            navRow(function () {
                refresh();
                if (!wiz.baseName) { err.hidden = false; err.textContent = lan ? 'Enter this computer\'s address.' : 'Enter your domain.'; return; }
                if (!lan && wiz.certSource !== 'custom' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wiz.acmeEmail)) { err.hidden = false; err.textContent = 'Enter an email address.'; return; }
                // Their own certificate: something has to be given now, unless one was saved before and is being kept.
                if (!lan && wiz.certSource === 'custom' && !(wiz.cert.trim() && wiz.key.trim()) && !data.state.customCert) {
                    err.hidden = false; err.textContent = 'Paste or choose the certificate and its private key.'; return;
                }
                // Addresses made from an earlier base name would be wrong now, so start those over.
                data.catalog.forEach(function (a) {
                    var w = wiz.apps[a.id];
                    if (w.host && w.host.slice(-(wiz.baseName.length + 1)) !== '.' + wiz.baseName) w.host = '';
                });
                step = 3; wizardView();
            })
        );
        refresh();
    }

    // The "use my own certificate" part of the Address step: the two boxes and a button to check them.
    function customCertBox() {
        var saved = data.state.customCert && data.state.customCertInfo;
        var result = h('div');
        var box = pemBox(wiz.cert, wiz.key, function () { wiz.cert = box.cert(); wiz.key = box.key(); result.textContent = ''; });
        return h('div', null,
            saved && !wiz.cert ? h('div', { class: 'notice ok', text: 'Your saved certificate is valid for ' + saved.names.join(', ') + ' until ' + new Date(saved.notAfter).toDateString() + '. Leave the boxes empty to keep using it, or paste a new one.' }) : null,
            box.el,
            h('div', { class: 'row' }, h('button', { class: 'secondary', text: 'Check the certificate', onclick: function () {
                result.textContent = '';
                add(result, h('p', { class: 'muted', text: 'Checking...' }));
                api('/api/cert-check', { body: { cert: wiz.cert, key: wiz.key, hosts: wiz.baseName ? ['gateway.' + wiz.baseName] : [] } }).then(function (r) {
                    showCertCheck(result, r);
                    add(result, h('p', { class: 'help', text: 'Every app address has to be covered by it too. That is checked again on the last step.' }));
                });
            } })),
            result);
    }

    function navRow(next, label) {
        return h('div', { class: 'row' },
            h('button', { class: 'secondary', onclick: function () { if (wiz.addOnly && step === 3) return start(); step -= 1; wizardView(); }, text: 'Back' }),
            h('button', { onclick: next, text: label || 'Continue' })
        );
    }

    function appsView() {
        var own = wiz.mode === 'own';
        var err = h('p', { class: 'notice bad', hidden: true });
        var anyNew = false;
        var cards = data.catalog.map(function (a) {
            var w = wiz.apps[a.id];
            if (!w.host && wiz.baseName) w.host = own ? '' : a.id + '.' + wiz.baseName;
            if (w.installed) {
                // Already installed: marked, not tickable. Changing the network setup may change its address.
                var addr = h('input', { type: 'text', value: w.host, autocapitalize: 'off', 'aria-label': a.name + ' address' });
                addr.addEventListener('input', function () { w.host = addr.value.trim().toLowerCase(); });
                return h('div', { class: 'card' },
                    h('div', { class: 'app' }, h('strong', { text: a.name }), h('span', { class: 'tag', text: 'Installed' })),
                    wiz.addOnly ? h('p', { class: 'muted', text: 'https://' + w.host }) : [h('label', { text: 'Address' }), addr]);
            }
            anyNew = true;
            var on = h('input', { type: 'checkbox', checked: w.on });
            var body = h('div', { hidden: !w.on });
            on.addEventListener('change', function () { w.on = on.checked; body.hidden = !w.on; });
            var host = h('input', { type: 'text', value: w.host, autocapitalize: 'off', placeholder: own ? 'fond.example.com' : a.id + '.' + wiz.baseName });
            host.addEventListener('input', function () { w.host = host.value.trim().toLowerCase(); });
            add(body, [h('label', { text: own ? 'The address people will use' : 'Address' }), host]);
            if (own) {
                var port = h('input', { type: 'number', min: '1', max: '65535', value: String(w.port) });
                port.addEventListener('input', function () { w.port = port.value; });
                add(body, [h('label', { text: 'Port to publish on this computer' }), h('span', { class: 'help', text: 'Your proxy will forward to this port. Change it if another app already uses it.' }), port]);
            }
            (a.fields || []).forEach(function (f) {
                var inp = h('input', { type: f.type === 'email' ? 'email' : 'text', value: w.fields[f.env] || '' });
                inp.addEventListener('input', function () { w.fields[f.env] = inp.value.trim(); });
                add(body, [h('label', { text: f.label }), f.help ? h('span', { class: 'help', text: f.help }) : null, inp]);
            });
            add(body, installSettings(a, w));
            return h('div', { class: 'card' },
                h('label', { class: 'choice' }, on, h('span', null, h('strong', { text: a.name }), h('span', { class: 'help', text: a.description }))),
                body);
        });
        if (wiz.addOnly && !anyNew) {
            return render(h('h1', { text: 'Add an app' }), cards,
                h('div', { class: 'card' }, h('p', { text: 'Every available app is already installed.' })),
                h('div', { class: 'row' }, h('button', { onclick: start, text: 'Back to my apps' })));
        }
        render(wiz.addOnly ? null : stepper(), h('h1', { text: wiz.addOnly ? 'Add an app' : 'Which apps?' }), cards, err,
            navRow(function () {
                var chosen = data.catalog.filter(function (a) { return wiz.apps[a.id].on; });
                if (!chosen.length) { err.hidden = false; err.textContent = 'Pick at least one app.'; return; }
                if (wiz.addOnly && !chosen.some(function (a) { return !wiz.apps[a.id].installed; })) { err.hidden = false; err.textContent = 'Tick the app you want to add.'; return; }
                for (var i = 0; i < chosen.length; i++) {
                    var a = chosen[i], w = wiz.apps[a.id];
                    if (!w.host) { err.hidden = false; err.textContent = a.name + ': enter an address.'; return; }
                    for (var j = 0; j < (a.fields || []).length; j++) {
                        var f = a.fields[j];
                        if (f.required && !(w.fields[f.env] || '').trim()) { err.hidden = false; err.textContent = a.name + ': ' + f.label + ' is required.'; return; }
                    }
                }
                step = 4; wizardView();
            }));
    }

    function payload() {
        var apps = {};
        data.catalog.forEach(function (a) {
            var w = wiz.apps[a.id];
            if (!w.on) return;
            var entry = { host: w.host, port: w.port, fields: w.fields };
            // A new app is installed with the settings chosen for it here, and the shared groups it uses.
            if (!w.installed && w.ed) {
                entry.settings = w.ed.values();
                entry.extra = w.ed.extra();
                entry.useShared = Object.keys(w.useShared || {}).filter(function (g) { return w.useShared[g]; });
            }
            apps[a.id] = entry;
        });
        var body = { mode: wiz.mode, access: wiz.access, baseName: wiz.baseName, acmeEmail: wiz.acmeEmail, bindAddr: wiz.bindAddr, apps: apps };
        if (wiz.mode === 'builtin' && wiz.access === 'domain') {
            body.certSource = wiz.certSource;
            if (wiz.certSource === 'custom') { body.cert = wiz.cert; body.key = wiz.key; }
        }
        return body;
    }

    function reviewView() {
        var p = payload();
        var items = Object.keys(p.apps).map(function (id) {
            var a = data.catalog.filter(function (c) { return c.id === id; })[0];
            return h('li', null, a.name + ': https://' + p.apps[id].host + (p.mode === 'own' ? '  (port ' + p.apps[id].port + ')' : '') + (wiz.apps[id].installed ? ' (already installed)' : ' (new)'));
        });
        var custom = p.mode === 'builtin' && p.access === 'domain' && p.certSource === 'custom';
        var certResult = h('div');
        var nav = navRow(function () { runInstall(p); }, 'Install');
        render(stepper(), h('h1', { text: 'Ready to install' }),
            h('div', { class: 'card' },
                h('p', { text: p.mode === 'builtin' ? (p.access === 'lan' ? 'The built-in proxy will use a local certificate for your home network.' : (custom ? 'The built-in proxy will use the certificate you gave.' : 'The built-in proxy will request real certificates for your domain.')) : 'Your own proxy will forward to the ports below.' }),
                h('ul', null, items),
                data.hardware && data.hardware.needsOldMongo ? h('p', { class: 'muted', text: data.hardware.reason }) : null,
                certResult,
                h('p', { class: 'muted', text: 'The first install downloads each app and its database, which can take a few minutes. Keep this page open.' })
            ),
            nav);
        // Their own certificate must cover every address the apps will use: check that now, before anything is installed.
        if (custom) {
            var installBtn = nav.lastChild;
            installBtn.disabled = true;
            add(certResult, h('p', { class: 'muted', text: 'Checking the certificate against your addresses...' }));
            var hosts = Object.keys(p.apps).map(function (id) { return p.apps[id].host; });
            if (wiz.baseName) hosts.unshift('gateway.' + wiz.baseName);
            api('/api/cert-check', { body: { cert: p.cert, key: p.key, hosts: hosts } }).then(function (r) {
                showCertCheck(certResult, r);
                installBtn.disabled = !r.ok;
            });
        }
    }

    function runInstall(p) {
        var log = h('pre', { class: 'log', 'aria-live': 'off' });
        var status = h('p', { class: 'muted', text: 'Starting...' });
        var actions = h('div', { class: 'row' });
        render(stepper(), h('h1', { text: 'Installing' }), h('div', { class: 'card' }, status, log), actions);
        api('/api/setup', { body: p }).then(function (r) {
            if (r._status !== 202) { status.textContent = (r.errors || [r.error || 'Could not start.']).join(' '); add(actions, h('button', { onclick: function () { step = 3; wizardView(); }, text: 'Go back' })); return; }
            poll(r.job);
        });
        function poll(id) {
            api('/api/job/' + id).then(function (j) {
                log.textContent = (j.lines || []).slice(-200).join('\n');
                log.scrollTop = log.scrollHeight;
                var running = (j.steps || []).filter(function (s) { return s.status === 'running'; })[0];
                if (j.status === 'running') { status.textContent = running ? running.name + '...' : 'Working...'; return setTimeout(function () { poll(id); }, 1500); }
                if (j.status === 'done') { status.textContent = 'Finished.'; return start(); }
                status.className = 'notice bad'; status.textContent = j.error || 'Something went wrong.';
                add(actions, h('button', { onclick: function () { step = 3; wizardView(); }, text: 'Go back' }));
            });
        }
    }

    // ---- dashboard (after setup) ----
    var STATUS = { running: 'ok', exited: 'bad', missing: 'bad', restarting: 'warn', created: 'warn' };

    var upEls = {};      // app id -> { badge, btn }
    var upAll = null;    // the "Update all" button
    var upNote = null;   // the status line under the update bar
    var upGateway = null;
    var upGwOk = null;

    function updateBar() {
        var st = data.state;
        upAll = h('button', { hidden: true, onclick: function () { runUpdate(Object.keys(data.state.apps)); }, text: 'Update all' });
        upNote = h('p', { class: 'muted', text: 'Checking for updates...' });
        var gwMsg = h('p', { class: 'muted' });
        upGateway = h('div', { class: 'notice warn', hidden: true },
            h('strong', { text: 'A newer Gateway is available.' }), ' ',
            h('button', { onclick: function () { selfUpdate(gwMsg); }, text: 'Update the Gateway' }), gwMsg);
        upGwOk = h('p', { class: 'muted', hidden: true, text: 'The Gateway is up to date (v' + data.version + ').' });
        return h('div', { class: 'card' },
            h('h2', { text: 'Updates' }),
            upNote,
            h('div', { class: 'row' }, upAll, h('button', { class: 'secondary', onclick: checkUpdates, text: 'Check again' })),
            upGateway, upGwOk);
    }

    // Automatic updates, per app: which apps, on which day and hour, and whether to back up first.
    function autoUpdateCard() {
        var st = data.state;
        var u = st.updates || { apps: {}, hour: 3, day: 'daily', backup: false };
        var ids = Object.keys(st.apps);
        var boxes = {};
        var rows = ids.map(function (id) {
            var a = data.catalog.filter(function (c) { return c.id === id; })[0] || { name: id };
            var cb = h('input', { type: 'checkbox', checked: !!(u.apps || {})[id] });
            boxes[id] = cb;
            return h('label', { class: 'choice' }, cb, h('span', null, h('strong', { text: a.name })));
        });
        var day = h('select', { 'aria-label': 'Day' });
        [['daily', 'Every day'], ['0', 'Every Sunday'], ['1', 'Every Monday'], ['2', 'Every Tuesday'], ['3', 'Every Wednesday'], ['4', 'Every Thursday'], ['5', 'Every Friday'], ['6', 'Every Saturday']].forEach(function (d) {
            var o = h('option', { value: d[0], text: d[1] }); if (String(u.day) === d[0]) o.selected = true; day.appendChild(o);
        });
        var hour = h('select', { 'aria-label': 'Hour' });
        for (var n = 0; n < 24; n++) {
            var o = h('option', { value: String(n), text: (n % 12 === 0 ? 12 : n % 12) + ':00 ' + (n < 12 ? 'AM' : 'PM') });
            if (Number(u.hour) === n) o.selected = true;
            hour.appendChild(o);
        }
        var bk = h('input', { type: 'checkbox', checked: !!u.backup });
        var msg = h('p', { class: 'muted' });
        return h('div', { class: 'card' },
            h('h2', { text: 'Automatic updates' }),
            h('p', { class: 'muted', text: 'Tick the apps that should update themselves. The Gateway checks at the time you choose, and only when a newer version exists. Your data is kept and each app restarts for a few seconds. It needs the Gateway to stay running.' }),
            ids.length ? rows : h('p', { class: 'muted', text: 'Install an app first.' }),
            h('div', { class: 'row' }, day, hour),
            h('p', { class: 'help', text: 'Times are in the Gateway\'s time zone (UTC unless you set TZ in its compose file).' }),
            h('label', { class: 'choice' }, bk, h('span', null, h('strong', { text: 'Back up before updating' }), h('span', { class: 'help', text: 'If the backup fails the app is not updated. Each backup uses disk space; delete old ones on the Settings page.' }))),
            msg,
            h('div', { class: 'row' }, h('button', { onclick: function () {
                var apps = {};
                ids.forEach(function (id) { apps[id] = boxes[id].checked; });
                api('/api/auto-update', { body: { apps: apps, hour: hour.value, day: day.value, backup: bk.checked } }).then(function (r) {
                    if (r.ok) { data.state.updates = r.updates; msg.textContent = 'Saved.'; } else msg.textContent = r.error || 'Could not save.';
                });
            }, text: 'Save' })));
    }

    // Start the self-update, then wait for the Gateway to come back on a new version.
    function selfUpdate(msg) {
        var old = data.version;
        msg.textContent = 'Starting the update...';
        api('/api/self-update', { body: {} }).then(function (r) {
            if (!r.ok) {
                msg.textContent = '';
                return add(msg, [(r.error || 'The update could not start.') + ' Run this on the computer that runs the Gateway: ', h('code', { text: 'docker compose pull && docker compose up -d' })]);
            }
            msg.textContent = 'Updating. The Gateway restarts in a few seconds and this page reconnects by itself...';
            var tries = 0;
            (function wait() {
                tries += 1;
                fetch('/api/auth', { credentials: 'same-origin' }).then(function (x) { return x.json(); }).then(function (a) {
                    if (a.version && a.version !== old) return location.reload();
                    if (tries > 60) { msg.textContent = 'It is taking longer than expected. Reload this page in a minute.'; return; }
                    setTimeout(wait, 3000);
                }).catch(function () { setTimeout(wait, 3000); });
            })();
        });
    }

    function checkUpdates() {
        if (upNote) upNote.textContent = 'Checking for updates...';
        api('/api/updates').then(function (r) {
            var count = 0, unknown = false;
            Object.keys((data && data.state && data.state.apps) || {}).forEach(function (id) {
                var s = (r.apps || {})[id] || 'unknown';
                if (s === 'yes') count += 1;
                if (s === 'unknown') unknown = true;
                var e = upEls[id];
                if (!e) return; // not on the home page right now
                e.btn.hidden = s !== 'yes';
                e.badge.textContent = s === 'yes' ? 'Update available' : (s === 'no' ? 'Up to date' : (s === 'pinned' ? 'Version pinned' : ''));
                e.badge.className = 'badge' + (s === 'yes' ? ' warn' : (s === 'no' ? ' ok' : ''));
            });
            var gw = r.gateway === 'yes' ? 1 : 0;
            setNavBadge(count + gw);
            if (updStrip) {
                updStrip.textContent = (count + gw) ? (count ? count + (count === 1 ? ' app has' : ' apps have') + ' an update' : '') + (count && gw ? ' and the ' : '') + (gw ? (count ? 'Gateway has one too' : 'A Gateway update is available') : '') : 'Everything is up to date';
                updStrip.className = 'pill ' + ((count + gw) ? 'warn' : 'ok');
            }
            if (!upNote) return; // not on the Updates page
            upAll.hidden = !count;
            upGateway.hidden = !gw;
            upGwOk.hidden = r.gateway !== 'no';
            upNote.textContent = count ? 'Updates are available.' : (unknown ? 'Everything that could be checked is up to date. Some apps could not be checked (no internet, or not downloaded from the registry).' : 'All your apps are up to date.');
        });
    }

    // ---- top navigation: Home, Certificates, Updates, Settings ----
    var navEl = document.getElementById('nav');
    var updStrip = null;
    function setNav(name) {
        Array.prototype.forEach.call(navEl.querySelectorAll('button'), function (b) {
            if (b.getAttribute('data-view') === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
    }
    function setNavBadge(n) {
        var b = navEl.querySelector('[data-view="updates"] .nb');
        b.textContent = n ? String(n) : '';
    }
    navEl.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b || !data) return;
        var v = b.getAttribute('data-view');
        if (v === 'home') dashboardView(); else if (v === 'certs') certsView(); else if (v === 'updates') updatesView(); else if (v === 'shared') sharedView(); else settingsView();
    });

    function certsView() {
        setNav('certs'); upEls = {}; upNote = null; updStrip = null;
        var st = data.state;
        render(h('h1', { text: 'Certificates' }),
            st.mode === 'builtin' && st.access === 'lan' ? trustCard()
                : (st.mode === 'builtin' && st.customCert ? ownCertCard()
                    : (st.mode === 'builtin' ? h('div', { class: 'notice ok', text: 'Real certificates from Let\'s Encrypt: nothing to install on any device. If an address shows a certificate error, check that its name points at this computer and that ports 80 and 443 reach it. A new certificate can take a minute to arrive.' })
                        : h('div', { class: 'notice', text: 'You are using your own reverse proxy, so certificates are managed there.' }))));
    }

    // Domain install with the person's own certificate: what it covers, when it runs out, and replacing it.
    function ownCertCard() {
        var info = data.state.customCertInfo;
        var days = info ? Math.floor((new Date(info.notAfter).getTime() - Date.now()) / 86400000) : null;
        var result = h('div');
        var box = pemBox('', '', function () { result.textContent = ''; });
        return h('div', { class: 'card' },
            h('h2', { text: 'Your certificate' }),
            info ? h('p', null, 'Valid for ', h('strong', { text: info.names.join(', ') || 'no names' }), ', until ', h('strong', { text: new Date(info.notAfter).toDateString() }), ' (' + days + ' days).') : null,
            days !== null && days < 30 ? h('div', { class: 'notice warn', text: days < 0 ? 'This certificate has expired. Replace it below.' : 'This certificate runs out soon. Replace it below before then.' }) : null,
            h('p', { class: 'muted', text: 'You renew this certificate yourself. When you have a new one, paste it here or choose the files, and the Gateway checks it against your addresses before it starts using it.' }),
            h('h3', { text: 'Replace the certificate' }),
            box.el,
            result,
            h('div', { class: 'row' }, h('button', { text: 'Check and use this certificate', onclick: function () {
                result.textContent = '';
                add(result, h('p', { class: 'muted', text: 'Checking...' }));
                api('/api/certificate', { body: { cert: box.cert(), key: box.key() } }).then(function (r) {
                    if (r.ok) {
                        data.state.customCertInfo = { names: r.info.names, notAfter: r.info.notAfter, subject: r.info.subject };
                        showCertCheck(result, { ok: true, info: r.info, warnings: r.warnings });
                        add(result, h('p', { class: 'notice ok', text: 'The new certificate is in use.' }));
                    } else showCertCheck(result, { ok: false, errors: r.errors || [r.error || 'Could not use that certificate.'] });
                });
            } })));
    }

    function updatesView() {
        setNav('updates'); upEls = {}; updStrip = null;
        render(h('h1', { text: 'Updates' }), autoUpdateCard(), updateBar());
        checkUpdates();
    }

    function settingsView() {
        setNav('settings'); upEls = {}; upNote = null; updStrip = null;
        var st = data.state;
        var keyApart = !!(data.secretsKey && data.secretsKey.separate);
        // Every section is folded away until opened, and they are listed A to Z.
        render(h('h1', { text: 'Settings' }),
            appearanceCard(),
            backupsCard(),
            section('Network', st.mode === 'own' ? 'Your own proxy' : 'Built-in proxy',
                h('p', { class: 'muted', text: st.mode === 'own' ? 'Using your own reverse proxy.' : 'Using the built-in proxy' + (st.baseName ? ' (' + st.baseName + ').' : '.') }),
                h('div', { class: 'row' }, h('button', { class: 'secondary', onclick: function () { beginWizard(false); }, text: 'Change network settings' })),
                data.gatewayHost && location.hostname !== data.gatewayHost
                    ? h('p', { class: 'muted' }, 'This page is also at ', h('a', { href: 'https://' + data.gatewayHost, text: 'https://' + data.gatewayHost }), '.') : null),
            section('Password', '', passwordCard()),
            section('Saved secrets', keyApart ? 'Encrypted, key kept apart' : 'Encrypted, key beside the data',
                keyApart
                    ? h('p', { class: 'muted', text: 'Passwords and keys you save here are encrypted. The key to unlock them is kept in its own volume, apart from the Gateway\'s data.' })
                    : h('div', { class: 'notice warn' }, h('strong', { text: 'The encryption key is stored next to the data. ' }), 'Passwords and keys are encrypted, but the key sits in the same volume, so a copy of that volume could unlock them. Add the key volume to the Gateway\'s compose file to keep them apart (see the Gateway documentation).')));
    }

    function runUpdate(ids) {
        var log = h('pre', { class: 'log', 'aria-live': 'off' });
        var status = h('p', { class: 'muted', text: 'Starting...' });
        var actions = h('div', { class: 'row' });
        render(h('h1', { text: 'Updating' }), h('div', { class: 'card' }, status, log), actions);
        api('/api/update', { body: { apps: ids } }).then(function (r) {
            if (r._status !== 202) { status.textContent = r.error || 'Could not start.'; return add(actions, h('button', { onclick: start, text: 'Back' })); }
            poll(r.job);
        });
        function poll(id) {
            api('/api/job/' + id).then(function (j) {
                log.textContent = (j.lines || []).slice(-200).join('\n');
                log.scrollTop = log.scrollHeight;
                var running = (j.steps || []).filter(function (s) { return s.status === 'running'; })[0];
                if (j.status === 'running') { status.textContent = running ? running.name + '...' : 'Working...'; return setTimeout(function () { poll(id); }, 1500); }
                if (j.status === 'done') { status.textContent = 'Updated.'; return add(actions, h('button', { onclick: start, text: 'Back to my apps' })); }
                status.className = 'notice bad'; status.textContent = j.error || 'Something went wrong.';
                add(actions, h('button', { onclick: start, text: 'Back' }));
            });
        }
    }

    function dashboardView() {
        var st = data.state;
        upEls = {};
        // A whole tile is clickable (and reachable with the keyboard); buttons inside it do their own thing.
        function clickable(el, label, go) {
            // A color chosen for this app (on its page) tints the card so the apps you use stand out.
            var tint = ((data.state.appearance || {}).cards || {})[el.getAttribute('data-app')];
            if (tint) { el.classList.add('tinted'); el.style.setProperty('--tile-color', tint); }
            el.setAttribute('role', 'link');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label', label);
            el.addEventListener('click', go);
            el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
            return el;
        }
        function inner(fn) { return function (e) { e.stopPropagation(); fn(); }; }
        function logo(a, n) { return appIcon(a, n); }

        var installed = [], missing = [];
        data.catalog.forEach(function (a, n) { (st.apps[a.id] ? installed : missing).push({ a: a, n: n }); });

        var tiles = installed.map(function (x) {
            var a = x.a, id = a.id;
            var s = (data.statuses || {})[id] || { status: 'missing', health: '' };
            var label = s.status === 'running' ? (s.health === 'starting' ? 'Starting' : s.health === 'unhealthy' ? 'Unhealthy' : 'Running') : (s.status.charAt(0).toUpperCase() + s.status.slice(1));
            var cls = s.status === 'running' && s.health !== 'unhealthy' ? (s.health === 'starting' ? 'warn' : 'ok') : (STATUS[s.status] || 'bad');
            var url = 'https://' + st.apps[id].host;
            var badge = h('span', { class: 'badge' });
            var upBtn = h('button', { hidden: true, onclick: inner(function () { runUpdate([id]); }), text: 'Update' });
            upEls[id] = { badge: badge, btn: upBtn };
            var open = h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener', text: 'Open' });
            open.addEventListener('click', function (e) { e.stopPropagation(); });
            return clickable(h('div', { class: 'tile', 'data-app': id },
                h('div', { class: 'tile-top' }, logo(a, x.n), h('div', null, h('strong', { text: a.name }), h('span', { class: 'small muted', text: a.description }))),
                h('div', { class: 'tile-status' }, h('span', { class: 'dot ' + cls }), label, badge),
                h('div', { class: 'row' }, open, upBtn)), 'Manage ' + a.name, function () { appView(id); });
        });
        var offTiles = missing.map(function (x) {
            var a = x.a;
            function go() { beginWizard(true, a.id); }
            return clickable(h('div', { class: 'tile off', 'data-app': a.id },
                h('div', { class: 'tile-top' }, logo(a, x.n), h('div', null, h('strong', { text: a.name }), h('span', { class: 'small muted', text: a.description }))),
                h('div', { class: 'tile-status muted', text: 'Not installed' }),
                h('div', { class: 'row' }, h('button', { class: 'secondary', onclick: inner(go), text: 'Install' }))), 'Install ' + a.name, go);
        });
        // The cards come first. Certificates and updates live on their own pages; this strip is a one-line summary.
        // The shortcuts under the cards are pill buttons. The first one reports the update state (green when everything
        // is up to date, amber when something has an update) and opens the Updates page.
        updStrip = h('button', { class: 'pill', text: 'Checking for updates...', onclick: updatesView });
        var certLink = st.mode === 'builtin' && st.access === 'lan'
            ? h('button', { class: 'pill', onclick: certsView, text: 'Trust the certificate on your devices' }) : null;
        // Grayed-out cards for apps you have not installed can be hidden (remembered in this browser). With nothing
        // installed they always show, so the page is never empty.
        var hideOff = getHideOff() && installed.length > 0;
        var offToggle = missing.length && installed.length
            ? h('button', { class: 'pill', onclick: function () { setHideOff(!hideOff); dashboardView(); }, text: hideOff ? 'Show apps I haven\'t installed' : 'Hide apps I haven\'t installed' }) : null;
        var addLink = hideOff && missing.length
            ? h('button', { class: 'pill', onclick: function () { beginWizard(true); }, text: 'Add an app' }) : null;
        upNote = null;
        setNav('home');
        // An app already running on this computer that the Gateway does not manage yet.
        var found = (data.adoptable || []).map(function (f) {
            return h('div', { class: 'notice warn' },
                h('strong', { text: f.name + ' is already installed on this computer. ' }),
                'Bring it into the Gateway to manage, update and back it up from here. Your data is copied and the old install is kept as a backup. ',
                h('button', { onclick: function () { adoptView(f.id); }, text: 'Bring it in' }));
        });
        // Look again for apps that were installed outside the Gateway (the page only looks when it opens).
        var scanMsg = h('div');
        var scanLink = h('button', { class: 'pill', text: 'Look for apps installed outside the Gateway', onclick: function () {
            scanMsg.textContent = '';
            add(scanMsg, h('p', { class: 'muted small', text: 'Looking...' }));
            api('/api/adoptable').then(function (r) {
                data.adoptable = r.apps || [];
                if (data.adoptable.length) return dashboardView(); // the notice with Bring it in appears above the cards
                scanMsg.textContent = '';
                add(scanMsg, h('p', { class: 'muted small', text: 'No apps found outside the Gateway.' }),
                    (r.notes || []).map(function (n) { return h('p', { class: 'help' }, h('strong', { text: n.name + ': ' }), n.reason); }));
            });
        } });
        render(
            h('h1', { text: 'Your apps' }),
            found,
            h('div', { class: 'grid' }, tiles, hideOff ? [] : offTiles),
            h('div', { class: 'pills' }, updStrip, certLink, offToggle, addLink, scanLink),
            scanMsg);
        checkUpdates();
    }

    function getHideOff() { try { return localStorage.getItem('gw.hideOff') === '1'; } catch (e) { return false; } }
    function setHideOff(on) { try { localStorage.setItem('gw.hideOff', on ? '1' : '0'); } catch (e) { /* not remembered */ } }

    // An app's icon: the stock one, or the one a person uploaded. If it cannot load, a colored letter stands in.
    var iconV = 1; // bumped when an icon changes, so the browser fetches the new one
    function appIcon(a, n) {
        var fallback = h('span', { class: 'logo c' + ((n || 0) % 5), 'aria-hidden': 'true', text: a.name.charAt(0) });
        var img = h('img', { class: 'logo-img', src: '/icons/' + encodeURIComponent(a.id) + '?v=' + iconV, alt: '', width: '44', height: '44' });
        img.addEventListener('error', function () { if (img.parentNode) img.parentNode.replaceChild(fallback, img); });
        return img;
    }

    // One field for one listed setting (an app's own, or a shared one). `key` names it in `i.values` / `i.secrets`
    // and in `collect`, which reads its value back when saving.
    function fieldFor(s, key, i, collect) {
        var cur = i.values[key];
        var hint = s.default && s.type !== 'bool' ? h('span', { class: 'help', text: 'Default: ' + (s.type === 'choice' ? ((s.options.filter(function (o) { return o.value === s.default; })[0] || {}).label || s.default) : s.default) }) : null;
        if (s.type === 'bool') {
            var cb = h('input', { type: 'checkbox', checked: String(cur) === 'true' });
            collect[key] = function () { return cb.checked; };
            return h('label', { class: 'choice' }, cb, h('span', null, h('strong', { text: s.label }), s.help ? h('span', { class: 'help', text: s.help }) : null));
        }
        if (s.type === 'choice') {
            var sel = h('select');
            (s.options || []).forEach(function (o) { var opt = h('option', { value: o.value, text: o.label }); if (o.value === (cur === undefined ? s.default : cur)) opt.selected = true; sel.appendChild(opt); });
            collect[key] = function () { return sel.value; };
            return h('div', null, h('label', { text: s.label }), s.help ? h('span', { class: 'help', text: s.help }) : null, sel);
        }
        if (s.type === 'secret') {
            var saved = !!i.secrets[key];
            var cleared = false;
            var pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: saved ? 'Saved. Type to replace it.' : '' });
            var clear = saved ? h('button', { class: 'link', onclick: function () { cleared = true; pw.value = ''; pw.placeholder = 'Will be cleared when you save'; clear.hidden = true; }, text: 'Clear the saved value' }) : null;
            collect[key] = function () { return cleared ? '' : (pw.value === '' ? null : pw.value); };
            return h('div', null, h('label', { text: s.label }), s.help ? h('span', { class: 'help', text: s.help }) : null, pw, clear);
        }
        var inp = h('input', { type: s.type === 'number' ? 'number' : (s.type === 'email' ? 'email' : 'text'), value: cur === undefined ? '' : cur, placeholder: s.default || '', autocomplete: 'off', autocapitalize: 'off' });
        collect[key] = function () { return inp.value; };
        return h('div', null, h('label', { text: s.label }), s.help ? h('span', { class: 'help', text: s.help }) : null, inp, hint);
    }

    function groupBy(list) {
        var g = {};
        list.forEach(function (s) { (g[s.group || 'General'] = g[s.group || 'General'] || []).push(s); });
        return g;
    }

    // ---- shared settings, as the app pages and the install step show them ----
    function sharedLabel(gid) {
        var g = (data.sharedInfo || []).filter(function (x) { return x.id === gid; })[0];
        return g ? g.label : gid;
    }
    // The shared groups that currently apply to an app: set up, and covering it (all apps, or ticked for it).
    function sharedUsedBy(appId) {
        var used = {};
        (data.sharedInfo || []).forEach(function (g) {
            var covers = g.apps.some(function (x) { return x.id === appId && x.covers > 0; });
            var ticked = g.selected === 'all' || (Array.isArray(g.selected) && g.selected.indexOf(appId) !== -1);
            if (covers && ticked && g.configured) used[g.id] = true;
        });
        return used;
    }
    // What cannot be set from the Gateway for this app, said plainly.
    function insideAppNote(a) {
        if (!a.insideApp || !a.insideApp.length) return null;
        return h('div', { class: 'notice' },
            h('strong', { text: 'Not set from the Gateway, only inside ' + a.name + ': ' }),
            h('ul', null, a.insideApp.map(function (t) { return h('li', { text: t }); })));
    }

    // An app's settings as a form: everyday settings first, then Advanced behind a warning. It is used on the app's own
    // page and in the install step, so both offer the same things. `a` is the catalog entry, `i` the current values
    // ({ settings, values, secrets, extra }), opts.sharedEnv says which settings a shared group manages.
    // Returns { el, values(), extra(), setShared(used, hide) }.
    function settingsEditor(a, i, opts) {
        opts = opts || {};
        var sharedEnv = opts.sharedEnv || {};
        var collect = {};
        var managed = {};   // setting -> { el, note, group, hide }
        var basic = i.settings.filter(function (s) { return s.level !== 'advanced'; });
        var adv = i.settings.filter(function (s) { return s.level === 'advanced'; });
        var root = h('div');

        // Each group of settings is folded away until opened, and the groups are listed A to Z.
        function groupBox(title, build) {
            var d = h('details', { class: 'subgroup' }, h('summary', null, h('strong', { text: title })));
            build(d);
            return d;
        }
        function field(s) {
            var el = fieldFor(s, s.env, i, collect);
            var g = sharedEnv[s.env];
            if (!g) return el;
            var note = h('span', { class: 'help shared-note', hidden: true });
            managed[s.env] = { el: el, note: note, group: g, hide: false };
            return h('div', null, el, note);
        }

        if (!basic.length) add(root, h('p', { class: 'muted', text: 'Everything else is set inside ' + a.name + ', under Admin.' }));
        var bg = groupBy(basic);
        Object.keys(bg).sort().forEach(function (g) {
            add(root, groupBox(g, function (d) { bg[g].forEach(function (s) { add(d, field(s)); }); }));
        });

        // Advanced: listed options, then "anything else", a pinned version and a memory limit.
        var rows = ((i.extra && i.extra.env) || []).map(function (r) { return { name: r.name, value: r.value }; });
        var list = h('div');
        var tag = h('input', { type: 'text', value: (i.extra && i.extra.tag) || '', placeholder: 'latest', autocapitalize: 'off', autocomplete: 'off' });
        var mem = h('input', { type: 'text', value: (i.extra && i.extra.memory) || '', placeholder: 'No limit', autocapitalize: 'off', autocomplete: 'off' });
        function drawRows() {
            list.textContent = '';
            rows.forEach(function (r, n) {
                var name = h('input', { type: 'text', value: r.name, placeholder: 'NAME', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Setting name' });
                // Values that look like secrets are hidden on screen (they are still saved as typed).
                var val = h('input', { type: /secret|pass|token|key/i.test(r.name) ? 'password' : 'text', value: r.value, placeholder: 'value', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Value' });
                name.addEventListener('input', function () { r.name = name.value; });
                val.addEventListener('input', function () { r.value = val.value; });
                add(list, h('div', { class: 'kv' }, name, val, h('button', { class: 'secondary', onclick: function () { rows.splice(n, 1); drawRows(); }, 'aria-label': 'Remove', text: 'Remove' })));
            });
            if (!rows.length) add(list, h('p', { class: 'muted', text: 'None added.' }));
        }
        drawRows();
        var advBox = h('details', { open: !!(rows.length || (i.extra && (i.extra.tag || i.extra.memory))) },
            h('summary', { text: 'Advanced settings' }),
            h('div', { class: 'notice warn' }, h('strong', { text: 'For advanced users. ' }), 'A wrong value here can stop ' + a.name + ' from starting or break sign-in. If it will not start, clear what you changed and save to go back to the default.'));
        // The listed groups, plus "Anything else", "Memory" and "Version", all folded away and listed A to Z.
        var ag = groupBy(adv);
        var advGroups = Object.keys(ag).map(function (g) {
            return { title: g, build: function (d) { ag[g].forEach(function (s) { add(d, field(s)); }); } };
        });
        advGroups.push({ title: 'Anything else', build: function (d) {
            add(d, [
                h('p', { class: 'help', text: 'A setting the app understands that is not listed above. Enter its name and value exactly as the app\'s documentation gives them. It replaces the same setting if one exists.' }),
                list,
                h('div', { class: 'row' }, h('button', { class: 'secondary', onclick: function () { rows.push({ name: '', value: '' }); drawRows(); }, text: 'Add a setting' }))
            ]);
        } });
        advGroups.push({ title: 'Memory', build: function (d) {
            add(d, [h('label', { text: 'Memory limit' }), h('span', { class: 'help', text: 'For example 512m or 2g. Leave empty for no limit.' }), mem]);
        } });
        advGroups.push({ title: 'Version', build: function (d) {
            add(d, [h('label', { text: 'Run this version' }), h('span', { class: 'help', text: 'Leave empty to always use the newest. A version number keeps the app on that version and turns off its update button.' }), tag]);
        } });
        advGroups.sort(byLabel).forEach(function (g) { add(advBox, groupBox(g.title, g.build)); });
        add(root, advBox);

        return {
            el: root,
            // Settings a shared group is giving the app are left out, so they are not set twice.
            values: function () {
                var v = {};
                Object.keys(collect).forEach(function (k) { if (managed[k] && managed[k].hide) return; v[k] = collect[k](); });
                return v;
            },
            extra: function () { return { env: rows, tag: tag.value, memory: mem.value }; },
            // `used` names the shared groups in use. With `hide`, those settings are hidden (install step); otherwise they
            // stay editable with a note that Shared settings also sets them (the app's page).
            setShared: function (used, hide) {
                Object.keys(managed).forEach(function (k) {
                    var m = managed[k];
                    var on = !!used[m.group];
                    m.hide = on && !!hide;
                    m.el.hidden = m.hide;
                    m.note.hidden = !on;
                    m.note.textContent = hide
                        ? 'Set by Shared settings (' + sharedLabel(m.group) + ').'
                        : 'Also set by Shared settings (' + sharedLabel(m.group) + '). Saving that page again replaces this value.';
                });
            }
        };
    }

    // The optional "settings for this app" part of the install step: which shared groups to use (ticked when they are set
    // up and cover the app), the app's own settings and Advanced, and what can only be set inside the app. The editor and
    // the ticks are kept on `w`, so they survive going back and forth between steps.
    function installSettings(a, w) {
        var hw = data.hardware || {};
        var groups = (data.sharedInfo || []).filter(function (g) { return g.apps.some(function (x) { return x.id === a.id && x.covers > 0; }); });
        if (!w.useShared) {
            w.useShared = {};
            groups.forEach(function (g) {
                var ticked = g.selected === 'all' || (Array.isArray(g.selected) && g.selected.indexOf(a.id) !== -1);
                w.useShared[g.id] = !!(g.configured && ticked);
            });
        }
        if (!w.ed) {
            var values = {};
            if (hw.needsOldMongo) values.MONGO_IMAGE = data.mongoOld; // this computer cannot run the newest MongoDB
            w.ed = settingsEditor(a, { settings: a.settings || [], values: values, secrets: {}, extra: { env: [], tag: '', memory: '' } }, { sharedEnv: (data.sharedEnv || {})[a.id] });
        }
        w.ed.setShared(w.useShared, true);

        var shareBox = h('div');
        groups.forEach(function (g) {
            var cb = h('input', { type: 'checkbox', checked: !!w.useShared[g.id], disabled: !g.configured });
            cb.addEventListener('change', function () { w.useShared[g.id] = cb.checked; w.ed.setShared(w.useShared, true); });
            add(shareBox, h('label', { class: 'choice' }, cb, h('span', null,
                h('strong', { text: 'Use the shared ' + g.label + ' settings' }),
                h('span', { class: 'help', text: g.configured ? 'Taken from the Shared settings page. Untick it to set this app\'s own instead.' : 'Not set up yet. Set it on the Shared settings page first, or fill in this app\'s own settings below.' }))));
        });
        return h('details', { class: 'subgroup' },
            h('summary', null, h('strong', { text: 'Settings for ' + a.name + ' (optional)' }), h('span', { class: 'summary-note muted small', text: 'You can change these any time later' })),
            hw.needsOldMongo ? h('div', { class: 'notice', text: hw.reason }) : null,
            groups.length ? [h('h3', { text: 'Shared settings' }), shareBox] : null,
            h('h3', { text: 'Settings for this app' }),
            w.ed.el,
            insideAppNote(a));
    }

    // Two boxes for a certificate and its private key: paste the text or choose the files. Returns { el, cert(), key() }.
    function pemBox(initialCert, initialKey, onChange) {
        function area(label, placeholder, value) {
            var t = h('textarea', { class: 'pem', rows: '6', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', placeholder: placeholder, 'aria-label': label });
            t.value = value || '';
            return t;
        }
        function picker(label, target) {
            var f = h('input', { type: 'file', accept: '.pem,.crt,.cer,.key,.txt', 'aria-label': 'Choose the ' + label.toLowerCase() + ' file' });
            f.addEventListener('change', function () {
                var file = f.files[0];
                if (!file) return;
                var r = new FileReader();
                r.onload = function () { target.value = String(r.result || ''); if (onChange) onChange(); };
                r.readAsText(file);
            });
            return f;
        }
        var certArea = area('Certificate', '-----BEGIN CERTIFICATE-----', initialCert);
        var keyArea = area('Private key', '-----BEGIN PRIVATE KEY-----', initialKey);
        certArea.addEventListener('input', function () { if (onChange) onChange(); });
        keyArea.addEventListener('input', function () { if (onChange) onChange(); });
        var el = h('div', null,
            h('label', { text: 'Certificate' }),
            h('span', { class: 'help', text: 'The certificate, or the full chain file your provider gave you. Paste it, or choose the file.' }),
            certArea, picker('Certificate', certArea),
            h('label', { text: 'Private key' }),
            h('span', { class: 'help', text: 'The matching private key, without a passphrase. It is kept on the Gateway for the proxy to use and is never shown again.' }),
            keyArea, picker('Private key', keyArea));
        return { el: el, cert: function () { return certArea.value; }, key: function () { return keyArea.value; } };
    }

    // Show the result of /api/cert-check: what is wrong in red, what to be aware of in yellow, what it covers in green.
    function showCertCheck(box, r) {
        box.textContent = '';
        (r.errors || []).forEach(function (e) { add(box, h('p', null, h('span', { class: 'dot bad' }), e)); });
        (r.warnings || []).forEach(function (w) { add(box, h('p', null, h('span', { class: 'dot warn' }), w)); });
        if (r.ok && r.info) {
            add(box, h('p', null, h('span', { class: 'dot ok' }), 'The certificate and key are a match. Valid for ' + (r.info.names.join(', ') || 'no names') + ', until ' + new Date(r.info.notAfter).toDateString() + ' (' + r.info.daysLeft + ' days).'));
        }
    }

    // A folded-away section: a header (title, and a short note on the right) that opens to show its content.
    function section(title, note) {
        var d = h('details', { class: 'card shared-group' },
            h('summary', null, h('strong', { text: title }), note ? h('span', { class: 'summary-note muted small', text: note }) : null));
        for (var n = 2; n < arguments.length; n++) add(d, arguments[n]);
        return d;
    }
    // Sections on every page are listed A to Z.
    function byLabel(a, b) { return String(a.label || a.title || '').localeCompare(String(b.label || b.title || '')); }

    // ---- shared settings: set once, carried to the apps you choose ----
    function sharedView() {
        setNav('shared'); upEls = {}; upNote = null; updStrip = null;
        render(h('h1', { text: 'Shared settings' }), h('p', { class: 'muted', text: 'Set email, sign-in, backups and the time zone once here, and carry them to the apps you choose.' }), h('p', { class: 'muted', text: 'Loading...' }));
        api('/api/shared').then(function (r) {
            var cards = (r.groups || []).slice().sort(byLabel).map(function (g) {
                var collect = {};
                var picks = {};
                var apps = g.apps;
                var isAll = g.selected === 'all';
                var chosen = Array.isArray(g.selected) ? g.selected : [];
                var allBox = h('input', { type: 'checkbox', checked: isAll });
                var list = h('div', { hidden: isAll });
                apps.forEach(function (x) {
                    var cb = h('input', { type: 'checkbox', checked: chosen.indexOf(x.id) !== -1, disabled: !x.installed });
                    picks[x.id] = cb;
                    add(list, h('label', { class: 'choice' }, cb, h('span', null, h('strong', { text: x.name }),
                        h('span', { class: 'help', text: x.installed ? 'Uses ' + x.covers + ' of the ' + x.of + ' settings here.' : 'Not installed.' }))));
                });
                allBox.addEventListener('change', function () { list.hidden = allBox.checked; });
                var msg = h('p', { class: 'muted' });
                // Each group is folded away until opened; its header says where it is applied.
                var status = g.selected === 'all' ? 'Applied to all apps that use it'
                    : (Array.isArray(g.selected) && g.selected.length ? 'Applied to ' + g.selected.length + (g.selected.length === 1 ? ' app' : ' apps') : 'Not applied yet');
                var card = h('details', { class: 'card shared-group' },
                    h('summary', null, h('strong', { text: g.label }), h('span', { class: 'summary-note muted small', text: status })),
                    h('p', { class: 'muted', text: g.help }));
                g.fields.forEach(function (f) { add(card, fieldFor(f, f.key, g, collect)); });
                add(card, h('h3', { text: 'Apply to' }),
                    apps.length ? [
                        h('label', { class: 'choice' }, allBox, h('span', null, h('strong', { text: 'All apps that use these settings' }), h('span', { class: 'help', text: 'Including apps you install later.' }))),
                        list
                    ] : h('p', { class: 'muted', text: 'None of your apps use these settings.' }),
                    h('p', { class: 'help', text: 'Saving restarts the apps it changes for a few seconds. Unticking an app later leaves it with what it already has.' }),
                    msg,
                    h('div', { class: 'row' }, h('button', { disabled: !apps.length, onclick: function () {
                        var values = {};
                        Object.keys(collect).forEach(function (k) { values[k] = collect[k](); });
                        var chosenApps = allBox.checked ? 'all' : Object.keys(picks).filter(function (id) { return picks[id].checked; });
                        msg.textContent = 'Saving and applying...';
                        api('/api/shared/' + g.id, { body: { values: values, apps: chosenApps } }).then(function (j0) {
                            if (j0._status !== 202) { msg.textContent = (j0.errors || [j0.error || 'Could not save.']).join(' '); return; }
                            (function poll() {
                                api('/api/job/' + j0.job).then(function (j) {
                                    if (j.status === 'running') return setTimeout(poll, 1500);
                                    msg.textContent = j.status === 'done' ? (j.lines && j.lines.length ? j.lines[j.lines.length - 1] : 'Saved.') : (j.error || 'Something went wrong.');
                                    // The apps' pages and the install step read this, so keep it current.
                                    api('/api/shared').then(function (sr) { if (sr.groups) data.sharedInfo = sr.groups; });
                                });
                            })();
                        });
                    }, text: 'Save and apply' })));
                return card;
            });
            render(h('h1', { text: 'Shared settings' }), h('p', { class: 'muted', text: 'Set email, sign-in, backups and the time zone once here, and carry them to the apps you choose.' }), cards);
        });
    }

    // ---- bring in an app that was installed before the Gateway ----
    function adoptView(id) {
        setNav('home');
        var a = data.catalog.filter(function (c) { return c.id === id; })[0];
        var st = data.state;
        var host = h('input', { type: 'text', value: st.mode === 'builtin' && st.baseName ? id + '.' + st.baseName : '', placeholder: id + '.example.com', autocapitalize: 'off', autocomplete: 'off' });
        var err = h('p', { class: 'notice bad', hidden: true });
        var backup = h('input', { type: 'checkbox', checked: true });

        function go() {
            err.hidden = true;
            var log = h('pre', { class: 'log', 'aria-live': 'off' });
            var status = h('p', { class: 'muted', text: 'Starting...' });
            var actions = h('div', { class: 'row' });
            render(h('h1', { text: 'Bringing in ' + a.name }), h('div', { class: 'card' }, status, log), actions);
            api('/api/adopt', { body: { id: id, host: host.value, backup: backup.checked } }).then(function (r) {
                if (r._status !== 202) { status.textContent = r.error || 'Could not start.'; return add(actions, h('button', { onclick: function () { adoptView(id); }, text: 'Back' })); }
                (function poll() {
                    api('/api/job/' + r.job).then(function (j) {
                        log.textContent = (j.lines || []).slice(-200).join('\n');
                        log.scrollTop = log.scrollHeight;
                        if (j.status === 'running') { var run = (j.steps || []).filter(function (s) { return s.status === 'running'; })[0]; status.textContent = run ? run.name + '...' : 'Working...'; return setTimeout(poll, 2000); }
                        if (j.status === 'done') {
                            status.textContent = a.name + ' is now managed by the Gateway.';
                            add(actions, h('a', { class: 'btn', href: 'https://' + host.value, target: '_blank', rel: 'noopener', text: 'Open ' + a.name }));
                            if (j.exportFile) add(actions, h('a', { class: 'btn secondary', href: '/api/exports/' + encodeURIComponent(j.exportFile), text: 'Download the backup' }));
                            return add(actions, h('button', { class: 'secondary', onclick: start, text: 'Back to my apps' }));
                        }
                        status.className = 'notice bad'; status.textContent = j.error || 'Something went wrong.';
                        add(actions, h('button', { onclick: start, text: 'Back' }));
                    });
                })();
            });
        }

        render(h('p', null, h('button', { class: 'link', onclick: start, text: 'Back' })),
            h('h1', { text: 'Bring ' + a.name + ' into the Gateway' }),
            h('div', { class: 'card' },
                h('p', { text: 'The Gateway found ' + a.name + ' already running on this computer.' }),
                h('ul', null,
                    h('li', { text: 'Your data is copied. Nothing is deleted.' }),
                    h('li', { text: 'The old install is stopped and kept, renamed, as a backup.' }),
                    h('li', { text: a.name + ' gets a secure address from the Gateway, and can be updated and managed here.' }),
                    h('li', { text: 'If anything goes wrong, the old install is started again.' })),
                h('label', { text: 'Address for ' + a.name }),
                h('span', { class: 'help', text: 'The name people will open it at. The old address stops working.' }),
                host,
                h('label', { class: 'choice' }, backup, h('span', null, h('strong', { text: 'Download a backup first (recommended)' }), h('span', { class: 'help', text: 'Saves the database and files to a file before anything is touched. If the backup fails, nothing is changed.' }))),
                err,
                h('div', { class: 'row' }, h('button', { onclick: go, text: 'Bring it in' }), h('button', { class: 'secondary', onclick: start, text: 'Cancel' }))));
    }

    // ---- uninstall: keep or delete the data, with an optional backup first ----
    function uninstallView(id) {
        setNav('home');
        var a = data.catalog.filter(function (c) { return c.id === id; })[0];
        var keep = true;
        var backupBox = h('input', { type: 'checkbox', id: 'bk' });
        var confirmInput = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', placeholder: a.name });
        var confirmWrap = h('div', { hidden: true }, h('label', { text: 'Type "' + a.name + '" to confirm' }), confirmInput);
        var err = h('p', { class: 'notice bad', hidden: true });
        var btn = h('button', { class: 'danger', onclick: go, text: 'Uninstall ' + a.name });

        function choose() {
            confirmWrap.hidden = keep;
            btn.textContent = keep ? 'Uninstall ' + a.name : 'Delete ' + a.name + ' and all its data';
            if (!keep) backupBox.checked = true;
            Array.prototype.forEach.call(root.querySelectorAll('.choice'), function (c) {
                var r = c.querySelector('input[type=radio]');
                if (r) c.className = 'choice' + (r.checked ? ' sel' : '');
            });
        }
        function radio(value, title, body) {
            var r = h('input', { type: 'radio', name: 'keep', value: value, checked: (value === 'keep') === keep });
            r.addEventListener('change', function () { keep = value === 'keep'; choose(); });
            return h('label', { class: 'choice' + ((value === 'keep') === keep ? ' sel' : '') }, r, h('span', null, h('strong', { text: title }), h('span', { class: 'help', text: body })));
        }

        function go() {
            if (!keep && confirmInput.value.trim().toLowerCase() !== a.name.toLowerCase()) { err.hidden = false; err.textContent = 'Type the app name to confirm.'; return; }
            err.hidden = true;
            var log = h('pre', { class: 'log', 'aria-live': 'off' });
            var status = h('p', { class: 'muted', text: 'Starting...' });
            var actions = h('div', { class: 'row' });
            render(h('h1', { text: 'Uninstalling ' + a.name }), h('div', { class: 'card' }, status, log), actions);
            api('/api/app/' + id + '/uninstall', { body: { keepData: keep, backup: backupBox.checked, confirm: confirmInput.value } }).then(function (r) {
                if (r._status !== 202) { status.textContent = r.error || 'Could not start.'; return add(actions, h('button', { onclick: function () { appView(id); }, text: 'Back' })); }
                (function poll() {
                    api('/api/job/' + r.job).then(function (j) {
                        log.textContent = (j.lines || []).slice(-200).join('\n');
                        log.scrollTop = log.scrollHeight;
                        if (j.status === 'running') { var run = (j.steps || []).filter(function (s) { return s.status === 'running'; })[0]; status.textContent = run ? run.name + '...' : 'Working...'; return setTimeout(poll, 1500); }
                        if (j.status === 'done') {
                            status.textContent = a.name + ' was removed' + (keep ? ' and its data was kept.' : ' and its data was deleted.');
                            if (j.exportFile) add(actions, h('a', { class: 'btn', href: '/api/exports/' + encodeURIComponent(j.exportFile), text: 'Download the backup' }));
                            return add(actions, h('button', { class: 'secondary', onclick: start, text: 'Back to my apps' }));
                        }
                        status.className = 'notice bad'; status.textContent = j.error || 'Something went wrong.';
                        add(actions, h('button', { onclick: function () { start(); }, text: 'Back' }));
                    });
                })();
            });
        }

        render(h('p', null, h('button', { class: 'link', onclick: function () { appView(id); }, text: 'Back' })),
            h('h1', { text: 'Uninstall ' + a.name }),
            h('div', { class: 'card' },
                radio('keep', 'Remove it, keep my data', 'The app stops and disappears from the Gateway. Its data stays on this computer, so installing it again later brings everything back.'),
                radio('wipe', 'Remove it and delete all its data', 'Everything is erased: accounts, entries and uploaded files. This cannot be undone.'),
                h('label', { class: 'choice' }, backupBox, h('span', null, h('strong', { text: 'Download a backup first' }), h('span', { class: 'help', text: 'Saves the database and uploaded files to a file you can download. The Gateway stops if the backup fails, so nothing is removed.' }))),
                confirmWrap, err,
                h('div', { class: 'row' }, btn, h('button', { class: 'secondary', onclick: function () { appView(id); }, text: 'Cancel' }))));
        choose();
    }

    function backupsCard() {
        var box = h('div', null, h('p', { class: 'muted', text: 'Loading...' }));
        function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
        function load() {
            api('/api/exports').then(function (r) {
                box.textContent = '';
                var list = r.exports || [];
                if (!list.length) return add(box, h('p', { class: 'muted', text: 'No backups yet. They appear here when you download a backup while uninstalling an app.' }));
                list.forEach(function (f) {
                    add(box, h('div', { class: 'app' },
                        h('div', null, h('strong', { text: f.name }), h('br'), h('span', { class: 'muted small', text: size(f.size) + ' · ' + new Date(f.created).toLocaleString() })),
                        h('div', { class: 'row' },
                            h('a', { class: 'btn secondary', href: '/api/exports/' + encodeURIComponent(f.name), text: 'Download' }),
                            h('button', { class: 'secondary danger', onclick: function () {
                                if (!confirm('Delete this backup from the Gateway? This cannot be undone.')) return;
                                api('/api/exports/' + encodeURIComponent(f.name) + '/delete', { body: {} }).then(load);
                            }, text: 'Delete' }))));
                });
            });
        }
        load();
        return section('Backups', '',
            h('p', { class: 'muted', text: 'These files hold your data and the apps\' secrets, and take up disk space. Download one to somewhere safe, then delete it here.' }), box);
    }

    // Settings > Appearance: theme, colors for each theme, font, text size, density and motion. Changes show at once;
    // Save keeps them for every device.
    function appearanceCard() {
        var saved = data.state.appearance || { mode: 'system', light: {}, dark: {}, font: 'system', size: 'normal', density: 'comfortable', motion: false };
        var draft = JSON.parse(JSON.stringify(saved));
        draft.light = draft.light || {}; draft.dark = draft.dark || {};
        var defaults = (window.WPTheme && window.WPTheme.defaults) || { light: {}, dark: {} };
        var msg = h('p', { class: 'muted' });
        function preview() { if (window.WPTheme) window.WPTheme.apply(draft); msg.textContent = 'Not saved yet.'; }

        function choiceRadio(name, value, label, current, set) {
            var r = h('input', { type: 'radio', name: name, value: value, checked: current === value });
            r.addEventListener('change', function () { set(value); preview(); });
            return h('label', { class: 'choice' }, r, h('span', null, h('strong', { text: label })));
        }
        function select(label, options, current, set) {
            var s = h('select', { 'aria-label': label });
            options.forEach(function (o) { var opt = h('option', { value: o[0], text: o[1] }); if (o[0] === current) opt.selected = true; s.appendChild(opt); });
            s.addEventListener('change', function () { set(s.value); preview(); });
            return h('div', null, h('label', { text: label }), s);
        }

        var LABELS = [['text', 'Text'], ['textSecondary', 'Secondary text'], ['bg', 'Background'], ['accent', 'Accent'], ['menuText', 'Menu text'], ['menuBg', 'Menu background']];
        function colors(theme, title) {
            var box = h('div', { class: 'swatches' });
            LABELS.forEach(function (l) {
                var key = l[0];
                var input = h('input', { type: 'color', id: 'ap-' + theme + '-' + key, value: draft[theme][key] || defaults[theme][key] || '#000000' });
                input.addEventListener('input', function () { draft[theme][key] = input.value; preview(); });
                add(box, h('div', { class: 'swatch' }, h('label', { for: 'ap-' + theme + '-' + key, text: l[1] }), input,
                    h('button', { class: 'secondary', onclick: function () { delete draft[theme][key]; input.value = defaults[theme][key]; preview(); }, 'aria-label': 'Reset ' + l[1], text: 'Reset' })));
            });
            return h('div', null, h('h3', { text: title }), box);
        }

        return section('Appearance', '',
            h('p', { class: 'muted', text: 'Choose how the Gateway looks. It is the same on every device. Changes show straight away and are kept when you save.' }),
            h('h3', { text: 'Theme' }),
            choiceRadio('ap-mode', 'system', 'Match my device', draft.mode, function (v) { draft.mode = v; }),
            choiceRadio('ap-mode', 'light', 'Light', draft.mode, function (v) { draft.mode = v; }),
            choiceRadio('ap-mode', 'dark', 'Dark', draft.mode, function (v) { draft.mode = v; }),
            colors('light', 'Colors for the light theme'),
            colors('dark', 'Colors for the dark theme'),
            h('h3', { text: 'Text and spacing' }),
            select('Font', [['system', 'Standard'], ['serif', 'Serif'], ['mono', 'Monospace'], ['rounded', 'Rounded']], draft.font, function (v) { draft.font = v; }),
            select('Text size', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']], draft.size, function (v) { draft.size = v; }),
            select('Spacing', [['comfortable', 'Comfortable'], ['compact', 'Compact']], draft.density, function (v) { draft.density = v; }),
            (function () {
                var cb = h('input', { type: 'checkbox', checked: !!draft.motion });
                cb.addEventListener('change', function () { draft.motion = cb.checked; preview(); });
                return h('label', { class: 'choice' }, cb, h('span', null, h('strong', { text: 'Reduce motion' }), h('span', { class: 'help', text: 'Turns off hover movement and fades.' })));
            })(),
            msg,
            h('div', { class: 'row' },
                h('button', { onclick: function () {
                    api('/api/appearance', { body: { appearance: draft } }).then(function (r) {
                        if (r.ok) { data.state.appearance = r.appearance; if (window.WPTheme) window.WPTheme.saved(r.appearance); msg.textContent = 'Saved.'; }
                        else msg.textContent = (r.errors || [r.error || 'Could not save.']).join(' ');
                    });
                }, text: 'Save appearance' }),
                h('button', { class: 'secondary', onclick: function () { if (window.WPTheme) window.WPTheme.apply(saved); settingsView(); }, text: 'Undo changes' })));
    }

    function passwordCard() {
        var cur = h('input', { type: 'password', autocomplete: 'current-password' });
        var nxt = h('input', { type: 'password', autocomplete: 'new-password' });
        var msg = h('p', { class: 'muted' });
        return h('div', null,
            h('label', { text: 'Current password' }), cur,
            h('label', { text: 'New password' }), nxt, msg,
            h('div', { class: 'row' }, h('button', { class: 'secondary', onclick: function () {
                api('/api/password', { body: { current: cur.value, next: nxt.value } }).then(function (r) {
                    msg.textContent = r.ok ? 'Password changed.' : (r.error || 'Could not change it.');
                    if (r.ok) { cur.value = ''; nxt.value = ''; }
                });
            }, text: 'Change password' })));
    }

    // ---- one app's page: status, controls, checks, settings, log, info ----
    function appView(id) {
        setNav('home');
        var st = data.state;
        var a = data.catalog.filter(function (c) { return c.id === id; })[0];
        var statusEl = h('p', { class: 'muted', text: 'Loading...' });
        var controls = h('div', { class: 'row' });
        var checksEl = h('div', { class: 'card' }, h('h2', { text: 'Checks' }), h('p', { class: 'muted', text: 'Running checks...' }));
        var settingsEl = h('div');
        var storageEl = h('div');
        var logPre = h('pre', { class: 'log', text: 'Loading...' });
        var infoEl = h('div', { class: 'card' });
        var proxyEl = st.mode === 'own' ? h('div', { class: 'card' }, h('h2', { text: 'Your reverse proxy' }), snippetBox(id)) : null;
        var note = h('p', { class: 'muted' });
        var updEl = h('div');
        // The icon shown on the home page: the stock one, or a picture you upload.
        var iconEl = (function () {
            var preview = h('img', { class: 'icon-preview', src: '/icons/' + encodeURIComponent(id) + '?v=' + iconV, alt: a.name + ' icon' });
            var msg = h('p', { class: 'muted' });
            var file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', 'aria-label': 'Choose an icon' });
            file.addEventListener('change', function () {
                var f = file.files[0];
                if (!f) return;
                msg.textContent = 'Uploading...';
                fetch('/api/app-icon/' + encodeURIComponent(id), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f })
                    .then(function (r) { return r.json().catch(function () { return {}; }); })
                    .then(function (r) {
                        if (r.ok) { iconV = Date.now(); preview.src = '/icons/' + encodeURIComponent(id) + '?v=' + iconV; msg.textContent = 'Icon changed.'; }
                        else msg.textContent = r.error || 'Could not use that file.';
                        file.value = '';
                    });
            });
            // The card color: saved with the rest of the appearance, so it shows on every device.
            var cardColors = ((data.state.appearance || {}).cards || {});
            var color = h('input', { type: 'color', id: 'card-color', value: cardColors[id] || '#1d5fd1' });
            function saveCardColor(hex) {
                var ap = JSON.parse(JSON.stringify(data.state.appearance || {}));
                ap.cards = ap.cards || {};
                if (hex) ap.cards[id] = hex; else delete ap.cards[id];
                api('/api/appearance', { body: { appearance: ap } }).then(function (r) {
                    if (r.ok) { data.state.appearance = r.appearance; msg.textContent = hex ? 'Card color saved.' : 'Card color removed.'; }
                    else msg.textContent = (r.errors || [r.error || 'Could not save.']).join(' ');
                });
            }
            color.addEventListener('change', function () { saveCardColor(color.value); });
            return h('div', { class: 'card' }, h('h2', { text: 'Icon and color' }),
                h('div', { class: 'row' }, preview, h('div', null,
                    h('p', { class: 'muted', text: 'Shown on the home page. Use a PNG, JPEG, WebP, GIF or SVG up to 512 KB. A square picture works best.' }),
                    file,
                    h('div', { class: 'row' }, h('button', { class: 'secondary', onclick: function () {
                        api('/api/app-icon/' + encodeURIComponent(id) + '/reset', { body: {} }).then(function () { iconV = Date.now(); preview.src = '/icons/' + encodeURIComponent(id) + '?v=' + iconV; msg.textContent = 'Back to the stock icon.'; });
                    }, text: 'Use the stock icon' })),
                    h('label', { for: 'card-color', text: 'Card color' }),
                    h('span', { class: 'help', text: 'Tints this app\'s card on the home page so it stands out.' }),
                    h('div', { class: 'row' }, color, h('button', { class: 'secondary', onclick: function () { saveCardColor(null); }, text: 'Remove the color' })),
                    msg)));
        })();
        // The same switch as on the Updates page, for this app only.
        var autoBox = h('input', { type: 'checkbox', checked: !!((st.updates || {}).apps || {})[id] });
        autoBox.addEventListener('change', function () {
            var u = st.updates || { apps: {}, hour: 3, day: 'daily', backup: false };
            var apps = {};
            Object.keys(u.apps || {}).forEach(function (k) { if (u.apps[k]) apps[k] = true; });
            if (autoBox.checked) apps[id] = true; else delete apps[id];
            api('/api/auto-update', { body: { apps: apps, hour: u.hour, day: u.day, backup: !!u.backup } }).then(function (r) { if (r.ok) data.state.updates = r.updates; });
        });
        var autoEl = h('label', { class: 'choice' }, autoBox, h('span', null, h('strong', { text: 'Update this app automatically' }), h('span', { class: 'help', text: 'The day and time are on the Updates page.' })));

        // Same check as the home page: is a newer version available for this app?
        function loadUpdate() {
            api('/api/updates').then(function (r) {
                var s = (r.apps || {})[id];
                updEl.textContent = '';
                if (s === 'yes') add(updEl, h('div', { class: 'notice warn' }, h('span', { class: 'badge warn', text: 'Update available' }), ' ', h('button', { onclick: function () { runUpdate([id]); }, text: 'Update now' })));
                else if (s === 'no') add(updEl, h('p', null, h('span', { class: 'badge ok', text: 'Up to date' })));
                else if (s === 'pinned') add(updEl, h('p', null, h('span', { class: 'badge', text: 'Version pinned' }), ' Clear the version in Advanced to update again.'));
            });
        }

        function act(name) {
            note.textContent = name === 'stop' ? 'Stopping...' : (name === 'start' ? 'Starting...' : 'Restarting...');
            api('/api/app/' + id + '/action', { body: { action: name } }).then(function (r) {
                note.textContent = r.ok ? 'Done.' : (r.error || 'That did not work.');
                load();
            });
        }

        function loadChecks() {
            checksEl.textContent = '';
            add(checksEl, [h('h2', { text: 'Checks' }), h('p', { class: 'muted', text: 'Running checks...' })]);
            api('/api/app/' + id + '/checks').then(function (r) {
                checksEl.textContent = '';
                add(checksEl, h('h2', { text: 'Checks' }));
                (r.checks || []).forEach(function (c) {
                    add(checksEl, h('p', null, h('span', { class: 'dot ' + (c.ok ? 'ok' : 'bad') }), c.label, c.fix ? h('span', { class: 'help', text: c.fix }) : null));
                });
                add(checksEl, h('button', { class: 'secondary', onclick: loadChecks, text: 'Run again' }));
            });
        }

        function loadLogs() {
            logPre.textContent = 'Loading...';
            api('/api/app/' + id + '/logs?lines=200').then(function (r) { logPre.textContent = r.text || '(nothing logged yet)'; logPre.scrollTop = logPre.scrollHeight; });
        }

        // The Settings card: everyday settings first, then an Advanced section with a warning. One Save button.
        // It also says which settings Shared settings manages, and what can only be set inside the app.
        function buildSettings(i) {
            settingsEl.textContent = '';
            var msg = h('p', { class: 'muted' });
            var card = h('div', { class: 'card' }, h('h2', { text: 'Settings' }));
            var ed = settingsEditor(a, i, { sharedEnv: (data.sharedEnv || {})[id] });
            ed.setShared(sharedUsedBy(id), false);
            add(card, ed.el, insideAppNote(a), msg,
                h('p', { class: 'help', text: 'Saving restarts ' + a.name + ' with the new settings. It is unavailable for a few seconds.' }),
                h('div', { class: 'row' }, h('button', { onclick: function () {
                    var values = ed.values();
                    msg.textContent = 'Saving and restarting ' + a.name + '...';
                    api('/api/app/' + id + '/settings', { body: { values: values, extra: ed.extra() } }).then(function (r) {
                        if (r._status !== 202) { msg.textContent = (r.errors || [r.error || 'Could not save.']).join(' '); return; }
                        (function poll() {
                            api('/api/job/' + r.job).then(function (j) {
                                if (j.status === 'running') return setTimeout(poll, 1500);
                                msg.textContent = j.status === 'done' ? 'Saved. ' + a.name + ' restarted with the new settings.' : (j.error || 'Something went wrong.');
                                load();
                            });
                        })();
                    });
                }, text: 'Save and restart' })));
            add(settingsEl, card);
        }

        // Where the data lives: a Docker-managed volume, or a folder on this computer.
        function buildStorage(i) {
            storageEl.textContent = '';
            var card = h('div', { class: 'card' },
                h('h2', { text: 'Where your data lives' }),
                h('p', { text: 'Docker keeps your data safe through updates and restarts, but you cannot easily see or back it up. A folder you choose is easy to find, back up and move to another disk.' }),
                h('p', { class: 'help', text: 'Tip: keep the Database and Backups on different disks, and back up the folders you choose yourself.' }));
            // One row per part of the app's data. Open a row to choose where it lives: the choices are always shown there,
            // and nothing moves until the checks pass.
            i.storage.slice().sort(byLabel).forEach(function (s) {
                var where = h('span', { class: 'badge' + (s.folder ? ' ok' : ''), text: s.folder ? 'Folder: ' + s.folder : 'Docker-managed' });
                var kind = s.folder ? 'folder' : 'volume';
                var folder = h('input', { type: 'text', value: s.folder, placeholder: '/srv/waypoints/' + id + '/' + s.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), autocapitalize: 'off', autocomplete: 'off', 'aria-label': s.label + ' folder' });
                var existing = h('input', { type: 'checkbox' });
                var results = h('div');
                var note = h('p', { class: 'muted' });
                var checkBtn = h('button', { class: 'secondary', text: 'Check this location' });
                var go = h('button', { text: 'Move my data', disabled: true });

                var folderWrap = h('div', { hidden: kind !== 'folder' },
                    h('label', { text: 'Folder on this computer' }),
                    h('span', { class: 'help', text: 'A full path, for example /mnt/disk2/' + id + '. It should be an empty folder on a disk inside this computer.' }),
                    folder,
                    h('label', { class: 'choice' }, existing, h('span', null, h('strong', { text: 'This folder already holds my data' }), h('span', { class: 'help', text: 'Use it as it is, without copying. For a folder you kept after uninstalling.' }))));

                function target() { return kind === 'folder' ? folder.value.trim() : ''; }
                function same() { return target() === (s.folder || ''); }
                // Any change to the choice means the last check no longer applies.
                function changed() {
                    go.disabled = true; results.textContent = '';
                    checkBtn.disabled = same();
                    note.textContent = same() ? 'The data is already there. Choose a different place to move it.' : 'Check the location first. Nothing is moved until the checks pass.';
                }
                function radio(value, title, body) {
                    var r = h('input', { type: 'radio', name: 'k-' + s.env, checked: kind === value });
                    r.addEventListener('change', function () { kind = value; folderWrap.hidden = kind !== 'folder'; changed(); });
                    return h('label', { class: 'choice' }, r, h('span', null, h('strong', { text: title }), h('span', { class: 'help', text: body })));
                }
                folder.addEventListener('input', changed);
                existing.addEventListener('change', changed);

                checkBtn.addEventListener('click', function () {
                    if (kind === 'folder' && !target()) { note.textContent = 'Enter a folder first.'; return; }
                    results.textContent = ''; note.textContent = 'Checking...'; go.disabled = true;
                    api('/api/app/' + id + '/storage-check', { body: { env: s.env, folder: target(), existing: existing.checked } }).then(function (r) {
                        results.textContent = '';
                        (r.checks || []).forEach(function (c) {
                            add(results, h('p', null, h('span', { class: 'dot ' + (c.level === 'error' ? 'bad' : (c.level === 'warn' ? 'warn' : 'ok')) }), c.label, c.fix ? h('span', { class: 'help', text: c.fix }) : null));
                        });
                        if (r.ok) { note.textContent = 'The checks passed.'; go.disabled = false; }
                        else note.textContent = (r.checks && r.checks.length ? 'Fix what is marked red, then check again.' : (r.error || 'Could not check that location.'));
                    });
                });

                go.addEventListener('click', function () {
                    var where2 = kind === 'folder' ? target() : 'Docker-managed storage';
                    if (!confirm('Move the ' + s.label.toLowerCase() + ' of ' + a.name + ' to ' + where2 + '?\n\n' + a.name + ' stops while your data is copied, then starts again. Your old copy is kept.')) return;
                    checkBtn.disabled = true; go.disabled = true;
                    note.textContent = 'Stopping ' + a.name + ' and copying your data. This can take a while for a large database. Keep this page open...';
                    api('/api/app/' + id + '/storage', { body: { env: s.env, folder: target(), existing: existing.checked } }).then(function (r) {
                        if (r._status !== 202) { note.textContent = (r.errors || [r.error || 'Could not start.']).join(' '); checkBtn.disabled = false; return; }
                        (function poll() {
                            api('/api/job/' + r.job).then(function (j) {
                                if (j.status === 'running') {
                                    var running = (j.steps || []).filter(function (x) { return x.status === 'running'; })[0];
                                    note.textContent = (running ? running.name + '... ' : '') + 'Keep this page open.';
                                    return setTimeout(poll, 2000);
                                }
                                results.textContent = '';
                                add(results, h('pre', { class: 'log', text: (j.lines || []).slice(-30).join('\n') }));
                                note.textContent = j.status === 'done' ? 'Moved. ' + a.name + ' is running again. Your old copy was kept at ' + (j.oldCopy || 'its old place') + ': delete it once you have checked everything works.' : (j.error || 'Something went wrong.');
                                if (j.status === 'done') load();
                                else checkBtn.disabled = false;
                            });
                        })();
                    });
                });

                add(card, h('details', { class: 'subgroup' },
                    h('summary', null, h('strong', { text: s.label }), ' ', where, h('span', { class: 'summary-note muted small', text: 'Change location' })),
                    h('p', { class: 'help', text: s.help }),
                    radio('volume', 'Docker-managed', 'Simplest. Docker chooses where. Safe through updates and restarts.'),
                    radio('folder', 'A folder on this computer', 'Easy to find, back up and put on another disk.'),
                    folderWrap,
                    h('div', { class: 'row' }, checkBtn, go),
                    results, note));
                changed();
            });
            add(storageEl, card);
        }

        function load() {
            api('/api/app/' + id + '/info').then(function (i) {
                if (i.error) { statusEl.textContent = i.error; return; }
                var c = i.container || {};
                var running = c.exists && c.status === 'running';
                statusEl.textContent = '';
                add(statusEl, [h('span', { class: 'dot ' + (running ? (c.health === 'unhealthy' ? 'bad' : (c.health === 'starting' ? 'warn' : 'ok')) : 'bad') }), c.exists ? (running ? (c.health && c.health !== 'healthy' ? c.health : 'running') : c.status) : 'not installed']);
                controls.textContent = '';
                add(controls, [
                    h('a', { class: 'btn', href: 'https://' + i.host, target: '_blank', rel: 'noopener', text: 'Open' }),
                    running ? h('button', { class: 'secondary', onclick: function () { act('restart'); }, text: 'Restart' }) : h('button', { onclick: function () { act('start'); }, text: 'Start' }),
                    running ? h('button', { class: 'secondary', onclick: function () { act('stop'); }, text: 'Stop' }) : null
                ]);
                infoEl.textContent = '';
                add(infoEl, [h('h2', { text: 'Info' }),
                    h('p', null, 'Address: ', h('a', { href: 'https://' + i.host, target: '_blank', rel: 'noopener', text: 'https://' + i.host })),
                    c.created ? h('p', { class: 'muted', text: 'Image built ' + new Date(c.created).toLocaleString() + ' (' + c.image + ')' }) : null,
                    c.started ? h('p', { class: 'muted', text: 'Running since ' + new Date(c.started).toLocaleString() }) : null]);
                buildSettings(i);
                buildStorage(i);
            });
        }

        render(
            h('p', null, h('button', { class: 'link', onclick: start, text: 'All apps' })),
            h('h1', { text: a.name }),
            statusEl, controls, note, updEl, autoEl,
            // The sections below are listed A to Z, except Uninstall, which is always last.
            checksEl,
            iconEl,
            infoEl,
            h('div', { class: 'card' }, h('h2', { text: 'Log' }), logPre, h('div', { class: 'row' }, h('button', { class: 'secondary', onclick: loadLogs, text: 'Refresh' }))),
            settingsEl,
            storageEl,
            proxyEl,
            h('div', { class: 'card' }, h('h2', { text: 'Uninstall' }),
                h('p', { class: 'muted', text: 'Remove ' + a.name + ' from this computer. You choose whether to keep or delete its data.' }),
                h('button', { class: 'secondary danger', onclick: function () { uninstallView(id); }, text: 'Uninstall ' + a.name }))
        );
        load(); loadChecks(); loadLogs(); loadUpdate();
    }

    function snippetBox(id) {
        var box = h('details', null, h('summary', { text: 'Settings for your reverse proxy' }));
        var loaded = false;
        box.addEventListener('toggle', function () {
            if (!box.open || loaded) return;
            loaded = true;
            api('/api/snippets?app=' + encodeURIComponent(id)).then(function (s) {
                var names = { nginx: 'nginx', caddy: 'Caddy', apache: 'Apache', traefik: 'Traefik', npm: 'Nginx Proxy Manager' };
                var pre = h('pre');
                var tabs = h('div', { class: 'tabs' });
                function show(k) { pre.textContent = s[k]; Array.prototype.forEach.call(tabs.children, function (b) { b.className = b.getAttribute('data-k') === k ? 'on' : ''; }); }
                Object.keys(names).forEach(function (k) { tabs.appendChild(h('button', { 'data-k': k, onclick: function () { show(k); }, text: names[k] })); });
                add(box, [h('p', { class: 'muted', text: 'Pick your proxy, copy the settings, and fill in your certificate paths if it asks.' }), tabs, pre]);
                show('nginx');
            });
        });
        return box;
    }

    function trustCard() {
        var ready = data.caCertReady;
        return h('div', { class: 'card' },
            h('h2', { text: 'One step per device: trust this network' }),
            h('p', { text: 'Your apps use a certificate made by this computer, so each phone or computer must trust it once. Until then the browser shows a warning. Download the certificate, then follow the steps for your device.' }),
            ready ? h('a', { class: 'btn', href: '/api/ca', text: 'Download the certificate' }) : h('p', { class: 'notice warn', text: 'The certificate is not ready yet. Open one of your apps once, wait a few seconds, then reload this page.' }),
            // The device steps are listed A to Z.
            h('details', null, h('summary', { text: 'Android' }), h('ol', null,
                h('li', { text: 'Settings > Security > Encryption & credentials > Install a certificate > CA certificate.' }),
                h('li', { text: 'Choose the downloaded file. (Exact menu names vary by phone.)' }))),
            h('details', null, h('summary', { text: 'iPhone or iPad' }), h('ol', null,
                h('li', { text: 'Open the downloaded file in Safari and allow the profile to download.' }),
                h('li', { text: 'Settings > Profile Downloaded > Install.' }),
                h('li', { text: 'Settings > General > About > Certificate Trust Settings, and turn the certificate on.' }))),
            h('details', null, h('summary', { text: 'Linux' }), h('p', { text: 'Copy the file to /usr/local/share/ca-certificates/ and run update-ca-certificates. Firefox keeps its own list: Settings > Privacy & Security > Certificates > View Certificates > Authorities > Import.' })),
            h('details', null, h('summary', { text: 'Mac' }), h('ol', null,
                h('li', { text: 'Double-click the file to open Keychain Access and add it to the System keychain.' }),
                h('li', { text: 'Double-click the new Waypoints entry, open Trust, and set "When using this certificate" to Always Trust.' }))),
            h('details', null, h('summary', { text: 'Windows' }), h('ol', null,
                h('li', { text: 'Double-click the downloaded file, then choose Install Certificate.' }),
                h('li', { text: 'Choose Local Machine (or Current User), then Place all certificates in the following store.' }),
                h('li', { text: 'Browse, pick Trusted Root Certification Authorities, finish, and restart your browser.' })))
        );
    }

    document.getElementById('logout').addEventListener('click', function () {
        api('/api/logout', { body: {} }).then(function () { loginView(); document.getElementById('logout').hidden = true; });
    });

    start();
})();
