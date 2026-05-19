/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: [
    '/node_modules/', 
    '/dist/', 
    '/shared/testing/', 
    'src/index.ts',
    'src/storage/cache/index.ts',
    'src/cypher/index.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  testTimeout: 60000,
  maxWorkers: 5,
  coverageReporters: [
    "lcov",
    "json-summary"
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { resolveJsonModule: true } }],
  },
};
