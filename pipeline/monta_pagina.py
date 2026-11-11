#!/usr/bin/env python3
"""Injeta os dados (gzip + base64) e a fonte no template e escreve a página."""
import base64
import gzip
from pathlib import Path

S = Path(__file__).parent


def embutir(nome):
    """Comprime o JSON e devolve em base64, guardando o .gz ao lado."""
    cru = (S / nome).read_bytes()
    gz = gzip.compress(cru, 9)
    (S / (nome + ".gz")).write_bytes(gz)
    b64 = base64.b64encode(gz).decode()
    print(f"  {nome}: {len(cru) / 1e6:.1f} MB -> gz {len(gz) / 1e6:.1f} -> base64 {len(b64) / 1e6:.1f}")
    return b64


def embutir_texto(nome):
    """Como embutir(), para um arquivo de texto que não é JSON (a biblioteca e o CSS dela)."""
    cru = (S / nome).read_bytes()
    gz = gzip.compress(cru, 9)
    b64 = base64.b64encode(gz).decode()
    print(f"  {nome}: {len(cru) / 1e3:.0f} kB -> gz {len(gz) / 1e3:.0f} -> base64 {len(b64) / 1e3:.0f}")
    return b64


tpl = (S / "template.html").read_text()
pagina = tpl.replace("/*__FONTE__*/", (S / "fonte_mono.txt").read_text().strip())
# MapLibre GL JS 4.7.1 (BSD-3-Clause), embutida como o resto: a página abre por file://, offline.
# O .js e o .css ficam em vendor/ com a licença; vão gzip + base64 e a página os descomprime na carga.
pagina = pagina.replace("/*__MAPLIBRE__*/", embutir_texto("vendor/maplibre-gl-4.7.1.js"))
pagina = pagina.replace("/*__MAPLIBRECSS__*/", embutir_texto("vendor/maplibre-gl-4.7.1.css"))
pagina = pagina.replace("/*__RESERV__*/", embutir("reservatorios.json"))
# Opcional: quem não rodou o baixa_etes.py monta a página sem a camada, e o
# template esconde o interruptor sozinho em vez de quebrar.
if (S / "etes.json").exists():
    pagina = pagina.replace("/*__ETES__*/", embutir("etes.json"))
else:
    print("  etes.json ausente — mapa sai sem a camada de tratamento")
# Idem para as barragens: sem barragens.json a camada de pontos some, e sem os
# campos livre/barJus/barMont no rede_vazao.json o modo "Rio livre" também.
if (S / "barragens.json").exists():
    pagina = pagina.replace("/*__BARRAGENS__*/", embutir("barragens.json"))
else:
    print("  barragens.json ausente — mapa sai sem a camada de barragens")
# Idem para a tendência: sem ela a ficha da estação perde a linha de %/década e
# o modo "Tendência" some do cartão "O que ver", junto com a faixa dele.
if (S / "tendencia_mapa.json").exists():
    pagina = pagina.replace("/*__TENDMAPA__*/", embutir("tendencia_mapa.json"))
else:
    print("  tendencia_mapa.json ausente — mapa sai sem tendência por estação")
# O relevo da vista 3D (relevo.py): a grade binária vai gzip + base64, e a geometria em JSON
# puro ao lado. Opcional: sem ele o 3D só inclina a câmera, como antes. As chaves são
# conferidas porque um relevo.json velho quebraria a decodificação calado.
if (S / "relevo.json").exists() and (S / "relevo.bin").exists():
    import json
    meta = json.loads((S / "relevo.json").read_text())
    faltam = {"latS", "lonO", "passo", "nlat", "nlon", "quantum", "teto", "fator", "max"} - meta.keys()
    if faltam:
        raise SystemExit(f"relevo.json sem {sorted(faltam)}: rode o relevo.py de novo")
    if (S / "relevo.bin").stat().st_size != 2 * meta["nlat"] * meta["nlon"]:
        raise SystemExit("relevo.bin não bate com o relevo.json: rode o relevo.py de novo")
    pagina = pagina.replace("/*__RELEVOMETA__*/", json.dumps(meta, ensure_ascii=False))
    pagina = pagina.replace("/*__RELEVO__*/", embutir_texto("relevo.bin"))
else:
    print("  relevo.json/relevo.bin ausentes — o 3D sai sem relevo")
# O tour: roteiro (design/tour.json, números e frases conferidos no banco — ver design/tour.md),
# o código que dirige a página e o som. Texto puro, sem compressão: são ~40 kB.
pagina = pagina.replace("/*__ROTEIRO__*/", (S.parent / "design" / "tour.json").read_text().replace("</", "<\\/"))
pagina = pagina.replace("/*__SOMTOUR__*/", (S / "som_tour.js").read_text())
pagina = pagina.replace("/*__TOUR__*/", (S / "tour.js").read_text())
pagina = pagina.replace("/*__DADOS__*/", embutir("rede_vazao.json"))
out = S / "rios_brasil.html"
out.write_text(pagina)
print(f"{out} — {out.stat().st_size / 1e6:.1f} MB")
