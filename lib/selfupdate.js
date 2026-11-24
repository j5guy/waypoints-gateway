const { run } = require('./run');

// A container cannot replace itself, so the gateway starts a short-lived helper container that pulls the newest
// gateway image and recreates the gateway with the same Compose file it was started from. The helper finds that file
// from the labels Docker Compose puts on the gateway's container. It needs a Linux host path; where that is not
// available (Docker Desktop on Windows or macOS, or a container not started by Compose) the page shows the manual
// command instead.
const SELF = 'waypoints-gateway';
const HELPER = 'waypoints-gateway-updater';
const HELPER_IMAGE = 'docker:27-cli';

const SCRIPT = [
    'sleep 4',
    'set --',
    'IFS=,',
    'for f in $WP_FILES; do set -- "$@" -f "$f"; done',
    'unset IFS',
    'docker compose -p "$WP_PROJECT" "$@" pull gateway && docker compose -p "$WP_PROJECT" "$@" up -d gateway'
].join('\n');

async function start() {
    const manual = (error) => ({ ok: false, manual: true, error });

    const r = await run('docker', ['inspect', '-f', '{{json .Config.Labels}}', SELF], { timeout: 15000 });
    if (!r.ok) return manual('Could not read the Gateway\'s own container.');
    let labels = {};
    try { labels = JSON.parse(r.stdout.trim()) || {}; } catch (_) { /* none */ }

    const project = labels['com.docker.compose.project'] || '';
    const dir = labels['com.docker.compose.project.working_dir'] || '';
    const files = labels['com.docker.compose.project.config_files'] || '';
    if (!project || !dir || !files) return manual('The Gateway was not started with Docker Compose.');
    if (!dir.startsWith('/')) return manual('This computer\'s Docker cannot update the Gateway from here.');

    await run('docker', ['rm', '-f', HELPER], { timeout: 20000 });
    const h = await run('docker', [
        'run', '-d', '--rm', '--name', HELPER,
        '-v', '/var/run/docker.sock:/var/run/docker.sock',
        '-v', `${dir}:${dir}`, '-w', dir,
        '-e', `WP_PROJECT=${project}`, '-e', `WP_FILES=${files}`,
        '--entrypoint', 'sh',
        HELPER_IMAGE, '-c', SCRIPT
    ], { timeout: 180000 });
    if (!h.ok) return manual(h.stderr.trim().split('\n').pop() || 'The updater could not start.');
    return { ok: true };
}

module.exports = { start };
