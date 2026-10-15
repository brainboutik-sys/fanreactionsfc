const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { fingerprintRoot, sha12 } = require('../netlify/fingerprint-assets.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frfc-fp-'));
  fs.mkdirSync(path.join(root, 'js'), { recursive: true });
  fs.mkdirSync(path.join(root, 'css'), { recursive: true });
  fs.writeFileSync(path.join(root, 'css', 'main.css'), 'body{color:#111}\n');
  fs.writeFileSync(path.join(root, 'js', 'admin.js'), 'window.Admin = {};\n');
  fs.writeFileSync(path.join(root, 'js', 'app.js'), "function boot(){}\n    script.src = '/js/admin.js';\n");
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html>
<html><head>
<link rel="stylesheet" href="/css/main.css">
</head><body>
<script src="/js/app.js" defer></script>
</body></html>
`);
  return root;
}

test('fingerprint rewrites index.html to content-addressed copies and leaves originals', () => {
  const root = fixture();
  const originalApp = fs.readFileSync(path.join(root, 'js', 'app.js'));
  const first = fingerprintRoot(root);
  assert.equal(first.skipped, false);

  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /href="\/assets\/css\/main\.[a-f0-9]{12}\.css"/);
  assert.match(index, /src="\/assets\/js\/app\.[a-f0-9]{12}\.js"/);
  assert.doesNotMatch(index, /(?:src|href)="\/(?:js|css)\//);

  for (const urlPath of Object.values(first.urls)) {
    const bytes = fs.readFileSync(path.join(root, urlPath.slice(1)));
    const hash = urlPath.match(/\.([a-f0-9]{12})\.[a-z]+$/)[1];
    assert.equal(sha12(bytes), hash, urlPath);
  }

  const appCopy = fs.readFileSync(path.join(root, first.urls['/js/app.js'].slice(1)), 'utf8');
  assert.match(appCopy, new RegExp(`script\\.src = '${first.urls['/js/admin.js'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';`));
  assert.doesNotMatch(appCopy, /script\.src = '\/js\/admin\.js'/);
  assert.equal(fs.readFileSync(path.join(root, 'js', 'app.js')).equals(originalApp), true);

  const second = fingerprintRoot(root);
  assert.equal(second.skipped, true);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), index);
});

test('a changed file gets a new URL so an old URL cannot serve the new bytes', () => {
  const root = fixture();
  const before = fingerprintRoot(root);
  const oldAdmin = before.urls['/js/admin.js'];
  const oldBytes = fs.readFileSync(path.join(root, oldAdmin.slice(1)));
  fs.writeFileSync(path.join(root, 'js', 'admin.js'), 'window.Admin = { v: 2 };\n');
  fs.writeFileSync(path.join(root, 'index.html'), fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(before.urls['/css/main.css'], '/css/main.css')
    .replace(before.urls['/js/app.js'], '/js/app.js'));
  const after = fingerprintRoot(root);
  assert.notEqual(after.urls['/js/admin.js'], oldAdmin);
  assert.equal(fs.readFileSync(path.join(root, oldAdmin.slice(1))).equals(oldBytes), true);
  const fresh = fs.readFileSync(path.join(root, after.urls['/js/admin.js'].slice(1)), 'utf8');
  assert.match(fresh, /v: 2/);
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, new RegExp(after.urls['/js/app.js'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(index, new RegExp(before.urls['/js/app.js'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('fingerprint refuses to run when the admin loader string is missing', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'js', 'app.js'), 'script.src = "/js/admin.js";\n');
  assert.throws(() => fingerprintRoot(root), /admin loader/);
});

test('fingerprint of the real index.html rewrites every stylesheet and script', () => {
  const repo = path.join(__dirname, '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frfc-real-'));
  fs.cpSync(path.join(repo, 'js'), path.join(root, 'js'), { recursive: true });
  fs.cpSync(path.join(repo, 'css'), path.join(root, 'css'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'index.html'), path.join(root, 'index.html'));
  const result = fingerprintRoot(root);
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(result.skipped, false);
  assert.doesNotMatch(index, /(?:src|href)="\/(?:js|css)\//);
  const app = fs.readFileSync(path.join(root, result.urls['/js/app.js'].slice(1)), 'utf8');
  assert.match(app, /script\.src = '\/assets\/js\/admin\.[a-f0-9]{12}\.js'/);
  assert.equal(fs.readFileSync(path.join(repo, 'index.html'), 'utf8').includes('/assets/js/app.'), false);
});

test('the CLI does not rewrite the repo unless this is a Netlify publish build', () => {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const before = fs.readFileSync(indexPath);
  const result = spawnSync(process.execPath, ['netlify/fingerprint-assets.js'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, NETLIFY: 'true', CONTEXT: 'dev' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped/);
  assert.equal(fs.readFileSync(indexPath).equals(before), true);
});
