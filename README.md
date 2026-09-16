# ML-Gestor

Gestión programática de publicaciones de Mercado Libre Argentina para la
cuenta **ELECTROPARTES** (Electropartes Pilar).

## Setup

1. `pip install -r requirements.txt`
2. Completar `.env` (no versionado) con las credenciales de la app:

   ```
   ML_CLIENT_ID=...
   ML_CLIENT_SECRET=...
   ML_ACCESS_TOKEN=...
   ML_REFRESH_TOKEN=...
   ML_USER_ID=...
   ```

## Uso

`ml_client.py` maneja la renovación automática del access_token (dura 6hs)
usando el refresh_token, y persiste el par renovado en `.env` porque ML
rota el refresh_token en cada uso.

```python
from ml_client import create_product, get_me

get_me()  # valida la conexión

create_product({
    "title": "...",
    "category_id": "...",
    "price": 1000,
    "currency_id": "ARS",
    "available_quantity": 1,
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "condition": "new",
    "pictures": [{"source": "https://..."}],
    "attributes": [...],
})
```
