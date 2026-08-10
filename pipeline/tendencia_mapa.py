#!/usr/bin/env python3
"""Poda o tendencia.json para o que a ficha do mapa precisa.

O series.html carrega a série anual inteira de cada estação — é dela que saem os
gráficos de lá. O mapa só quer o número que a série resume, a inclinação de
Theil-Sen em % da média por década, e os dois avisos que decidem se ela pode ser
lida como notícia: se passou no teste de significância e se a estação fica numa
barragem. Sem esta poda o blob entraria com 1,6 MB de pontos que nenhuma ficha
desenha.

Só entram estações que o mapa realmente tem — a análise roda sobre o inventário
inteiro, e o mapa desenha um subconjunto.
"""
import json
from pathlib import Path

S = Path(__file__).parent

# %/década do corte do filtro "só as que secam". 25% por década é uma queda de
# metade da vazão em trinta anos — a escala em que o rio muda de tamanho, não a
# em que oscila.
LIMITE = -25.0


def main():
    tend = json.loads((S / "tendencia.json").read_text())
    rede = json.loads((S / "rede_vazao.json").read_text())
    no_mapa = {e["cod"] for e in rede["estacoes"]}

    est = {}
    for r in tend["estacoes"]:
        if r["cod"] not in no_mapa:
            continue
        # [%/década, significativa, obra, anos, primeiro, último]
        est[r["cod"]] = [r["pct"], int(r["sig"]), int(r["obra"]),
                         r["n"], r["ini"], r["fim"]]

    secando = [c for c, v in est.items() if v[0] <= LIMITE and v[1] and not v[2]]
    saida = {"criterios": tend["criterios"], "limite": LIMITE, "estacoes": est}
    destino = S / "tendencia_mapa.json"
    destino.write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")))

    print(f"  {len(est):,} das {len(tend['estacoes']):,} estações com tendência estão no mapa")
    print(f"  {len(secando):,} caem {abs(LIMITE):.0f}% ou mais por década, "
          "com significância e fora de barragem")
    print(f"  {destino} — {destino.stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
