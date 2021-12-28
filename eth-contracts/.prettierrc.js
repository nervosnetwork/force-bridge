module.exports = {
  tabWidth: 2,
  singleQuote: true,
  overrides: [
    {
      files: '*.sol',
      options: {
        tabWidth: 2,
        singleQuote: false,
        explicitTypes: 'always',
      },
    },
  ],
  plugins: [require.resolve('prettier-plugin-solidity')],
};
