module.exports = {
  extends: '.eslintrc.js',
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-require-imports': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'import/order': ['error', { alphabetize: { order: 'asc' } }],
  },
};
