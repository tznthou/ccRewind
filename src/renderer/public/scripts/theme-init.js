// Synchronous theme initialization — runs before React to prevent FOUC.
// Same mapping as src/renderer/context/resolveTheme.ts (tests/renderer/themeMigration.test.ts holds both to one table):
// the removed terminal theme moves to board; archive and anything unknown fall back to timeline.
(function () {
  var stored = localStorage.getItem('ccrewind-theme')
  document.documentElement.dataset.theme = stored === 'board' || stored === 'terminal' ? 'board' : 'timeline'
})()
