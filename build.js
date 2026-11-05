const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

function bumpVersion(versionStr, bumpType = 'patch') {
  const parts = (versionStr || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);

  if (bumpType === 'major') {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (bumpType === 'minor') {
    parts[1] += 1;
    parts[2] = 0;
  } else {
    parts[2] += 1;
  }

  return parts.join('.');
}

function minifyHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

async function build() {
  const manifestPath = path.join(ROOT, 'manifest.json');
  const pkgPath = path.join(ROOT, 'package.json');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  // Determine version bump type (default: 'patch'; supports `npm run build -- minor` or `major`)
  const arg = (process.argv[2] || 'patch').toLowerCase();
  const bumpType = ['major', 'minor', 'patch'].includes(arg) ? arg : 'patch';

  const prevVersion = manifest.version || pkg.version || '1.0.0';
  const nextVersion = bumpVersion(prevVersion, bumpType);

  manifest.version = nextVersion;
  pkg.version = nextVersion;

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  const zipName = `RealSearchPro_v${nextVersion}.zip`;
  const zipPath = path.join(ROOT, zipName);

  // 1. Clean and recreate dist/
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });

  // 2. Compile & minify JS files (whitespace + syntax + identifier mangling)
  await esbuild.build({
    entryPoints: [
      path.join(ROOT, 'content.js'),
      path.join(ROOT, 'background.js'),
      path.join(ROOT, 'popup.js')
    ],
    outdir: DIST,
    bundle: true,
    minify: true,
    target: ['chrome110'],
    legalComments: 'none'
  });

  // 3. Minify CSS
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'popup.css')],
    outfile: path.join(DIST, 'popup.css'),
    minify: true,
    legalComments: 'none'
  });

  // 4. Minify HTML & manifest.json
  const rawHtml = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  fs.writeFileSync(path.join(DIST, 'popup.html'), minifyHtml(rawHtml));
  fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest));

  // 5. Copy required icons
  const iconFiles = fs.readdirSync(path.join(ROOT, 'icons')).filter((f) => f.endsWith('.png'));
  for (const file of iconFiles) {
    fs.copyFileSync(
      path.join(ROOT, 'icons', file),
      path.join(DIST, 'icons', file)
    );
  }

  // 6. Pack dist/ contents into a Chrome Web Store ready .zip
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  execFileSync('zip', ['-r', '-q', zipPath, '.', '-x', '*.DS_Store'], {
    cwd: DIST
  });

  const zipStat = fs.statSync(zipPath);
  const sizeKb = (zipStat.size / 1024).toFixed(1);
  console.log(`✅ Version bumped: ${prevVersion} → ${nextVersion}`);
  console.log(`✅ Built dist/ and packaged ${zipName} (${sizeKb} KB)`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
