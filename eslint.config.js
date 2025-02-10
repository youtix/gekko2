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
      'max-len': ['error', { code: 120, ignoreTemplateLiterals: true, ignoreComments: true }],
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
      'import/no-cycle': 'error',
      'import/no-unresolved': 'error',
      'import/no-unused-modules': 'error',
    },
  },
  {
    settings: {
      'import/resolver': { typescript: true, node: true },
      'import/ignore': ['node_modules', 'dist'],
      'import/core-modules': ['reflect-metadata'],
    },
  },
];
