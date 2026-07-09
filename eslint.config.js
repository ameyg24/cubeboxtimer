import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // The one place console is allowed to appear directly - everything else
    // logs through src/logger.js.
    files: ['src/logger.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // These two files intentionally co-locate a context Provider with its
    // useX() hook (useAuth/useTheme) - a standard React pattern. It trips
    // react-refresh's "only export components" rule, which is a Fast
    // Refresh nicety, not a correctness issue; splitting the hook into its
    // own file would be churn for no real benefit.
    files: ['src/components/AuthContext.jsx', 'src/components/ThemeContext.jsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
