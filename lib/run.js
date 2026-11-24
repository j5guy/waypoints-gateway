const { execFile, spawn } = require('child_process');

// Run a command without a shell (arguments are never parsed), collect its output.
function run(cmd, args, { timeout = 120000, env = {}, cwd } = {}) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout, env: { ...process.env, ...env }, cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

// Run a long command, reporting each line of output as it arrives.
function runStreaming(cmd, args, { env = {}, cwd, onLine = () => {} } = {}) {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { env: { ...process.env, ...env }, cwd });
        const feed = (chunk) => String(chunk).split(/\r?\n|\r/).map(s => s.trim()).filter(Boolean).forEach(onLine);
        child.stdout.on('data', feed);
        child.stderr.on('data', feed);
        child.on('error', (e) => { onLine(`Could not run ${cmd}: ${e.message}`); resolve({ ok: false, code: 1 }); });
        child.on('close', (code) => resolve({ ok: code === 0, code }));
    });
}

// Run a command and write everything it prints to a file (for example a database dump), keeping its errors.
function runToFile(cmd, args, file, { timeout = 600000 } = {}) {
    const fs = require('fs');
    return new Promise((resolve) => {
        const out = fs.createWriteStream(file, { mode: 0o600 });
        const child = spawn(cmd, args, { env: process.env });
        let err = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
        child.stdout.pipe(out);
        child.stderr.on('data', (c) => { err += String(c); });
        child.on('error', (e) => { clearTimeout(timer); out.end(); resolve({ ok: false, stderr: e.message }); });
        child.on('close', (code) => { clearTimeout(timer); out.end(() => resolve({ ok: code === 0, stderr: err })); });
    });
}

module.exports = { run, runStreaming, runToFile };
