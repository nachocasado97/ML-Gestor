# Mercado Pago → Google Sheets

Registra en una planilla de Google cada pago que entra a la cuenta de
Mercado Pago por los links de pago, y mantiene actualizado su estado
(aprobado, pendiente, devuelto, contracargo).

## Cómo funciona

```
 Cliente paga el link ──► Mercado Pago
                              │
        cada 5 min            │  GET /v1/payments/search
  ┌───────────────────────────┤  (pagos creados o modificados
  │  Apps Script (trigger)    │   desde la última corrida)
  │  dentro de la planilla ◄──┘
  │        │
  │        └─► hoja "Pagos": agrega filas nuevas / actualiza las existentes
  │
  └── opcional: webhook de MP → doPost → registra el pago al instante
```

- **Sin servidor:** todo corre en Google Apps Script, pegado a la planilla.
- **Sin duplicados:** cada pago se identifica por su ID; si cambia (por
  ejemplo, se devuelve) se reescribe su fila.
- **No se pierde nada:** cada corrida vuelve a revisar las últimas 6 horas,
  así un pago que se salteó (por demora de MP o una corrida fallida) se
  recupera solo.
- **Solo cobros:** se ignoran los pagos que hacés vos y las transferencias.

Columnas: ID pago · Fecha · Fecha aprobación · Estado · Detalle estado ·
Descripción (título del link) · Monto · Moneda · Comisión MP · Neto
recibido · Medio de pago · Tipo · Cuotas · Pagador · Email pagador ·
Documento pagador · Referencia externa · Preference ID (link) · Merchant
order · Fecha liberación · Última actualización.

---

# Paso a paso

Hacelo desde una **computadora** (en el celular el editor de Apps Script no
funciona bien). Tiempo total: 15–20 minutos.

Necesitás:
- Tu usuario y contraseña de Mercado Pago (la cuenta que recibe los pagos).
- Una cuenta de Google (Gmail).

## Parte 1 — Sacar la "llave" de Mercado Pago (Access Token)

El Access Token es una clave que le permite al script leer tus pagos.

1. Entrá a <https://www.mercadopago.com.ar/developers/panel/app> e iniciá
   sesión con tu cuenta de Mercado Pago (la misma con la que creaste los
   links).
2. Tocá el botón **Crear aplicación**.
3. Completá el formulario:
   - **Nombre de la aplicación:** `Planilla de pagos` (o el que quieras).
   - **¿Qué tipo de solución vas a integrar?** → **Pagos online**.
   - **¿Estás usando una plataforma de e-commerce?** → **No**.
   - **¿Qué producto estás integrando?** → **Checkout Pro**.
   - Aceptá los términos, resolvé el captcha si aparece y tocá **Crear
     aplicación**.
   - (Los nombres exactos pueden variar un poco; si te pregunta otra cosa,
     elegí lo más parecido a "pagos online / checkout". No afecta en nada
     al script.)
4. Ya dentro de la aplicación, en el menú de la izquierda buscá
   **Credenciales de producción** (a veces dentro de "Producción").
5. Si te pide **activar las credenciales**:
   - **Industria:** la de tu negocio (ej. "Autos, motos y otros vehículos").
   - **Sitio web:** podés poner el link a tu perfil de Mercado Libre o
     cualquier página tuya. Es solo informativo.
   - Aceptá y tocá **Activar credenciales de producción**.
6. Vas a ver dos datos: *Public Key* y **Access Token**. Copiá el
   **Access Token** (empieza con `APP_USR-` y es largo). Usá el botón de
   copiar para no cortarlo.
7. Pegalo por ahora en un bloc de notas. **No lo mandes por WhatsApp ni
   mail**: quien tenga ese token puede ver y operar tu cuenta.

> ⚠️ Usá las credenciales **de producción**, no las "de prueba". Las de
> prueba empiezan con `TEST-` y no ven tus pagos reales.

## Parte 2 — Crear la planilla

1. Entrá a <https://sheets.new> (crea una planilla nueva en tu Google Drive).
2. Arriba a la izquierda, donde dice "Hoja de cálculo sin título", poné un
   nombre, por ejemplo `Pagos Mercado Pago`.

## Parte 3 — Pegar el script

1. En la planilla, menú **Extensiones → Apps Script**. Se abre una pestaña
   nueva con un editor de código.
2. Arriba a la izquierda, donde dice "Proyecto sin título", hacé clic y
   ponele un nombre, por ejemplo `MP a Sheets`.
