import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules
    }
  },
  {
    files: ['scripts/**/*.{js,cjs}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // .mjs 另立一個 block 而非併進上面的 glob：上面是 sourceType: 'commonjs'，
    // ESM 語法（import / top-level await）在那個 parser 設定下會直接解析失敗。
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      // 沒有這行，scripts/*.mjs 會噴一整排 process / console / fetch 的 no-undef
      // （實測移除後 eslint exit 1）。WebSocket 不必另外補，globals.node 已收錄。
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/renderer/scripts/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    ignores: ['out/', 'dist/', 'node_modules/']
  }
)
