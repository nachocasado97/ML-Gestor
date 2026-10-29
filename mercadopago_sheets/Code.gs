/**
 * Mercado Pago -> Google Sheets.
 *
 * Copia a la hoja "Pagos" cada pago recibido en la cuenta de Mercado Pago
 * (los que entran por los links de pago) y mantiene actualizado su estado
 * (aprobado, devuelto, contracargo...).
 *
 * Funciona por polling: un trigger de tiempo llama a `sincronizar()` cada
 * pocos minutos y trae de la API todo pago creado o modificado desde la
 * ultima corrida. Opcionalmente `doPost` recibe los webhooks de MP para que
 * el pago aparezca al instante; el polling igual queda como red de
 * seguridad por si un webhook se pierde.
 *
 * Configuracion (Extensiones > Apps Script > Configuracion del proyecto >
 * Propiedades de la secuencia de comandos):
 *   MP_ACCESS_TOKEN      (obligatoria) Access Token de produccion, APP_USR-...
 *   FILTRO_DESCRIPCION   (opcional) palabras separadas por coma; solo se
 *                        registran pagos cuya descripcion contenga alguna.
 *   FILTRO_PREFERENCIAS  (opcional) pref_id de los links, separados por coma;
 *                        solo se registran pagos de esos links.
 *   DIAS_INICIALES       (opcional) dias hacia atras en la primera corrida (30).
 */

const SHEET_NAME = 'Pagos';
const MP_API = 'https://api.mercadopago.com';
const PAGE_SIZE = 50;
// Cada corrida vuelve a mirar este margen hacia atras: la API indexa los
// pagos con demora y una corrida puede fallar, asi que con un margen amplio
// un pago que se salteo se recupera solo en las corridas siguientes.
const OVERLAP_MINUTES = 6 * 60;
const SYNC_EVERY_MINUTES = 5;

const COLUMNS = [
  ['ID pago', (p) => String(p.id)],
  ['Fecha', (p) => toDate(p.date_created)],
  ['Fecha aprobacion', (p) => toDate(p.date_approved)],
  ['Estado', (p) => p.status],
  ['Detalle estado', (p) => p.status_detail],
  ['Descripcion', (p) => p.description || ''],
  ['Monto', (p) => p.transaction_amount],
  ['Moneda', (p) => p.currency_id],
  ['Comision MP', (p) => (p.fee_details || []).reduce((sum, fee) => sum + (fee.amount || 0), 0)],
  ['Neto recibido', (p) => (p.transaction_details || {}).net_received_amount],
  ['Medio de pago', (p) => p.payment_method_id],
  ['Tipo', (p) => p.payment_type_id],
  ['Cuotas', (p) => p.installments],
  ['Pagador', (p) => payerName(p)],
  ['Email pagador', (p) => (p.payer || {}).email || ''],
  ['Documento pagador', (p) => payerDocument(p)],
  ['Referencia externa', (p) => p.external_reference || ''],
  ['Preference ID (link)', (p) => p._preference_id || ''],
  ['Merchant order', (p) => (p.order && p.order.id) ? String(p.order.id) : ''],
  ['Fecha liberacion', (p) => toDate(p.money_release_date)],
  ['Ultima actualizacion', (p) => toDate(p.date_last_updated)],
];


// ---------------------------------------------------------------------------
// Puntos de entrada
// ---------------------------------------------------------------------------

/** Correr una vez a mano: arma la hoja, valida el token y crea el trigger. */
function configurar() {
  const me = mpGet('/users/me');
  props().setProperty('MP_USER_ID', String(me.id));
  getSheet();

  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sincronizar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(SYNC_EVERY_MINUTES).create();

  sincronizar();
  Logger.log('Listo. Conectado como %s (id %s).', me.nickname, me.id);
}

/** Trae los pagos nuevos o modificados desde la ultima corrida. */
function sincronizar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return;
  try {
    const startedAt = new Date();
    const since = getLastSync();
    const payments = searchPayments(since, startedAt).filter(isRelevant);
    upsertPayments(payments);
    props().setProperty('ULTIMA_SYNC', startedAt.toISOString());
    Logger.log('%s pagos procesados desde %s.', payments.length, since.toISOString());
  } finally {
    lock.releaseLock();
  }
}

/** Re-sincroniza los ultimos `dias` dias (por defecto 90). Util para cargar historico. */
function sincronizarHistorico(dias) {
  const days = Number(dias) || 90;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  props().setProperty('ULTIMA_SYNC', since.toISOString());
  sincronizar();
}

/**
 * Webhook de Mercado Pago (opcional). Publicar el script como aplicacion web
 * y cargar la URL en el panel de desarrolladores, evento "Pagos".
 * No se confia en el cuerpo recibido: solo se usa el id para volver a pedir
 * el pago a la API con nuestro token, asi un POST falso no puede inventar filas.
 */
function doPost(e) {
  try {
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const params = e.parameter || {};
    const topic = body.type || body.topic || params.type || params.topic;
    const id = (body.data && body.data.id) || params['data.id'] || params.id;

    if (topic === 'payment' && id) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(20 * 1000)) {
        try {
          const payment = mpGet('/v1/payments/' + encodeURIComponent(id));
          if (isRelevant(payment)) upsertPayments([payment]);
        } finally {
          lock.releaseLock();
        }
      }
    }
  } catch (err) {
    console.error('Webhook MP: ' + err);
  }
  return ContentService.createTextOutput('ok');
}


