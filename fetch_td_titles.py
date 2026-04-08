#!/usr/bin/env python3
"""
Baixa a lista de títulos do Tesouro Direto e gera titulos_td.json.

Uso:
  pip install requests
  python fetch_td_titles.py

Coloque este arquivo na raiz do repositório público vj-wallet-td-data.
O GitHub Actions executa este script e faz commit do titulos_td.json gerado.
"""

import csv
import json
import sys
from datetime import datetime, timezone
from io import StringIO

from curl_cffi import requests  # imita fingerprint TLS do Chrome — bypassa Cloudflare

# URL oficial do Tesouro Direto (bloqueada para requests normais, liberada com curl_cffi)
CSV_URL = "https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsfile.json"

OUTPUT_FILE = "titulos_td.json"


def classify_title(name: str) -> tuple:
    """Retorna (subtype, indexer) a partir do nome do título."""
    n = name.lower()
    if "selic" in n:
        return "tesouro_selic", "selic"
    if "prefixado" in n and ("juros" in n or "semestr" in n):
        return "tesouro_prefixado_juros", "prefixado"
    if "prefixado" in n:
        return "tesouro_prefixado", "prefixado"
    if "educa" in n:
        return "tesouro_educa", "ipca"
    if "renda" in n:
        return "tesouro_renda", "ipca"
    if "ipca" in n and ("juros" in n or "semestr" in n):
        return "tesouro_ipca_juros", "ipca"
    if "ipca" in n:
        return "tesouro_ipca", "ipca"
    return "tesouro_prefixado", "prefixado"


def parse_br_float(s: str) -> float:
    """Converte número no formato brasileiro (1.234,56) para float."""
    s = s.strip()
    if not s:
        return 0.0
    return float(s.replace(".", "").replace(",", "."))


def parse_br_date(s: str) -> str:
    """Converte DD/MM/YYYY para YYYY-MM-DD."""
    parts = s.strip().split("/")
    return f"{parts[2]}-{parts[1]}-{parts[0]}"


def fetch_csv() -> str:
    """Baixa o CSV do Tesouro Direto com impersonação de Chrome."""
    try:
        resp = requests.get(
            CSV_URL,
            impersonate="chrome124",  # fingerprint TLS real do Chrome 124
            timeout=30,
        )
        ct = resp.headers.get("content-type", "")
        print(f"[TD] {CSV_URL} → {resp.status_code} ({ct})")
        if resp.status_code == 200 and "text/html" not in ct:
            print(f"[TD] Baixados {len(resp.content)} bytes")
            return resp.text
        print(f"[TD] Resposta inesperada: {resp.text[:200]}")
    except Exception as e:
        print(f"[TD] Erro: {e}")
    return ""


def parse_csv(csv_text: str) -> list:
    """Faz o parse do CSV e retorna lista de dicts de títulos."""
    titles = []
    reader = csv.reader(StringIO(csv_text), delimiter=";")
    header_found = False

    for row in reader:
        if not row:
            continue
        # Detecta linha de cabeçalho
        if not header_found:
            first = row[0].strip().lower()
            if "tipo" in first or "titulo" in first or "nmtitulo" in first:
                header_found = True
            continue
        if len(row) < 6:
            continue
        name = row[0].strip()
        if not name:
            continue
        try:
            maturity = parse_br_date(row[1])
            buy_rate = parse_br_float(row[2])
            sell_rate = parse_br_float(row[3])
            buy_pu = parse_br_float(row[4])
            sell_pu = parse_br_float(row[5])
            subtype, indexer = classify_title(name)
            titles.append({
                "name": name,
                "subtype": subtype,
                "indexer": indexer,
                "maturity_date": maturity,
                "buy_rate": buy_rate,
                "sell_rate": sell_rate,
                "buy_pu": buy_pu,
                "sell_pu": sell_pu,
            })
        except Exception as e:
            print(f"[TD] Linha ignorada {row}: {e}")

    return titles


def main():
    csv_text = fetch_csv()

    if not csv_text:
        print("[TD] Não foi possível baixar o CSV — JSON existente mantido.")
        sys.exit(0)  # Não falha o workflow; mantém a última versão válida

    titles = parse_csv(csv_text)

    if not titles:
        print("[TD] Nenhum título encontrado no CSV — JSON existente mantido.")
        sys.exit(0)

    output = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "titles": titles,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"[TD] {len(titles)} títulos gravados em {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
