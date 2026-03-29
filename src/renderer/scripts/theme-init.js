// Synchronous theme initialization — runs before React to prevent FOUC
document.documentElement.dataset.theme = localStorage.getItem('ccrewind-theme') || 'timeline'
