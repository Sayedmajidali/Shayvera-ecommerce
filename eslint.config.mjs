import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Vendored React Bits components (src/components/react-bits, installed from reactbits.dev):
  // they drive animations imperatively through refs, which the React Compiler advisory rules flag.
  // Kept close to upstream so they can be updated; these rules stay on for all of our own code.
  {
    files: ["src/components/react-bits/**"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / local artefacts:
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    "coverage/**",
    "storage/**",
  ]),
]);

export default eslintConfig;
