function App() {
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside
        style={{
          width: 280,
          borderRight: '1px solid #e0e0e0',
          padding: 16,
          overflowY: 'auto',
          backgroundColor: '#fafafa'
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>ccRewind</h2>
        <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
          Claude Code 對話回放工具
        </p>
      </aside>
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999'
        }}
      >
        選擇一個專案開始瀏覽
      </main>
    </div>
  )
}

export default App
