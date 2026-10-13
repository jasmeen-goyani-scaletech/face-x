// Generates the link-preview card (src/app/opengraph-image.png) from the brand colours, on any OS.
//
// Why a script and not an `opengraph-image.tsx` route: Next 14's bundled image renderer builds the paths of its font and wasm files
// with `path.join(import.meta.url, ...)`, which mangles a file:// URL on Windows ("file:\D:\..."), so a route that uses it makes
// `next build` fail there. Here the same renderer is called from plain Node with `path.join` taught to keep file:// URLs intact, and
// the result is committed as a static image, which Next serves unchanged on every platform. Re-run after changing the design:
//   pnpm --filter @facex/web generate:og
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// Teach path.join to leave file:// URLs alone (what the renderer meant to do), before the renderer is loaded.
const nativeJoin = path.join;
path.join = (...parts) => (typeof parts[0] === 'string' && parts[0].startsWith('file:') ? new URL(parts.slice(1).join('/'), parts[0] + '/').href : nativeJoin(...parts));
syncBuiltinESMExports();

// Resolve the renderer that ships inside the installed `next` (so it always matches the app's Next version).
const nextDir = path.dirname(require.resolve('next/package.json'));
const og = await import(new URL(`file:///${path.join(nextDir, 'dist/compiled/@vercel/og/index.node.js').replace(/\\/g, '/')}`).href);
const Renderer = og.ImageResponse;

const h = (type, style, children) => ({ type, props: { style, children } });
const SIZE = { width: 1200, height: 630 };

const card = h(
  'div',
  {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '0 96px',
    background: 'linear-gradient(135deg, #16543a 0%, #1f6f4d 100%)',
    color: '#ffffff'
  },
  [
    h('div', { display: 'flex', alignItems: 'center', gap: 28 }, [
      h('div', { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 120, height: 120, borderRadius: 28, background: '#ffffff', color: '#1f6f4d', fontSize: 64, fontWeight: 800 }, 'FX'),
      h('div', { fontSize: 112, fontWeight: 800, letterSpacing: 2 }, 'FACE-X')
    ]),
    h('div', { marginTop: 44, fontSize: 46, lineHeight: 1.25, maxWidth: 940 }, 'Player, coach and staff registration and event-day check-in for California youth football.'),
    h(
      'div',
      { marginTop: 40, display: 'flex', gap: 16, fontSize: 28, fontWeight: 700 },
      ['PLAYER', 'COACH', 'STAFF'].map((r) => h('div', { display: 'flex', padding: '10px 24px', borderRadius: 999, background: 'rgba(255,255,255,0.18)' }, r))
    )
  ]
);

const png = Buffer.from(await new Renderer(card, SIZE).arrayBuffer());
if (png.subarray(1, 4).toString() !== 'PNG') throw new Error('The renderer did not produce a PNG');
const out = fileURLToPath(new URL('../src/app/opengraph-image.png', import.meta.url));
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
