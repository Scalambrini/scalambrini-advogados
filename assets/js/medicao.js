/* Medição (Google Analytics 4 e Google Ads) com gerenciamento de consentimento
 * Scalambrini e Saraiva Advogados
 *
 * ESTADO ATUAL: DESATIVADO.
 * Enquanto GA4_ID e ADS_ID estiverem vazios, este arquivo não carrega nenhuma tag, não grava
 * cookies, não exibe aviso de cookies e não envia dados a terceiros.
 *
 * Ao preencher os identificadores (veja o guia de ativação):
 *  - o aviso de cookies passa a ser exibido, com "Aceitar" e "Recusar" de mesmo destaque;
 *  - nenhuma tag do Google é carregada antes da escolha do visitante;
 *  - "Análise" libera o GA4; "Publicidade" libera o Google Ads e a captura do identificador
 *    do clique no anúncio (GCLID), usado depois para importar contatos qualificados;
 *  - a escolha pode ser revista a qualquer momento pelo link "Preferências de cookies" no rodapé.
 *
 * Eventos registrados (somente com consentimento):
 *  - generate_lead        envio do formulário CONFIRMADO pela Formspree (não conta cliques)
 *  - clique_whatsapp      clique em link do WhatsApp (parâmetro "posicao" indica qual botão)
 *  - clique_telefone      clique em link de telefone
 *  - clique_email         clique em link de e-mail
 *  - formulario_iniciado  primeira digitação em um formulário
 *  - "Contato qualificado" NÃO é registrado no site: é importado depois no Google Ads pelo
 *    escritório, a partir do GCLID recebido no formulário (planilha de conversões offline).
 */
