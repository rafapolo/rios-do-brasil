#!/usr/bin/env python3
"""Estações de tratamento de esgoto do Atlas Esgotos da ANA (camada ETE 2019).

Complementa o que o poluicao.py já faz: as outorgas dizem onde o efluente
ENTRA no rio, e o Atlas por município diz quanta carga a cidade gera. Faltava
onde ele é (ou deveria ser) TRATADO antes disso -- e com que eficiência.

Três armadilhas desta camada, todas medidas contra o serviço:

  1. **Uma linha por município atendido, não por ETE física.** "ETE Barueri"
     aparece 13 vezes, uma para cada município da RMSP que manda esgoto para
     ela; "ETE ABC", 9. Contar linha é inflar. O grão real é ETE_CD, e é por
     ele que se deduplica -- guardando quantos municípios cada uma atende, que
     é informação de verdade sobre o porte.
  2. **ETE_DS_STATUS vem com mojibake na origem.** "Não localizadas" chega como
     "Nto", "Nmo", "Nro" e "Nno localizadas", cada variante contando separado.
     Normalizamos para não virar quatro categorias no mapa.
  3. **ETE_NM_CORPORECEPTOR vem em branco na maioria** e ETE_QT_POPPROJ vem
     zerado até nas grandes da RMSP. Nenhum dos dois serve de eixo; o corpo
     receptor, quando existe, é só texto de apoio na ficha.

O ponto vem em SIRGAS 2000 (wkid 4674), o mesmo datum da BHO -- não há
reprojeção a fazer.
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

S = Path(__file__).parent
URL = ("https://www.snirh.gov.br/arcgis/rest/services/SPR/"
       "ETE_2019/MapServer/0/query")
CAMPOS = ("ETE_CD,ETE_NM,ETE_DS_STATUS,ETE_DS_TIPOLOGIA,ETE_DS_TIPOLOGRESUMIDA,"
          "ETE_NM_CORPORECEPTOR,ETE_MUN_CD_IBGE,ETE_AA_OPERACAO,"
          "ETE_PC_REMOCAODBO,ETE_PC_REMOCAOP,ETE_PC_REMOCAON")

# Os códigos da tipologia resumida não são autoexplicativos e a camada não traz
# dicionário; sem isto a ficha do mapa mostraria "RAN" e "QBI" cru. Os sete
# abaixo são TODOS os valores que a camada usa, e o significado de cada um foi
# lido do campo longo ETE_DS_TIPOLOGIA que acompanha cada linha -- não chutado.
TIPOLOGIA = {
    "LAG": "lagoa",
    "RAN": "reator anaeróbio",
    "LAT": "lodos ativados",
    "SIM": "tratamento simplificado",
    "QBI": "físico-químico",
    "MIS": "misto",
    "ESP": None,   # "Sem informações/Não localizada" -- não é tipologia
}


def pega(params, tentativas=5):
    for i in range(tentativas):
        try:
            r = requests.post(URL, data={**params, "f": "json"}, timeout=300)
            r.raise_for_status()
            d = r.json()
            if "error" in d:
                raise RuntimeError(str(d["error"])[:200])
            return d
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                print(f"  falhou: {e}", file=sys.stderr)
                return {"features": []}
            time.sleep(3 * (i + 1))


def limpa_status(s):
    """'Nto/Nmo/Nro/Nno localizadas' são a mesma coisa, quebradas no encoding."""
    s = (s or "").strip()
    if not s:
        return "sem informação"
    baixo = s.lower()
    if "localizadas" in baixo:
        return "não localizada"
    if baixo.startswith("problemas operacionais"):
        return "problemas operacionais"
    if "inativa" in baixo:
        return "inativa"
    if "constru" in baixo or "amplia" in baixo:
        return "em construção"
    if "projeto" in baixo or "prevista" in baixo or "planejada" in baixo:
        return "planejada"
    return baixo


def main():
    meta = requests.get(URL.replace("/query", ""), params={"f": "json"},
                        timeout=120).json()
    pag = int(meta.get("maxRecordCount") or 1000)
    n = pega({"where": "1=1", "returnCountOnly": "true"})["count"]
    print(f"{n} linhas em {-(-n // pag)} páginas de {pag}")

    def pagina(off):
        d = pega({"where": "1=1", "outFields": CAMPOS, "returnGeometry": "true",
                  "orderByFields": "OBJECTID", "resultOffset": off,
                  "resultRecordCount": pag})
        return d.get("features", [])

    with ThreadPoolExecutor(6) as ex:
        partes = list(ex.map(pagina, range(0, n, pag)))
    feats = [f for p in partes for f in p]
    if len(feats) != n:
        print(f"  ATENÇÃO: recebidas {len(feats)} de {n}", file=sys.stderr)

    # Dedup por ETE_CD: a mesma estação repete uma linha por município atendido.
    # Fica a primeira geometria (todas as repetições trazem o mesmo ponto) e a
    # contagem de municípios, que é o que a repetição de fato informa.
    por_cd = {}
    sem_geo = 0
    for f in feats:
        a, g = f["attributes"], f.get("geometry") or {}
        if g.get("x") is None or g.get("y") is None:
            sem_geo += 1
            continue
        cd = a.get("ETE_CD")
        chave = cd if cd not in (None, "", 0) else f"_{a.get('ETE_NM')}_{g['x']}"
        e = por_cd.get(chave)
        if e is None:
            pc = a.get("ETE_PC_REMOCAODBO")
            e = por_cd[chave] = {
                "nome": (a.get("ETE_NM") or "").strip() or "ETE sem nome",
                "lon": round(float(g["x"]), 4),
                "lat": round(float(g["y"]), 4),
                "status": limpa_status(a.get("ETE_DS_STATUS")),
                # A remoção vem como fração (0,65), não porcentagem.
                "dbo": round(float(pc) * 100) if pc not in (None, "") else None,
                "tipo": TIPOLOGIA.get((a.get("ETE_DS_TIPOLOGRESUMIDA") or "").strip()),
                "corpo": (a.get("ETE_NM_CORPORECEPTOR") or "").strip() or None,
                "ano": a.get("ETE_AA_OPERACAO") or None,
                "mun": 0,
            }
        e["mun"] += 1

    saida = sorted(por_cd.values(), key=lambda e: (-e["mun"], e["nome"]))
    ativas = sum(1 for e in saida if e["status"] == "ativa")
    com_dbo = sum(1 for e in saida if e["dbo"] is not None)
    maior = saida[0] if saida else None

    (S / "etes.json").write_text(
        json.dumps(saida, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(feats)} linhas -> {len(saida)} ETEs distintas "
          f"({sem_geo} sem geometria descartadas)")
    print(f"  {ativas} ativas, {com_dbo} com remoção de DBO informada")
    if maior:
        print(f"  a que atende mais municípios: {maior['nome']} ({maior['mun']})")
    print(f"-> etes.json ({(S / 'etes.json').stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main()
