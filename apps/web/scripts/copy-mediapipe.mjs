// Copies the MediaPipe wasm runtime into public/ so face detection is served from our own origin
// (works offline at the field, and the service worker can cache it). Runs on `npm install`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const src = 'node_modules/@mediapipe/tasks-vision/wasm';
const dest = 'public/mediapipe/wasm';

if (!existsSync(src)) {
  console.warn('[copy-mediapipe] @mediapipe/tasks-vision not installed yet — skipping.');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-mediapipe] copied wasm runtime to ${dest}`);
