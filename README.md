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

Toda publicación nueva lleva descripción: texto propio del producto + los
datos fijos del negocio (`STORE_INFO` en `ml_client.py`).

```python
from ml_client import set_description

set_description("MLA...", "Texto especifico de este producto...")
```

Toda publicación nueva lleva, como última foto, el logo de la tienda
(`STORE_LOGO_PICTURE_ID` en `ml_client.py`, ya subido a ML). Para subir
fotos nuevas de producto y armar la lista completa:

```python
from ml_client import upload_picture, with_store_logo, create_product

pic_id = upload_picture("/ruta/a/foto_producto.jpg", "image/jpeg")
item["pictures"] = with_store_logo([pic_id])
create_product(item)
```
