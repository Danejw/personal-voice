import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src-tauri/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: "Use the shared branded SelectField component instead of a native select.",
        },
      ],
    },
  },
);
