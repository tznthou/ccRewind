// Synchronous font-scale initialization — runs before React to prevent FOUC
(function () {
  var stored = localStorage.getItem('ccrewind-font-scale')
  var value = '1'
  if (stored === 'large') value = '1.1'
  else if (stored === 'xlarge') value = '1.25'
  document.documentElement.style.setProperty('--font-scale', value)
})()
