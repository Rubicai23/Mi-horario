import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.env.APP_ROOT;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const IMPORTS = { '@capacitor/core': '/__stubs/capacitor-core.js' };
const FAKE = `
const noop = () => {};
export function createCloudService() {
  const h = { state: noop, days: noop, profile: noop, error: noop };
  const log = window.__cloud = { pushed: [], profiles: [], tracked: [], deleted: 0 };
  return {
    init() { h.state({ status: 'loading', email: '', uid: '' });
      return Promise.resolve().then(() => {
        h.state({ status: 'signedIn', email: 'a@b.c', uid: 'u1' });
        h.days({ fromCache: false, remoteKeys: [], changes: [] });
        h.profile({ fromCache: false, exists: false, data: null });
      }); },
    onState(f) { h.state = f; }, onDays(f) { h.days = f; }, onProfile(f) { h.profile = f; }, onError(f) { h.error = f; },
    signIn: async () => {}, signUp: async () => {}, signOut: async () => {}, resetPassword: async () => {},
    deleteAccount: async () => { log.deleted++; }, setAnalytics: noop,
    track: (n, p) => log.tracked.push(n),
    pushDay: async (k, b) => { log.pushed.push(k); }, removeDay: async () => {}, pushProfile: async p => { log.profiles.push(p); }
  };
}`;
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  const send = (body, type) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  if (p === '/__stubs/capacitor-core.js') return send('export const Capacitor = { isNativePlatform: () => false };', TYPES['.js']);
  if (p === '/src/firebase-service.js') return send(FAKE, TYPES['.js']);
  if (p === '/' || p === '/index.html') {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    html = html.replace('<link rel="stylesheet"', `<script type="importmap">${JSON.stringify({ imports: IMPORTS })}</script>\n<link rel="stylesheet"`);
    return send(html, TYPES['.html']);
  }
  for (const base of [ROOT, path.join(ROOT, 'public')]) {
    const f = path.join(base, p);
    if (f.startsWith(base) && fs.existsSync(f) && fs.statSync(f).isFile()) return send(fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
  }
  res.writeHead(404); res.end('nf');
}).listen(5199, () => console.log('up'));
