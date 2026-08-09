#!/usr/bin/env python3
"""Baixa a rede de drenagem BHO 2017 5K da ANA (trechos Strahler >= 5)."""
import json
import sys
import time
from pathlib import Path

import requests

URL = "https://www.snirh.gov.br/arcgis/rest/services/SPR/BHO2017_5K_TRECHODRENAGEM/FeatureServer/0/query"
OUT = Path(__file__).parent / "bho"
OUT.mkdir(exist_ok=True)
PAGE = 1000
import sys as _s
ORDEM = int(_s.argv[1]) if len(_s.argv) > 1 else 5
WHERE = f"NUSTRAHLER>={ORDEM}"
FIELDS = "COTRECHO,NUTRJUS,NUAREAMONT,NUAREACONT,NUSTRAHLER,NORIOCOMP,COBACIA,NUCOMPTREC,DEDOMINIAL"


def fetch(session, offset):
    params = {
        "where": WHERE,
        "outFields": FIELDS,
        "returnGeometry": "true",
        "outSR": "4326",
        "geometryPrecision": "4",
        "orderByFields": "COTRECHO",
        "resultOffset": offset,
        "resultRecordCount": PAGE,
        "f": "geojson",
    }
    for attempt in range(5):
        try:
            r = session.get(URL, params=params, timeout=180)
            r.raise_for_status()
            d = r.json()
            if "features" not in d:
                raise ValueError(str(d)[:300])
            return d["features"]
        except Exception as e:  # noqa: BLE001
            print(f"  offset={offset} tentativa {attempt + 1} falhou: {e}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"offset {offset} falhou 5x")


def main():
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"
    feats = []
    offset = 0
    while True:
        page = fetch(session, offset)
        feats.extend(page)
        print(f"offset {offset}: +{len(page)} (total {len(feats)})")
        if len(page) < PAGE:
            break
        offset += PAGE
    path = OUT / f"bho_strahler{ORDEM}.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"\n{len(feats)} trechos -> {path} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
