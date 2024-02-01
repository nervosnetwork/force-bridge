module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
  ],
  env: { jest: true, node: true },
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json', './packages/*/tsconfig.json'],
  },
  plugins: ['@typescript-eslint', 'import', 'prettier', 'deprecation'],
  rules: {
    '@typescript-eslint/member-ordering': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-require-imports': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'prettier/prettier': 'error',
    'import/order': ['warn', { alphabetize: { order: 'asc' } }],
    'no-console': 'warn',
    'no-constant-condition': 'warn',
    'deprecation/deprecation': 'warn',
  },
  ignorePatterns: ['**/generated', '**/*.js'],
};
