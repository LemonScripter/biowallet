var lang = navigator.language && navigator.language.startsWith('hu') ? 'hu' : 'en';
function applyLang() {
  document.querySelectorAll('.lang-en').forEach(function(el) { el.style.display = lang === 'en' ? '' : 'none'; });
  document.querySelectorAll('.lang-hu').forEach(function(el) { el.style.display = lang === 'hu' ? '' : 'none'; });
  var btn = document.getElementById('lang-btn');
  if (btn) btn.textContent = lang === 'en' ? 'HU' : 'EN';
  document.documentElement.lang = lang;
}
function toggleLang() { lang = lang === 'en' ? 'hu' : 'en'; applyLang(); }
applyLang();
