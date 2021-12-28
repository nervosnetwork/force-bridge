// module.exports = {
//   tabWidth: 2,
//   semi: true,
//   singleQuote: true,
// };
//
module.exports = {
  tabWidth: 2,
  singleQuote: true,
  semi: true,
  overrides: [
    {
      files: '*.sol',
      options: {
        tabWidth: 2,
        singleQuote: true,
        explicitTypes: 'always',
      },
    },
  ],
  plugins: [require.resolve('prettier-plugin-solidity')],
};
