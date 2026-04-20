import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.output/**",
      "**/data/**",
      "**/models/**",
      "**/routeTree.gen.ts",
      "**/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
