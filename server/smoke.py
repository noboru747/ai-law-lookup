"""Manual smoke test against the real model (not part of pytest).

    python smoke.py [base_url]        # default http://127.0.0.1:8790, service must be running

Prints a one-line-per-case summary: status, latency, citations, answer head, caveat count.
"""
import json
import sys
import time

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"

GEN = [
    ("online.return", {"channel": "online", "item_type": "general", "opened": "no"},
     "網購的衣服收到第3天，想退貨", ["cpa-018", "cpa-019", "cpa_ex-002"]),
    ("online.exception", {"item_type": "fresh"},
     "買生鮮食品，賣家說不能退貨", ["cpa-019", "cpa_ex-002"]),
    ("gift", {"issue": "expiry"},
     "百貨公司禮券過期了還能用嗎", ["gift-mustnot-001", "gift-must-002", "cpa-017"]),
    ("gym", {"reason": "personal"},
     "健身房倒閉，想退費", ["gym-must-010", "gym-must-015", "cpa-017"]),
    ("complaint.flow", {"stage": "none"},
     "店家不理我，我要向誰申訴", ["cpa-043", "cpa-044", "cpa-045", "cpa_er-036"]),
]
REWRITE = ["買生鮮食品不能退貨", "鑑賞期7天", "健身房倒閉"]
ROUTE = ["我想知道買到瑕疵品可以要求換貨嗎", "我被詐騙集團騙錢", "今天天氣如何"]


def post(c, path, body):
    t = time.monotonic()
    r = c.post(BASE + path, json=body, timeout=30)
    return r, time.monotonic() - t


with httpx.Client() as c:
    print("health:", c.get(BASE + "/health").json())
    for q in REWRITE:
        r, dt = post(c, "/rewrite", {"query": q, "leaf_id": None})
        print(f"rewrite {q!r} -> {r.status_code} {dt:.1f}s {r.json()}")
    for q in ROUTE:
        r, dt = post(c, "/route", {"text": q})
        print(f"route {q!r} -> {r.status_code} {dt:.1f}s {r.json()}")
    for leaf, slots, q, ids in GEN:
        r, dt = post(c, "/generate", {"leaf_id": leaf, "slots": slots, "query": q, "article_ids": ids})
        j = r.json()
        if r.status_code == 200:
            print(f"[{leaf}] 200 {dt:.1f}s cites={j['citations']} caveats={len(j['caveats'])}")
            print("   A:", j["answer"].replace("\n", " "))
            for cv in j["caveats"]:
                print("   C:", cv)
        else:
            print(f"[{leaf}] {r.status_code} {dt:.1f}s {json.dumps(j, ensure_ascii=False)}")
