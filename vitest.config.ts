import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      // 納入全部 src/ 而非只算「有測試的部分」，否則覆蓋率是自我恭維的數字。
      // .tsx 天然接近 0%：renderer 刻意不建 jsdom/component test 基建，
      // 純邏輯要抽成隔壁 .ts 才進得了 node 測試。這些 0% 就是「還沒抽出來的邏輯」清單，
      // 不遮蔽它們——遮了就等於預先宣告盲區不用看。
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/shared/types.ts', // 純型別宣告，無可執行程式碼（v8 會記成 0% 汙染數字）
        'src/main/index.ts', // Electron entry point，無法在 node 測試中載入
        'src/preload/**', // contextBridge 宣告，無邏輯
        'src/renderer/main.tsx', // React entry point
      ],
      // 不設 threshold：目前多數 .tsx 為 0%，任何門檻不是形同虛設就是讓 CI 長期紅。
      // 覆蓋率在此處的用途是「指出盲點在哪」，不是閘門。
    },
  },
})
