// Build the page and copy it into the personal-page site repo, served at sharifmutasim.com/lunar-windows/.
// Usage: npm run publish:site [-- <path to the personal-page folder>]
// Then commit and push the personal-page repo; Cloudflare Pages deploys it.
// Only the built page and its terrain patches are copied; the source stays in this private repo.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const SUBDIR = 'lunar-windows';

// The site repo is the folder whose git remote is smutasim/personal-page. Check the remote, not the folder name:
// after the planned rename, a folder called smutasim.github.io is the public redirect repo, never the target.
function isSiteRepo(dir) {
  try {
    const url = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
    return /personal-page(\.git)?\s*$/.test(url);
  } catch { return false; }
}
const coding = path.join(root, '..', '..');
const candidates = process.argv[2] ? [path.resolve(process.argv[2])]
  : [path.join(coding, 'personal-page'), path.join(coding, 'smutasim.github.io')];
const site = candidates.find(isSiteRepo);
if (!site) {
  console.error('No personal-page repo found in: ' + candidates.join(', ') + '\nPass its folder: npm run publish:site -- <folder>');
  process.exit(1);
}

execFileSync(process.execPath, [path.join(root, 'tools', 'build.js')], { stdio: 'inherit' });

const out = path.join(site, SUBDIR);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'terrain3d'), { recursive: true });
fs.copyFileSync(path.join(root, 'dist', 'index.html'), path.join(out, 'index.html'));
for (const f of fs.readdirSync(path.join(root, 'dist', 'terrain3d'))) {
  fs.copyFileSync(path.join(root, 'dist', 'terrain3d', f), path.join(out, 'terrain3d', f));
}
console.log('copied to ' + out + '\nnext: commit and push that repo (git -C "' + site + '" add ' + SUBDIR + ')');
