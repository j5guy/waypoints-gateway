const fs = require('fs');

// MongoDB 5 and newer (and 4.4.19 and newer) need CPU features that older hardware does not have, and crash with
// "Illegal instruction" without them: ARMv8.2-A on ARM (a Raspberry Pi 4 or older does not have it; a Pi 5 does) and
// AVX on Intel and AMD. MongoDB 4.4.18 runs on both. The Gateway looks at the CPU when it installs an app and picks
// the older version by itself where it is needed.
//
// The Gateway runs in a container, but /proc/cpuinfo shows the real computer's processor (the kernel is shared).
const MONGO_OLD = 'mongo:4.4.18';

function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } }

// `sample` is for testing: { arch, cpuinfo, model }.
function detect(sample) {
    const arch = (sample && sample.arch) || process.arch;
    const cpuinfo = sample ? (sample.cpuinfo || '') : read('/proc/cpuinfo');
    const model = (sample ? (sample.model || '') : read('/proc/device-tree/model')).replace(/\0/g, '').trim();
    const out = { arch, model, needsOldMongo: false, unsupported: false, reason: '' };
    const line = (name) => ((cpuinfo.match(new RegExp(`^${name}\\s*:\\s*(.*)$`, 'mi')) || [])[1] || '').toLowerCase();

    if (arch === 'arm64') {
        const features = line('Features');
        // fphp / asimdhp / asimddp are the markers of ARMv8.2-A.
        const hasV82 = /\b(fphp|asimdhp|asimddp)\b/.test(features);
        const knownOld = /raspberry pi (zero|[1-4]\b|compute module [1-4])/i.test(model);
        if ((features && !hasV82) || (!features && knownOld)) {
            out.needsOldMongo = true;
            out.reason = `${model || 'This ARM computer'} does not have the processor features MongoDB 5 and newer need (ARMv8.2-A), so apps will use MongoDB 4.4.18.`;
        }
    } else if (arch === 'x64') {
        const flags = line('flags');
        if (flags && !/\bavx\b/.test(flags)) {
            out.needsOldMongo = true;
            out.reason = 'This processor does not have AVX, which MongoDB 5 and newer need, so apps will use MongoDB 4.4.18.';
        }
    } else if (arch === 'arm') {
        out.unsupported = true;
        out.reason = 'This is a 32-bit ARM system. The apps and MongoDB need a 64-bit operating system: install the 64-bit version of the operating system and try again.';
    }
    return out;
}

module.exports = { detect, MONGO_OLD };
