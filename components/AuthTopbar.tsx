// The bare Minty topbar used by the auth screens (/auth and /auth/confirm),
// including their Suspense fallbacks. Markup is byte-for-byte what each page
// inlined before — an empty <h1> and empty .right keep the three-column
// topbar-inner grid from collapsing, so the brand stays left-aligned.
//
// OnboardingApp renders its own variant of this block with a title and an
// avatar button in .right; it is intentionally not shared here.
export default function AuthTopbar() {
  return (
    <div className="topbar" data-screen-label="Top bar">
      <div className="topbar-inner">
        <div className="brand">
          <img className="brand-mark-img" src="/assets/minty-logo.png" alt="Minty" />
          <span>Minty</span>
        </div>
        <h1></h1>
        <div className="right" />
      </div>
    </div>
  );
}
