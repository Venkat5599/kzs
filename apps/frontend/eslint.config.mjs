import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * ESLint 9 flat config.
 *
 * `eslint-config-next` 16 exports flat config arrays directly, so there is no
 * `FlatCompat` shim here — importing the two presets is the whole configuration.
 *
 * Ignores are declared in config rather than passed on the command line, because
 * flat config takes its file set from here; an `--ext` or `--ignore-pattern` flag
 * on the npm script would be silently dropped.
 */
export default [
  {
    ignores: [".next/**", "out/**", "node_modules/**", "next-env.d.ts"],
  },
  ...coreWebVitals,
  ...typescript,
];
