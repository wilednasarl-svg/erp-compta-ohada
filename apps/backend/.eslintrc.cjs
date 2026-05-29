module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.cjs', 'dist', 'node_modules', 'coverage'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      // Jest's `expect(obj.method).toHaveBeenCalled(...)` legitimately
      // references unbound methods, and mock harnesses commonly cast
      // through `as unknown as jest.Mocked<X>` which trips
      // `no-unnecessary-type-assertion` when the inner shape already
      // matches. Both rules guard runtime correctness — they do not
      // earn their cost in test files.
      files: ['**/*.spec.ts', '**/*.test.ts', 'test/**/*.ts'],
      rules: {
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        // `mock.calls[0]!` and friends fall through TS's inference and
        // trip the unsafe-* family. These rules guard runtime correctness
        // — fixture code pays no cost from suppressing them.
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        // Mock implementations conform to async interfaces (e.g. a repository
        // method typed `findById(): Promise<X>`) and so must stay `async`
        // even when the stub body has nothing to await. Same rationale as the
        // unsafe-* family: the rule guards production correctness, not fixtures.
        '@typescript-eslint/require-await': 'off',
        // Tests legitimately reach for `require(...)` to lazily pull a module
        // at runtime (avoiding circular import order) and for inline
        // `import('...').Type` annotations in `as unknown as` mock casts.
        // These are organizational/strictness rules with no fixture payoff.
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
      },
    },
  ],
};
