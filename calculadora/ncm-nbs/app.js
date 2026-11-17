/* Calculadora de IBS e CBS por NCM e NBS — Scalambrini e Saraiva Advogados
 * Interface da calculadora. O cálculo fica em motor.js (adaptado do código aberto da
 * Receita Federal, licença MIT); as tabelas, em dados/*.json (geradas por .github/rfb/gerar_dados.py). */
(function () {
  'use strict';

  var Motor = window.MotorIbsCbs, D = Motor.D;
  var $ = function (id) { return document.getElementById(id); };
  var WHATSAPP = '5511964056680';
  var ANOS = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033];
  var REF_CBS = 11.3, REF_IBS = 18.7; // mesmas premissas do Simulador da transição (/calculadora/)
  var F_IBS = { 2029: 0.1, 2030: 0.2, 2031: 0.3, 2032: 0.4, 2033: 1 };
  var CST_SUPORTADOS = ['000', '010', '011', '200', '221', '222', '400', '410', '510', '515'];
  var ROTULO_CST = {
    '000': 'Tributação integral — situações específicas', '010': 'Alíquotas uniformes setoriais',
    '011': 'Alíquotas uniformes reduzidas', '200': 'Alíquota reduzida', '221': 'Alíquota fixa proporcional',
    '222': 'Redução de base de cálculo', '400': 'Isenção', '410': 'Imunidade e não incidência',
    '510': 'Diferimento', '515': 'Diferimento com redução de alíquota'
  };
  var ORDEM_CST = ['000', '200', '011', '010', '222', '221', '510', '515', '400', '410'];
  var UF_PADRAO = '35', MUN_PADRAO = '3550308';

  var base = null, motor = null, municipios = null;
  var listas = { ncm: null, nbs: null }, carregandoLista = {};
  var estado = { tipo: 'ncm', item: null, clId: null, ano: 2026, valor: '1000', cbs: null, ibs: null, uf: UF_PADRAO, mun: MUN_PADRAO };
  var opcoesAtuais = null, ultimo = null;

  // ---------- formatação ----------
  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function moeda(x) { return brl.format(Number(new D(x || 0).toDecimalPlaces(2, D.ROUND_HALF_EVEN).toString())); }
  function pct(x, sufixo) {
    if (x === null || x === undefined) return '—';
    var s = new D(x).toDecimalPlaces(4, D.ROUND_HALF_EVEN).toFixed(4).replace(/0+$/, '');
    var p = s.split('.');
    if (!p[1] || p[1].length < 2) s = new D(s).toFixed(2);
    return s.replace('.', ',') + (sufixo === false ? '' : '%');
  }
  function reducaoTxt(r) { return r && r.gt(0) ? pct(r).replace(/,00%$/, '%') : '—'; }
  function numeroBr(x, casas) { return new D(x).toDecimalPlaces(casas, D.ROUND_HALF_EVEN).toNumber().toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); }
  function lerNumero(txt) {
    var s = String(txt || '').replace(/[^\d,.\-]/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var n = Number(s);
    return isFinite(n) && n >= 0 ? s : null;
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function limparDesc(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/^[\s\-–—]+/, '').replace(/[:;]\s*$/, '').trim(); }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
  function codigoFmt(tipo, cd) {
    if (tipo === 'ncm') return cd.length === 8 ? cd.slice(0, 4) + '.' + cd.slice(4, 6) + '.' + cd.slice(6) : cd;
    return cd.length === 9 ? cd.slice(0, 1) + '.' + cd.slice(1, 5) + '.' + cd.slice(5, 7) + '.' + cd.slice(7) : cd;
  }
  function tituloUf(n) {
    return String(n).toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); })
      .replace(/\s(De|Do|Da|Dos|Das|E)\s/g, function (m) { return m.toLowerCase(); });
  }
  function hojeIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dataOperacao(ano) {
    var hoje = hojeIso(), a = Number(hoje.slice(0, 4));
    if (ano === a) return hoje;
    return ano < a ? ano + '-12-31' : ano + '-01-01';
  }
  function dataBr(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }

  // ---------- carga de dados ----------
  function carregar(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('Falha ao carregar ' + url);
      return r.json();
    });
  }

  function prepararLista(tipo, dados) {
    var mapa = {}, folhas = [], tam = tipo === 'ncm' ? 8 : 9;
    dados.forEach(function (l) { mapa[l[0]] = l[1]; });
    dados.forEach(function (l) {
      var cd = l[0];
      if (cd.length !== tam) return;
      var pais = [];
      // Na tabela NBS, os capítulos 1.10 e 1.20 aparecem como "11" e "12": só valem para códigos 110… e 120…
      for (var k = 2; k < tam; k++) {
        if (tipo === 'nbs' && k === 2 && cd.charAt(2) !== '0') continue;
        var p = mapa[cd.slice(0, k)];
        if (p) pais.push(limparDesc(p));
      }
      var propria = limparDesc(l[1]);
      var generica = /^(outr[oa]s?|demais)\b/i.test(propria) || propria.length < 14;
      var pai = pais.length ? pais[pais.length - 1] : '';
      var titulo = generica && pai ? propria + ' — ' + pai : propria;
      var ctx = tipo === 'ncm' ? (mapa[cd.slice(0, 4)] ? limparDesc(mapa[cd.slice(0, 4)]) : '') : (pais[0] || '');
      folhas.push({ cd: cd, titulo: titulo, ctx: ctx, n: norm(propria), np: norm(pais.join(' ')) });
    });
    return folhas;
  }

  function garantirLista(tipo) {
    if (listas[tipo]) return Promise.resolve(listas[tipo]);
    if (!carregandoLista[tipo]) {
      carregandoLista[tipo] = carregar('dados/' + tipo + '.json').then(function (d) {
        listas[tipo] = prepararLista(tipo, d);
        return listas[tipo];
      });
    }
    return carregandoLista[tipo];
  }

  // ---------- busca ----------
  var busca = $('busca'), lista = $('lista'), ativo = -1, resultadosBusca = [], tBusca;

  function pesquisar(q) {
    var l = listas[estado.tipo];
    if (!l) return [];
    var dig = q.replace(/[\s.\-]/g, '');
    if (/^\d{2,}$/.test(dig)) {
      return l.filter(function (e) { return e.cd.indexOf(dig) === 0; }).slice(0, 60);
    }
    var termos = norm(q).split(/\s+/).filter(function (t) { return t.length >= 2; });
    if (!termos.length || norm(q).replace(/\s/g, '').length < 3) return [];
    var out = [];
    for (var k = 0; k < l.length; k++) {
      var e = l[k], sc = 0, ok = true;
      for (var j = 0; j < termos.length; j++) {
        var t = termos[j], ini = new RegExp('(^|[^a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (ini.test(e.n)) sc += 4;
        else if (e.n.indexOf(t) >= 0) sc += 2;
        else if (ini.test(e.np)) sc += 1;
        else if (e.np.indexOf(t) >= 0) sc += 0.5;
        else { ok = false; break; }
      }
      if (ok) out.push([sc, e]);
    }
    out.sort(function (a, b) { return b[0] - a[0] || (a[1].cd < b[1].cd ? -1 : 1); });
    return out.slice(0, 50).map(function (x) { return x[1]; });
  }

  function abrirLista(html) {
    lista.innerHTML = html;
    lista.hidden = false;
    busca.setAttribute('aria-expanded', 'true');
  }
  function fecharLista() {
    lista.hidden = true;
    busca.setAttribute('aria-expanded', 'false');
    busca.removeAttribute('aria-activedescendant');
    ativo = -1;
  }

  function atualizarBusca() {
    var q = busca.value.trim();
    if (q.length < 2) { fecharLista(); return; }
    if (!listas[estado.tipo]) {
      abrirLista('<li class="vazio" role="option" aria-disabled="true">Carregando a tabela ' + (estado.tipo === 'ncm' ? 'NCM' : 'NBS') + '…</li>');
      garantirLista(estado.tipo).then(atualizarBusca, function () {
        abrirLista('<li class="vazio" role="option" aria-disabled="true">Não foi possível carregar a tabela. Tente novamente.</li>');
      });
      return;
    }
    resultadosBusca = pesquisar(q);
    ativo = -1;
    if (!resultadosBusca.length) {
      abrirLista('<li class="vazio" role="option" aria-disabled="true">Nenhum código encontrado. Tente outra palavra ou os primeiros números do código.</li>');
      return;
    }
    abrirLista(resultadosBusca.map(function (e, i) {
      return '<li role="option" id="op-' + i + '" data-i="' + i + '" aria-selected="false"><span class="cod">' + codigoFmt(estado.tipo, e.cd) + '</span> ' +
        esc(trunc(e.titulo, 140)) + (e.ctx && e.ctx !== e.titulo ? '<span class="ctx">' + esc(trunc(e.ctx, 110)) + '</span>' : '') + '</li>';
    }).join(''));
  }

  function marcarAtivo(i) {
    var itens = lista.querySelectorAll('li[data-i]');
    if (!itens.length) return;
    ativo = (i + itens.length) % itens.length;
    itens.forEach(function (li, k) { li.setAttribute('aria-selected', k === ativo ? 'true' : 'false'); });
    itens[ativo].scrollIntoView({ block: 'nearest' });
    busca.setAttribute('aria-activedescendant', 'op-' + ativo);
  }

  busca.addEventListener('input', function () { clearTimeout(tBusca); tBusca = setTimeout(atualizarBusca, 120); });
  busca.addEventListener('focus', function () { garantirLista(estado.tipo); if (busca.value.trim().length >= 2) atualizarBusca(); });
  busca.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (lista.hidden) atualizarBusca(); else marcarAtivo(ativo + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); marcarAtivo(ativo - 1); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (!lista.hidden && resultadosBusca.length) escolherItem(resultadosBusca[ativo >= 0 ? ativo : 0]);
    } else if (ev.key === 'Escape') fecharLista();
  });
  busca.addEventListener('blur', function () { setTimeout(fecharLista, 180); });
  lista.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
  lista.addEventListener('click', function (ev) {
    var li = ev.target.closest('li[data-i]');
    if (li) escolherItem(resultadosBusca[Number(li.dataset.i)]);
  });

  function escolherItem(e, restaurando) {
    if (!e) return;
    estado.item = e;
    fecharLista();
    busca.value = '';
    $('esc-cod').textContent = codigoFmt(estado.tipo, e.cd);
    $('esc-desc').textContent = trunc(e.titulo, 160);
    $('esc-ctx').textContent = e.ctx && e.ctx !== e.titulo ? trunc(e.ctx, 140) : '';
    $('escolhido').hidden = false;
    busca.hidden = true;
    $('dica-busca').hidden = true;
    montarOpcoes(restaurando ? false : 'forcar');
    if (!restaurando) atualizar();
  }

  $('trocar').addEventListener('click', function () {
    $('escolhido').hidden = true;
    busca.hidden = false;
    $('dica-busca').hidden = false;
    busca.focus();
  });

  document.querySelectorAll('input[name=tipo]').forEach(function (r) {
    r.addEventListener('change', function () {
      estado.tipo = r.value;
      estado.item = null;
      estado.clId = null;
      $('rot-busca').textContent = r.value === 'ncm' ? 'Produto' : 'Serviço';
      busca.placeholder = r.value === 'ncm' ? 'Código ou descrição, ex.: arroz ou 1006.30' : 'Código ou descrição, ex.: consultoria ou 1.1403';
      $('escolhido').hidden = true;
      busca.hidden = false;
      $('dica-busca').hidden = false;
      busca.value = '';
      fecharLista();
      garantirLista(r.value);
      montarOpcoes(false);
      atualizar();
    });
  });

  // ---------- enquadramentos ----------
  function nomenclaturaAceita(nom, tipo) {
    return tipo === 'ncm' ? (nom === 'NCM' || nom === 'NBS ou NCM') : (nom === 'NBS' || nom === 'NBS ou NCM');
  }

  function calcularOpcoes() {
    if (!estado.item) return null;
    var data = dataOperacao(estado.ano), ano = estado.ano, tipo = estado.tipo, cod = estado.item.cd;
    var res = { esp: [], geral: [], outros: {} };
    base.class.forEach(function (c) {
      if (!Motor.vigente(c.i, c.f, data)) return;
      var st = base.cst[String(c.st)];
      if (!st || !Motor.vigente(st.i, st.f, data) || CST_SUPORTADOS.indexOf(st.cd) < 0) return;
      if (!nomenclaturaAceita(c.nom, tipo)) return;
      var tt = motor.tratamento(c, data);
      if (!tt || tt.aj || tt.mono) return;
      if (c.tipo === 'Fixa' || c.tipo === 'Uniforme setorial') {
        if (ano >= 2027 || motor.aliquotaDaClassificacao(c, 2, data) === null) return;
      } else if (c.tipo !== 'Sem alíquota' && ano === 2026 && motor.aliquotaReferencia(2, data) === null) return;
      var cr = motor.criticar(tipo, cod, c, data);
      if (cr.temAnexo && !cr.aceito) return;
      var o = { c: c, st: st, tt: tt, itens: cr.itens, especifico: cr.temAnexo };
      if (cr.temAnexo) res.esp.push(o);
      else if (c.cd === '000001') res.geral.push(o);
      else (res.outros[st.cd] = res.outros[st.cd] || []).push(o);
    });
    res.todos = res.esp.concat(res.geral);
    ORDEM_CST.forEach(function (k) { if (res.outros[k]) res.todos = res.todos.concat(res.outros[k]); });
    return res;
  }

  function resumoReducao(o) {
    var data = dataOperacao(estado.ano), red = motor.reducao(o.c, 2, data), cd = o.st.cd;
    if (cd === '400') return 'isenção';
    if (cd === '410') return 'imunidade ou não incidência';
    if (cd === '510') return 'diferimento';
    if (cd === '222') return 'redução de base';
    if (cd === '221' || cd === '010') return 'alíquota específica';
    if (red && red.gt(0)) return red.eq(100) ? 'alíquota zero' : 'redução de ' + pct(red).replace(',00', '');
    return 'alíquota cheia';
  }

  function rotuloOpcao(o) { return o.c.cd + ' · ' + trunc(o.c.d, 78) + ' — ' + resumoReducao(o); }

  function montarOpcoes(preferirEspecifico) {
    var sel = $('enquadramento');
    opcoesAtuais = calcularOpcoes();
    if (!opcoesAtuais) {
      sel.innerHTML = '<option>Escolha antes o produto ou o serviço</option>';
      sel.disabled = true;
      $('detalhe').hidden = true;
      return;
    }
    var o = opcoesAtuais, html = '';
    var grupo = function (rot, arr) {
      if (!arr || !arr.length) return '';
      return '<optgroup label="' + esc(rot) + '">' + arr.map(function (x) {
        return '<option value="' + x.c.id + '">' + esc(rotuloOpcao(x)) + '</option>';
      }).join('') + '</optgroup>';
    };
    html += grupo('Previstos nos anexos para este código (confira o item)', o.esp);
    html += grupo('Regra geral', o.geral);
    ORDEM_CST.forEach(function (k) { html += grupo('Outros · ' + (ROTULO_CST[k] || k) + ' (CST ' + k + ')', o.outros[k]); });
    sel.innerHTML = html;
    sel.disabled = false;

    // Novo código: sugere o enquadramento previsto nos anexos (ou a regra geral). Mudança de ano:
    // mantém a escolha, se ainda disponível.
    var ids = o.todos.map(function (x) { return x.c.id; });
    if (preferirEspecifico === 'forcar' || !(estado.clId && ids.indexOf(estado.clId) >= 0)) {
      var preferido = o.esp.filter(function (x) { return !/administra[cç][aã]o p[uú]blica|[oó]rg[aã]os? |emerg[eê]ncia|governo|\bTAC\b/i.test(x.c.d); })[0] || o.esp[0];
      if (!preferido) preferido = o.geral[0] || o.todos[0];
      estado.clId = preferido ? preferido.c.id : null;
    }
    if (estado.clId) sel.value = String(estado.clId);
    mostrarDetalhe();
  }

  function opcaoAtual() {
    if (!opcoesAtuais || !estado.clId) return null;
    for (var k = 0; k < opcoesAtuais.todos.length; k++) if (opcoesAtuais.todos[k].c.id === estado.clId) return opcoesAtuais.todos[k];
    return null;
  }

  function textoAnexo(id) {
    var a = base.anexos[String(id)];
    return a ? { rot: 'Anexo ' + a[0] + ' da LC 214/2025, item ' + a[1], txt: a[2] } : null;
  }

  function mostrarDetalhe() {
    var o = opcaoAtual(), box = $('detalhe');
    if (!o) { box.hidden = true; return; }
    var data = dataOperacao(estado.ano), f = motor.fundamentacao(o.c, data);
    var h = '<p><span class="etq">CST ' + esc(o.st.cd) + ' · ' + esc(o.st.d) + '</span></p>';
    h += '<p><strong>' + esc(o.c.cd) + '</strong> — ' + esc(o.c.d) + '</p>';
    o.itens.slice(0, 4).forEach(function (id) {
      var a = textoAnexo(id);
      if (a) h += '<p><span class="etq">' + esc(a.rot) + '</span><br>' + esc(a.txt) + '</p>';
    });
    if (!o.especifico && o.c.cd !== '000001') h += '<p>Este enquadramento depende das condições previstas na lei para a operação.</p>';
    if (f) h += '<details><summary>Fundamentação: ' + esc(f.curto) + '</summary><div class="lei">' + esc(f.txt) + '</div></details>';
    box.innerHTML = h;
    box.hidden = false;
  }

  $('enquadramento').addEventListener('change', function (ev) {
    estado.clId = Number(ev.target.value);
    mostrarDetalhe();
    atualizar();
  });

  // ---------- ano e alíquotas ----------
  function sugestao(ano) {
    if (ano <= 2026) return null;
    if (ano <= 2028) return { cbs: REF_CBS - 0.1, ibs: 0.1 };
    return { cbs: REF_CBS, ibs: Number((REF_IBS * F_IBS[ano]).toFixed(4)) };
  }

  function aplicarSugestao() {
    var s = sugestao(estado.ano);
    $('sec-aliq').hidden = !s;
    if (!s) { estado.cbs = estado.ibs = null; return; }
    estado.cbs = String(s.cbs);
    estado.ibs = String(s.ibs);
    $('cbsRef').value = pct(s.cbs, false);
    $('ibsRef').value = pct(s.ibs, false);
    $('dica-aliq').textContent = estado.ano <= 2028
      ? 'CBS: referência de 11,3% calculada pelo TCU para 2027, reduzida em 0,1 ponto percentual. IBS: 0,05% estadual e 0,05% municipal.'
      : 'CBS: referência de 11,3% (TCU). IBS: estimativa de 18,7% para a referência plena, na proporção da transição em ' + estado.ano + '. Valores ajustáveis.';
  }

  function nominais() {
    if (estado.ano <= 2026) return null;
    var cbs = estado.cbs === null ? '0' : estado.cbs, ibs = new D(estado.ibs === null ? '0' : estado.ibs);
    if (estado.ano <= 2028) return { 2: cbs, 3: ibs.div(2).toString(), 4: ibs.div(2).toString() };
    return { 2: cbs, 3: ibs.toString(), 4: '0' };
  }

  var selAno = $('ano');
  selAno.innerHTML = ANOS.map(function (a) { return '<option value="' + a + '">' + a + (a === 2026 ? ' · teste' : ' · simulação') + '</option>'; }).join('');
  (function () { var a = Number(hojeIso().slice(0, 4)); estado.ano = ANOS.indexOf(a) >= 0 ? a : 2026; selAno.value = String(estado.ano); })();
  selAno.addEventListener('change', function () {
    estado.ano = Number(selAno.value);
    aplicarSugestao();
    montarOpcoes(false);
    atualizar();
  });
  ['cbsRef', 'ibsRef'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      var v = lerNumero($(id).value);
      if (v !== null && Number(v) <= 100) { estado[id === 'cbsRef' ? 'cbs' : 'ibs'] = v; atualizar(); }
    });
    $(id).addEventListener('blur', function () { var v = estado[id === 'cbsRef' ? 'cbs' : 'ibs']; if (v !== null) $(id).value = pct(v, false); });
  });
  $('restaurar').addEventListener('click', function () { aplicarSugestao(); atualizar(); });

  $('valor').addEventListener('input', function () {
    var v = lerNumero($('valor').value);
    if (v !== null && Number(v) < 1e13) { estado.valor = v; atualizar(); }
  });
  $('valor').addEventListener('blur', function () { $('valor').value = numeroBr(estado.valor, 2); });

  // ---------- UF e município ----------
  function montarUfs() {
    $('uf').innerHTML = municipios.ufs.map(function (u) {
      return '<option value="' + u[0] + '">' + u[1] + ' — ' + esc(tituloUf(u[2])) + '</option>';
    }).join('');
    $('uf').value = estado.uf;
    montarMunicipios();
  }
  function montarMunicipios() {
    var l = municipios.mun[estado.uf] || [];
    $('municipio').innerHTML = l.map(function (m) { return '<option value="' + m[0] + '">' + esc(m[1]) + '</option>'; }).join('');
    if (!l.some(function (m) { return String(m[0]) === String(estado.mun); })) {
      var capital = { '35': '3550308' }[estado.uf];
      estado.mun = capital || (l[0] ? String(l[0][0]) : '');
    }
    $('municipio').value = estado.mun;
  }
  $('uf').addEventListener('change', function () { estado.uf = $('uf').value; estado.mun = ''; montarMunicipios(); atualizar(); });
  $('municipio').addEventListener('change', function () { estado.mun = $('municipio').value; atualizar(); });
  function nomeLocal() {
    if (!municipios) return '';
    var u = municipios.ufs.filter(function (x) { return String(x[0]) === String(estado.uf); })[0];
    var m = (municipios.mun[estado.uf] || []).filter(function (x) { return String(x[0]) === String(estado.mun); })[0];
    return (m ? m[1] + ' / ' : '') + (u ? u[1] : '');
  }

  // ---------- cálculo e resultado ----------
  function calcularOpcao(o) {
    return motor.calcular(o.c, { data: dataOperacao(estado.ano), base: estado.valor || '0', nominais: nominais() });
  }

  function linhasTributos(r) {
    var linhas = [];
    if (!r.grupo) return linhas;
    linhas.push({ rot: 'CBS', t: r.CBS });
    if (estado.ano >= 2029) {
      var uf = r.IBSUF, mu = r.IBSMun;
      linhas.push({
        rot: 'IBS (Estado + Município)', t: uf && {
          aliquota: uf.aliquota.plus(mu ? mu.aliquota : 0), percentualReducao: uf.percentualReducao,
          aliquotaEfetiva: uf.aliquotaEfetiva === null ? null : uf.aliquotaEfetiva.plus(mu && mu.aliquotaEfetiva ? mu.aliquotaEfetiva : 0),
          tributoDevido: r.vIBS, baseCalculo: uf.baseCalculo, grupoReducao: uf.grupoReducao,
          diferimento: uf.diferimento ? { valor: uf.diferimento.valor.plus(mu && mu.diferimento ? mu.diferimento.valor : 0), percentual: uf.diferimento.percentual } : null
        }
      });
    } else {
      linhas.push({ rot: 'IBS estadual', t: r.IBSUF });
      linhas.push({ rot: 'IBS municipal', t: r.IBSMun });
    }
    return linhas.filter(function (l) { return l.t; });
  }

  function efetiva(t) {
    if (!t) return null;
    if (t.aliquotaEfetiva !== null && t.aliquotaEfetiva !== undefined) return t.aliquotaEfetiva;
    return t.aliquota;
  }

  function preencherMemoria(o, t, f) {
    var tpl = o.c.mem || '';
    var mapa = {
      norma: f ? f.curto : 'LC 214/2025', tratamento: o.tt.d, base_calculo: numeroBr(t.baseCalculo, 2),
      aliquota_ad_valorem: pct(t.aliquota, false), percentual_reducao: t.percentualReducao ? pct(t.percentualReducao, false) : '0',
      aliquota_ad_rem: '0', quantidade: '1', unidade: 'UN'
    };
    return tpl.replace(/\[(\w+)\]/g, function (m, k) { return mapa[k] !== undefined ? mapa[k] : m; });
  }

  function atualizar() {
    var o = opcaoAtual();
    var vazio = !estado.item || !o;
    $('vazio').hidden = !vazio;
    $('res').hidden = vazio;
    if (vazio) { ultimo = null; atualizarHash(); return; }

    var data = dataOperacao(estado.ano), r;
    try { r = calcularOpcao(o); }
    catch (e) {
      $('res').hidden = true;
      $('vazio').hidden = false;
      $('vazio').textContent = 'Não foi possível calcular este enquadramento para ' + estado.ano + ': ' + e.message;
      ultimo = null;
      return;
    }
    $('vazio').textContent = 'Escolha o produto ou o serviço e o enquadramento para ver o cálculo.';
    var valor = new D(estado.valor || 0), total = r.total, f = motor.fundamentacao(o.c, data);
    var linhas = linhasTributos(r);
    var carga = valor.gt(0) ? total.div(valor).times(100) : new D(0);
    var efetTotal = linhas.reduce(function (s, l) { return s.plus(efetiva(l.t) || 0); }, new D(0));

    // cartões
    $('cards').innerHTML =
      card('CBS + IBS', moeda(total), 'sobre ' + moeda(valor)) +
      card('Carga sobre o valor', pct(carga.toDecimalPlaces(2, D.ROUND_HALF_EVEN)), 'alíquota efetiva somada: ' + pct(efetTotal)) +
      card('Valor com CBS e IBS', moeda(valor.plus(total)), 'tributos calculados “por fora”');

    // avisos
    var av = [];
    if (!r.grupo) av.push('<strong>Sem destaque de CBS e IBS.</strong> No CST ' + esc(o.st.cd) + ' (' + esc(o.st.d.toLowerCase()) + ') a operação não tem o grupo de cálculo desses tributos no documento fiscal.');
    var dif = linhas.filter(function (l) { return l.t.diferimento && l.t.diferimento.valor.gt(0); });
    if (dif.length) av.push('<strong>Diferimento:</strong> ' + dif.map(function (l) { return l.rot + ' de ' + moeda(l.t.diferimento.valor); }).join(', ') + ' fica diferido, sem cobrança nesta etapa.');
    if (estado.ano === 2026) av.push('<strong>2026 é ano de teste.</strong> A CBS de 0,9% e o IBS de 0,1% são destacados no documento, mas são compensáveis com PIS/Cofins ou dispensados para quem cumpre as obrigações acessórias (art. 348 da LC 214/2025).');
    else av.push('<strong>Simulação.</strong> As alíquotas de ' + estado.ano + ' ainda serão fixadas; o cálculo usa os valores indicados em “Alíquotas de referência”.');
    $('avisos').innerHTML = av.map(function (t) { return '<div class="aviso">' + t + '</div>'; }).join('');

    // tabela
    var tb = linhas.map(function (l) {
      var t = l.t;
      return '<tr><th scope="row">' + l.rot + '</th><td data-label="Alíquota">' + pct(t.aliquota) + '</td><td data-label="Redução">' + reducaoTxt(t.percentualReducao) +
        '</td><td data-label="Alíquota efetiva">' + pct(efetiva(t)) + '</td><td class="forte" data-label="Valor">' + moeda(t.tributoDevido || 0) + '</td></tr>';
    }).join('');
    if (!linhas.length) tb = '<tr><td colspan="5" class="cab" style="text-align:left;white-space:normal">Sem destaque de CBS e IBS para este enquadramento.</td></tr>';
    document.querySelector('#tab-trib tbody').innerHTML = tb;
    document.querySelector('#tab-trib tfoot').innerHTML = linhas.length ? '<tr><th scope="row">Total</th><td></td><td></td><td data-label="Alíquota efetiva">' + pct(efetTotal) + '</td><td data-label="Valor">' + moeda(total) + '</td></tr>' : '';
    var nb = r.vBC !== null ? 'Base de cálculo: ' + moeda(r.vBC) + '.' : '';
    if (r.vBC !== null && !new D(r.vBC).eq(valor)) nb += ' O enquadramento reduz a base sobre o valor informado de ' + moeda(valor) + '.';
    $('nota-base').textContent = nb + ' Data considerada: ' + dataBr(data) + '.' + (nomeLocal() ? ' Destino: ' + nomeLocal() + '.' : '');

    // créditos
    var cr = creditos(o.c);
    $('creditos').innerHTML = cr.map(function (x) { return '<li><i class="' + x[0] + '" aria-hidden="true">' + (x[0] === 'sim' ? '✓' : x[0] === 'nao' ? '✕' : 'i') + '</i><span>' + esc(x[1]) + '</span></li>'; }).join('');

    // comparativo
    var comp = [];
    if (opcoesAtuais && opcoesAtuais.esp.length) {
      opcoesAtuais.esp.concat(opcoesAtuais.geral).forEach(function (x) {
        try {
          var rr = x.c.id === o.c.id ? r : calcularOpcao(x);
          comp.push({ o: x, total: rr.total, carga: valor.gt(0) ? rr.total.div(valor).times(100) : new D(0) });
        } catch (e) { /* enquadramento sem cálculo neste ano */ }
      });
    }
    $('bloco-comp').hidden = comp.length < 2;
    document.querySelector('#tab-comp tbody').innerHTML = comp.map(function (x) {
      var atual = x.o.c.id === o.c.id;
      return '<tr' + (atual ? ' class="atual"' : '') + '><td class="cab"><strong>' + esc(x.o.c.cd) + '</strong> — ' + esc(trunc(x.o.c.d, 110)) +
        (atual ? ' <em>(selecionado)</em>' : ' <button type="button" class="esc" data-cl="' + x.o.c.id + '">usar este</button>') +
        '</td><td data-label="Carga">' + pct(x.carga.toDecimalPlaces(2, D.ROUND_HALF_EVEN)) + '</td><td class="forte" data-label="CBS + IBS">' + moeda(x.total) + '</td></tr>';
    }).join('');

    // fundamentação
    var fh = '';
    if (f) fh += '<p style="margin:0"><strong>' + esc(f.curto) + '</strong>' + (/^art/i.test(f.curto) ? ' da LC 214/2025' : '') + ' — ' + esc(o.c.d) + '</p>';
    o.itens.slice(0, 6).forEach(function (id) { var a = textoAnexo(id); if (a) fh += '<p style="margin:6px 0 0"><strong>' + esc(a.rot) + ':</strong> ' + esc(a.txt) + '</p>'; });
    if (f && f.txt) fh += '<details><summary>Ler o dispositivo legal</summary><div class="lei">' + esc(f.txt) + '</div></details>';
    $('fund').innerHTML = fh || '<p style="margin:0">Fundamentação não informada na tabela oficial.</p>';

    // memória
    var mem = linhas.map(function (l) {
      var t = l.t, s = '<strong>' + l.rot + ':</strong> ' + moeda(t.baseCalculo) + ' × ' + pct(t.aliquota);
      if (t.percentualReducao && t.percentualReducao.gt(0)) s += ' × (1 − ' + reducaoTxt(t.percentualReducao) + ' de redução)';
      s += ' = ' + moeda(t.diferimento ? t.diferimento.valor : t.tributoDevido || 0);
      if (t.diferimento && t.diferimento.valor.gt(0)) s += ', integralmente diferido: devido ' + moeda(t.tributoDevido || 0);
      return '<li>' + s + '</li>';
    });
    if (!linhas.length) mem.push('<li>Sem cálculo de CBS e IBS: ' + esc(o.st.d) + ' (CST ' + esc(o.st.cd) + ').</li>');
    if (linhas.length && r.CBS) mem.push('<li><span class="rfb">Texto padrão da memória de cálculo da Receita (CBS): ' + esc(preencherMemoria(o, r.CBS, f)) + '</span></li>');
    $('memoria').innerHTML = mem.join('');

    ultimo = { o: o, r: r, linhas: linhas, valor: valor, total: total, carga: carga, efetTotal: efetTotal, data: data, f: f, comp: comp, creditos: cr, avisos: av };
    atualizarWhatsapp();
    atualizarHash();
  }

  function card(rot, val, de) {
    return '<div class="card"><div class="rot">' + rot + '</div><div class="val">' + val + '</div><div class="de">' + de + '</div></div>';
  }

  function creditos(c) {
    var out = [];
    if (c.apCbs && c.apIbs) out.push(['sim', 'Gera crédito de CBS e de IBS para o adquirente contribuinte do regime regular.']);
    else if (!c.apCbs && !c.apIbs) out.push(['nao', 'Não gera crédito de CBS e de IBS para o adquirente.']);
    else {
      out.push([c.apCbs ? 'sim' : 'nao', (c.apCbs ? 'Gera' : 'Não gera') + ' crédito de CBS para o adquirente.']);
      out.push([c.apIbs ? 'sim' : 'nao', (c.apIbs ? 'Gera' : 'Não gera') + ' crédito de IBS para o adquirente.']);
    }
    if (c.ant === 'Manutenção') out.push(['sim', 'O fornecedor mantém os créditos das aquisições ligadas a esta operação.']);
    else if (c.ant === 'Anulação') out.push(['nao', 'O fornecedor deve anular os créditos das aquisições ligadas a esta operação.']);
    if (c.cpf) out.push(['info', 'Hipótese com crédito presumido para o fornecedor.']);
    if (c.cpa) out.push(['info', 'Hipótese com crédito presumido para o adquirente.']);
    return out;
  }

  document.querySelector('#tab-comp tbody').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-cl]');
    if (!b) return;
    estado.clId = Number(b.dataset.cl);
    $('enquadramento').value = String(estado.clId);
    mostrarDetalhe();
    atualizar();
    $('t-res').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ---------- WhatsApp, link e PDF ----------
  function resumoTexto() {
    if (!ultimo) return '';
    return (estado.tipo === 'ncm' ? 'NCM ' : 'NBS ') + codigoFmt(estado.tipo, estado.item.cd) + ', enquadramento ' + ultimo.o.c.cd + ', ano ' + estado.ano;
  }
  function atualizarWhatsapp() {
    var msg = 'Olá! Usei a calculadora de IBS e CBS do site (' + resumoTexto() + ') e gostaria de solicitar uma análise tributária.';
    $('b-wpp').href = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(msg);
  }

  function estadoParaHash() {
    var q = new URLSearchParams();
    q.set('t', estado.tipo);
    if (estado.item) q.set('c', estado.item.cd);
    var o = opcaoAtual();
    if (o) { q.set('cl', o.c.cd); q.set('cst', o.st.cd); }
    q.set('v', estado.valor);
    q.set('a', String(estado.ano));
    if (estado.ano > 2026) { q.set('cbs', estado.cbs); q.set('ibs', estado.ibs); }
    q.set('uf', estado.uf);
    if (estado.mun) q.set('m', estado.mun);
    return q.toString();
  }
  var tHash;
  function atualizarHash() {
    clearTimeout(tHash);
    tHash = setTimeout(function () {
      if (!estado.item) return;
      try { history.replaceState(null, '', location.pathname + location.search + '#' + estadoParaHash()); } catch (e) { /* sem histórico */ }
    }, 250);
  }

  function avisar(t) {
    var m = $('msg');
    m.textContent = t;
    clearTimeout(avisar.t);
    avisar.t = setTimeout(function () { m.textContent = ''; }, 4000);
  }

  $('b-link').addEventListener('click', function () {
    var url = location.origin + location.pathname + '#' + estadoParaHash();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { avisar('Link copiado.'); }, function () { avisar('Link atualizado na barra de endereço.'); });
    } else avisar('Link atualizado na barra de endereço.');
  });

  function carregarScript(src) {
    return new Promise(function (ok, erro) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.onload = ok; s.onerror = function () { erro(new Error('Falha ao carregar ' + src)); };
      document.head.appendChild(s);
    });
  }
  var pdfPronto = null;
  function prepararPdf() {
    if (!pdfPronto) {
      pdfPronto = carregarScript('/assets/vendor/jspdf-4.2.1.umd.min.js').then(function () { return carregarScript('pdf.js?v=20261116'); });
      pdfPronto.catch(function () { pdfPronto = null; });
    }
    return pdfPronto;
  }

  function relatorio() {
    var u = ultimo, o = u.o;
    var anexos = o.itens.map(textoAnexo).filter(Boolean);
    return {
      geradoEm: new Date(),
      endereco: location.origin + location.pathname + '#' + estadoParaHash(),
      item: { tipo: estado.tipo === 'ncm' ? 'NCM' : 'NBS', codigo: codigoFmt(estado.tipo, estado.item.cd), descricao: estado.item.titulo, contexto: estado.item.ctx },
      enquadramento: { cst: o.st.cd, cstDesc: o.st.d, cClassTrib: o.c.cd, descricao: o.c.d, tratamento: o.tt.d, especifico: o.especifico, anexos: anexos },
      operacao: { valor: moeda(u.valor), ano: String(estado.ano), data: dataBr(u.data), local: nomeLocal(), simulacao: estado.ano > 2026 },
      tributos: u.linhas.map(function (l) {
        return { rot: l.rot, aliquota: pct(l.t.aliquota), reducao: reducaoTxt(l.t.percentualReducao), efetiva: pct(efetiva(l.t)), valor: moeda(l.t.tributoDevido || 0) };
      }),
      total: moeda(u.total), carga: pct(u.carga.toDecimalPlaces(2, D.ROUND_HALF_EVEN)), efetTotal: pct(u.efetTotal), comTributos: moeda(u.valor.plus(u.total)),
      base: u.r.vBC !== null ? moeda(u.r.vBC) : '—',
      avisos: u.avisos.map(function (h) { return h.replace(/<[^>]+>/g, ''); }),
      creditos: u.creditos.map(function (x) { return x[1]; }),
      fundamentacao: u.f ? { curto: u.f.curto, txt: u.f.txt } : null,
      memoria: Array.prototype.map.call(document.querySelectorAll('#memoria li'), function (li) { return li.textContent; }),
      comparativo: u.comp.length > 1 ? u.comp.map(function (x) { return { rot: x.o.c.cd + ' — ' + x.o.c.d, carga: pct(x.carga.toDecimalPlaces(2, D.ROUND_HALF_EVEN)), total: moeda(x.total), atual: x.o.c.id === o.c.id }; }) : [],
      fonte: base.meta,
      whatsapp: '(11) 96405-6680',
      whatsappUrl: $('b-wpp').href,
      chamada: 'Sua empresa já avaliou como a Reforma Tributária afetará seus preços, contratos e créditos fiscais? Solicite uma análise individualizada com nossa equipe.'
    };
  }

  $('b-pdf').addEventListener('click', function () {
    if (!ultimo) return;
    var b = $('b-pdf');
    b.disabled = true;
    avisar('Gerando o PDF…');
    prepararPdf().then(function () {
      return window.PdfSimulacao.gerar(relatorio());
    }).then(function () {
      avisar('PDF gerado.');
    }, function (e) {
      avisar('Não foi possível gerar o PDF. Tente novamente.');
      if (window.console) console.error(e);
    }).then(function () { b.disabled = false; });
  });
  $('b-pdf').addEventListener('pointerenter', prepararPdf, { once: true });

  // ---------- início ----------
  function lerHash() {
    var h = location.hash.replace(/^#/, '');
    return h ? new URLSearchParams(h) : null;
  }

  function aplicarHash(q) {
    if (!q) return Promise.resolve();
    var tipo = q.get('t') === 'nbs' ? 'nbs' : 'ncm';
    estado.tipo = tipo;
    $('tipo-' + tipo).checked = true;
    $('rot-busca').textContent = tipo === 'ncm' ? 'Produto' : 'Serviço';
    var a = Number(q.get('a'));
    if (ANOS.indexOf(a) >= 0) { estado.ano = a; selAno.value = String(a); }
    aplicarSugestao();
    var v = lerNumero(q.get('v'));
    if (v !== null) { estado.valor = v; }
    if (estado.ano > 2026) {
      var cb = lerNumero(q.get('cbs')), ib = lerNumero(q.get('ibs'));
      if (cb !== null) { estado.cbs = cb; $('cbsRef').value = pct(cb, false); }
      if (ib !== null) { estado.ibs = ib; $('ibsRef').value = pct(ib, false); }
    }
    if (q.get('uf')) estado.uf = q.get('uf');
    if (q.get('m')) estado.mun = q.get('m');
    var cod = (q.get('c') || '').replace(/\D/g, '');
    if (!cod) return Promise.resolve();
    return garantirLista(tipo).then(function (l) {
      var e = l.filter(function (x) { return x.cd === cod; })[0];
      if (!e) return;
      var cl = q.get('cl'), cst = q.get('cst');
      if (cl) {
        var c = base.class.filter(function (x) { return x.cd === cl && (!cst || base.cst[String(x.st)].cd === cst) && Motor.vigente(x.i, x.f, dataOperacao(estado.ano)); })[0];
        if (c) estado.clId = c.id;
      }
      estado.item = e;
      escolherItem(e, true);
      if (cl && estado.clId) { $('enquadramento').value = String(estado.clId); mostrarDetalhe(); }
    });
  }

  carregar('dados/base.json').then(function (b) {
    base = b;
    motor = new Motor(b);
    var m = b.meta;
    $('versao').innerHTML = 'Tabelas e regras de cálculo do código aberto da <a href="https://github.com/ReceitaFederal/calculadora-rtc-regime-regular" rel="noopener" target="_blank">Calculadora de Tributos da Receita Federal</a> (licença MIT), base ' +
      esc(m.versaoBase) + ' de ' + dataBr(m.dataVersaoBase) + '. Ferramenta independente, sem vínculo com a Receita Federal.';
    $('fonte-txt').insertAdjacentHTML('beforeend', ' Versão da base usada nesta página: ' + esc(m.versaoBase) + ', de ' + dataBr(m.dataVersaoBase) +
      (m.commit ? ' (commit <code>' + esc(m.commit.slice(0, 7)) + '</code>)' : '') + '; dados gerados em ' + dataBr(m.geradoEm) + '.');
    aplicarSugestao();
    var q = lerHash();
    return aplicarHash(q).then(function () {
      $('valor').value = numeroBr(estado.valor, 2);
      atualizar();
    });
  }).catch(function (e) {
    $('vazio').textContent = 'Não foi possível carregar as tabelas da calculadora. Recarregue a página.';
    if (window.console) console.error(e);
  });

  carregar('dados/municipios.json').then(function (m) { municipios = m; montarUfs(); if (ultimo) atualizar(); })
    .catch(function () { $('uf').innerHTML = '<option value="">Indisponível</option>'; $('municipio').innerHTML = '<option value="">Indisponível</option>'; });

  // Link de simulação colado na mesma página: recarrega com os novos parâmetros
  // (as atualizações feitas pela própria calculadora usam replaceState e não disparam este evento).
  window.addEventListener('hashchange', function () { location.reload(); });

  if ('requestIdleCallback' in window) requestIdleCallback(function () { garantirLista(estado.tipo); });
  else setTimeout(function () { garantirLista(estado.tipo); }, 1500);
})();
