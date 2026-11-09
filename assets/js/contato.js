/* Formulário de contato — Scalambrini e Saraiva Advogados
 *
 * CONFIGURAÇÃO
 * FORMSPREE_ID é o identificador do formulário criado no painel da Formspree
 * (a parte final do endereço https://formspree.io/f/IDENTIFICADOR). Formulário do escritório:
 * https://formspree.io/f/mvkknzno. O identificador não é senha: ele aparece no código de
 * qualquer formulário publicado.
 *
 * Se FORMSPREE_ID for esvaziado, o formulário volta a funcionar como antes:
 * valida os campos e abre o programa de e-mail do visitante com a mensagem pronta.
 *
 * Proteções: campo-isca "_gotcha" (envios que o preenchem são descartados pela Formspree)
 * e os filtros automáticos da própria Formspree. Não há bloqueio por tempo de preenchimento.
 *
 * Transferência internacional (art. 33, VIII, da LGPD): com a Formspree configurada, o envio
 * exige a caixa de autorização específica e em destaque; a data e a hora da autorização seguem
 * com a mensagem. Sem a autorização marcada — ou se a caixa não existir no formulário —, nenhum
 * dado é enviado à Formspree. Sem a Formspree configurada, a caixa fica oculta, pois não há
 * transferência. O botão "Enviar" vem desativado no HTML e só é ativado por este script, para
 * que o formulário não possa ser submetido sem as validações.
 */
