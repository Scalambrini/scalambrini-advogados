#!/usr/bin/env python3
"""Gera os dados da Calculadora IBS e CBS por NCM/NBS (scalambrini.com/calculadora/ncm-nbs/).

Lê as migrações SQL do repositório público da Receita Federal
(https://github.com/ReceitaFederal/calculadora-rtc-regime-regular, licença MIT),
monta o banco SQLite na mesma ordem usada pelo Flyway do projeto e exporta, em JSON,
somente as tabelas usadas pelo cálculo de CBS e IBS no navegador.

Uso:
    python3 -I gerar_dados.py --rfb CAMINHO_DO_CLONE --saida calculadora/ncm-nbs/dados [--commit SHA]

Nada do repositório da Receita é executado além do SQL, aplicado a um banco temporário.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sqlite3
import tempfile

IBS_CBS = (2, 3, 4)  # CBS, IBS estadual, IBS municipal


def montar_banco(rfb, destino):
    """Aplica beforeMigrate, B0001, V0002..Vnnnn e afterMigrate, como o Flyway (mixed=true).

    Migrações com 'PRAGMA foreign_keys' rodam fora de transação; as demais, em transação
    própria (necessário para o 'PRAGMA defer_foreign_keys' de algumas delas)."""
    con = sqlite3.connect(destino)
    con.isolation_level = None
    base = os.path.join(rfb, 'flyway', 'sql')

    def rodar(caminho, transacao=False):
        sql = open(caminho, encoding='utf-8').read()
        if transacao and not re.search(r'(?im)^\s*PRAGMA\s+foreign_keys', sql):
            sql = 'BEGIN;\n' + sql + '\nCOMMIT;'
        con.executescript(sql)

    rodar(os.path.join(base, 'criacao', 'beforeMigrate.sql'))
    rodar(os.path.join(base, 'criacao', 'B0001__sistema_tributario_completo.sql'))
    versoes = sorted(glob.glob(os.path.join(base, 'manutencao', 'V*.sql')),
                     key=lambda p: int(re.match(r'V(\d+)', os.path.basename(p)).group(1)))
    for v in versoes:
        rodar(v, transacao=True)
    rodar(os.path.join(base, 'criacao', 'afterMigrate.sql'))
    return con


ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']
VAZIAS = set(('servicos servico de da do das dos e em para ou os as com nao a o na no nas nos por que outros outras outro outra '
              'exceto inclusive mesmo qualquer sua seu suas seus classificados subposicoes anteriores relacionados destinados destinadas '
              'diretamente demais').split())
SINONIMOS = {'ensin': 'educa'}  # "ensino" (anexo II) = "educação" (NBS)


def termos(s):
    import unicodedata
    s = unicodedata.normalize('NFD', (s or '').lower()).encode('ascii', 'ignore').decode()
    out = set()
    for p in re.findall(r'[a-z]{3,}', s):
        if p not in VAZIAS:
            p = p[:5]
            out.add(SINONIMOS.get(p, p))
    return out


def contencao(descricao, texto):
    d, t = termos(descricao), termos(texto)
    return len(d & t) / len(d) if d else 0.0


def corrigir_anexos(con, ncm_ap, nbs_ap):
    """Corrige os vínculos código → item de anexo das tabelas da Receita.

    Na base V0059, os vínculos NBS_APLICAVEL → ANEXO estão deslocados (ex.: NBS 1.2301.92.00,
    fisioterapia, apontava para o item 10 do Anexo III, enfermagem; o correto é o item 11), e dois
    vínculos NCM apontam para item de outro anexo. As regras de cálculo e de enquadramento não mudam:
    só o item exibido. Para NBS, o item é refeito pela descrição oficial do código, dentro do anexo da
    classificação; se não houver correspondência inequívoca, nenhum item é exibido.
    Retorna a lista de alterações."""
    anexos = {r[0]: (r[1], r[2], r[3]) for r in con.execute(
        "SELECT ANXO_ID, ANXO_NUMERO, ANXO_NUMERO_ITEM, ANXO_TEXTO_ITEM FROM ANEXO")}
    por_numero = {}
    for aid, (n, i, t) in anexos.items():
        por_numero.setdefault(n, []).append((aid, i, t))
    anexo_classe = {r[0]: ROMANOS[int(r[1])] if (r[1] or '').isdigit() and int(r[1]) < len(ROMANOS) else None
                    for r in con.execute("SELECT CLTR_ID, CLTR_ANEXO FROM CLASSIFICACAO_TRIBUTARIA")}
    desc_nbs = {r[0]: r[1] for r in con.execute("SELECT NBS_CD, NBS_DESCRICAO FROM NBS")}
    alteracoes = []

    def rotulo(aid):
        return '%s-%s' % anexos[aid][:2] if aid in anexos else '-'

    for l in nbs_ap:  # [id, codigo, cltr, anexo, inicio, fim]
        aid, esperado = l[3], anexo_classe.get(l[2])
        if aid is None:
            continue
        desc = desc_nbs.get(l[1], '')
        cands = sorted(((contencao(desc, t), len(termos(desc) & termos(t)) / max(1, len(termos(desc) | termos(t))), a)
                        for a, i, t in por_numero.get(esperado, [])), reverse=True)
        # aceita o item só se for a melhor correspondência do anexo, sem empate
        novo = None
        if cands and cands[0][0] >= 0.75 and (len(cands) == 1 or cands[0][:2] > cands[1][:2]):
            novo = cands[0][2]
        if novo == aid:
            continue
        alteracoes.append(('NBS', l[1], l[2], rotulo(aid), rotulo(novo) if novo else 'sem item'))
        l[3] = novo

    for l in ncm_ap:
        aid, esperado = l[3], anexo_classe.get(l[2])
        if aid is None or aid not in anexos or anexos[aid][0] == esperado:
            continue
        alteracoes.append(('NCM', l[1], l[2], rotulo(aid), 'sem item'))
        l[3] = None
    return alteracoes


def num(v):
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


def limpar(t):
    if t is None:
        return None
    return t.replace('\\n', '\n').strip()


def exportar(con, saida, commit, referencia):
    con.row_factory = sqlite3.Row
    q = lambda sql, *a: con.execute(sql, a).fetchall()

    versao = q("SELECT VRBD_VERSAO_BASE_DADO v, VRBD_DATA d, VRBD_DESCRICAO x FROM VERSAO_BASE_DADO ORDER BY VRBD_ID DESC LIMIT 1")[0]
    meta = {
        'fonte': 'Receita Federal do Brasil - Calculadora de Tributos (calculadora-rtc-regime-regular), licença MIT',
        'repositorio': 'https://github.com/ReceitaFederal/calculadora-rtc-regime-regular',
        'commit': commit or '',
        'versaoBase': versao['v'],
        'dataVersaoBase': (versao['d'] or '')[:10],
        'geradoEm': dt.date.today().isoformat(),
    }

    sitr_ibs = {r['TRST_SITR_ID'] for r in q(
        "SELECT DISTINCT TRST_SITR_ID FROM TRIBUTO_SITUACAO_TRIBUTARIA WHERE TRST_TBTO_ID IN (2,3,4)")}

    cst = {}
    for r in q("SELECT * FROM SITUACAO_TRIBUTARIA"):
        if r['SITR_ID'] not in sitr_ibs:
            continue
        cst[str(r['SITR_ID'])] = {
            'cd': r['SITR_CD'], 'd': r['SITR_DESCRICAO'],
            'g': r['SITR_IND_GIBSCBS'], 'red': r['SITR_IND_GRED'], 'dif': r['SITR_IND_GDIF'],
            'mono': r['SITR_IND_GIBSCBSMONO'],
            'i': r['SITR_INICIO_VIGENCIA'], 'f': r['SITR_FIM_VIGENCIA'],
        }

    trat = {}
    for r in q("SELECT * FROM TRATAMENTO_TRIBUTARIO"):
        trat[str(r['TRTR_ID'])] = {
            'd': r['TRTR_DESCRICAO'],
            'a': r['TRTR_EXPRESSAO_ALIQUOTA'] or '', 'e': r['TRTR_EXPRESSAO_ALIQUOTA_EFETIVA'] or '',
            'b': r['TRTR_EXPRESSAO_BASE_CALCULO'] or '', 'c': r['TRTR_EXPRESSAO_TRIBUTO_CALCULADO'] or '',
            'v': r['TRTR_EXPRESSAO_TRIBUTO_DEVIDO'] or '',
            'pd': r['TRTR_EXPRESSAO_PERCENTUAL_DIFERIMENTO'] or '', 'vd': r['TRTR_EXPRESSAO_VALOR_DIFERIMENTO'] or '',
            'red': r['TRTR_IN_POSSUI_PERCENTUAL_REDUCAO'], 'aj': r['TRTR_IN_POSSUI_AJUSTE'],
            'mono': r['TRTR_IN_POSSUI_MONOFASIA'],
        }

    aliq_ref = [{'t': r['ALRE_TBTO_ID'], 'v': num(r['ALRE_VALOR']), 'i': r['ALRE_INICIO_VIGENCIA'], 'f': r['ALRE_FIM_VIGENCIA']}
                for r in q("SELECT * FROM ALIQUOTA_REFERENCIA WHERE ALRE_TBTO_ID IN (2,3,4)")]
    aliq_padrao = q("SELECT COUNT(*) n FROM ALIQUOTA_PADRAO")[0]['n']

    def por_cltr(sql):
        d = {}
        for r in q(sql):
            d.setdefault(r[0], []).append([x for x in tuple(r)[1:]])
        return d

    red = por_cltr("SELECT PERE_CLTR_ID, PERE_TBTO_ID, PERE_VALOR, PERE_INICIO_VIGENCIA, PERE_FIM_VIGENCIA FROM PERCENTUAL_REDUCAO")
    tc = por_cltr("SELECT TRCL_CLTR_ID, TRCL_TRTR_ID, TRCL_INICIO_VIGENCIA, TRCL_FIM_VIGENCIA FROM TRATAMENTO_CLASSIFICACAO")
    fc = por_cltr("SELECT FDCL_CLTR_ID, FDCL_FDLG_ID, FDCL_INICIO_VIGENCIA, FDCL_FIM_VIGENCIA FROM FUNDAMENTACAO_CLASSIFICACAO")
    afix = por_cltr("SELECT AADV_CLTR_ID, AADV_TBTO_ID, AADV_VALOR, AADV_INICIO_VIGENCIA, AADV_FIM_VIGENCIA FROM ALIQUOTA_AD_VALOREM WHERE AADV_CLTR_ID IS NOT NULL AND AADV_TBTO_ID IN (2,3,4)")
    tem_ncm = {r[0] for r in q("SELECT DISTINCT NCMA_CLTR_ID FROM NCM_APLICAVEL")}
    tem_nbs = {r[0] for r in q("SELECT DISTINCT NBSA_CLTR_ID FROM NBS_APLICAVEL")}

    classes = []
    fund_usadas = set()
    for r in q("SELECT * FROM CLASSIFICACAO_TRIBUTARIA ORDER BY CLTR_CD, CLTR_ID"):
        if r['CLTR_SITR_ID'] not in sitr_ibs:
            continue
        cid = r['CLTR_ID']
        for f in fc.get(cid, []):
            fund_usadas.add(f[0])
        classes.append({
            'id': cid, 'cd': r['CLTR_CD'], 'st': r['CLTR_SITR_ID'], 'd': limpar(r['CLTR_DESCRICAO']),
            'tipo': r['CLTR_TIPO_ALIQUOTA'], 'nom': r['CLTR_NOMENCLATURA'], 'mem': r['CLTR_MEMORIA_CALCULO'],
            'apCbs': r['CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_CBS'], 'apIbs': r['CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_IBS'],
            'cpf': r['CLTR_IN_CREDITO_PRESUMIDO_FORNECEDOR'], 'cpa': r['CLTR_IN_CREDITO_PRESUMIDO_ADQUIRENTE'],
            'ant': r['CLTR_CREDITO_OPERACAO_ANTECEDENTE'], 'anexo': r['CLTR_ANEXO'] or None,
            'i': r['CLTR_INICIO_VIGENCIA'], 'f': r['CLTR_FIM_VIGENCIA'],
            'trat': tc.get(cid, []), 'red': [[a, num(b), c, d] for a, b, c, d in red.get(cid, [])],
            'fund': fc.get(cid, []), 'fixa': [[a, num(b), c, d] for a, b, c, d in afix.get(cid, [])],
            'lNcm': 1 if cid in tem_ncm else 0, 'lNbs': 1 if cid in tem_nbs else 0,
        })

    fund = {}
    for r in q("SELECT * FROM FUNDAMENTACAO_LEGAL"):
        if r['FDLG_ID'] in fund_usadas:
            fund[str(r['FDLG_ID'])] = {'curto': limpar(r['FDLG_TEXTO_CURTO']), 'txt': limpar(r['FDLG_TEXTO']),
                                       'ref': limpar(r['FDLG_REFERENCIA_NORMATIVA'])}

    anexos = {str(r['ANXO_ID']): [r['ANXO_NUMERO'], r['ANXO_NUMERO_ITEM'], limpar(r['ANXO_TEXTO_ITEM']),
                                  r['ANXO_INICIO_VIGENCIA'], r['ANXO_FIM_VIGENCIA']]
              for r in q("SELECT * FROM ANEXO")}

    ncm_ap = [list(r) for r in q("SELECT NCMA_ID, NCMA_NCM_CD, NCMA_CLTR_ID, NCMA_ANXO_ID, NCMA_INICIO_VIGENCIA, NCMA_FIM_VIGENCIA FROM NCM_APLICAVEL ORDER BY NCMA_ID")]
    ncm_ex = [list(r) for r in q("SELECT ENCM_NCMA_ID, ENCM_NCM_CD, ENCM_INICIO_VIGENCIA, ENCM_FIM_VIGENCIA FROM EXCECAO_NCM_APLICAVEL")]
    nbs_ap = [list(r) for r in q("SELECT NBSA_ID, NBSA_NBS_CD, NBSA_CLTR_ID, NBSA_ANXO_ID, NBSA_INICIO_VIGENCIA, NBSA_FIM_VIGENCIA FROM NBS_APLICAVEL ORDER BY NBSA_ID")]
    nbs_ex = [list(r) for r in q("SELECT ENBS_NBSA_ID, ENBS_NBS_CD, ENBS_INICIO_VIGENCIA, ENBS_FIM_VIGENCIA FROM EXCECAO_NBS_APLICAVEL")]
    con.row_factory = None
    alteracoes = corrigir_anexos(con, ncm_ap, nbs_ap)
    con.row_factory = sqlite3.Row
    cl_cd = {r['CLTR_ID']: r['CLTR_CD'] for r in q("SELECT CLTR_ID, CLTR_CD FROM CLASSIFICACAO_TRIBUTARIA")}
    print('Vínculos código → item de anexo corrigidos: %d' % len(alteracoes))
    for a in alteracoes:
        print('  %s %s (cClassTrib %s): %s -> %s' % (a[0], a[1], cl_cd.get(a[2], a[2]), a[3], a[4]))

    base = {
        'meta': meta, 'cst': cst, 'trat': trat, 'aliqRef': aliq_ref, 'aliqPadraoRegistros': aliq_padrao,
        'class': classes, 'fund': fund, 'anexos': anexos,
        'ncmAp': ncm_ap, 'ncmEx': ncm_ex, 'nbsAp': nbs_ap, 'nbsEx': nbs_ex,
    }

    ncm = [[r[0], limpar(r[1])] for r in q(
        "SELECT NCM_CD, NCM_DESCRICAO FROM NCM WHERE NCM_INICIO_VIGENCIA <= ? AND (NCM_FIM_VIGENCIA IS NULL OR NCM_FIM_VIGENCIA >= ?) ORDER BY NCM_CD",
        referencia, referencia)]
    nbs = [[r[0], limpar(r[1])] for r in q(
        "SELECT NBS_CD, NBS_DESCRICAO FROM NBS WHERE NBS_INICIO_VIGENCIA <= ? AND (NBS_FIM_VIGENCIA IS NULL OR NBS_FIM_VIGENCIA >= ?) ORDER BY NBS_CD",
        referencia, referencia)]

    ufs = [[r['UF_CD'], r['UF_SIGLA'], r['UF_NOME']] for r in q("SELECT * FROM UF WHERE UF_CD < 90 ORDER BY UF_SIGLA")]
    mun = {}
    for r in q("SELECT MUNI_CD, MUNI_UF_CD, MUNI_NOME FROM MUNICIPIO ORDER BY MUNI_NOME"):
        mun.setdefault(str(r['MUNI_UF_CD']), []).append([r['MUNI_CD'], r['MUNI_NOME']])

    os.makedirs(saida, exist_ok=True)

    def gravar(nome, obj):
        with open(os.path.join(saida, nome), 'w', encoding='utf-8') as fp:
            json.dump(obj, fp, ensure_ascii=False, separators=(',', ':'))

    gravar('base.json', base)
    gravar('ncm.json', ncm)
    gravar('nbs.json', nbs)
    gravar('municipios.json', {'ufs': ufs, 'mun': mun})
    return meta, len(classes), len(ncm), len(nbs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rfb', required=True, help='clone do repositório calculadora-rtc-regime-regular')
    ap.add_argument('--saida', required=True, help='pasta de destino dos JSON')
    ap.add_argument('--commit', default='', help='commit do repositório da Receita usado na geração')
    ap.add_argument('--referencia', default=dt.date.today().isoformat(), help='data de referência para NCM/NBS vigentes')
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        con = montar_banco(a.rfb, os.path.join(tmp, 'calculadora.db'))
        meta, nc, nn, nb = exportar(con, a.saida, a.commit, a.referencia)
        con.close()
    print('Base %s (%s) - %d classificações, %d NCM, %d NBS' % (meta['versaoBase'], meta['dataVersaoBase'], nc, nn, nb))


if __name__ == '__main__':
    main()
