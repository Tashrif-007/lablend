module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '(src/.*\\.spec|test/.*\\.e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'ES2022', emitDecoratorMetadata: true, experimentalDecorators: true, esModuleInterop: true, strict: true, skipLibCheck: true } }] },
  testEnvironment: 'node',
};
