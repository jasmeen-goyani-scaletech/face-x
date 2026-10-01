/**
 * Demo Mode: mock push-notification previews and a "Reset Demo State" control for live walkthroughs without
 * a backend. Off unless `NEXT_PUBLIC_DEMO_MODE=true` at build/start time, so the client-facing product never
 * shows either. (The sample documents for seeded roster people are not gated by this — see DemoDocuments.)
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export const DEMO_DOCUMENTS_KEY = 'facex-demo-documents';

/** Set by "Reset Demo State": documents without a saved decision start as pending instead of following the person's status. */
export const DEMO_RESET_KEY = 'facex-demo-reset';
