import js from '@eslint/js';
import pluginN from 'eslint-plugin-n';
import globals from 'globals';

export default [
  js.configs.recommended,
  pluginN.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022
      }
    },
    rules: {
      semi: ['error', 'always'],
      'space-before-function-paren': ['error', {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always'
      }],
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }]
    }
  },
  // Test files can use devDependencies
  {
    files: ['tests/**/*.js', 'vitest.config.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly'
      }
    },
    rules: {
      'n/no-unpublished-require': 'off',
      'n/no-unpublished-import': 'off',
      'n/no-extraneous-require': 'off'
    }
  },
  // Test helper files (in src but used only for tests)
  {
    files: ['src/utils/testHelpers/**/*.js'],
    rules: {
      'n/no-unpublished-require': 'off'
    }
  },
  // Ignore examples (they use old grpc package and are for demo only)
  {
    ignores: ['node_modules/**', 'coverage/**', 'examples/**']
  }
];
