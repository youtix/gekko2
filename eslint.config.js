import pluginJs from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    rules: {
      'no-console': 'error',
      'no-multiple-empty-lines': ['error', { max: 1 }],
      'arrow-parens': ['error', 'as-needed'],
      semi: ['error', 'always'],
      indent: 'off',
      quotes: ['error', 'single'],
      'max-len': 'off',
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
      'import/no-cycle': 'error',
      'import/no-unresolved': 'error',
      'import/no-unused-modules': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    settings: {
      'import/resolver': { typescript: { bun: true } },
      'import/ignore': ['node_modules', 'dist'],
      'import/core-modules': ['reflect-metadata'],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
