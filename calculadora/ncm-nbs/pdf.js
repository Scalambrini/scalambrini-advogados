/* Relatório em PDF da Calculadora de IBS e CBS por NCM e NBS — Scalambrini e Saraiva Advogados.
 * Carregado sob demanda, depois de jsPDF (licença MIT). */
(function () {
  'use strict';

  var NAVY = [19, 26, 44], GOLD = [184, 147, 89], GOLDD = [138, 106, 51], INK = [31, 35, 40],
    MUTED = [90, 98, 112], LINE = [227, 230, 234], SOFT = [245, 246, 248], CREME = [251, 247, 239];
  var ML = 18, MR = 18, MT = 16, MB = 20, PW = 210, PH = 297, W = PW - ML - MR;

  // Caracteres fora da codificação das fontes-padrão do PDF
  function seguro(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/−/g, '-').replace(/[‐‑]/g, '-').replace(/ | /g, ' ')
      .replace(/[✓✔]/g, '').replace(/[✕✖]/g, '')
      .replace(/[^\x09\x0a\x0d\x20-\x7e¡-ÿ–—‘’“”•…€]/g, '');
  }

  function imagem(url) {
    return fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (ok, erro) {
        var fr = new FileReader();
        fr.onload = function () { ok(fr.result); };
        fr.onerror = erro;
        fr.readAsDataURL(b);
      });
    });
  }

  function gerar(rel) {
    return imagem('logo-pdf.jpg').catch(function () { return null; }).then(function (logo) {
      var jsPDF = window.jspdf.jsPDF;
      var doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      doc.setProperties({ title: 'Simulação de IBS e CBS — ' + seguro(rel.item.tipo + ' ' + rel.item.codigo), author: 'Scalambrini e Saraiva Advogados', subject: 'Simulação informativa de CBS e IBS', creator: 'scalambrini.com' });
      var y = MT;

      function cor(c) { doc.setTextColor(c[0], c[1], c[2]); }
      function fonte(tam, negrito) { doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam); }
      function altLinha(tam) { return tam * 0.3528 * 1.38; }
      function novaPagina() { doc.addPage(); y = MT + 4; }
      function garantir(h) { if (y + h > PH - MB) novaPagina(); }

      function texto(s, o) {
        o = o || {};
        var tam = o.tam || 9.5, x = o.x !== undefined ? o.x : ML, larg = o.larg || W;
        fonte(tam, o.negrito);
        cor(o.cor || INK);
        var linhas = doc.splitTextToSize(seguro(s), larg), lh = altLinha(tam);
        for (var k = 0; k < linhas.length; k++) {
          garantir(lh);
          doc.text(linhas[k], x, y + lh * 0.72);
          y += lh;
        }
        y += o.depois !== undefined ? o.depois : 1.2;
      }

      function titulo(s) {
        garantir(30); // título nunca fica sozinho no pé da página
        y += 5;
        fonte(8.5, true);
        cor(GOLDD);
        doc.text(seguro(s).toUpperCase(), ML, y + 3, { charSpace: 0.35 });
        y += 5;
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
        doc.setLineWidth(0.3);
        doc.line(ML, y, ML + W, y);
        y += 3;
      }

      function marcador(s, o) {
        o = o || {};
        var tam = o.tam || 9.5;
        fonte(tam, false);
        var linhas = doc.splitTextToSize(seguro(s), W - 5), lh = altLinha(tam);
        garantir(lh);
        cor(GOLD);
        doc.text('•', ML + 0.5, y + lh * 0.72);
        cor(o.cor || INK);
        for (var k = 0; k < linhas.length; k++) {
          garantir(lh);
          doc.text(linhas[k], ML + 5, y + lh * 0.72);
          y += lh;
        }
        y += 1;
      }

      function tabela(cols, cab, linhas, o) {
        o = o || {};
        var tam = o.tam || 9, lh = altLinha(tam), pad = 2.2;
        function medir(lin, negrito) {
          fonte(tam, negrito);
          var partes = lin.map(function (cel, i) { return doc.splitTextToSize(seguro(cel), cols[i].w - pad * 2); });
          var n = Math.max.apply(null, partes.map(function (p) { return p.length; }));
          return { partes: partes, h: n * lh + pad * 2 };
        }
        function desenhar(lin, m, estilo) {
          var x = ML;
          if (estilo.fundo) { doc.setFillColor(estilo.fundo[0], estilo.fundo[1], estilo.fundo[2]); doc.rect(ML, y, W, m.h, 'F'); }
          fonte(estilo.tam || tam, estilo.negrito);
          cor(estilo.cor || INK);
          m.partes.forEach(function (p, i) {
            var c = cols[i];
            p.forEach(function (l, k) {
              var ty = y + pad + lh * 0.72 + k * lh;
              if (c.dir) doc.text(l, x + c.w - pad, ty, { align: 'right' });
              else doc.text(l, x + pad, ty);
            });
            x += c.w;
          });
          doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
          doc.setLineWidth(0.2);
          doc.line(ML, y + m.h, ML + W, y + m.h);
          y += m.h;
        }
        var mc = cab ? medir(cab, true) : null;
        if (mc) { garantir(mc.h + lh * 2); desenhar(cab, mc, { fundo: SOFT, negrito: true, cor: MUTED, tam: tam - 1 }); }
        linhas.forEach(function (lin) {
          var dados = lin.cels || lin, m = medir(dados, lin.negrito);
          if (y + m.h > PH - MB) { novaPagina(); if (mc) desenhar(cab, mc, { fundo: SOFT, negrito: true, cor: MUTED, tam: tam - 1 }); }
          desenhar(dados, m, { negrito: lin.negrito, fundo: lin.fundo, cor: lin.cor });
        });
        y += 2;
      }

      // ---------- cabeçalho ----------
      if (logo) doc.addImage(logo, 'JPEG', ML, y, 40, 15.9);
      fonte(8, true); cor(GOLDD);
      doc.text('SIMULAÇÃO DE IBS E CBS', PW - MR, y + 5, { align: 'right', charSpace: 0.35 });
      fonte(8.5, false); cor(MUTED);
      var g = rel.geradoEm;
      var quando = ('0' + g.getDate()).slice(-2) + '/' + ('0' + (g.getMonth() + 1)).slice(-2) + '/' + g.getFullYear() + ' às ' + ('0' + g.getHours()).slice(-2) + 'h' + ('0' + g.getMinutes()).slice(-2);
      doc.text(seguro('Gerada em ' + quando), PW - MR, y + 10, { align: 'right' });
      y += 20;
      doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]); doc.setLineWidth(0.8); doc.line(ML, y, ML + W, y);
      y += 6;
      texto('Calculadora de IBS e CBS por produto e serviço', { tam: 15, negrito: true, cor: NAVY, depois: 0.5 });
      texto(rel.item.tipo + ' ' + rel.item.codigo + ' — ' + rel.item.descricao, { tam: 10, cor: INK, depois: 0 });
      if (rel.item.contexto && rel.item.contexto !== rel.item.descricao) texto(rel.item.contexto, { tam: 8.5, cor: MUTED, depois: 0 });

      // ---------- dados da operação ----------
      titulo('Dados da operação');
      var e = rel.enquadramento, op = rel.operacao;
      tabela([{ w: 46 }, { w: W - 46 }], null, [
        [rel.item.tipo === 'NCM' ? 'Produto (NCM)' : 'Serviço (NBS)', rel.item.codigo + ' — ' + rel.item.descricao],
        ['Enquadramento (cClassTrib)', e.cClassTrib + ' — ' + e.descricao],
        ['Situação tributária (CST)', e.cst + ' — ' + e.cstDesc],
        ['Tratamento tributário', e.tratamento],
        ['Valor da operação', op.valor],
        ['Ano e data considerada', op.ano + ' (' + op.data + ')' + (op.simulacao ? ' — alíquotas simuladas' : ' — alíquotas de teste das tabelas oficiais')],
        ['Destino', op.local || 'Não informado']
      ].map(function (l) { return { cels: l }; }), { tam: 9 });

      // ---------- resultado ----------
      titulo('Resultado');
      garantir(24);
      var bw = (W - 8) / 3, bx = ML;
      [['CBS + IBS', rel.total], ['Carga sobre o valor', rel.carga], ['Valor com CBS e IBS', rel.comTributos]].forEach(function (c) {
        doc.setFillColor(SOFT[0], SOFT[1], SOFT[2]);
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
        doc.roundedRect(bx, y, bw, 19, 2, 2, 'FD');
        fonte(7.5, true); cor(MUTED);
        doc.text(seguro(c[0]).toUpperCase(), bx + 4, y + 6, { charSpace: 0.2 });
        fonte(14, true); cor(NAVY);
        doc.text(seguro(c[1]), bx + 4, y + 14.2);
        bx += bw + 4;
      });
      y += 24;

      if (rel.tributos.length) {
        var cw = [W - 4 * 30, 30, 30, 30, 30];
        tabela(cw.map(function (w, i) { return { w: w, dir: i > 0 }; }), ['Tributo', 'Alíquota', 'Redução', 'Alíquota efetiva', 'Valor'],
          rel.tributos.map(function (t) { return [t.rot, t.aliquota, t.reducao, t.efetiva, t.valor]; })
            .concat([{ cels: ['Total', '', '', rel.efetTotal, rel.total], negrito: true, fundo: SOFT, cor: NAVY }]), { tam: 9 });
      }
      texto('Base de cálculo: ' + rel.base + '.', { tam: 8.5, cor: MUTED });
      rel.avisos.forEach(function (a) { marcador(a, { tam: 8.5, cor: INK }); });

      // ---------- créditos ----------
      titulo('Efeitos sobre créditos');
      rel.creditos.forEach(function (c) { marcador(c); });
      texto('Indicadores da tabela oficial de classificação tributária (cClassTrib). O aproveitamento efetivo depende do regime do adquirente e da regularidade da operação.', { tam: 8, cor: MUTED });

      // ---------- comparativo ----------
      if (rel.comparativo.length) {
        titulo('Comparativo de enquadramentos para este código');
        tabela([{ w: W - 56 }, { w: 24, dir: true }, { w: 32, dir: true }], ['Enquadramento', 'Carga', 'CBS + IBS'],
          rel.comparativo.map(function (c) { return { cels: [c.rot + (c.atual ? ' (selecionado)' : ''), c.carga, c.total], negrito: c.atual, fundo: c.atual ? CREME : null }; }), { tam: 8.5 });
        texto('Enquadramentos em que o código consta dos anexos da LC 214/2025, comparados com a regra geral. Cada um depende das condições previstas na lei.', { tam: 8, cor: MUTED });
      }

      // ---------- fundamentação ----------
      titulo('Fundamentação legal');
      if (rel.fundamentacao) texto(rel.fundamentacao.curto + (/^art/i.test(rel.fundamentacao.curto) ? ' da LC 214/2025' : ''), { negrito: true, cor: NAVY, depois: 0.8 });
      e.anexos.forEach(function (a) { texto(a.rot + ': ' + a.txt, { tam: 8.8, depois: 1 }); });
      if (rel.fundamentacao && rel.fundamentacao.txt) texto(rel.fundamentacao.txt, { tam: 8.3, cor: [59, 69, 90] });

      // ---------- memória ----------
      titulo('Memória de cálculo');
      rel.memoria.forEach(function (m) { marcador(m, { tam: 8.8 }); });

      // ---------- premissas ----------
      titulo('Premissas e limitações');
      [
        'Cálculo com as tabelas e as regras do código aberto da Calculadora de Tributos da Receita Federal (licença MIT), base ' + rel.fonte.versaoBase + ' de ' + rel.fonte.dataVersaoBase.split('-').reverse().join('/') + '. Ferramenta independente, sem vínculo com a Receita Federal.',
        op.simulacao ? 'As alíquotas a partir de 2027 são simulações: as alíquotas de referência ainda serão fixadas, e as de cada Estado e Município podem divergir da referência.' : 'Em 2026, valem as alíquotas de teste das tabelas oficiais (CBS de 0,9% e IBS de 0,1%).',
        'Não considera Imposto Seletivo, Simples Nacional, compras governamentais, suspensão, regimes monofásicos, o valor de créditos presumidos nem requisitos de fato exigidos por cada enquadramento.',
        'Simulação de caráter informativo. Não constitui parecer nem substitui a análise das operações e da legislação aplicável a cada caso.'
      ].forEach(function (p) { marcador(p, { tam: 8.5, cor: MUTED }); });
      fonte(8.5, false); cor(GOLDD);
      garantir(6);
      doc.textWithLink('Abrir esta simulação no site', ML, y + 3.5, { url: rel.endereco });
      y += 7;

      // ---------- chamada ----------
      fonte(10.5, false);
      var lc = doc.splitTextToSize(seguro(rel.chamada), W - 16), alt = lc.length * altLinha(10.5) + 17;
      garantir(alt + 4);
      y += 3;
      doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.roundedRect(ML, y, W, alt, 2.5, 2.5, 'F');
      doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.roundedRect(ML, y + 1.2, W, alt - 1.2, 2.5, 2.5, 'F');
      var cy = y + 9;
      fonte(10.5, false); doc.setTextColor(255, 255, 255);
      lc.forEach(function (l) { doc.text(l, ML + 8, cy); cy += altLinha(10.5); });
      cy += 2.5;
      fonte(10, true); cor(GOLD);
      var rotulo = seguro('Solicitar análise tributária: WhatsApp ' + rel.whatsapp + ' · scalambrini.com');
      doc.textWithLink(rotulo, ML + 8, cy, { url: rel.whatsappUrl });
      y += alt + 2;

      // ---------- rodapés ----------
      var n = doc.getNumberOfPages();
      for (var p = 1; p <= n; p++) {
        doc.setPage(p);
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3);
        doc.line(ML, PH - 13, ML + W, PH - 13);
        fonte(7.5, false); cor(MUTED);
        doc.text(seguro('Scalambrini e Saraiva Advogados · São Paulo · Brasília · scalambrini.com · Simulação informativa, não constitui parecer.'), ML, PH - 8.5);
        doc.text('Página ' + p + ' de ' + n, PW - MR, PH - 8.5, { align: 'right' });
      }

      var nome = 'simulacao-ibs-cbs-' + rel.item.codigo.replace(/\D/g, '') + '-' + rel.enquadramento.cClassTrib + '-' + rel.operacao.ano + '.pdf';
      doc.save(nome);
      return nome;
    });
  }

  window.PdfSimulacao = { gerar: gerar };
})();
