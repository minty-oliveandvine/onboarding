// Base URL of the Flask backend. The onboarding API, the OTP endpoints and the
// Xero OAuth entry point (/api/onboarding/*, /auth/email/*, /xero_auth) all
// live there, so the auth screens use the same env var as the rest of the app
// — NEXT_PUBLIC_MODULE1_API_URL.
//
// NEXT_PUBLIC_API_URL is kept only as a backward-compatible fallback for builds
// that still set the old var. Without it, an unset NEXT_PUBLIC_API_URL silently
// fell back to localhost and broke the Xero and OTP request/verify calls in
// deployed environments.
export const FLASK_BASE =
  process.env.NEXT_PUBLIC_MODULE1_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:5001";
