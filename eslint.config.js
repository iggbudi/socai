// ESLint flat config (eslint 9) — Prioritas 2 tooling kualitas.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'public/**', '.pi/**', 'backups/**', 'package-lock.json'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Template literal HTML di views memicu banyak false-positive unused vars.
      'no-unused-vars': 'off',
      // Pola `catch {}` disengaja (guard req.body, upload cleanup).
      'no-empty': 'off',
      // Regex markdown/HTML/parse jadwal memakai banyak escape.
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
    },
  },
];
