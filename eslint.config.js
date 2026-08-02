// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'docs/**', '**/*.d.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The handoff bans `any` outright — no escape hatches.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Async correctness: a dropped promise is a silent production bug.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSNonNullExpression',
          message: 'Narrow the type instead of asserting non-null.',
        },
      ],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Fastify identifies a plugin by its signature: `async (app) => {}` is the
    // encapsulated-plugin form, so these stay async even with nothing to await.
    files: ['src/**/*.routes.ts', 'src/shared/middleware/*.ts', 'src/app.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Tests assert on loosely typed injected payloads.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Config files are not part of the TypeScript program.
    files: ['*.js', '*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['prisma/seed.ts', 'src/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
