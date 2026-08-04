import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  prettier,
  {
    rules: {
      // WXT/浏览器扩展常见:未使用的下划线参数
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // react-hooks v7 新增的激进规则:现有代码模式暂降为警告,重构时再收紧
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
);
