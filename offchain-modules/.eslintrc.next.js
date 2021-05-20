module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
  ],
  env: { jest: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.next.json'],
  },
  plugins: ['@typescript-eslint', 'import', 'prettier', 'tsc'],
  rules: {
    '@typescript-eslint/member-ordering': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-require-imports': 'error',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'prettier/prettier': 'error',
    'import/order': ['warn', { alphabetize: { order: 'asc' } }],
    'no-console': ['warn'],
    'tsc/config': [
      'error',
      {
        configFile: 'tsconfig.next.json',
      },
    ],
  },
};