// ---------------------------------------------------------------------------
// Mercado Pago
// ---------------------------------------------------------------------------

function searchPayments(since, until) {
  const begin = new Date(since.getTime() - OVERLAP_MINUTES * 60 * 1000);
  const payments = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = mpGet('/v1/payments/search', {
      sort: 'date_last_updated',
      criteria: 'asc',
      range: 'date_last_updated',
      begin_date: begin.toISOString(),
      end_date: until.toISOString(),
      limit: PAGE_SIZE,
      offset: offset,
    });
    const results = page.results || [];
    payments.push(...results);
    const total = (page.paging || {}).total || 0;
    if (results.length < PAGE_SIZE || offset + PAGE_SIZE >= total) break;
  }
  return payments;
}

/** Solo pagos cobrados por esta cuenta (no los que pagamos) y que pasen los filtros. */
function isRelevant(payment) {
  const myId = getUserId();
  if (String(payment.collector_id) !== myId) return false;
  if (payment.operation_type && payment.operation_type !== 'regular_payment') return false;

  const keywords = listProperty('FILTRO_DESCRIPCION').map((k) => k.toLowerCase());
  if (keywords.length) {
    const description = (payment.description || '').toLowerCase();
    if (!keywords.some((k) => description.includes(k))) return false;
  }

  const preferences = listProperty('FILTRO_PREFERENCIAS');
  if (preferences.length && !preferences.includes(getPreferenceId(payment))) return false;

  return true;
}

/** pref_id del link de pago que origino el pago (via su merchant order), cacheado en el objeto. */
function getPreferenceId(payment) {
  if (payment._preference_id !== undefined) return payment._preference_id;
  payment._preference_id = '';
  if (payment.order && payment.order.type === 'mercadopago' && payment.order.id) {
    try {
      payment._preference_id = mpGet('/merchant_orders/' + payment.order.id).preference_id || '';
    } catch (err) {
      console.warn('No se pudo leer merchant order ' + payment.order.id + ': ' + err);
    }
  }
  return payment._preference_id;
}

function mpGet(path, params) {
  const query = params
    ? '?' + Object.keys(params).map((k) => k + '=' + encodeURIComponent(params[k])).join('&')
    : '';
  const options = {
    headers: { Authorization: 'Bearer ' + getToken() },
    muteHttpExceptions: true,
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = UrlFetchApp.fetch(MP_API + path + query, options);
    const code = resp.getResponseCode();
    if (code === 200) return JSON.parse(resp.getContentText());
    if (code !== 429 && code < 500) {
      throw new Error('MP ' + path + ' respondio ' + code + ': ' + resp.getContentText());
    }
    Utilities.sleep(1000 * Math.pow(2, attempt));
  }
  throw new Error('MP ' + path + ' no respondio tras varios reintentos');
}


// ---------------------------------------------------------------------------
// Hoja
// ---------------------------------------------------------------------------

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map((c) => c[0]));
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // El ID es numerico largo: como texto para que Sheets no lo redondee.
    sheet.getRange('A:A').setNumberFormat('@');
  }
  return sheet;
}

/** Agrega los pagos nuevos y reescribe los existentes (por si cambio el estado). */
function upsertPayments(payments) {
  if (!payments.length) return;
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  const ids = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map((r) => String(r[0])) : [];
  const rowById = {};
  ids.forEach((id, i) => { rowById[id] = i + 2; });

  const newRows = [];
  const seen = {};
  payments.forEach((payment) => {
    const id = String(payment.id);
    if (seen[id]) return;
    seen[id] = true;
    getPreferenceId(payment);
    const row = COLUMNS.map((c) => valueOrBlank(c[1](payment)));
    if (rowById[id]) {
      sheet.getRange(rowById[id], 1, 1, row.length).setValues([row]);
    } else {
      newRows.push(row);
    }
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, COLUMNS.length).setValues(newRows);
  }
}


// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function props() {
  return PropertiesService.getScriptProperties();
}

function getToken() {
  const token = props().getProperty('MP_ACCESS_TOKEN');
  if (!token) throw new Error('Falta la propiedad MP_ACCESS_TOKEN en la configuracion del proyecto.');
  return token.trim();
}

function getUserId() {
  let id = props().getProperty('MP_USER_ID');
  if (!id) {
    id = String(mpGet('/users/me').id);
    props().setProperty('MP_USER_ID', id);
  }
  return id;
}

function getLastSync() {
  const saved = props().getProperty('ULTIMA_SYNC');
  if (saved) return new Date(saved);
  const days = Number(props().getProperty('DIAS_INICIALES')) || 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function listProperty(name) {
  return (props().getProperty(name) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toDate(iso) {
  return iso ? new Date(iso) : '';
}

function valueOrBlank(value) {
  return value === undefined || value === null ? '' : value;
}

function payerName(p) {
  const payer = p.payer || {};
  const fromPayer = [payer.first_name, payer.last_name].filter(Boolean).join(' ');
  if (fromPayer) return fromPayer;
  const extra = (p.additional_info || {}).payer || {};
  const fromExtra = [extra.first_name, extra.last_name].filter(Boolean).join(' ');
  if (fromExtra) return fromExtra;
  return ((p.card || {}).cardholder || {}).name || '';
}

function payerDocument(p) {
  const ident = (p.payer || {}).identification || {};
  return ident.number ? (ident.type || '') + ' ' + ident.number : '';
}
