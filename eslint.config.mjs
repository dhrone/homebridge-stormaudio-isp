import prettier from 'eslint-config-prettier';
import path from 'path';
import { fileURLToPath } from 'url';

import tseslint from 'typescript-eslint';

// Use fileURLToPath for Node 20.0+ compatibility
// (import.meta.dirname requires Node 20.11+ and would fail on 20.0-20.10)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'scripts/', 'vitest.config.ts', 'homebridge-ui/', 'coverage/'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'dot-notation': 'error',
      eqeqeq: ['error', 'smart'],
      curly: ['error', 'all'],
      'prefer-arrow-callback': 'warn',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { classes: false, enums: false }],
    },
  },
  // Disables all ESLint formatting rules that could conflict with Prettier
  prettier,
);
