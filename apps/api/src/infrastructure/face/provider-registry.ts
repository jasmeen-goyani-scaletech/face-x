import type { FaceRecognitionProvider } from './face-provider';

/**
 * Where a real provider is plugged in later: add an adapter under `infrastructure/face/providers/<name>.ts` and
 * register its factory here under the value operators set in FACE_PROVIDER. Nothing else in the application changes.
 *
 * NOTHING IS REGISTERED YET: no real provider has been chosen, and no stand-in is shipped in production code (a
 * fake exists only in the tests). With no provider, face enrollment answers 503.
 *
 * Provider-specific settings (credentials, endpoint, region, collection/project ids...) will be read by that adapter's
 * factory. FACE_PROVIDER_API_KEY and FACE_PROVIDER_URL already exist as optional env values for it; anything else it
 * needs is added together with the adapter.
 */
export interface FaceProviderEnv {
  FACE_PROVIDER_API_KEY?: string;
  FACE_PROVIDER_URL?: string;
}

export type FaceProviderFactory = (env: FaceProviderEnv) => FaceRecognitionProvider;

const FACTORIES: Readonly<Record<string, FaceProviderFactory>> = {};

export const registeredFaceProviders = (): string[] => Object.keys(FACTORIES);

/** The configured provider, or undefined when FACE_PROVIDER is unset or names a provider with no adapter. */
export function createFaceProvider(
  name: string | undefined,
  env: FaceProviderEnv,
): FaceRecognitionProvider | undefined {
  const factory = name ? FACTORIES[name] : undefined;
  return factory?.(env);
}