3. En el editor vas a ver un archivo `Código.gs` con un texto tipo
   `function myFunction() { }`. **Borrá todo** (Ctrl+A y Suprimir).
4. Abrí el archivo [`Code.gs`](Code.gs) de esta carpeta, copiá **todo** su
   contenido y pegalo en el editor.
5. Guardá con **Ctrl+S** (o el ícono de disquete). Si queda algún error de
   sintaxis aparece en rojo: casi siempre es porque no se copió el archivo
   completo; volvé a copiarlo.

## Parte 4 — Configurar zona horaria y el token

1. En la barra de la izquierda del editor, tocá el ícono de **engranaje ⚙️
   (Configuración del proyecto)**.
2. En **Zona horaria**, elegí **(GMT-03:00) Hora de Argentina (Buenos
   Aires)**.
3. Bajá hasta el final de la página, a **Propiedades de la secuencia de
   comandos**, y tocá **Agregar propiedad de la secuencia de comandos**.
4. Completá:
   - **Propiedad:** `MP_ACCESS_TOKEN` (exactamente así, en mayúsculas).
   - **Valor:** el Access Token que copiaste en la Parte 1.
5. Tocá **Guardar propiedades de la secuencia de comandos**.

Opcionales (podés saltearlos y agregarlos cuando quieras, igual que el
anterior):

| Propiedad | Para qué sirve | Ejemplo |
|---|---|---|
| `DIAS_INICIALES` | Cuántos días para atrás traer la primera vez. Por defecto 30. | `90` |
| `FILTRO_DESCRIPCION` | Registrar solo pagos cuya descripción contenga alguna de estas palabras (separadas por coma). | `alternador, burro` |
| `FILTRO_PREFERENCIAS` | Registrar solo pagos de ciertos links (sus `pref_id`, separados por coma). | `123456-abcd...` |

Si los links de pago son tu única forma de cobrar por Mercado Pago, **no
pongas filtros**: se registran todos tus cobros.

## Parte 5 — Activarlo

1. En la barra de la izquierda tocá el ícono **< > (Editor)** para volver
   al código.
2. Arriba, al lado de los botones "Ejecutar" y "Depurar", hay un menú
   desplegable con nombres de funciones. Elegí **`configurar`**.
3. Tocá **▶ Ejecutar**.
4. La primera vez Google pide permiso:
   1. **Revisar permisos** → elegí tu cuenta de Google.
   2. Aparece *"Google no verificó esta app"*. Es normal: la app es tu
      propio script. Tocá **Configuración avanzada** (o "Avanzado") y
      después **Ir a MP a Sheets (no seguro)**.
   3. Si aparecen casillas de permisos, marcá **Seleccionar todo**.
   4. Tocá **Permitir**.

   Los permisos son: ver y editar *esta* planilla, conectarse a un servicio
   externo (la API de Mercado Pago) y programar la ejecución automática.
5. Abajo se abre el **Registro de ejecución**. Al terminar tiene que decir
   algo como:
   ```
   N pagos procesados desde ...
   Listo. Conectado como TUNOMBRE (id 123456789).
   ```
6. Volvé a la pestaña de la planilla: hay una hoja nueva **Pagos** con los
   cobros de los últimos 30 días (puede estar vacía si no hubo pagos).

## Parte 6 — Comprobar que quedó automático

1. En Apps Script, barra izquierda, ícono de **reloj ⏰ (Activadores)**.
2. Tiene que haber **un** activador: función `sincronizar`, evento
   "Según tiempo", **cada 5 minutos**.
3. Para probar con un pago real: pedile a alguien que pague uno de tus links
   con un monto chico. En menos de 5 minutos aparece en la hoja. Si
   después le devolvés el dinero desde la app de Mercado Pago, la columna
   **Estado** cambia a `refunded` en la siguiente corrida.

   (No podés pagar tu propio link con tu misma cuenta; tiene que ser otra
   persona u otra cuenta.)

¡Listo! Desde acá no hay que hacer nada más: cada pago aparece solo.

---

## Opcional — Que el pago aparezca al instante (webhook)

Con lo anterior un pago tarda **hasta 5 minutos** en aparecer. Si lo
querés al instante:

> ⚠️ Mercado Pago solo manda webhooks a una aplicación por los pagos
> creados con *esa* aplicación. Los links de pago creados desde la app o
> la web de Mercado Pago no generan aviso, así que para ellos el webhook
> no sirve y el registro es cada 5 minutos.

