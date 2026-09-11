// Where the stack lives. Shared by playwright.config.ts and the specs.
//
// In its own module rather than exported from the config: Playwright loads the config
// through a CommonJS path, so a spec that imports from it fails at load with "Cannot
// use import statement outside a module" -- which reads like a broken test file rather
// than a module-format problem.

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3001';
export const FLASK_URL = process.env.E2E_FLASK_URL || 'http://localhost:5001';
export const ONBOARDING_API_URL = process.env.E2E_ONBOARDING_API_URL || 'http://localhost:8001';
