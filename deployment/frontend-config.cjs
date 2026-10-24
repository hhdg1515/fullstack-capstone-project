const fs = require('node:fs');
function frontendConfig(backendOrigin, frontendOrigin) {
  let url;
  try { url = new URL(backendOrigin); } catch { throw new Error('Use the approved exact HTTPS API origin'); }
  if (url.protocol !== 'https:' || url.origin !== backendOrigin || url.username || url.password || (/(?:^|\.)localhost$/.test(url.hostname) || ['127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use the approved exact HTTPS API origin');
  let frontend;
  try { frontend = new URL(frontendOrigin); } catch { throw new Error('Use the exact approved staging frontend origin'); }
  if (frontend.protocol !== 'https:' || frontend.origin !== frontendOrigin || frontend.username || frontend.password || frontend.port || frontend.origin === url.origin) throw new Error('Use distinct approved frontend/API HTTPS origins');
  return { $schema: 'https://openapi.vercel.sh/vercel.json', routes: [
    { src: '^/api(?:/(.*))?$', dest: backendOrigin + '/api/$1', has: [{ type: 'host', value: frontend.hostname }], headers: { 'Cache-Control': 'private, no-store' } },
    { src: '^/api(?:/.*)?$', dest: '/service-unavailable.json', status: 503, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' } },
    { handle: 'filesystem' },
    { src: '/.*', dest: '/index.html' }
  ] };
}
if (require.main === module) {
  try {
    const origin = process.argv[2]; const frontend = process.argv[3]; const destination = process.argv[4];
    const text = JSON.stringify(frontendConfig(origin, frontend), null, 2) + '\n';
    if (destination) fs.writeFileSync(destination, text, { flag: 'wx' }); else process.stdout.write(text);
  } catch { console.error('Configuration not written. Supply approved API/frontend HTTPS origins and a new output file.'); process.exitCode = 1; }
}
module.exports = { frontendConfig };
