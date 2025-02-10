import pluginJs from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ['src/**/*.{ts}'] },
  { languageOptions: { globals: globals.node } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  eslintPluginPrettierRecommended,
  { rules: { indent: 'off', 'no-console': 'error' } },
  {
    settings: {
      'import/resolver': { typescript: true, node: true },
      'import/ignore': ['node_modules', 'dist'],
      'import/core-modules': ['reflect-metadata'],
    },
  },
];
