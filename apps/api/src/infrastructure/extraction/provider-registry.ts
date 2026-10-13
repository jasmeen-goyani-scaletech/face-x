import type { DocumentExtractor } from './document-extractor';
import { OPENAI_EXTRACTOR, createOpenAiExtractorFromEnv } from './providers/openai.provider';

/**
 * Where a document extraction provider is plugged in: add an adapter under `infrastructure/extraction/providers/<name>.ts`
 * and register its factory here under the value operators set in EXTRACTION_PROVIDER. Nothing else changes.
 *
 * REGISTERED: "openai" (Responses API, needs OPENAI_API_KEY). With EXTRACTION_PROVIDER unset, extraction answers 503.
 */
export interface ExtractionProviderEnv {
  OPENAI_API_KEY?: string;
  EXTRACTION_MODEL: string;
  EXTRACTION_REASONING_EFFORT: ExtractionReasoningEffort;
}

/** "default" sends no reasoning setting at all (for models that do not take one). */
export type ExtractionReasoningEffort = 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high';

export type ExtractionProviderFactory = (env: ExtractionProviderEnv) => DocumentExtractor;

const FACTORIES: Readonly<Record<string, ExtractionProviderFactory>> = {
  [OPENAI_EXTRACTOR]: createOpenAiExtractorFromEnv,
};

export const registeredExtractionProviders = (): string[] => Object.keys(FACTORIES);

/** The configured extractor, or undefined when EXTRACTION_PROVIDER is unset or names a provider with no adapter. */
export function createDocumentExtractor(
  name: string | undefined,
  env: ExtractionProviderEnv,
): DocumentExtractor | undefined {
  const factory = name ? FACTORIES[name] : undefined;
  return factory?.(env);
}
