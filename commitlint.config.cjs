module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0, 'always'], // Disables the rule
    'header-max-length': [2, 'always', 125], // Throws error if the header is longer than 125 characters
  },
};
