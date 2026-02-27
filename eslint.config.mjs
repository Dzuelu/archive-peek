import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';

const prettierConfig = {
  singleQuote: true,
  trailingComma: 'none',
  printWidth: 120,
  tabWidth: 2,
  semi: true,
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf'
};

export default tseslint.config(
  {
    ignores: ['out/**', 'node_modules/**']
  },
  ...tseslint.configs.recommended,
  prettier,
  { rules: { 'prettier/prettier': ['error', prettierConfig] } },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    rules: {
      'prettier/prettier': ['error', prettierConfig],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'warn'
    }
  }
);
