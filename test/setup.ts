// Runs before every test file.
//
// jest-dom's matchers are imported from the '/vitest' entry point, not the bare
// package: the bare one registers against Jest's expect and silently adds nothing
// here, so `toBeInTheDocument` would come back as "not a function" at the call site
// rather than as a setup error.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom implements no ResizeObserver, and Stepper constructs one on mount to drive
// its label marquee. A no-op stub rather than a real implementation on purpose: the
// marquee measures scrollWidth and getComputedStyle, both of which jsdom reports as
// 0 / empty, so any assertion about it would be testing the stub. The marquee is
// checked by eye in the browser; what these tests need is only for mount to survive.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// RTL only auto-cleans when a global `afterEach` exists, and this project runs with
// globals disabled -- so without this, every render stacks up in the same document
// and `getByRole` starts finding two of everything.
afterEach(() => {
  cleanup();
});
