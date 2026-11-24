// The footer shared by every page: version, What's new, Docs, Follow us on X.
(function () {
    'use strict';
    var el = document.getElementById('footer');
    if (!el) return;
    fetch('/api/site').then(function (r) { return r.json(); }).then(function (s) {
        function pill(href, text, external) {
            var a = document.createElement('a');
            a.className = 'footer-pill';
            a.href = href;
            a.textContent = text;
            if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
            return a;
        }
        var p = document.createElement('p');
        p.appendChild(document.createTextNode('Waypoints Gateway '));
        var v = document.createElement('span');
        v.className = 'muted';
        v.textContent = 'v' + s.version + ' ';
        p.appendChild(v);
        p.appendChild(pill('/whats-new', 'What\'s new', false));
        p.appendChild(document.createTextNode(' '));
        p.appendChild(pill(s.docsUrl, 'Docs', true));
        el.textContent = '';
        el.appendChild(p);
        // Follow us on X is on its own line, like the other Waypoints apps.
        if (s.xUrl) {
            var community = document.createElement('p');
            community.className = 'footer-community';
            community.appendChild(pill(s.xUrl, 'Follow us on X', true));
            el.appendChild(community);
        }
    }).catch(function () { /* no footer if the server cannot be reached */ });
})();
