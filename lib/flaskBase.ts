// Base URL of the Flask backend. The onboarding API, the OTP endpoints and the
// Xero OAuth entry point (/api/onboarding/*, /auth/email/*, /xero_auth) all
// live there, so the auth screens use the same env var as the rest of the app
// — NEXT_PUBLIC_MODULE1_API_URL.
//
// NEXT_PUBLIC_* vars are inlined at build time, so in a deployed environment
// this MUST be set: an unset value silently falls back to localhost and breaks
// the Xero and OTP request/verify calls.
export const FLASK_BASE =
  process.env.NEXT_PUBLIC_MODULE1_API_URL || "http://localhost:5001";
