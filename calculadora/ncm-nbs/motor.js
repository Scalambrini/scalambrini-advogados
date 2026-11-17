/*!
 * Motor de cálculo de CBS e IBS — Scalambrini e Saraiva Advogados
 *
 * Adaptação para o navegador das regras de cálculo do serviço CalculoCbsIbsService e da
 * validação de NCM/NBS contra os anexos (NcmAplicavelService / NbsAplicavelService) da
 * Calculadora de Tributos da Receita Federal do Brasil:
 * https://github.com/ReceitaFederal/calculadora-rtc-regime-regular
 *
 * Copyright (c) 2026 Receita Federal do Brasil — licença MIT (texto em /calculadora/ncm-nbs/licencas.html).
 * Adaptação: Scalambrini e Saraiva Advogados, 2026. Ferramenta não oficial.
 *
 * Mantém as convenções do motor original: cálculos intermediários com 8 casas decimais e
 * arredondamento bancário (HALF_EVEN), divisões com 34 dígitos significativos (DECIMAL128)
 * e arredondamento final de valores monetários para 2 casas, também HALF_EVEN.
 * Depende de decimal.js (licença MIT).
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(require('decimal.js'));
  else raiz.MotorIbsCbs = fabrica(raiz.Decimal);
})(typeof self !== 'undefined' ? self : this, function (DecimalBase) {
  'use strict';

  var D = DecimalBase.clone({ precision: 34, rounding: DecimalBase.ROUND_HALF_EVEN });
  var HE = D.ROUND_HALF_EVEN;
  var ZERO = new D(0);
  var TRIB = { 2: 'CBS', 3: 'IBSUF', 4: 'IBSMun' };

  function r8(x) { return x.toDecimalPlaces(8, HE); }
  function div100(x) { return x.div(100).toDecimalPlaces(8, HE); }
  function dec(v) { return v === null || v === undefined || v === '' ? null : new D(v); }

  function vigente(i, f, data) { return (!i || i <= data) && (!f || f >= data); }

  // ---------- avaliador de expressões (substitui o JEXL do motor original) ----------
  // Aceita apenas números, nomes de variáveis, + - * / e parênteses.
  function tokens(expr) {
    var re = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/()])/y, out = [], m;
    re.lastIndex = 0;
    while (re.lastIndex < expr.length) {
      var antes = re.lastIndex;
      m = re.exec(expr);
      if (!m) {
        if (/^\s*$/.test(expr.slice(antes))) break;
        throw new Error('Expressão inválida: ' + expr);
      }
      out.push(m[1]);
    }
    return out;
  }

  function avaliar(expr, vars) {
    var e = String(expr).trim();
    if (Object.prototype.hasOwnProperty.call(vars, e)) return vars[e];
    var t = tokens(e), p = 0;
    function prox() { return t[p]; }
    function come(x) { if (t[p] !== x) throw new Error('Expressão inválida: ' + e); p++; }
    function fator() {
      var k = t[p++];
      if (k === undefined) throw new Error('Expressão incompleta: ' + e);
      if (k === '(') { var v = soma(); come(')'); return v; }
      if (k === '-') return fator().neg();
      if (k === '+') return fator();
      if (/^\d/.test(k)) return new D(k);
      if (!Object.prototype.hasOwnProperty.call(vars, k)) throw new Error('Variável desconhecida: ' + k);
      return vars[k];
    }
    function produto() {
      var v = fator();
      while (prox() === '*' || prox() === '/') {
        var op = t[p++], d = fator();
        if (op === '*') v = v.times(d);
        else { if (d.isZero()) throw new Error('Divisão por zero'); v = v.div(d); }
      }
      return v;
    }
    function soma() {
      var v = produto();
      while (prox() === '+' || prox() === '-') {
        var op = t[p++], d = produto();
        v = op === '+' ? v.plus(d) : v.minus(d);
      }
      return v;
    }
    var r = soma();
    if (p !== t.length) throw new Error('Expressão inválida: ' + e);
    return r8(r);
  }

  function usaAliquota(expr) { return !!expr && /\baliquota\b/.test(expr); }

  // ---------- consultas às tabelas ----------
  function Motor(base) {
    this.b = base;
    this.porId = {};
    var self = this;
    base.class.forEach(function (c) { self.porId[c.id] = c; });
  }

  Motor.prototype.cst = function (c) { return this.b.cst[String(c.st)]; };

  Motor.prototype.linhaVigente = function (lista, data, idx) {
    // lista de [valor, ..., inicio, fim]; idx = posição do início
    for (var k = 0; k < lista.length; k++) {
      var l = lista[k];
      if (vigente(l[idx], l[idx + 1], data)) return l;
    }
    return null;
  };

  Motor.prototype.tratamento = function (c, data) {
    var l = this.linhaVigente(c.trat, data, 1);
    return l ? this.b.trat[String(l[0])] : null;
  };

  Motor.prototype.reducao = function (c, tributo, data) {
    for (var k = 0; k < c.red.length; k++) {
      var l = c.red[k];
      if (l[0] === tributo && vigente(l[2], l[3], data)) return dec(l[1]);
    }
    return null;
  };

  Motor.prototype.aliquotaReferencia = function (tributo, data) {
    var a = this.b.aliqRef;
    for (var k = 0; k < a.length; k++) if (a[k].t === tributo && vigente(a[k].i, a[k].f, data)) return dec(a[k].v);
    return null;
  };

  Motor.prototype.aliquotaDaClassificacao = function (c, tributo, data) {
    for (var k = 0; k < c.fixa.length; k++) {
      var l = c.fixa[k];
      if (l[0] === tributo && vigente(l[2], l[3], data)) return dec(l[1]);
    }
    return null;
  };

  Motor.prototype.fundamentacao = function (c, data) {
    var l = this.linhaVigente(c.fund, data, 1);
    return l ? this.b.fund[String(l[0])] : null;
  };

  /**
   * Cálculo de um tributo (CBS = 2, IBS estadual = 3, IBS municipal = 4), espelhando
   * CalculoCbsIbsService.calcularCbsIbs para operações sem tributação regular,
   * compra governamental, monofasia ou ajuste.
   * op: { data: 'AAAA-MM-DD', base, isInformado, isCalculado, nominais: {2: %, 3: %, 4: %} }
   */
  Motor.prototype.calcularTributo = function (c, tributo, op) {
    var data = op.data;
    var tt = this.tratamento(c, data);
    if (!tt) throw new Error('Tratamento tributário não encontrado para ' + c.cd + ' em ' + data);
    if (tt.aj) throw new Error('Classificação ' + c.cd + ' sem cálculo implementado (ajuste).');
    if (tt.mono) throw new Error('Classificação ' + c.cd + ' sem cálculo implementado (monofasia).');

    var pRed = null;
    if (tt.red) {
      var red = this.reducao(c, tributo, data);
      if (red === null) throw new Error('Percentual de redução não encontrado para ' + c.cd + ' em ' + data);
      pRed = div100(red);
    }

    var tipo = c.cd === '510001' ? 'Padrão' : c.tipo;
    var nominal = op.nominais && op.nominais[tributo] !== undefined && op.nominais[tributo] !== null ? dec(op.nominais[tributo]) : null;
    var aliq = null, nominalAplicada = false, porCem = false, bruta;

    switch (tipo) {
      case 'Padrão':
      case 'Uniforme nacional (referência)':
        if (nominal !== null) { aliq = div100(nominal); nominalAplicada = true; }
        else {
          bruta = this.aliquotaReferencia(tributo, data);
          if (bruta === null) throw new SemAliquota(tributo, data);
          aliq = div100(bruta);
        }
        porCem = true;
        break;
      case 'Uniforme setorial':
      case 'Fixa':
        if (nominal !== null) { aliq = div100(nominal); nominalAplicada = true; }
        else {
          bruta = this.aliquotaDaClassificacao(c, tributo, data);
          if (bruta === null) throw new SemAliquota(tributo, data, c.cd);
          aliq = div100(bruta);
        }
        porCem = true;
        break;
      case 'Sem alíquota':
        if (nominal !== null) { aliq = div100(nominal); nominalAplicada = true; porCem = true; }
        else aliq = ZERO;
        break;
      default:
        throw new Error('Tipo de alíquota não suportado: ' + tipo);
    }

    var v = function (extra) {
      var o = {
        quantidade: ZERO, aliquota: aliq || ZERO, percentualReducao: pRed || ZERO, pRedutorCompraGov: ZERO,
        aliquotaPadraoOuReferencia: ZERO, aliquotaReferencia: ZERO, aliquotaAdValorem: ZERO, aliquotaAdRem: ZERO,
        ajuste: ZERO, redutor: ZERO, aliquotaAdRemPrincipal: ZERO, aliquotaAdRemSecundaria: ZERO,
        variacaoPontoPercentual: ZERO, pBio: ZERO, percentualDiferimento: ZERO,
        baseCalculoInformada: dec(op.base) || ZERO, impostoSeletivoInformado: dec(op.isInformado) || ZERO,
        impostoSeletivoCalculado: dec(op.isCalculado) || ZERO
      };
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k] === null ? ZERO : extra[k];
      return o;
    };

    var rAliq = null;
    if (nominalAplicada && !usaAliquota(tt.a)) rAliq = aliq;
    else if (tt.a) rAliq = avaliar(tt.a, v({}));

    var rEfet = tt.e ? avaliar(tt.e, v({ aliquota: rAliq })) : null;
    var rBase = avaliar(tt.b, v({ aliquota: rAliq, aliquotaEfetiva: rEfet }));
    if (rBase.isNegative()) rBase = ZERO;
    var vars3 = { aliquota: rAliq, aliquotaEfetiva: rEfet, baseCalculo: rBase };
    var rCalc = avaliar(tt.c, v(vars3));
    var rDev = tt.v ? avaliar(tt.v, v({ aliquota: rAliq, aliquotaEfetiva: rEfet, baseCalculo: rBase, tributoCalculado: rCalc })) : null;

    var pDif = null, vDif = null;
    if (tt.pd && tt.vd) {
      var vars5 = { aliquota: rAliq, aliquotaEfetiva: rEfet, baseCalculo: rBase, tributoCalculado: rCalc };
      pDif = avaliar(tt.pd, v(vars5));
      vars5.percentualDiferimento = pDif;
      vDif = avaliar(tt.vd, v(vars5));
      rCalc = r8(rCalc.minus(vDif));
      rDev = r8(rCalc.minus(vDif));
      if (rCalc.isNegative()) rCalc = ZERO;
      if (rDev.isNegative()) rDev = ZERO;
    }

    var st = this.cst(c);
    if (!st.g) return null; // CST sem grupo IBS/CBS (isenção, imunidade, não incidência)

    var pct = function (x) { return x === null ? null : (porCem ? x.times(100) : x); };
    return {
      tributo: TRIB[tributo],
      tratamento: tt.d,
      aliquota: pct(rAliq),
      percentualReducao: pRed === null ? null : pRed.times(100),
      grupoReducao: !!(st.red && pRed !== null && rEfet !== null),
      aliquotaEfetiva: pct(rEfet),
      baseCalculo: rBase,
      tributoCalculado: rCalc,
      tributoDevido: rDev,
      diferimento: vDif !== null && pDif !== null ? { valor: vDif, percentual: pDif.times(100) } : null,
      nominalAplicada: nominalAplicada
    };
  };

  function SemAliquota(tributo, data, cd) {
    this.name = 'SemAliquota';
    this.tributo = tributo;
    this.message = 'Alíquota ' + (cd ? 'da classificação ' + cd + ' ' : 'de referência ') + 'de ' + TRIB[tributo] + ' não encontrada para ' + data;
  }
  SemAliquota.prototype = Object.create(Error.prototype);

  /** Cálculo de CBS, IBS estadual e IBS municipal de um item. */
  Motor.prototype.calcular = function (c, op) {
    var self = this, out = {};
    [2, 3, 4].forEach(function (t) { out[TRIB[t]] = self.calcularTributo(c, t, op); });
    var lista = [out.CBS, out.IBSUF, out.IBSMun];
    var algum = lista.some(function (x) { return x; });
    out.vBC = algum ? (out.IBSMun || out.IBSUF || out.CBS).baseCalculo : null;
    var soma = function (a, b) { return (a ? a.tributoDevido || ZERO : ZERO).plus(b ? b.tributoDevido || ZERO : ZERO); };
    out.vIBS = soma(out.IBSUF, out.IBSMun);
    out.vCBS = out.CBS ? out.CBS.tributoDevido || ZERO : ZERO;
    out.total = out.vIBS.plus(out.vCBS);
    out.grupo = algum;
    return out;
  };

  // ---------- NCM / NBS contra os anexos ----------
  Motor.prototype.indices = function () {
    if (this._idx) return this._idx;
    var b = this.b, idx = { ncm: {}, nbs: {}, exNcm: {}, exNbs: {}, ncmCls: {}, nbsCls: {} };
    b.ncmEx.forEach(function (e) { (idx.exNcm[e[0]] = idx.exNcm[e[0]] || []).push(e); });
    b.nbsEx.forEach(function (e) { (idx.exNbs[e[0]] = idx.exNbs[e[0]] || []).push(e); });
    b.ncmAp.forEach(function (a) { (idx.ncmCls[a[2]] = idx.ncmCls[a[2]] || []).push(a); });
    b.nbsAp.forEach(function (a) { (idx.nbsCls[a[2]] = idx.nbsCls[a[2]] || []).push(a); });
    this._idx = idx;
    return idx;
  };

  /**
   * Critica um código completo contra o anexo da classificação, com a tabela-verdade de
   * NcmAplicavelService: rejeita se não há vínculo vigente que cubra o código, ou se uma
   * exceção vigente o cobre e não há outro vínculo vigente sem exceções.
   * Retorna { temAnexo, aceito, itens: [ids de ANEXO] }.
   */
  Motor.prototype.criticar = function (tipo, codigo, c, data) {
    var idx = this.indices();
    var vincs = (tipo === 'ncm' ? idx.ncmCls : idx.nbsCls)[c.id] || [];
    var exs = tipo === 'ncm' ? idx.exNcm : idx.exNbs;
    var vigentes = vincs.filter(function (a) { return vigente(a[4], a[5], data); });
    if (!vigentes.length) return { temAnexo: false, aceito: true, itens: [], vinculos: [] };
    var cobre = vigentes.filter(function (a) { return codigo.indexOf(a[1]) === 0; });
    if (!cobre.length) return { temAnexo: true, aceito: false, itens: [], vinculos: [] };
    var excecao = cobre.some(function (a) {
      return (exs[a[0]] || []).some(function (e) { return codigo.indexOf(e[1]) === 0 && vigente(e[2], e[3], data); });
    });
    var semExcecao = cobre.some(function (a) {
      return !(exs[a[0]] || []).some(function (e) { return vigente(e[2], e[3], data); });
    });
    if (excecao && !semExcecao) return { temAnexo: true, aceito: false, itens: [], vinculos: [] };
    var itens = [], vinculos = [];
    cobre.forEach(function (a) {
      var excluido = (exs[a[0]] || []).some(function (e) { return codigo.indexOf(e[1]) === 0 && vigente(e[2], e[3], data); });
      if (!excluido && a[3] && itens.indexOf(a[3]) < 0) { itens.push(a[3]); vinculos.push([a[3], a[1]]); }
    });
    return { temAnexo: true, aceito: true, itens: itens, vinculos: vinculos };
  };

  Motor.D = D;
  Motor.vigente = vigente;
  Motor.avaliar = avaliar;
  Motor.SemAliquota = SemAliquota;
  return Motor;
});
