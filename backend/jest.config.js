module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: ['src/**/*.js'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  // Regression floor, set just below the baseline established by the release
  // test suite. Raise these as coverage grows — never lower them.
  coverageThreshold: {
    global: {
      branches: 25,
      functions: 33,
      lines: 37,
      statements: 35,
    },
  },
};
