/* Botão para recolher/expandir o menu lateral (.side-nav). Roda de forma
 * independente do carregamento do CSV/candidatos, e lembra a preferência
 * do usuário entre visitas via localStorage. */
(function () {
  var STORAGE_KEY = "miner-testdome-nav-collapsed";
  var shell = document.querySelector(".shell");
  var toggle = document.getElementById("nav-toggle");
  if (!shell || !toggle) return;

  function apply(collapsed) {
    shell.classList.toggle("nav-collapsed", collapsed);
    var label = collapsed ? "Expandir menu" : "Recolher menu";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  }

  var saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  apply(saved === "1");

  toggle.addEventListener("click", function () {
    var collapsed = !shell.classList.contains("nav-collapsed");
    apply(collapsed);
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch (e) {}
  });
})();
