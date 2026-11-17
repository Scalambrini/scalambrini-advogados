#!/usr/bin/env node
/* Confere o motor da calculadora (calculadora/ncm-nbs/motor.js) com os casos de teste publicados
 * pela Receita Federal no repositório calculadora-rtc-regime-regular.
 *
 * Uso: node .github/rfb/conferir_motor.js CAMINHO_DO_CLONE_DA_RECEITA
 * Requer decimal.js acessível por require (ex.: NODE_PATH apontando para node_modules).
 * Sai com código 1 se algum caso divergir: nesse caso, as tabelas novas não devem ser publicadas
 * sem revisão do motor. */
'use strict';
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const rfb = process.argv[2];
if (!rfb) { console.error('Informe o caminho do clone da Receita.'); process.exit(2); }

const Motor = require(path.join(raiz, 'calculadora/ncm-nbs/motor.js'));
const base = JSON.parse(fs.readFileSync(path.join(raiz, 'calculadora/ncm-nbs/dados/base.json'), 'utf8'));
const m = new Motor(base);
const D = Motor.D;
const SUPORTADOS = new Set(['000', '010', '011', '200', '220', '221', '222', '400', '410', '510', '515']);

const f2 = x => x == null ? null : new D(x).toDecimalPlaces(2, D.ROUND_HALF_EVEN).toFixed(2);
const f4 = x => {
  if (x == null) return null;
  let s = new D(x).toDecimalPlaces(4, D.ROUND_HALF_EVEN).toFixed(4).replace(/0+$/, '');
  if (s.split('.')[1].length < 2) s = new D(s).toFixed(2);
  return s;
};
const classe = (cd, cst, data) => base.class.find(x => x.cd === cd && base.cst[String(x.st)].cd === cst && Motor.vigente(x.i, x.f, data));

let ok = 0, falhas = 0, comparacoes = 0;
const pulados = {};

// 1) Teste de regressão com vários itens (2027, alíquotas nominais informadas)
const R = path.join(rfb, 'src/test/resources');
const ent = JSON.parse(fs.readFileSync(path.join(R, 'entradas/calculoscorretos/varios_itens/Teste_Varios_Itens.json'), 'utf8'));
const sai = JSON.parse(fs.readFileSync(path.join(R, 'saidas/Teste_Varios_Itens.json'), 'utf8'));
const dataReg = ent.dataHoraEmissao.slice(0, 10);

ent.itens.forEach((it, k) => {
  const esperado = sai.objetos[k].tribCalc;
  const motivo = !SUPORTADOS.has(it.cst) ? 'CST ' + it.cst : it.tributacaoRegular ? 'tributação regular' : null;
  if (motivo) { pulados[motivo] = (pulados[motivo] || 0) + 1; return; }
  const c = classe(it.cClassTrib, it.cst, dataReg);
  const nom = it.aliquotasNominais || {};
  const op = {
    data: dataReg, base: it.baseCalculo,
    isInformado: it.impostoSeletivo ? (it.impostoSeletivo.impostoInformado || 0) : 0,
    isCalculado: esperado.IS ? esperado.IS.vIS : 0,
    nominais: { 2: nom.cbs, 3: nom.ibsEstadual, 4: nom.ibsMunicipal }
  };
  let r;
  try {
    if (!c) throw new Error('classificação não encontrada');
    r = m.calcular(c, op);
  } catch (e) {
    if (!esperado.IBSCBS) { ok++; return; } // a Receita também não calcula
    falhas++; console.log('ERRO item', it.numero, it.cst, it.cClassTrib, e.message); return;
  }
  const g = esperado.IBSCBS && esperado.IBSCBS.gIBSCBS, dif = [];
  const chk = (rot, a, b) => { comparacoes++; if (String(a) !== String(b)) dif.push(rot + ': ' + a + ' (esperado ' + b + ')'); };
  if (!g) { if (r.grupo) dif.push('grupo IBS/CBS não esperado'); }
  else {
    chk('vBC', f2(r.vBC), g.vBC);
    chk('vIBS', f2(r.vIBS), g.vIBS);
    [['gCBS', 'CBS', 'pCBS', 'vCBS'], ['gIBSUF', 'IBSUF', 'pIBSUF', 'vIBSUF'], ['gIBSMun', 'IBSMun', 'pIBSMun', 'vIBSMun']].forEach(([gk, rk, pk, vk]) => {
      const e = g[gk], o = r[rk];
      if (!e) { if (o) dif.push(gk + ' não esperado'); return; }
      if (!o) { dif.push(gk + ' ausente'); return; }
      chk(pk, f4(o.aliquota), e[pk]);
      chk(vk, f2(o.tributoDevido), e[vk]);
      if (e.gRed) { chk(gk + '.pRedAliq', f4(o.percentualReducao), e.gRed.pRedAliq); chk(gk + '.pAliqEfet', f4(o.aliquotaEfetiva), e.gRed.pAliqEfet); }
      else if (o.grupoReducao) dif.push(gk + '.gRed não esperado');
      if (e.gDif) { chk(gk + '.vDif', f2(o.diferimento && o.diferimento.valor), e.gDif.vDif); chk(gk + '.pDif', f4(o.diferimento && o.diferimento.percentual), e.gDif.pDif); }
    });
  }
  if (dif.length) { falhas++; console.log('DIVERGÊNCIA item', it.numero, it.cst, it.cClassTrib, dif.join(' | ')); } else ok++;
});

// 2) Casos de 2026 com as alíquotas de referência da base (valores dos testes unitários da Receita:
//    Teste_000001_1, Teste_011002_1 e Teste_200032_1 — base de cálculo R$ 200,00)
[
  ['000', '000001', { CBS: '1.80', IBSUF: '0.20', IBSMun: '0.00' }],
  ['011', '011002', { CBS: '0.72', IBSUF: '0.08', IBSMun: '0.00' }],
  ['200', '200032', { CBS: '0.72', IBSUF: '0.08', IBSMun: '0.00' }]
].forEach(([cst, cd, esp]) => {
  const c = classe(cd, cst, '2026-01-01');
  let r;
  try { r = m.calcular(c, { data: '2026-01-01', base: 200 }); } catch (e) { falhas++; console.log('ERRO 2026', cd, e.message); return; }
  const dif = Object.keys(esp).filter(k => { comparacoes++; return f2(r[k].tributoDevido) !== esp[k]; });
  if (dif.length) { falhas++; console.log('DIVERGÊNCIA 2026', cd, dif.map(k => k + ' ' + f2(r[k].tributoDevido) + ' (esperado ' + esp[k] + ')').join(' | ')); } else ok++;
});

console.log(`Casos conferidos: ${ok} sem divergência, ${falhas} com divergência; ${comparacoes} valores comparados.`);
console.log('Fora do escopo da calculadora:', JSON.stringify(pulados));
process.exit(falhas ? 1 : 0);