(function () {
  'use strict';

  var CONFIG = {
    GA4_ID: '',                 // ID de métricas do GA4, no formato G-XXXXXXXXXX
    ADS_ID: '',                 // ID de conversão do Google Ads, no formato AW-XXXXXXXXXX
    ADS_ROTULO_FORMULARIO: '',  // rótulo da ação de conversão "Formulário enviado" (principal)
    ADS_ROTULO_WHATSAPP: '',    // rótulo da ação "Clique no WhatsApp" (secundária) — opcional
    ADS_ROTULO_TELEFONE: ''     // rótulo da ação "Clique no telefone" (secundária) — opcional
  };

  var CHAVE = 'scalambrini-consentimento';
  var VERSAO = 1;
  var VALIDADE_DIAS = 365;
  var EN = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
  var temAnalise = !!CONFIG.GA4_ID;
  var temPublicidade = !!CONFIG.ADS_ID;
  var ativo = temAnalise || temPublicidade;
  var gtagCarregado = false;

  var T = EN ? {
    regiao: 'Cookie preferences',
    titulo: 'Cookies and measurement',
    texto: 'With your permission, this website uses ' + (temAnalise ? 'analytics cookies (Google Analytics)' : '') + (temAnalise && temPublicidade ? ' and ' : '') + (temPublicidade ? 'advertising cookies (Google Ads)' : '') + ' to measure how the site and its campaigns perform. Declining does not affect your browsing.',
    politica: 'Privacy Policy',
    politicaUrl: '/en/privacy.html#cookies',
    analise: 'Analytics (Google Analytics)',
    publicidade: 'Advertising measurement (Google Ads)',
    recusar: 'Decline',
    aceitar: 'Accept',
    personalizar: 'Customize',
    salvar: 'Save choices'
  } : {
    regiao: 'Preferências de cookies',
    titulo: 'Cookies e medição',
    texto: 'Com a sua autorização, este site usa ' + (temAnalise ? 'cookies de análise (Google Analytics)' : '') + (temAnalise && temPublicidade ? ' e ' : '') + (temPublicidade ? 'cookies de publicidade (Google Ads)' : '') + ' para medir o desempenho do site e das campanhas. A recusa não prejudica a navegação.',
    politica: 'Política de Privacidade',
    politicaUrl: '/privacidade.html#cookies',
    analise: 'Análise (Google Analytics)',
    publicidade: 'Medição de publicidade (Google Ads)',
    recusar: 'Recusar',
    aceitar: 'Aceitar',
    personalizar: 'Personalizar',
    salvar: 'Salvar escolhas'
  };

  /* ---------- consentimento ---------- */

  function lerConsentimento() {
    try {
      var c = JSON.parse(window.localStorage.getItem(CHAVE) || 'null');
      if (!c || c.v !== VERSAO || !c.data) return null;
      if ((Date.now() - new Date(c.data).getTime()) / 86400000 > VALIDADE_DIAS) return null;
      return { analise: !!c.analise && temAnalise, publicidade: !!c.publicidade && temPublicidade };
    } catch (e) {
      return null;
    }
  }

  function gravarConsentimento(analise, publicidade) {
    var anterior = lerConsentimento();
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify({ v: VERSAO, analise: !!analise, publicidade: !!publicidade, data: new Date().toISOString() }));
    } catch (e) { /* navegação privada: a escolha vale só para esta página */ }
    var revogou = anterior && ((anterior.analise && !analise) || (anterior.publicidade && !publicidade));
    if (revogou) {
      apagarCookiesGoogle();
      if (gtagCarregado) { window.location.reload(); return; }
    }
    aplicar({ analise: !!analise && temAnalise, publicidade: !!publicidade && temPublicidade });
  }

  function apagarCookiesGoogle() {
    try { window.sessionStorage.removeItem('scalambrini-anuncio'); } catch (e) { /* sem armazenamento */ }
    var host = window.location.hostname;
    var dominios = ['', host, '.' + host, '.' + host.replace(/^www\./, '')];
    document.cookie.split(';').forEach(function (par) {
      var nome = par.split('=')[0].trim();
      if (!/^(_ga|_gid|_gat|_gcl)/.test(nome)) return;
      dominios.forEach(function (d) {
        document.cookie = nome + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
  }

  /* ---------- Google tag ---------- */

  function gtag() { window.dataLayer.push(arguments); }

  function carregarGtag(c) {
    if (gtagCarregado) {
      gtag('consent', 'update', estadoConsentimento(c));
      return;
    }
    gtagCarregado = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = gtag;
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    gtag('consent', 'update', estadoConsentimento(c));
    gtag('js', new Date());
    if (temAnalise && c.analise) gtag('config', CONFIG.GA4_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
    if (temPublicidade && c.publicidade) gtag('config', CONFIG.ADS_ID, { allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CONFIG.GA4_ID || CONFIG.ADS_ID);
    document.head.appendChild(s);
  }

  function estadoConsentimento(c) {
    return {
      analytics_storage: c.analise ? 'granted' : 'denied',
      ad_storage: c.publicidade ? 'granted' : 'denied',
      ad_user_data: c.publicidade ? 'granted' : 'denied',
      ad_personalization: 'denied' // sem remarketing nem anúncios personalizados
    };
  }

  function aplicar(c) {
    if (c.publicidade) guardarIdentificadoresAnuncio();
    if (c.analise || c.publicidade) carregarGtag(c);
  }

  /* ---------- identificadores de clique em anúncio (somente com consentimento de publicidade) ---------- */

  function idsDaUrl() {
    var p;
    try { p = new URLSearchParams(window.location.search); } catch (e) { return {}; }
    var ids = {};
    ['gclid', 'gbraid', 'wbraid'].forEach(function (k) {
      var v = p.get(k);
      if (v && /^[\w-]{1,200}$/.test(v)) ids[k] = v;
    });
    return ids;
  }

  function guardarIdentificadoresAnuncio() {
    var ids = idsDaUrl();
    if (!ids.gclid && !ids.gbraid && !ids.wbraid) return;
    try { window.sessionStorage.setItem('scalambrini-anuncio', JSON.stringify(ids)); } catch (e) { /* sem armazenamento */ }
  }

  function identificadoresAnuncio() {
    var c = lerConsentimento();
    if (!c || !c.publicidade) return {};
    var ids = idsDaUrl();
    if (ids.gclid || ids.gbraid || ids.wbraid) return ids;
    try { return JSON.parse(window.sessionStorage.getItem('scalambrini-anuncio') || '{}') || {}; } catch (e) { return {}; }
  }

  /* ---------- eventos ---------- */

  function registrar(evento, params) {
    if (!ativo) return;
    var c = lerConsentimento();
    if (!c || !(c.analise || c.publicidade)) return;
    carregarGtag(c);
    var dados = { pagina: window.location.pathname, transport_type: 'beacon' };
    var k;
    for (k in (params || {})) if (Object.prototype.hasOwnProperty.call(params, k)) dados[k] = params[k];
    if (temAnalise && c.analise) {
      dados.send_to = CONFIG.GA4_ID;
      gtag('event', evento, dados);
    }
    var rotulo = {
      generate_lead: CONFIG.ADS_ROTULO_FORMULARIO,
      clique_whatsapp: CONFIG.ADS_ROTULO_WHATSAPP,
      clique_telefone: CONFIG.ADS_ROTULO_TELEFONE
    }[evento];
    if (temPublicidade && c.publicidade && rotulo) {
      gtag('event', 'conversion', { send_to: CONFIG.ADS_ID + '/' + rotulo, transport_type: 'beacon' });
    }
  }

  function posicao(a) {
    return a.getAttribute('data-posicao') || (a.closest('footer') ? 'rodape' : a.closest('header, .barra-topo') ? 'topo' : 'conteudo');
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var h = a.getAttribute('href') || '';
    if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(h)) registrar('clique_whatsapp', { posicao: posicao(a) });
    else if (h.indexOf('tel:') === 0) registrar('clique_telefone', { posicao: posicao(a) });
    else if (h.indexOf('mailto:') === 0) registrar('clique_email', { posicao: posicao(a) });
  }, true);

  document.addEventListener('scalambrini:formulario-iniciado', function (e) {
    registrar('formulario_iniciado', { formulario: (e.detail && e.detail.formulario) || '' });
  });

  document.addEventListener('scalambrini:formulario-enviado', function (e) {
    var d = e.detail || {};
    registrar('generate_lead', { formulario: d.formulario || '', area_interesse: d.area || '', lead_source: 'formulario_site' });
  });

  /* ---------- aviso de cookies ---------- */

  var aviso = null;

  function estilos() {
    if (document.getElementById('cs-estilos')) return;
    var css = '' +
      '.cs-aviso{position:fixed;left:0;right:0;bottom:0;z-index:60;padding:12px;font-family:Poppins,"Helvetica Neue",Arial,sans-serif}' +
      '.cs-caixa{max-width:760px;margin:0 auto;padding:20px 22px;background:#FFFFFF;color:#1F2328;border:1px solid #D9DDE3;border-top:3px solid #B89359;border-radius:12px;box-shadow:0 10px 30px rgba(19,26,44,.18);display:flex;flex-direction:column;gap:12px}' +
      '.cs-titulo{margin:0;font-size:16px;font-weight:600;color:#131A2C}' +
      '.cs-texto{margin:0;font-size:14px;line-height:1.6}' +
      '.cs-texto a{color:#8A6A33}' +
      '.cs-opcoes{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;border:0}' +
      '.cs-opcoes[hidden]{display:none}' +
      '.cs-aviso .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
      '.cs-opcoes label{display:flex;align-items:center;gap:10px;min-height:32px;font-size:14px}' +
      '.cs-opcoes input{width:18px;height:18px;accent-color:#131A2C}' +
      '.cs-botoes{display:flex;flex-wrap:wrap;gap:10px}' +
      '.cs-botoes button{flex:1 1 140px;min-height:46px;padding:0 18px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}' +
      '.cs-principal{background:#131A2C;color:#FFFFFF;border:1px solid #131A2C}' +
      '.cs-secundario{background:#FFFFFF;color:#131A2C;border:1px solid #131A2C}' +
      '.cs-aviso button:focus-visible,.cs-aviso a:focus-visible,.cs-aviso input:focus-visible{outline:2px solid #8A6A33;outline-offset:2px}';
    var st = document.createElement('style');
    st.id = 'cs-estilos';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function opcao(nome, rotulo, marcado) {
    return '<label><input type="checkbox" name="' + nome + '"' + (marcado ? ' checked' : '') + '> ' + rotulo + '</label>';
  }

  function mostrarAviso(personalizando) {
    estilos();
    if (aviso) aviso.remove();
    var atual = lerConsentimento() || { analise: false, publicidade: false };
    aviso = document.createElement('div');
    aviso.className = 'cs-aviso';
    aviso.setAttribute('role', 'region');
    aviso.setAttribute('aria-label', T.regiao);
    aviso.innerHTML =
      '<div class="cs-caixa">' +
        '<p class="cs-titulo">' + T.titulo + '</p>' +
        '<p class="cs-texto">' + T.texto + ' <a href="' + T.politicaUrl + '">' + T.politica + '</a>.</p>' +
        '<fieldset class="cs-opcoes"' + (personalizando ? '' : ' hidden') + '>' +
          '<legend class="sr-only">' + T.personalizar + '</legend>' +
          (temAnalise ? opcao('analise', T.analise, atual.analise) : '') +
          (temPublicidade ? opcao('publicidade', T.publicidade, atual.publicidade) : '') +
        '</fieldset>' +
        '<div class="cs-botoes">' +
          '<button type="button" class="cs-principal" data-cs="recusar">' + T.recusar + '</button>' +
          (personalizando
            ? '<button type="button" class="cs-principal" data-cs="salvar">' + T.salvar + '</button>'
            : '<button type="button" class="cs-secundario" data-cs="personalizar">' + T.personalizar + '</button>') +
          '<button type="button" class="cs-principal" data-cs="aceitar">' + T.aceitar + '</button>' +
        '</div>' +
      '</div>';
    aviso.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-cs]') : null;
      if (!b) return;
      var acao = b.getAttribute('data-cs');
      if (acao === 'personalizar') { mostrarAviso(true); return; }
      if (acao === 'aceitar') gravarConsentimento(true, true);
      else if (acao === 'recusar') gravarConsentimento(false, false);
      else if (acao === 'salvar') {
        var a = aviso.querySelector('input[name="analise"]');
        var p = aviso.querySelector('input[name="publicidade"]');
        gravarConsentimento(a ? a.checked : false, p ? p.checked : false);
      }
      fecharAviso();
    });
    document.body.appendChild(aviso);
    if (personalizando) {
      var primeiro = aviso.querySelector('input');
      if (primeiro) primeiro.focus();
    }
  }

  function fecharAviso() {
    if (aviso) { aviso.remove(); aviso = null; }
  }

  /* ---------- interface pública ---------- */

  window.ScalambriniMedicao = {
    ativo: ativo,
    consentimento: lerConsentimento,
    abrirPreferencias: function () { if (ativo) mostrarAviso(true); },
    identificadoresAnuncio: identificadoresAnuncio
  };

  if (!ativo) return;

  function iniciar() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-preferencias-cookies]'), function (b) {
      b.hidden = false;
      b.addEventListener('click', function () { mostrarAviso(true); });
    });
    var c = lerConsentimento();
    if (c) aplicar(c);
    else mostrarAviso(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
