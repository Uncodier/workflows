import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Allow 'any' type for Temporal configuration objects
      "@typescript-eslint/no-explicit-any": "off",
      // Allow unused vars for type parameters
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      // Allow require imports for Node.js scripts
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
