/*!
 * Validação dos vínculos entre códigos NCM/NBS e itens dos anexos da LC 214/2025
 * Scalambrini e Saraiva Advogados — calculadora/ncm-nbs
 *
 * Usada pela página (antes de exibir um item de anexo na tela ou no PDF) e pela conferência
 * automática (.github/rfb/conferir_motor.js). Um item só é exibido quando:
 *  - pertence ao anexo da classificação tributária (cClassTrib) escolhida;
 *  - para NBS, a descrição oficial do código está contida no texto do item;
 *  - para NCM, se o texto do item cita códigos, o código do vínculo é compatível com algum deles.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.VinculosAnexo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
  var VAZIAS = ('servicos servico de da do das dos e em para ou os as com nao a o na no nas nos por que outros outras outro outra ' +
    'exceto inclusive mesmo qualquer sua seu suas seus classificados subposicoes anteriores relacionados destinados destinadas ' +
    'diretamente demais').split(' ').reduce(function (o, p) { o[p] = 1; return o; }, {});
  var SINONIMOS = { ensin: 'educa' }; // "ensino" (anexo II) = "educação" (NBS)
  var LIMITE = 0.75;

  function termos(s) {
    var t = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z]{3,}/g) || [];
    var out = {};
    t.forEach(function (p) { if (!VAZIAS[p]) { p = p.slice(0, 5); out[SINONIMOS[p] || p] = 1; } });
    return Object.keys(out);
  }

  /** Fração dos termos da descrição do código que aparecem no texto do item. */
  function contencao(descricao, texto) {
    var d = termos(descricao), t = termos(texto);
    if (!d.length) return 0;
    var n = d.filter(function (x) { return t.indexOf(x) >= 0; }).length;
    return n / d.length;
  }

  /** Códigos NCM citados no texto do item, desconsiderando os mencionados como exceção. */
  function codigosCitados(texto) {
    // exceções entre parênteses saem sozinhas; fora deles, a exceção vai até o fim da oração
    var s = String(texto || '').replace(/\(\s*(?:exceto|exclu[íi]d[oa]s?|exclusive)\b[^)]*\)/gi, ' ')
      .replace(/\b(?:exceto|exclu[íi]d[oa]s?|exclusive)\b[^;]*/gi, '');
    var out = [], m, re4 = /(?:^|[^\d.])(\d{2})\.?(\d{2})(?:\.(\d{2}))?(?:\.(\d{2}))?(?![\d])/g;
    while ((m = re4.exec(s))) out.push(m[1] + m[2] + (m[3] || '') + (m[4] || ''));
    var cap = /cap[íi]tulos?\s+((?:\d{1,2}(?:\s*(?:,|e|a)\s*)?)+)/gi;
    while ((m = cap.exec(s))) (m[1].match(/\d{1,2}/g) || []).forEach(function (x) { out.push(('0' + x).slice(-2)); });
    return out;
  }

  function jaccard(a, b) {
    var x = termos(a), y = termos(b), u = {}, n = 0;
    x.concat(y).forEach(function (k) { u[k] = 1; });
    x.forEach(function (k) { if (y.indexOf(k) >= 0) n++; });
    var tot = Object.keys(u).length;
    return tot ? n / tot : 0;
  }

  /**
   * v: { tipo: 'ncm' | 'nbs', codigo, descricao (descrição oficial do código do vínculo),
   *      anexoClasse (número do anexo da classificação, ex.: '3'), item: [numeroAnexo, numeroItem, texto],
   *      itensDoAnexo: textos dos demais itens do mesmo anexo (para NBS) }
   */
  function compativel(v) {
    if (!v || !v.item) return false;
    var esperado = ROMANOS[Number(v.anexoClasse)] || null;
    if (esperado && v.item[0] !== esperado) return false;
    if (v.tipo === 'nbs') {
      var c = contencao(v.descricao, v.item[2]), j = jaccard(v.descricao, v.item[2]);
      if (c < LIMITE) return false;
      // nenhum outro item do anexo pode corresponder melhor à descrição do código
      return !(v.itensDoAnexo || []).some(function (t) {
        if (t === v.item[2]) return false;
        var c2 = contencao(v.descricao, t);
        return c2 > c || (c2 === c && jaccard(v.descricao, t) >= j);
      });
    }
    var cit = codigosCitados(v.item[2]);
    if (!cit.length) return true;
    var cd = String(v.codigo);
    return cit.some(function (c) { return cd.indexOf(c) === 0 || c.indexOf(cd) === 0; });
  }

  return { compativel: compativel, contencao: contencao, jaccard: jaccard, codigosCitados: codigosCitados, termos: termos, ROMANOS: ROMANOS, LIMITE: LIMITE };
});
