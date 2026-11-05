import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    ignores: ['scripts/**'], // dev scripts (benchmark timings) are not money code
    rules: {
      // Money must never go through floating point helpers by accident.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'round', message: 'Use core/money roundDiv for money and quantities.' },
        { property: 'toFixed', message: 'Format money with core/money formatSar.' },
      ],
    },
  },
);
