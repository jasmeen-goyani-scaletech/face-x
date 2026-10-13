import type { FaceImage } from '../../face-provider';

/** One face found in an image, with its 128-number descriptor. */
export interface DetectedFace {
  descriptor: Float32Array;
  /** The detector's confidence, 0 to 1. */
  score: number;
  /** Size of the face's box in pixels, after the image was scaled down for analysis. */
  width: number;
  height: number;
}

/**
 * Finds every face in an image and describes each one. The provider decides what to do with the answer (one face, a clearly
 * dominant face, too many); the engine only measures. A bad image makes it throw a FaceProviderError('IMAGE_REJECTED').
 */
export interface FaceEngine {
  detect(image: FaceImage, signal?: AbortSignal): Promise<DetectedFace[]>;
  /** Stops the engine's worker, if it has one. */
  close(): Promise<void>;
}