**En Apps Script:**
1. Arriba a la derecha: **Implementar → Nueva implementación**.
2. Al lado de "Seleccionar tipo", tocá el engranaje ⚙️ → **Aplicación web**.
3. Completá:
   - **Descripción:** `webhook MP`.
   - **Ejecutar como:** **Yo** (tu email).
   - **Quién tiene acceso:** **Cualquier usuario**.
4. **Implementar** (si pide permisos de nuevo, aceptá como en la Parte 5).
5. Copiá la **URL de la aplicación web** (termina en `/exec`).

**En Mercado Pago:**
1. Volvé a <https://www.mercadopago.com.ar/developers/panel/app> y entrá a
   tu aplicación.
2. Menú izquierdo: **Webhooks** → **Configurar notificaciones**.
3. En **Modo productivo**, pegá la URL `/exec`.
4. En eventos, marcá **Pagos**. Tocá **Guardar**.

Notas:
- Es seguro que la URL sea pública: del aviso solo se usa el número de pago
  y el script lo vuelve a consultar a Mercado Pago con tu token, así que
  nadie puede cargar pagos falsos.
- El botón **Simular** del panel manda un pago inventado: **no** va a
  aparecer en la hoja, y está bien.
- Es posible que el panel de MP marque algunas notificaciones como
  "fallidas" por cómo responde Google. No pasa nada: la sincronización cada
  5 minutos sigue andando y cubre cualquier aviso perdido.
- Si algún día cambiás el código del script, para que el webhook use la
  versión nueva: **Implementar → Gestionar implementaciones → ✏️ editar →
  Versión: Nueva versión → Implementar**. La URL no cambia.

---

## Cómo sacar el `pref_id` de un link (solo si usás FILTRO_PREFERENCIAS)

- **Fácil:** esperá a que el link reciba un pago; en la hoja, la columna
  **Preference ID (link)** muestra su `pref_id`. Copialo de ahí.
- **Desde el link:** abrí el link de pago en el navegador de la compu. La
  dirección termina mostrando algo como
  `.../checkout/v1/redirect?pref_id=123456789-abcd-1234-...`. Todo lo que
  está después de `pref_id=` es el valor.

## Uso diario y mantenimiento

- **Traer pagos más viejos:** en Apps Script elegí la función
  `sincronizarHistorico` y Ejecutar (trae los últimos 90 días). Los que ya
  estaban no se duplican.
- **Agregar tus propias columnas** (ej. "Entregado", "Notas"): ponelas a la
  derecha de **Última actualización** (columna U). El script solo escribe
  de la A a la U, así que no las pisa.
- **Ordenar o filtrar** la hoja: se puede, el script busca cada pago por su
  ID. Lo que **no** hay que hacer es borrar/mover las columnas A–U, la fila
  de encabezados o cambiarle el nombre a la hoja "Pagos".
- **Seguridad:** quien tenga permiso de *edición* en la planilla puede ver
  el token (en la configuración del script) y los datos de tus clientes.
  Compartila solo como *lector*, o no la compartas.

## Si algo falla

Los errores se ven en Apps Script → ícono **☰ Ejecuciones** (barra
izquierda) → clic en la ejecución con error.

| Mensaje / síntoma | Qué hacer |
|---|---|
| `Falta la propiedad MP_ACCESS_TOKEN` | Revisá la Parte 4: el nombre tiene que ser exactamente `MP_ACCESS_TOKEN` y hay que tocar Guardar. |
| `respondio 401` | Token mal copiado, de prueba (`TEST-`) o revocado. Copialo de nuevo desde Credenciales de producción y reemplazalo en la propiedad. |
| `respondio 403` | Las credenciales de producción no están activadas (Parte 1, paso 5). |
| La hoja "Pagos" está vacía | Si no hubo cobros en los últimos 30 días es normal. Para traer más, poné `DIAS_INICIALES` o ejecutá `sincronizarHistorico`. Revisá también que no tengas filtros puestos. |
| Falta un pago que sí entró | Esperá 5 minutos. Si sigue sin aparecer, fijate si tenés filtros. Si no, avisá: puede que MP clasifique ese pago distinto y haya que ajustar el filtro del script. |
| Aparecen cobros que no son de los links (ej. QR) | Usá `FILTRO_DESCRIPCION` o `FILTRO_PREFERENCIAS`. |
| Hay dos activadores `sincronizar` | Borrá uno, o volvé a ejecutar `configurar` (deja uno solo). |
| Las fechas tienen 3 horas de diferencia | Zona horaria del proyecto mal puesta (Parte 4, paso 2) y también en la planilla: **Archivo → Configuración → Zona horaria**. |
