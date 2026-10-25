import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'release', 'release-audit', 'tmp', 'tmp_docx_audit', 'tmp_docx_render', 'win-unpacked', 'a', 'APP_QUAN_LY_KHO_HANG', 'functions/lib', '.agents', '.codex', '.impeccable']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Codebase hiện hữu dùng `any` tại các callback UI/Ant Design; type-check
      // TypeScript vẫn chạy độc lập trong `npm run build`.
      '@typescript-eslint/no-explicit-any': 'off',
      'prefer-const': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
])