(function () {
  'use strict';

  var FORMSPREE_ID = 'mvkknzno';

  var EMAIL_ESCRITORIO = 'contato@scalambrini.com';
  var WHATSAPP = '5511964056680';
  var EN = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;

  var T = EN ? {
    nome: 'Please enter your name.',
    empresa: 'Please enter your company name.',
    emailVazio: 'Please enter your email address.',
    emailInvalido: 'Please enter a valid email address, such as name@company.com.',
    telefone: 'Please enter the phone number with area code, or leave it blank.',
    area: 'Please select an area of interest.',
    resumo: 'Please keep the summary within 600 characters.',
    consentimento: 'To send this form, please tick the authorization box, or contact the firm by WhatsApp or email.',
    corrija: 'Please review the highlighted fields.',
    enviando: 'Sending…',
    caracteres: function (n) { return n + ' of 600 characters'; },
    falha: 'We could not send your message right now. Your information is still in the form. You can try again, or contact the firm',
    porWhats: 'on WhatsApp',
    porEmail: 'by email (message ready to send)',
    ou: ' or ',
    abrindoEmail: 'Your email program will open with the message ready to send. If nothing happens, write to ',
    assunto: 'Website contact',
    whatsFalha: 'Hello, I tried to send the contact form on the website and would like to speak with the firm.',
    rotulos: { nome: 'Name', empresa: 'Company', email: 'Email', telefone: 'Phone', area: 'Area of interest', resumo: 'Summary' }
  } : {
    nome: 'Informe seu nome.',
    empresa: 'Informe o nome da empresa.',
    emailVazio: 'Informe seu e-mail.',
    emailInvalido: 'Informe um e-mail válido, como nome@empresa.com.br.',
    telefone: 'Informe o telefone com DDD ou deixe o campo em branco.',
    area: 'Selecione a área de interesse.',
    resumo: 'O resumo deve ter até 600 caracteres.',
    consentimento: 'Para enviar pelo formulário, marque a autorização. Se preferir, fale com o escritório pelo WhatsApp ou por e-mail.',
    corrija: 'Revise os campos destacados.',
    enviando: 'Enviando…',
    caracteres: function (n) { return n + ' de 600 caracteres'; },
    falha: 'Não foi possível enviar sua mensagem agora. Os dados continuam no formulário. Você pode tentar novamente ou falar com o escritório',
    porWhats: 'pelo WhatsApp',
    porEmail: 'por e-mail (mensagem pronta)',
    ou: ' ou ',
    abrindoEmail: 'Seu programa de e-mail será aberto com a mensagem pronta. Se nada acontecer, escreva para ',
    assunto: 'Contato pelo site',
    whatsFalha: 'Olá, tentei enviar o formulário do site e gostaria de falar com o escritório.',
    rotulos: { nome: 'Nome', empresa: 'Empresa', email: 'E-mail', telefone: 'Telefone', area: 'Área de interesse', resumo: 'Resumo do assunto' }
  };

  var PROVEDORES_PESSOAIS = [
    'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
    'live.com', 'msn.com', 'yahoo.com', 'yahoo.com.br', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
    'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com', 'r7.com',
    'zipmail.com.br', 'protonmail.com', 'proton.me', 'aol.com', 'gmx.com'
  ];

  function emitir(nome, detalhe) {
    var ev;
    try {
      ev = new CustomEvent(nome, { detail: detalhe });
    } catch (e) {
      ev = document.createEvent('CustomEvent');
      ev.initCustomEvent(nome, false, false, detalhe);
    }
    document.dispatchEvent(ev);
  }

  function iniciar(form) {
    var nomeFormulario = form.getAttribute('data-formulario') || 'contato';
    var campos = form.querySelector('.form-campos') || form;
    var sucesso = form.querySelector('.form-sucesso');
    var status = form.querySelector('.form-status');
    var botao = form.querySelector('.botao-enviar');
    var textoBotao = botao ? botao.textContent : '';
    var resumo = form.elements.resumo;
    var contador = form.querySelector('.contador');
    var iniciado = false;
    var enviando = false;
    var consentimento = form.querySelector('[data-consentimento-formspree]');

    if (botao) botao.disabled = false;

    if (consentimento && !FORMSPREE_ID) {
      // sem Formspree configurada não há transferência internacional: a autorização não se aplica
      consentimento.hidden = true;
      Array.prototype.forEach.call(consentimento.querySelectorAll('input'), function (el) {
        el.required = false;
        el.disabled = true;
      });
    }

    function valor(n) {
      var el = form.elements[n];
      return el && el.value ? String(el.value).trim() : '';
    }

    function erroDe(el) {
      return el && el.id ? document.getElementById('erro-' + el.id) : null;
    }

    function mensagem(el) {
      if (el.type === 'checkbox') return el.required && !el.checked ? T.consentimento : '';
      var v = (el.value || '').trim();
      if (el.name === 'telefone') {
        if (!v) return '';
        var digitos = v.replace(/\D/g, '');
        return digitos.length >= 10 && digitos.length <= 13 ? '' : T.telefone;
      }
      if (el.required && !v) {
        if (el.name === 'email') return T.emailVazio;
        return T[el.name] || T.corrija;
      }
      if (el.name === 'email' && v && (el.validity.typeMismatch || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v))) return T.emailInvalido;
      if (el.name === 'resumo' && v.length > 600) return T.resumo;
      return '';
    }

    function marcar(el, msg) {
      var alvo = erroDe(el);
      if (msg) {
        el.setAttribute('aria-invalid', 'true');
        if (alvo) { alvo.textContent = msg; alvo.hidden = false; }
      } else {
        el.removeAttribute('aria-invalid');
        if (alvo) { alvo.textContent = ''; alvo.hidden = true; }
      }
    }

    function validaveis() {
      return Array.prototype.filter.call(form.elements, function (el) {
        return el.name && el.name.charAt(0) !== '_' && el.type !== 'hidden' && el.type !== 'submit' && !el.disabled && !el.closest('.isca');
      });
    }

    function validar(focar) {
      var primeiro = null;
      validaveis().forEach(function (el) {
        var msg = mensagem(el);
        marcar(el, msg);
        if (msg && !primeiro) primeiro = el;
      });
      if (primeiro && focar) primeiro.focus();
      return !primeiro;
    }

    validaveis().forEach(function (el) {
      el.addEventListener('blur', function () {
        if ((el.type !== 'checkbox' && el.value) || el.getAttribute('aria-invalid')) marcar(el, mensagem(el));
      });
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', function () {
        if (el.getAttribute('aria-invalid')) marcar(el, mensagem(el));
        if (!iniciado) {
          iniciado = true;
          emitir('scalambrini:formulario-iniciado', { formulario: nomeFormulario });
        }
      });
    });

    if (resumo && contador) {
      var atualizar = function () { contador.textContent = T.caracteres(resumo.value.length); };
      resumo.addEventListener('input', atualizar);
      atualizar();
    }

    function tipoEmail(email) {
      var dominio = (email.split('@')[1] || '').toLowerCase();
      if (!dominio) return '';
      return PROVEDORES_PESSOAIS.indexOf(dominio) >= 0 ? 'pessoal' : 'corporativo';
    }

    function origemCampanha() {
      var p;
      try { p = new URLSearchParams(window.location.search); } catch (e) { return ''; }
      var partes = [];
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        var v = p.get(k);
        if (v) partes.push(k + '=' + v.slice(0, 120));
      });
      return partes.join('; ');
    }

    function definirOculto(nome, v) {
      var el = form.elements[nome];
      if (!el) {
        el = document.createElement('input');
        el.type = 'hidden';
        el.name = nome;
        form.appendChild(el);
      }
      el.value = v || '';
    }

    function preencherOcultos() {
      definirOculto('pagina', window.location.pathname);
      definirOculto('idioma', EN ? 'en' : 'pt-BR');
      definirOculto('origem_campanha', origemCampanha());
      definirOculto('tipo_email', tipoEmail(valor('email')));
      var ids = (window.ScalambriniMedicao && window.ScalambriniMedicao.identificadoresAnuncio && window.ScalambriniMedicao.identificadoresAnuncio()) || {};
      definirOculto('gclid', ids.gclid);
      definirOculto('gbraid', ids.gbraid);
      definirOculto('wbraid', ids.wbraid);
      var caixa = form.elements.consentimento_transferencia_internacional;
      definirOculto('consentimento_transferencia_registro', caixa && caixa.checked && !caixa.disabled
        ? new Date().toISOString() + ' · texto do formulário de 09/11/2026 (art. 33, VIII, LGPD)'
        : '');
      var assunto = T.assunto + ' — ' + (valor('area') || '-') + (valor('empresa') ? ' — ' + valor('empresa') : '');
      definirOculto('_subject', assunto);
    }

    function corpoEmail() {
      var r = T.rotulos;
      return [
        r.nome + ': ' + valor('nome'),
        r.empresa + ': ' + valor('empresa'),
        r.email + ': ' + valor('email'),
        r.telefone + ': ' + valor('telefone'),
        r.area + ': ' + valor('area'),
        '',
        r.resumo + ':',
        valor('resumo')
      ].join('\n');
    }

    function linkEmail() {
      return 'mailto:' + EMAIL_ESCRITORIO + '?subject=' + encodeURIComponent(T.assunto + ' — ' + (valor('area') || '')) + '&body=' + encodeURIComponent(corpoEmail());
    }

    function mostrarStatus(tipo, conteudo) {
      if (!status) return;
      status.className = 'form-status ' + tipo;
      status.innerHTML = '';
      if (typeof conteudo === 'string') status.textContent = conteudo;
      else status.appendChild(conteudo);
      status.hidden = false;
    }

    function ocultarStatus() {
      if (status) { status.hidden = true; status.textContent = ''; }
    }

    function bloquear(sim) {
      enviando = sim;
      if (!botao) return;
      botao.disabled = sim;
      botao.textContent = sim ? T.enviando : textoBotao;
    }

    function concluir() {
      bloquear(false);
      emitir('scalambrini:formulario-enviado', { formulario: nomeFormulario, area: valor('area') });
      form.reset();
      if (contador && resumo) contador.textContent = T.caracteres(0);
      if (sucesso) {
        campos.hidden = true;
        sucesso.hidden = false;
        var titulo = sucesso.querySelector('h3');
        if (titulo) { titulo.setAttribute('tabindex', '-1'); titulo.focus(); }
      }
    }

    function falhar() {
      bloquear(false);
      var frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(T.falha + ' '));
      var w = document.createElement('a');
      w.href = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(T.whatsFalha);
      w.textContent = T.porWhats;
      w.setAttribute('data-posicao', 'formulario-erro');
      frag.appendChild(w);
      frag.appendChild(document.createTextNode(T.ou));
      var m = document.createElement('a');
      m.href = linkEmail();
      m.textContent = T.porEmail;
      m.setAttribute('data-posicao', 'formulario-erro');
      frag.appendChild(m);
      frag.appendChild(document.createTextNode('.'));
      mostrarStatus('erro', frag);
    }

    function autorizado() {
      var caixa = form.elements.consentimento_transferencia_internacional;
      return !!(caixa && caixa.type === 'checkbox' && caixa.checked && !caixa.disabled);
    }

    function enviarFormspree() {
      if (!autorizado()) return; // salvaguarda: nunca envia à Formspree sem a autorização
      bloquear(true);
      ocultarStatus();
      var controle = typeof AbortController === 'function' ? new AbortController() : null;
      var limite = controle ? setTimeout(function () { controle.abort(); }, 20000) : null;
      fetch('https://formspree.io/f/' + encodeURIComponent(FORMSPREE_ID), {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
        signal: controle ? controle.signal : undefined
      }).then(function (resposta) {
        if (limite) clearTimeout(limite);
        if (resposta.ok) concluir();
        else falhar();
      }).catch(function () {
        if (limite) clearTimeout(limite);
        falhar();
      });
    }

    function abrirEmail() {
      var frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(T.abrindoEmail));
      var m = document.createElement('a');
      m.href = 'mailto:' + EMAIL_ESCRITORIO;
      m.textContent = EMAIL_ESCRITORIO;
      frag.appendChild(m);
      frag.appendChild(document.createTextNode('.'));
      mostrarStatus('info', frag);
      window.location.href = linkEmail();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (enviando) return;
      if (!validar(true)) {
        mostrarStatus('erro', T.corrija);
        return;
      }
      if (FORMSPREE_ID && !autorizado()) {
        mostrarStatus('erro', T.consentimento);
        return;
      }
      ocultarStatus();
      preencherOcultos();
      if (FORMSPREE_ID) enviarFormspree();
      else abrirEmail();
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('form[data-contato]'), iniciar);
})();
