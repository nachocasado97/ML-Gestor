"""Cliente mínimo para la API de Mercado Libre (cuenta ELECTROPARTES).

Maneja el ciclo de vida del access_token (renovación automática vía
refresh_token) y expone helpers para publicar y actualizar productos.
Las credenciales viven en `.env` (no versionado) y este módulo persiste
ahi mismo el access_token/refresh_token nuevos cada vez que rotan.
"""
from __future__ import annotations

import os
from pathlib import Path

import requests

ENV_PATH = Path(__file__).resolve().parent / ".env"
API_BASE = "https://api.mercadolibre.com"
OAUTH_URL = f"{API_BASE}/oauth/token"


def _read_env() -> dict:
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def _write_env(env: dict) -> None:
    lines = [f"{key}={value}" for key, value in env.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n")


def refresh_access_token() -> dict:
    """Renueva el access_token usando el refresh_token vigente.

    ML rota el refresh_token en cada uso: el nuevo se persiste en .env
    junto con el access_token, o el siguiente refresh fallaria.
    """
    env = _read_env()
    resp = requests.post(
        OAUTH_URL,
        headers={
            "accept": "application/json",
            "content-type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type": "refresh_token",
            "client_id": env["ML_CLIENT_ID"],
            "client_secret": env["ML_CLIENT_SECRET"],
            "refresh_token": env["ML_REFRESH_TOKEN"],
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    env["ML_ACCESS_TOKEN"] = data["access_token"]
    env["ML_REFRESH_TOKEN"] = data["refresh_token"]
    _write_env(env)
    return data


def get_access_token(force_refresh: bool = False) -> str:
    env = _read_env()
    if force_refresh:
        return refresh_access_token()["access_token"]
    return env["ML_ACCESS_TOKEN"]


def _request(method: str, path: str, **kwargs) -> requests.Response:
    """Request autenticado que reintenta una vez tras renovar el token si da 401."""
    token = get_access_token()
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = f"Bearer {token}"
    resp = requests.request(method, f"{API_BASE}{path}", headers=headers, timeout=30, **kwargs)

    if resp.status_code == 401:
        token = get_access_token(force_refresh=True)
        headers["Authorization"] = f"Bearer {token}"
        resp = requests.request(method, f"{API_BASE}{path}", headers=headers, timeout=30, **kwargs)

    return resp


def get_me() -> dict:
    resp = _request("GET", "/users/me")
    resp.raise_for_status()
    return resp.json()


STORE_LOGO_PICTURE_ID = "616246-MLA116258732008_092026"


def upload_picture(file_path: str, content_type: str) -> str:
    """Sube una imagen a ML (en su resolucion original) y devuelve su picture id."""
    token = get_access_token()
    with open(file_path, "rb") as f:
        files = {"file": (file_path.split("/")[-1], f, content_type)}
        resp = requests.post(
            f"{API_BASE}/pictures/items/upload",
            headers={"Authorization": f"Bearer {token}"},
            files=files,
            timeout=60,
        )
    if not resp.ok:
        raise RuntimeError(f"Error subiendo imagen {file_path} ({resp.status_code}): {resp.text}")
    return resp.json()["id"]


def with_store_logo(picture_ids: list) -> list:
    """Arma la lista de pictures para un item agregando el logo de la tienda al final."""
    return [{"id": pid} for pid in list(picture_ids) + [STORE_LOGO_PICTURE_ID]]


def create_product(item: dict) -> dict:
    """Publica un producto nuevo. `item` es el payload tal como lo espera /items."""
    resp = _request("POST", "/items", json=item)
    if not resp.ok:
        raise RuntimeError(f"Error publicando producto ({resp.status_code}): {resp.text}")
    return resp.json()


def update_product(item_id: str, changes: dict) -> dict:
    resp = _request("PUT", f"/items/{item_id}", json=changes)
    if not resp.ok:
        raise RuntimeError(f"Error actualizando producto {item_id} ({resp.status_code}): {resp.text}")
    return resp.json()


def get_product(item_id: str) -> dict:
    resp = _request("GET", f"/items/{item_id}")
    resp.raise_for_status()
    return resp.json()


STORE_INFO = """Por que elegirnos?
Electropartes Pilar - mas de 25 anos en el rubro de repuestos de electricidad del automotor.
Direccion: 25 de Mayo 660, Local 6
Contacto: 11-5162-3607

Trabajamos con stock permanente y atencion personalizada para particulares y talleres."""


def set_description(item_id: str, product_text: str) -> dict:
    """Sube la descripcion de una publicacion: el texto del producto + los datos fijos del negocio."""
    full_text = f"{product_text.strip()}\n\n{STORE_INFO}"
    resp = _request("POST", f"/items/{item_id}/description", json={"plain_text": full_text})
    if not resp.ok:
        resp = _request("PUT", f"/items/{item_id}/description", json={"plain_text": full_text})
    if not resp.ok:
        raise RuntimeError(f"Error subiendo descripcion de {item_id} ({resp.status_code}): {resp.text}")
    return resp.json()


if __name__ == "__main__":
    me = get_me()
    print(f"Conectado como: {me['nickname']} ({me['email']}) - site {me['site_id']}")
