import type { Queryable } from '../database/database';
import type { FaceRecognitionProvider } from './face-provider';
import { NODE_NATIVE_PROVIDER, createNodeNativeFromEnv } from './providers/node-native.provider';
import { RUST_REMOTE_PROVIDER, createRustRemoteFromEnv } from './providers/rust-remote.provider';

/**
 * Where a provider is plugged in: add an adapter under `infrastructure/face/providers/<name>.ts` and register its factory here
 * under the value operators set in FACE_PROVIDER. Nothing else in the application changes.
 *
 * REGISTERED: "node-native", face-api (WASM) running inside this API with its descriptors kept encrypted in `face_templates`.
 * It needs FACE_ENCRYPTION_KEY and no cloud service. With FACE_PROVIDER unset, enrollment and scanning answer 503.
 *
 * REGISTERED: "rust-remote", the external Rust face service (face_z_BE) over HTTP. It needs RUST_FACE_SERVICE_URL; the service holds
 * the biometric data and this application keeps only its opaque member id.
 *
 * Provider-specific settings (credentials, endpoint, region, collection/project ids...) are read by that adapter's factory.
 */
export interface FaceProviderEnv {
  FACE_PROVIDER_API_KEY?: string;
  FACE_PROVIDER_URL?: string;
  FACE_ENCRYPTION_KEY?: string;
  RUST_FACE_SERVICE_URL?: string;
  RUST_FACE_SERVICE_TOKEN?: string;
}

/** What an adapter may use besides the environment: the database, for providers that keep their own data. */
export interface FaceProviderDeps {
  db: Queryable;
}

export type FaceProviderFactory = (
  env: FaceProviderEnv,
  deps: FaceProviderDeps,
) => FaceRecognitionProvider;

const FACTORIES: Readonly<Record<string, FaceProviderFactory>> = {
  [NODE_NATIVE_PROVIDER]: createNodeNativeFromEnv,
  [RUST_REMOTE_PROVIDER]: createRustRemoteFromEnv,
};

export const registeredFaceProviders = (): string[] => Object.keys(FACTORIES);

/** The configured provider, or undefined when FACE_PROVIDER is unset or names a provider with no adapter. */
export function createFaceProvider(
  name: string | undefined,
  env: FaceProviderEnv,
  deps: FaceProviderDeps,
): FaceRecognitionProvider | undefined {
  const factory = name ? FACTORIES[name] : undefined;
  return factory?.(env, deps);
}
