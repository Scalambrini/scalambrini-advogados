/* Navegação — Scalambrini e Saraiva Advogados
   Menu compacto no celular: abre e fecha a lista de seções; fecha ao escolher um item ou ao pressionar Esc. */
(function () {
  'use strict';
  var botao = document.querySelector('.menu-botao');
  var menu = document.getElementById('menu-principal');
  if (!botao || !menu) return;

  function definir(aberto) {
    botao.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    menu.classList.toggle('aberto', aberto);
  }

  botao.addEventListener('click', function () {
    definir(botao.getAttribute('aria-expanded') !== 'true');
  });

  menu.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a')) definir(false);
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && botao.getAttribute('aria-expanded') === 'true') {
      definir(false);
      botao.focus();
    }
  });
})();
