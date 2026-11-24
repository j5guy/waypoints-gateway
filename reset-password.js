// Forgot the Gateway password? Run this on the computer that runs it, then restart the Gateway and open it to set
// a new one:
//
//   docker exec waypoints-gateway node reset-password.js && docker restart waypoints-gateway
//
// Your apps and settings are not touched.
const fs = require('fs');
const path = require('path');
const file = path.join(process.env.DATA_DIR || '/data', 'auth.json');
try { fs.unlinkSync(file); console.log('Password cleared. Open the Gateway within 15 minutes of restarting it to set a new one.'); }
catch (_) { console.log('No password was set.'); }
