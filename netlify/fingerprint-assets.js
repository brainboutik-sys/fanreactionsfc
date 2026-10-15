#!/usr/bin/env node
// Content-address the JS and CSS the SPA loads, without a bundler.
//
// Copies each file to /assets/<same path with a 12-char sha256 in the
// filename> and rewrites index.html to those URLs. app.js's dynamic
// admin.js load is rewritten in the copy only, then that copy is hashed,
// so the URL always names the bytes it serves.
//
// Original /js and /css files stay in place and keep max-age=0 (see
// netlify.toml). Anything this script misses still revalidates, so it
// cannot be pinned to stale bytes. HTML documents use
// Cache-Control: max-age=0, must-revalidate, so a browser cannot keep a
// page that points at a hash from a previous deploy. Fingerprinted files
// are immutable: a given URL never changes bytes. A stale cache therefore
// cannot pair one deploy's HTML with another deploy's script.
//
// Netlify's build runs this. Local `netlify dev` (CONTEXT=dev) skips it
// so the working tree is not rewritten. Set FINGERPRINT_ASSETS=1 to run
// against the repo by hand.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ADMIN_LOADER = "script.src = '/js/admin.js';";

function sha12(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

function fingerUrl(urlPath, hash) {
  const ext = path.posix.extname(urlPath);
  const base = urlPath.slice(0, -ext.length);
  return `/assets${base}.${hash}${ext}`;
}

function collectRefs(indexHtml) {
  const refs = new Set();
  const re = /(?:src|href)="(\/(?:js|css)\/[^"]+)"/g;
  let m;
  while ((m = re.exec(indexHtml)) !== null) refs.add(m[1]);
  return refs;
}

function fingerprintRoot(root) {
  const indexPath = path.join(root, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const refs = collectRefs(indexHtml);
  if (!refs.size) {
    if (indexHtml.includes('/assets/js/app.')) return { skipped: true, urls: {} };
    throw new Error('index.html has no /js or /css references to fingerprint');
  }

  refs.add('/js/admin.js');
  const originals = {};
  for (const urlPath of refs) {
    const disk = path.join(root, urlPath.slice(1));
    if (!fs.existsSync(disk)) throw new Error('missing asset ' + urlPath);
    originals[urlPath] = fs.readFileSync(disk);
  }

  const urls = {};
  const bodies = {};
  for (const urlPath of refs) {
    if (urlPath === '/js/app.js') continue;
    const hash = sha12(originals[urlPath]);
    urls[urlPath] = fingerUrl(urlPath, hash);
    bodies[urlPath] = originals[urlPath];
  }

  if (!originals['/js/app.js']) throw new Error('index.html does not reference /js/app.js');
  const appText = originals['/js/app.js'].toString('utf8');
  if (!appText.includes(ADMIN_LOADER)) {
    throw new Error('app.js admin loader string not found; refusing to fingerprint');
  }
  if (!urls['/js/admin.js']) throw new Error('admin.js was not hashed');
  const rewrittenApp = Buffer.from(appText.replaceAll(ADMIN_LOADER, `script.src = '${urls['/js/admin.js']}';`));
  const appHash = sha12(rewrittenApp);
  urls['/js/app.js'] = fingerUrl('/js/app.js', appHash);
  bodies['/js/app.js'] = rewrittenApp;

  for (const urlPath of Object.keys(bodies)) {
    const dest = path.join(root, urls[urlPath].slice(1));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bodies[urlPath]);
  }

  let next = indexHtml;
  const ordered = Object.keys(urls).sort((a, b) => b.length - a.length);
  for (const urlPath of ordered) {
    if (urlPath === '/js/admin.js') continue;
    next = next.split(urlPath).join(urls[urlPath]);
  }
  if (collectRefs(next).size) {
    throw new Error('index.html still references unfingerprinted /js or /css files');
  }
  fs.writeFileSync(indexPath, next);
  return { skipped: false, urls };
}

function shouldRunFromCli() {
  if (process.env.FINGERPRINT_ASSETS === '1') return true;
  const ctx = process.env.CONTEXT || '';
  return process.env.NETLIFY === 'true' && ctx && ctx !== 'dev';
}

if (require.main === module) {
  if (!shouldRunFromCli()) {
    console.log('fingerprint-assets: skipped (not a Netlify publish build). Set FINGERPRINT_ASSETS=1 to run locally.');
    process.exit(0);
  }
  const result = fingerprintRoot(path.join(__dirname, '..'));
  if (result.skipped) console.log('fingerprint-assets: already fingerprinted');
  else console.log('fingerprint-assets: wrote ' + Object.keys(result.urls).length + ' files');
}

module.exports = { fingerprintRoot, fingerUrl, sha12, collectRefs };
