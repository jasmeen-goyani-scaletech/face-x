/**
 * Pure face-positioning logic for the camera UI: takes what a face detector saw, the on-screen
 * frame size and a brightness reading, and decides what one short instruction to show. No DOM, no
 * detector — so it can be unit-tested and reused by both the registration selfie and the event-day scanner.
 */

export interface Point {
  x: number;
  y: number;
}

/** A detected face, in the video's own pixel coordinates. Eyes/nose are optional (used for straightness). */
export interface FaceObservation {
  box: { x: number; y: number; w: number; h: number };
  leftEye?: Point;
  rightEye?: Point;
  nose?: Point;
}

export interface Size {
  w: number;
  h: number;
}

export type GuidanceCode =
  | 'no_face'
  | 'multiple'
  | 'too_far'
  | 'too_close'
  | 'off_center'
  | 'low_light'
  | 'backlit'
  | 'not_straight'
  | 'moving'
  | 'good';

export interface Guidance {
  code: GuidanceCode;
  level: 'warn' | 'good';
  message: string;
}

/** Brightness (0–255 luma) around the face; see `measureLighting`. */
export interface LightingStats {
  /** Mean luma of the cheeks/nose band. */
  face: number;
  /** Mean luma of the frame outside the face. */
  background: number;
}

/** The face must fill at least this share of the visible camera frame (product requirement). */
export const MIN_FACE_AREA_RATIO = 0.25;

const ZONE_ASPECT = 0.78; // width / height of the (never drawn) target zone
/** Share of the frame height the target zone may use, leaving room for the banner and shutter. */
export const TARGET_MAX_HEIGHT = 0.7;
const MAX_ROLL_DEG = 12;
const MAX_YAW_RATIO = 0.4; // nose offset from eye midpoint, as a share of eye distance
const MAX_CENTER_OFFSET = 0.35; // share of the target-zone radius the face centre may drift
const MAX_MOVE_RATIO = 0.04; // share of frame width the face may move between samples
const TOO_CLOSE_WIDTH_RATIO = 1.15; // face wider than the target zone by this factor → too close

// Lighting (0–255 luma).
const MIN_FACE_LUMA = 55; // darker than this and the photo is muddy
const BACKLIT_BG_MIN = 140; // background must be bright...
const BACKLIT_RATIO = 1.8; // ...and this many times brighter than the face

// Detector box → whole-face estimate. Measured with BlazeFace short-range on a frontal portrait:
// the box is ~1/1.2 of the face width, ~1/1.45 of its height, and its centre is ~0.28 box-heights
// below the face centre (forehead-to-chin midpoint).
const FACE_WIDTH_FACTOR = 1.2;
const FACE_HEIGHT_FACTOR = 1.45;
const FACE_CENTER_LIFT = 0.28;

const MESSAGES: Record<GuidanceCode, string> = {
  no_face: 'Face not detected — please position yourself in front of the camera.',
  multiple: 'One person at a time, please.',
  too_far: 'Move a little closer.',
  too_close: 'Move a little farther away.',
  off_center: 'Please center your face.',
  low_light: 'Improve the lighting.',
  backlit: 'Avoid strong backlighting.',
  not_straight: 'Keep your face straight.',
  moving: 'Keep your face still.',
  good: 'Ready to scan'
};

function guidance(code: GuidanceCode): Guidance {
  return { code, level: code === 'good' ? 'good' : 'warn', message: MESSAGES[code] };
}

export interface TargetZone {
  cx: number;
  cy: number;
  /** Full width / height in frame pixels. */
  w: number;
  h: number;
}

/**
 * The area a well-framed face should occupy: centred in the frame and never drawn on screen.
 * `maxHeightRatio` caps its height as a share of the frame so it leaves room for on-screen controls.
 */
export function targetZone(frame: Size, maxHeightRatio = TARGET_MAX_HEIGHT): TargetZone {
  const w = Math.min(0.84 * frame.w, ZONE_ASPECT * maxHeightRatio * frame.h);
  return { cx: frame.w / 2, cy: frame.h / 2, w, h: w / ZONE_ASPECT };
}

