# Mercado Pago → Google Sheets

Registra en una planilla de Google cada pago que entra a la cuenta de
Mercado Pago por los links de pago, y mantiene actualizado su estado
(aprobado, pendiente, devuelto, contracargo).

## Cómo funciona

```
 Cliente paga el link ──► Mercado Pago
                              │
        cada 10 min           │  GET /v1/payments/search
  ┌───────────────────────────┤  (pagos creados o modificados
  │  Apps Script (trigger)    │   desde la última corrida)
  │  dentro de la planilla ◄──┘
  │        │
  │        └─► hoja "Pagos": agrega filas nuevas / actualiza las existentes
  │
  └── opcional: webhook de MP → doPost → registra el pago al instante
```

- **Sin servidor:** todo corre en Google Apps Script, pegado a la planilla.
  No hace falta tener una PC prendida ni pagar hosting.
- **Sin duplicados:** cada pago se identifica por su ID. Si un pago cambia
  (por ejemplo, se devuelve), se reescribe su fila en vez de agregar otra.
- **No se pierde nada:** cada corrida vuelve a revisar los últimos 30
  minutos, así un pago que la API indexó tarde igual se registra.
- **Solo cobros:** se ignoran los pagos que hacés vos y las transferencias;
  quedan los pagos (`regular_payment`) que cobra tu cuenta.

## Columnas

ID pago · Fecha · Fecha aprobación · Estado · Detalle estado · Descripción
(el título del link) · Monto · Moneda · Comisión MP · Neto recibido · Medio
de pago · Tipo · Cuotas · Pagador · Email pagador · Documento pagador ·
Referencia externa · Preference ID (link) · Merchant order · Fecha
liberación · Última actualización

## Instalación (unos 10 minutos)

### 1. Conseguir el Access Token de Mercado Pago

1. Entrá a <https://www.mercadopago.com.ar/developers/panel/app> con tu
   cuenta personal.
2. **Crear aplicación** → cualquier nombre (ej. "Planilla de pagos"); como
   tipo de solución elegí *Pagos online* / *Checkout Pro*.
3. En la app, andá a **Credenciales de producción** (si te lo pide,
   completá rubro y sitio web; podés poner el de Mercado Libre) y copiá el
   **Access Token** (empieza con `APP_USR-`).

> El token da acceso completo a tu cuenta de MP. No lo pegues en el código
> ni lo compartas: va solo en las propiedades del script (paso 3).

### 2. Crear la planilla y pegar el script

1. Creá una planilla nueva en Google Sheets.
2. **Extensiones → Apps Script**.
3. Borrá el contenido de `Código.gs` y pegá el de [`Code.gs`](Code.gs).
4. En **Configuración del proyecto** (ícono de engranaje), poné la zona
   horaria en *(GMT-03:00) Buenos Aires*.

### 3. Cargar la configuración

En **Configuración del proyecto → Propiedades de la secuencia de comandos**
agregá:

| Propiedad | Obligatoria | Valor |
|---|---|---|
| `MP_ACCESS_TOKEN` | sí | El token del paso 1 |
| `FILTRO_DESCRIPCION` | no | Palabras separadas por coma. Solo se registran pagos cuya descripción contenga alguna (ej. `alternador, burro de arranque`) |
| `FILTRO_PREFERENCIAS` | no | Los `pref_id` de tus links, separados por coma, para registrar **solo** esos links |
| `DIAS_INICIALES` | no | Cuántos días para atrás traer la primera vez (por defecto 30) |

Sin filtros se registran todos los cobros de la cuenta, que normalmente es
lo que querés si los links son tu única forma de cobrar por MP.

**¿Cómo saco el `pref_id` de un link?** Abrí el link en el navegador:
redirige a una URL del tipo
`mercadopago.com.ar/checkout/v1/redirect?pref_id=123456789-abcd-...`. Lo
que sigue a `pref_id=` es el valor. También aparece en la columna
*Preference ID (link)* de la planilla una vez que ese link recibe un pago.

### 4. Activar

1. En el editor, elegí la función **`configurar`** y tocá **Ejecutar**.
2. Google pide permisos (acceder a la planilla, conectarse a servicios
   externos, crear triggers): aceptalos. Si aparece "Google no verificó esta
   app", es tu propio script: *Configuración avanzada → Ir a ... (no seguro)*.
3. Se crea la hoja **Pagos**, se cargan los pagos de los últimos 30 días y
   queda programada la sincronización cada 10 minutos.

Listo: de acá en adelante cada pago aparece solo.

## Opcional: registro instantáneo con webhook

Con el trigger, un pago tarda hasta 10 minutos en aparecer. Para verlo al
instante:

1. En Apps Script: **Implementar → Nueva implementación → Aplicación web**.
   Ejecutar como: *Yo*. Quién tiene acceso: *Cualquier usuario*. Copiá la URL.
2. En el panel de desarrolladores de MP, dentro de tu app: **Webhooks →
   Configurar notificaciones** → modo productivo → pegá la URL y marcá el
   evento **Pagos**.

El webhook es seguro aunque la URL sea pública: del aviso solo se toma el ID
del pago y se lo vuelve a pedir a la API de MP con tu token, así que nadie
puede meter filas falsas. El polling sigue activo como respaldo por si algún
aviso se pierde.

## Mantenimiento

- **Cargar histórico:** ejecutá `sincronizarHistorico` (trae 90 días; para
  otro rango, llamala desde otra función, ej. `sincronizarHistorico(365)`).
- **Ver errores:** en Apps Script → **Ejecuciones**. Si aparece `401`, el
  token se revocó o cambió: generá uno nuevo y actualizá `MP_ACCESS_TOKEN`.
- **Agregar columnas propias** (ej. "Entregado", notas): ponelas a la
  derecha de *Última actualización*. El script solo escribe las primeras 21
  columnas, así que no las pisa.
- Podés ordenar o filtrar las filas como quieras: el script encuentra cada
  pago por su ID, no por su posición. Lo que no hay que hacer es mover o
  borrar las columnas del script ni la fila de encabezados.
