import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // `no-undef` for the plain-JS files, because NOTHING else covers them.
  //
  // eslint-config-next/typescript turns `no-undef` off -- correct for .ts/.tsx, where the
  // compiler catches it -- but tsconfig.json's `include` lists only **/*.ts, **/*.tsx and
  // **/*.mts, and `checkJs` is off. So the .jsx files (which is most of this app, including
  // both ~2,000-line components) had NO check for an undefined identifier at all: a missing
  // import passed `next build` AND `eslint` and failed only at runtime in the browser.
  //
  // That happened. This rule is the gate that would have caught it.
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        ResizeObserver: "readonly",
        IntersectionObserver: "readonly",
        MutationObserver: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Intl: "readonly",
        atob: "readonly",
        btoa: "readonly",
        process: "readonly",
        AbortController: "readonly",
        Image: "readonly",
      },
    },
    rules: { "no-undef": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