/**
 * Minimum face size (share of frame area). Normally 25%, but a very wide frame can't fit a 25%-area
 * face inside a zone that must stay within the frame height, so it is capped to what the zone allows.
 */
export function minFaceAreaRatio(frame: Size, zone: TargetZone): number {
  const achievable = (0.6 * (zone.w * zone.h)) / (frame.w * frame.h);
  return Math.min(MIN_FACE_AREA_RATIO, achievable);
}

/** Maps a video-pixel point into displayed-frame pixels, for a `<video>` styled `object-fit: cover`. */
export function videoToFrame(p: Point, video: Size, frame: Size): Point {
  const scale = Math.max(frame.w / video.w, frame.h / video.h);
  return {
    x: p.x * scale + (frame.w - video.w * scale) / 2,
    y: p.y * scale + (frame.h - video.h * scale) / 2
  };
}

/** Estimated whole-face box (forehead to chin) from the detector's tighter box, in the same coordinates. */
export function estimateFaceBox(box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const w = box.w * FACE_WIDTH_FACTOR;
  const h = box.h * FACE_HEIGHT_FACTOR;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2 - box.h * FACE_CENTER_LIFT;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Reads brightness from a downscaled greyscale copy of the frame (`luma`, row-major, `size` px).
 * `face` is the estimated whole-face box in that same pixel space. Null when the face is off the sample.
 */
export function measureLighting(luma: ArrayLike<number>, size: Size, face: { x: number; y: number; w: number; h: number }): LightingStats | null {
  const mean = (x0: number, y0: number, x1: number, y1: number) => {
    const ax = Math.max(0, Math.floor(x0));
    const ay = Math.max(0, Math.floor(y0));
    const bx = Math.min(size.w, Math.ceil(x1));
    const by = Math.min(size.h, Math.ceil(y1));
    let sum = 0;
    let n = 0;
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) {
        sum += luma[y * size.w + x];
        n++;
      }
    }
    return n ? sum / n : null;
  };

  // Cheeks/nose band: 40–75% down the face box, middle 60% of its width.
  const x0 = face.x + face.w * 0.2;
  const x1 = face.x + face.w * 0.8;
  const cheeks = mean(x0, face.y + face.h * 0.4, x1, face.y + face.h * 0.75);
  if (cheeks === null) return null;

  // Background = everything outside the face box, so a large face doesn't dilute the reading.
  const total = size.w * size.h;
  const overlapW = Math.max(0, Math.min(size.w, face.x + face.w) - Math.max(0, face.x));
  const overlapH = Math.max(0, Math.min(size.h, face.y + face.h) - Math.max(0, face.y));
  const faceArea = overlapW * overlapH;
  const outside = total - faceArea;
  const whole = mean(0, 0, size.w, size.h) ?? cheeks;
  const faceMean = mean(face.x, face.y, face.x + face.w, face.y + face.h) ?? cheeks;
  const background = outside > 0 ? Math.max(0, (whole * total - faceMean * faceArea) / outside) : whole;

  return { face: cheeks, background };
}

export interface Evaluation {
  guidance: Guidance;
  /** Face centre in frame pixels, to compare against the next sample for stillness. */
  center: Point | null;
  /** Estimated whole-face box in video pixels (for the caller to measure lighting on the next sample). */
  faceBox: { x: number; y: number; w: number; h: number } | null;
}

