const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

function minifyHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

async function build() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const version = manifest.version || '1.0.0';
  const zipName = `RealSearchPro_v${version}.zip`;
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
  console.log(`✅ Built dist/ and packaged ${zipName} (${sizeKb} KB)`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

