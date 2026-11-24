(function () {
    'use strict';
    function h(tag, attrs) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { if (k === 'class') el.className = attrs[k]; else if (k === 'text') el.textContent = attrs[k]; else el.setAttribute(k, attrs[k]); });
        for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
        return el;
    }
    fetch('/api/whats-new').then(function (r) { return r.json(); }).then(function (d) {
        document.getElementById('running').textContent = 'Recent changes to the Waypoints Gateway. This Gateway is running v' + d.version + '.';
        var root = document.getElementById('notes');
        root.appendChild(h('h2', { text: 'Highlights' }));
        d.releases.slice(0, 3).forEach(function (r) {
            var ul = h('ul');
            r.highlights.forEach(function (x) { ul.appendChild(h('li', { text: x })); });
            root.appendChild(h('div', { class: 'card' }, h('h3', { text: r.version }), ul));
        });
        root.appendChild(h('h2', { text: 'Release notes' }));
        d.releases.forEach(function (r) {
            var card = h('div', { class: 'card', id: r.version }, h('h3', null, h('a', { href: '#' + r.version, text: r.version })));
            (r.notes || []).forEach(function (n) { card.appendChild(h('p', null, h('strong', { text: n.title + '. ' }), n.text)); });
            if (!(r.notes || []).length) { var ul = h('ul'); r.highlights.forEach(function (x) { ul.appendChild(h('li', { text: x })); }); card.appendChild(ul); }
            root.appendChild(card);
        });
    }).catch(function () { document.getElementById('running').textContent = 'Could not load the release notes.'; });
})();