export function evaluateFaces(
  faces: FaceObservation[],
  video: Size,
  frame: Size,
  prevCenter: Point | null,
  light: LightingStats | null = null,
  maxHeightRatio = TARGET_MAX_HEIGHT
): Evaluation {
  if (faces.length === 0) return { guidance: guidance('no_face'), center: null, faceBox: null };

  // The largest face is the subject; a second sizeable face means someone else is in shot.
  const sorted = [...faces].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  const face = sorted[0];
  const second = sorted[1];
  const faceBox = estimateFaceBox(face.box);

  const tl = videoToFrame({ x: face.box.x, y: face.box.y }, video, frame);
  const br = videoToFrame({ x: face.box.x + face.box.w, y: face.box.y + face.box.h }, video, frame);
  // The detector's box is a tight square over eyes–nose–mouth, smaller than the whole face and
  // sitting below its centre. Judge size and centring on an estimate of the full face instead.
  const rawW = br.x - tl.x;
  const rawH = br.y - tl.y;
  const boxW = rawW * FACE_WIDTH_FACTOR;
  const boxH = rawH * FACE_HEIGHT_FACTOR;
  const center = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 - rawH * FACE_CENTER_LIFT };
  const zone = targetZone(frame, maxHeightRatio);
  const result = (code: GuidanceCode): Evaluation => ({ guidance: guidance(code), center, faceBox });

  if (second && second.box.w * second.box.h >= 0.35 * face.box.w * face.box.h) return result('multiple');
  if ((boxW * boxH) / (frame.w * frame.h) < minFaceAreaRatio(frame, zone)) return result('too_far');
  if (boxW > TOO_CLOSE_WIDTH_RATIO * zone.w) return result('too_close');

  const dx = (center.x - zone.cx) / (zone.w / 2);
  const dy = (center.y - zone.cy) / (zone.h / 2);
  if (Math.hypot(dx, dy) > MAX_CENTER_OFFSET) return result('off_center');

  if (light) {
    if (light.face < MIN_FACE_LUMA) return result('low_light');
    if (light.background >= BACKLIT_BG_MIN && light.background > BACKLIT_RATIO * light.face) return result('backlit');
  }

  if (face.leftEye && face.rightEye) {
    const [a, b] = face.leftEye.x <= face.rightEye.x ? [face.leftEye, face.rightEye] : [face.rightEye, face.leftEye];
    const eyeDx = b.x - a.x;
    const eyeDy = b.y - a.y;
    const rollDeg = Math.abs((Math.atan2(eyeDy, eyeDx) * 180) / Math.PI);
    const eyeDist = Math.hypot(eyeDx, eyeDy);
    let yawRatio = 0;
    if (face.nose && eyeDist > 0) {
      yawRatio = Math.abs(face.nose.x - (a.x + b.x) / 2) / eyeDist;
    }
    if (rollDeg > MAX_ROLL_DEG || yawRatio > MAX_YAW_RATIO) return result('not_straight');
  }

  if (prevCenter && Math.hypot(center.x - prevCenter.x, center.y - prevCenter.y) > MAX_MOVE_RATIO * frame.w) {
    return result('moving');
  }

  return result('good');
}

/**
 * Debounces raw per-sample guidance so the on-screen text doesn't flicker and a single lucky frame
 * can't unlock the shutter: a new message must persist for a few samples before it replaces the old
 * one, and "good" must hold longer still before capture is allowed.
 */
export function createGuidanceSmoother(opts: { confirmSamples?: number; goodSamples?: number; noFaceSamples?: number; lightingSamples?: number } = {}) {
  const confirm = opts.confirmSamples ?? 2;
  const goodNeeded = opts.goodSamples ?? 5;
  const noFaceNeeded = opts.noFaceSamples ?? 3;
  const lightingNeeded = opts.lightingSamples ?? 4; // lighting readings are noisier — be slower to accuse

  let shown: Guidance | null = null;
  let candidate: GuidanceCode | null = null;
  let candidateCount = 0;

  return {
    push(raw: Guidance): Guidance {
      if (raw.code === candidate) candidateCount++;
      else {
        candidate = raw.code;
        candidateCount = 1;
      }
      const needed =
        raw.code === 'good'
          ? goodNeeded
          : raw.code === 'no_face'
            ? noFaceNeeded
            : raw.code === 'low_light' || raw.code === 'backlit'
              ? lightingNeeded
              : confirm;
      if (!shown) {
        // First sample: never open on "good" — it has to prove itself steady first.
        shown = raw.code === 'good' ? guidance('moving') : raw;
      } else if (raw.code !== shown.code && candidateCount >= needed) {
        shown = raw;
      }
      return shown;
    },
    reset() {
      shown = null;
      candidate = null;
      candidateCount = 0;
    }
  };
}
