"""Chequea ventas y preguntas nuevas en Mercado Libre desde el ultimo chequeo.

Guarda estado (ids ya vistos) en .ml_state.json para no repetir avisos.
Imprime un resumen legible de lo nuevo; si no hay nada nuevo, no imprime nada.
"""
import json
from pathlib import Path

from ml_client import _request, _read_env

STATE_PATH = Path(__file__).resolve().parent / ".ml_state.json"


def _load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {"seen_order_ids": [], "seen_question_ids": []}


def _save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2))


def check_new_orders(seller_id: str, seen_ids: list) -> tuple[list, list]:
    resp = _request(
        "GET",
        "/orders/search",
        params={"seller": seller_id, "order.status": "paid", "sort": "date_desc", "limit": 20},
    )
    resp.raise_for_status()
    results = resp.json().get("results", [])

    new_orders = []
    all_ids = list(seen_ids)
    for order in results:
        oid = str(order["id"])
        if oid not in seen_ids:
            new_orders.append(order)
            all_ids.append(oid)
    return new_orders, all_ids


def check_new_questions(seller_id: str, seen_ids: list) -> tuple[list, list]:
    resp = _request(
        "GET",
        "/questions/search",
        params={"seller_id": seller_id, "status": "UNANSWERED", "sort_fields": "date_created", "sort_types": "DESC", "limit": 20},
    )
    resp.raise_for_status()
    results = resp.json().get("questions", [])

    new_questions = []
    all_ids = list(seen_ids)
    for q in results:
        qid = str(q["id"])
        if qid not in seen_ids:
            new_questions.append(q)
            all_ids.append(qid)
    return new_questions, all_ids


def main():
    env = _read_env()
    seller_id = env["ML_USER_ID"]
    state = _load_state()

    try:
        new_orders, order_ids = check_new_orders(seller_id, state["seen_order_ids"])
    except Exception as exc:
        print(f"AVISO: no se pudo chequear ventas ({exc}). Revisar permisos de 'Ordenes' en developers.mercadolibre.com.")
        new_orders, order_ids = [], state["seen_order_ids"]

    new_questions, question_ids = check_new_questions(seller_id, state["seen_question_ids"])

    state["seen_order_ids"] = order_ids[-200:]
    state["seen_question_ids"] = question_ids[-200:]
    _save_state(state)

    if not new_orders and not new_questions:
        return

    print("NOVEDADES ML-GESTOR:")
    for order in new_orders:
        total = order.get("total_amount")
        item_title = order.get("order_items", [{}])[0].get("item", {}).get("title", "?")
        print(f"- VENTA #{order['id']}: {item_title} - ${total}")
    for q in new_questions:
        item_id = q.get("item_id")
        text = q.get("text", "")
        print(f"- PREGUNTA en {item_id}: {text[:120]}")


if __name__ == "__main__":
    main()
