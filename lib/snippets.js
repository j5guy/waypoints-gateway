// Ready-to-paste reverse proxy configuration for people who run their own proxy. `host` is the public name,
// `target` the address the proxy reaches the app at (e.g. 127.0.0.1:5560).

function nginx({ host, target }) {
    return `server {
    listen 443 ssl;
    http2 on;
    server_name ${host};

    # Your certificate and key (Let's Encrypt, your own CA, ...)
    ssl_certificate     /etc/ssl/certs/${host}.pem;
    ssl_certificate_key /etc/ssl/private/${host}.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 150M;

    location / {
        proxy_pass http://${target};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
    }
}

server {
    listen 80;
    server_name ${host};
    return 301 https://$host$request_uri;
}
`;
}

function caddy({ host, target }) {
    return `${host} {
\tencode zstd gzip
\treverse_proxy ${target}
}
`;
}

function apache({ host, target }) {
    return `# Needs: a2enmod ssl proxy proxy_http proxy_wstunnel headers rewrite
<VirtualHost *:443>
    ServerName ${host}
    SSLEngine on
    SSLCertificateFile    /etc/ssl/certs/${host}.pem
    SSLCertificateKeyFile /etc/ssl/private/${host}.key

    LimitRequestBody 157286400
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule /(.*) ws://${target}/$1 [P,L]

    ProxyPass        / http://${target}/
    ProxyPassReverse / http://${target}/
</VirtualHost>
`;
}

function traefik({ host, target, id }) {
    const [h, p] = target.split(':');
    return `# Labels for the app's container (it must share a Docker network with Traefik).
# If Traefik runs on the host instead, use a file-provider router pointing at http://${target}.
labels:
  - traefik.enable=true
  - traefik.http.routers.${id}.rule=Host(\`${host}\`)
  - traefik.http.routers.${id}.entrypoints=websecure
  - traefik.http.routers.${id}.tls=true
  - traefik.http.routers.${id}.tls.certresolver=letsencrypt   # your resolver's name
  - traefik.http.services.${id}.loadbalancer.server.port=${p}
# Container address if on the same network: ${h}
`;
}

function npm({ host, target }) {
    const [h, p] = target.split(':');
    return `Nginx Proxy Manager > Hosts > Proxy Hosts > Add Proxy Host

  Domain Names:          ${host}
  Scheme:                http
  Forward Hostname / IP: ${h}
  Forward Port:          ${p}
  Websockets Support:    on
  Block Common Exploits: on

SSL tab: pick or request a certificate, turn on Force SSL.
Advanced tab, custom config:  client_max_body_size 150M;
`;
}

function all(opts) {
    return { nginx: nginx(opts), caddy: caddy(opts), apache: apache(opts), traefik: traefik(opts), npm: npm(opts) };
}

module.exports = { all };
