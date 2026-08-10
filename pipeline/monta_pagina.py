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


tpl = (S / "template.html").read_text()
pagina = tpl.replace("/*__FONTE__*/", (S / "fonte_mono.txt").read_text().strip())
pagina = pagina.replace("/*__RESERV__*/", embutir("reservatorios.json"))
# Opcional: quem não rodou o baixa_etes.py monta a página sem a camada, e o
# template esconde o interruptor sozinho em vez de quebrar.
if (S / "etes.json").exists():
    pagina = pagina.replace("/*__ETES__*/", embutir("etes.json"))
else:
    print("  etes.json ausente — mapa sai sem a camada de tratamento")
# Idem para a tendência: sem ela a ficha da estação perde a linha de %/década e
# o filtro "só as que secam" some do painel de camadas.
if (S / "tendencia_mapa.json").exists():
    pagina = pagina.replace("/*__TENDMAPA__*/", embutir("tendencia_mapa.json"))
else:
    print("  tendencia_mapa.json ausente — mapa sai sem tendência por estação")
pagina = pagina.replace("/*__DADOS__*/", embutir("rede_vazao.json"))
out = S / "rios_brasil.html"
out.write_text(pagina)
print(f"{out} — {out.stat().st_size / 1e6:.1f} MB")
