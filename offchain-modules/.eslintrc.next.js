module.exports = {
  extends: '.eslintrc.js',
  plugins: ['deprecation'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json', './packages/*/tsconfig.json'],
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-require-imports': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': ['error'],
    'import/order': ['error', { alphabetize: { order: 'asc' } }],
    'deprecation/deprecation': 'error',
  },
};
