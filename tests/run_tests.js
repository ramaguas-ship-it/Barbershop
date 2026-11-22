/**
 * Pruebas funcionales de Barbershop V1.1 contra PostgreSQL real.
 * Uso:  DATABASE_URL=postgresql://usuario:clave@localhost:5432/barbershop npm test
 * Levanta la aplicacion en un puerto libre, ejecuta las pruebas por HTTP,
 * comprueba el efecto en la base de datos y escribe tests/resultados.md.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-pruebas';
const app = require('../src/app');
const { pool, query } = require('../src/db');
const config = require('../src/config');

const DOMINIO = '@pruebas.test';
const PASS = 'Prueba2026x';
let base;

// ---------- cliente HTTP minimo con cookies y CSRF ----------
class Cliente {
  constructor() { this.cookie = ''; this.token = ''; }
  async req(metodo, ruta, datos) {
    let body;
    if (metodo === 'POST' && datos && datos._csrf === undefined) datos = { _csrf: await this.csrf(), ...datos };
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie; // despues de obtener el token (puede cambiar la cookie)
    if (metodo === 'POST') {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(datos || {}).toString();
    }
    const r = await fetch(base + ruta, { method: metodo, headers, body, redirect: 'manual' });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const texto = await r.text();
    const m = texto.match(/name="_csrf" value="([0-9a-f]+)"/);
    if (m) this.token = m[1];
    return { status: r.status, loc: r.headers.get('location'), texto };
  }
  get(ruta) { return this.req('GET', ruta); }
  post(ruta, datos) { return this.req('POST', ruta, datos); }
  async csrf() { await this.get('/login'); return this.token; }
  async login(correo, password = PASS) { return this.post('/login', { correo, password }); }
}

// ---------- registro de resultados ----------
const filas = [];
async function prueba(id, req, datos, esperado, fn) {
  let obtenido, ok;
  try { const r = await fn(); ok = r.ok; obtenido = r.obtenido; }
  catch (e) { ok = false; obtenido = `Excepción: ${e.message}`; }
  filas.push({ id, req, datos, esperado, obtenido, ok });
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${id} [${req}] ${obtenido}`);
}
const una = async (sql, p) => (await query(sql, p)).rows[0];
const hash = bcrypt.hashSync(PASS, 10);
async function crearUsuario(nombre, correo, rol) {
  return (await query(
    `INSERT INTO usuarios (nombre, telefono, correo, password_hash, rol, consentimiento) VALUES ($1,'0991112233',$2,$3,$4,TRUE) RETURNING id`,
    [nombre, correo, hash, rol])).rows[0].id;
}
const fechaEn = async (dias) => (await una(`SELECT to_char((now() AT TIME ZONE $1)::date + $2::int, 'YYYY-MM-DD') AS f`, [config.tz, dias])).f;

async function limpiar() {
  await query(`DELETE FROM citas WHERE cliente_id IN (SELECT id FROM usuarios WHERE correo LIKE $1)`, ['%' + DOMINIO]);
  await query(`DELETE FROM barberos WHERE usuario_id IN (SELECT id FROM usuarios WHERE correo LIKE $1)`, ['%' + DOMINIO]);
  await query(`DELETE FROM usuarios WHERE correo LIKE $1`, ['%' + DOMINIO]);
  await query(`DELETE FROM servicios WHERE nombre LIKE 'PRUEBA %'`);
}

(async () => {
  await limpiar();
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const run = Date.now().toString(36);

  // Datos base de la corrida
  const idAdmin = await crearUsuario('Admin Pruebas', `admin${DOMINIO}`, 'administrador');
  const idBarbA = await crearUsuario('Barbero A Pruebas', `barbA${DOMINIO}`, 'barbero');
  const idBarbB = await crearUsuario('Barbero B Pruebas', `barbB${DOMINIO}`, 'barbero');
  const bA = (await query('INSERT INTO barberos (usuario_id) VALUES ($1) RETURNING id', [idBarbA])).rows[0].id;
  const bB = (await query('INSERT INTO barberos (usuario_id) VALUES ($1) RETURNING id', [idBarbB])).rows[0].id;
  const srv30 = (await query(`INSERT INTO servicios (nombre, duracion_min, precio) VALUES ('PRUEBA Corte', 30, 6.00) RETURNING id`)).rows[0].id;
  const F1 = await fechaEn(7), F2 = await fechaEn(8), F3 = await fechaEn(9);

  const admin = new Cliente(), barbA = new Cliente(), barbB = new Cliente();
  await admin.login(`admin${DOMINIO}`); await barbA.login(`barbA${DOMINIO}`); await barbB.login(`barbB${DOMINIO}`);

  // ============ RF-01 ============
  const c1 = new Cliente(); const correo1 = `ana${run}${DOMINIO}`;
  await prueba('PF-01', 'RF-01', `nombre "Ana Pruebas", tel 0987654321, correo ${correo1}, clave válida, consentimiento`, 'Cliente registrado (redirige a /login); en BD existe con rol cliente y contraseña con hash bcrypt', async () => {
    const r = await c1.post('/registro', { nombre: 'Ana Pruebas', telefono: '0987654321', correo: correo1, password: PASS, consentimiento: '1' });
    const u = await una('SELECT rol, password_hash FROM usuarios WHERE correo = $1', [correo1]);
    return { ok: r.status === 302 && r.loc === '/login' && u?.rol === 'cliente' && u.password_hash.startsWith('$2'), obtenido: `HTTP ${r.status} → ${r.loc}; BD: rol=${u?.rol}, hash=${u?.password_hash.slice(0, 4)}…` };
  });
  await prueba('PF-02', 'RF-01', `mismo correo ${correo1} en mayúsculas`, 'Rechazado (HTTP 409) y sigue habiendo un solo registro', async () => {
    const r = await new Cliente().post('/registro', { nombre: 'Otra Persona', telefono: '0987654322', correo: correo1.toUpperCase(), password: PASS, consentimiento: '1' });
    const n = (await una('SELECT count(*)::int AS n FROM usuarios WHERE lower(correo) = lower($1)', [correo1])).n;
    return { ok: r.status === 409 && n === 1, obtenido: `HTTP ${r.status}; registros con ese correo en BD: ${n}` };
  });
  await prueba('PF-03', 'RF-01', 'teléfono "abc", contraseña "123", sin consentimiento', 'Rechazado (HTTP 400) con mensajes de validación; no se inserta', async () => {
    const correo = `malo${run}${DOMINIO}`;
    const r = await new Cliente().post('/registro', { nombre: 'Xy', telefono: 'abc', correo, password: '123' });
    const n = (await una('SELECT count(*)::int AS n FROM usuarios WHERE correo = $1', [correo])).n;
    return { ok: r.status === 400 && n === 0 && r.texto.includes('teléfono'), obtenido: `HTTP ${r.status}; filas insertadas: ${n}` };
  });

  // ============ RF-02 / RNF-03 / RNF-20 ============
  await prueba('PF-04', 'RF-02', 'credenciales válidas de cliente; luego clave errónea', 'Válidas: redirige a /citas. Erróneas: HTTP 401', async () => {
    const ok = await c1.login(correo1); const mal = await new Cliente().login(correo1, 'incorrecta1');
    return { ok: ok.status === 302 && ok.loc === '/citas' && mal.status === 401, obtenido: `válidas: HTTP ${ok.status} → ${ok.loc}; erróneas: HTTP ${mal.status}` };
  });
  await prueba('PF-05', 'RF-02 / RNF-03', 'cliente→/admin/servicios; barbero→/admin/barberos; anónimo→/citas', 'Cliente y barbero: HTTP 403; anónimo: redirige a /login', async () => {
    const a = await c1.get('/admin/servicios'), b = await barbA.get('/admin/barberos'), c = await new Cliente().get('/citas');
    return { ok: a.status === 403 && b.status === 403 && c.status === 302 && c.loc === '/login', obtenido: `cliente: ${a.status}; barbero: ${b.status}; anónimo: ${c.status} → ${c.loc}` };
  });
  await prueba('PF-06', 'RNF-20', '5 intentos fallidos y luego clave correcta', 'Cuenta bloqueada: HTTP 423 aun con la clave correcta; bloqueado_hasta definido en BD', async () => {
    const correo = `lock${run}${DOMINIO}`; await crearUsuario('Usuario Bloqueo', correo, 'cliente');
    const c = new Cliente(); for (let i = 0; i < 5; i++) await c.login(correo, 'incorrecta1');
    const r = await c.login(correo); const u = await una('SELECT bloqueado_hasta FROM usuarios WHERE correo = $1', [correo]);
    return { ok: r.status === 423 && u.bloqueado_hasta !== null, obtenido: `HTTP ${r.status}; bloqueado_hasta=${u.bloqueado_hasta?.toISOString?.()}` };
  });
  await prueba('PF-07', 'Seguridad', 'correo "\' OR \'1\'=\'1" en login; POST sin token CSRF', 'Inyección SQL sin efecto (HTTP 401); POST sin token rechazado (HTTP 403)', async () => {
    const a = await new Cliente().login("' OR '1'='1", "' OR '1'='1");
    const sinToken = await fetch(base + '/logout', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
    return { ok: a.status === 401 && sinToken.status === 403, obtenido: `login inyectado: HTTP ${a.status}; POST sin CSRF: HTTP ${sinToken.status}` };
  });

  // ============ RF-03 ============
  let idSrv;
  await prueba('PF-08', 'RF-03', 'servicio "PRUEBA Barba", 20 min, $4.50', 'Creado; en BD con los valores indicados. Duración 0 y nombre repetido rechazados (400/409)', async () => {
    const r = await admin.post('/admin/servicios', { nombre: 'PRUEBA Barba', duracion_min: '20', precio: '4.50' });
    const s = await una(`SELECT id, duracion_min, precio::text FROM servicios WHERE nombre = 'PRUEBA Barba'`); idSrv = s?.id;
    const inv = await admin.post('/admin/servicios', { nombre: 'PRUEBA Otro', duracion_min: '0', precio: '4' });
    const dup = await admin.post('/admin/servicios', { nombre: 'prueba barba', duracion_min: '20', precio: '4.5' });
    return { ok: r.status === 302 && s?.duracion_min === 20 && s.precio === '4.50' && inv.status === 400 && dup.status === 409, obtenido: `alta HTTP ${r.status}; BD: ${s?.duracion_min} min, $${s?.precio}; duración 0: ${inv.status}; duplicado: ${dup.status}` };
  });
  await prueba('PF-09', 'RF-03 / RNF-08', 'cambiar precio de $4.50 a $5.25', 'Precio actualizado y auditoría con usuario y valor anterior', async () => {
    await admin.post(`/admin/servicios/${idSrv}`, { nombre: 'PRUEBA Barba', duracion_min: '20', precio: '5.25' });
    const s = await una('SELECT precio::text FROM servicios WHERE id = $1', [idSrv]);
    const a = await una(`SELECT usuario_id, valor_anterior FROM auditoria WHERE tabla='servicios' AND registro_id=$1 ORDER BY id DESC LIMIT 1`, [idSrv]);
    return { ok: s.precio === '5.25' && a?.usuario_id === idAdmin && Number(a.valor_anterior.precio) === 4.5, obtenido: `precio BD $${s.precio}; auditoría: usuario=${a?.usuario_id}, anterior=${JSON.stringify(a?.valor_anterior)}` };
  });
  await prueba('PF-10', 'RF-03', 'desactivar servicio y consultar formulario de reserva', 'Servicio inactivo en BD y ya no aparece en el formulario de reserva', async () => {
    await admin.post(`/admin/servicios/${idSrv}/estado`, {});
    const s = await una('SELECT activo FROM servicios WHERE id = $1', [idSrv]);
    const f = await c1.get('/citas/nueva');
    return { ok: s.activo === false && !f.texto.includes('PRUEBA Barba'), obtenido: `activo=${s.activo}; aparece en reserva: ${f.texto.includes('PRUEBA Barba')}` };
  });
  await prueba('PF-11', 'RF-03', 'registrar barbero "Barbero Nuevo" con correo y clave inicial', 'Se crean usuario (rol barbero) y perfil de barbero; el barbero puede iniciar sesión', async () => {
    const correo = `nuevo${run}${DOMINIO}`;
    const r = await admin.post('/admin/barberos', { nombre: 'Barbero Nuevo', telefono: '0990001111', correo, password: 'Inicial2026' });
    const x = await una(`SELECT u.rol, b.id FROM usuarios u JOIN barberos b ON b.usuario_id = u.id WHERE u.correo = $1`, [correo]);
    const l = await new Cliente().login(correo, 'Inicial2026');
    return { ok: r.status === 302 && x?.rol === 'barbero' && l.loc === '/agenda', obtenido: `alta HTTP ${r.status}; BD rol=${x?.rol}, barbero_id=${x?.id}; login → ${l.loc}` };
  });

  // ============ RF-04 / RF-05 ============
  const cB = new Cliente(), cC = new Cliente();
  const idCB = await crearUsuario('Cliente B Pruebas', `cb${run}${DOMINIO}`, 'cliente');
  const idCC = await crearUsuario('Cliente C Pruebas', `cc${run}${DOMINIO}`, 'cliente');
  await cB.login(`cb${run}${DOMINIO}`); await cC.login(`cc${run}${DOMINIO}`);
  let citaB;
  await prueba('PF-12', 'RF-04', `cliente B reserva barbero A, servicio 30 min, ${F1} 09:00`, 'Cita en estado «pendiente» asociada al cliente; el formulario no pide nombre, teléfono ni correo', async () => {
    const form = await cB.get(`/citas/nueva?barbero_id=${bA}&servicio_id=${srv30}&fecha=${F1}`);
    const r = await cB.post('/citas', { barbero_id: bA, servicio_id: srv30, fecha: F1, hora: '09:00' });
    const c = await una(`SELECT id, estado, cliente_id, to_char(inicio AT TIME ZONE $1,'HH24:MI') AS h, to_char(fin AT TIME ZONE $1,'HH24:MI') AS f FROM citas WHERE barbero_id=$2 AND cliente_id=$3`, [config.tz, bA, idCB]); citaB = c?.id;
    const pideDatos = /name="(nombre|telefono|correo)"/.test(form.texto);
    return { ok: r.status === 302 && c?.estado === 'pendiente' && c.h === '09:00' && c.f === '09:30' && !pideDatos, obtenido: `HTTP ${r.status}; BD: estado=${c?.estado}, ${c?.h}–${c?.f}; formulario pide datos personales: ${pideDatos}` };
  });
  await prueba('PF-13', 'RF-05 / RN-01', `cliente C intenta barbero A, ${F1} 09:00 (ocupado)`, 'Rechazado; sigue 1 sola cita activa en ese horario; el horario no figura entre los libres', async () => {
    const r = await cC.post('/citas', { barbero_id: bA, servicio_id: srv30, fecha: F1, hora: '09:00' });
    const n = (await una(`SELECT count(*)::int AS n FROM citas WHERE barbero_id=$1 AND to_char(inicio AT TIME ZONE $2,'YYYY-MM-DD HH24:MI')=$3 AND estado NOT IN ('cancelada','ausente')`, [bA, config.tz, `${F1} 09:00`])).n;
    const lista = await cC.get(`/citas/nueva?barbero_id=${bA}&servicio_id=${srv30}&fecha=${F1}`);
    return { ok: r.status === 302 && n === 1 && !lista.texto.includes('value="09:00"') && lista.texto.includes('value="09:30"'), obtenido: `HTTP ${r.status}; citas activas en ese horario: ${n}; 09:00 ofrecido: ${lista.texto.includes('value="09:00"')}; 09:30 ofrecido: ${lista.texto.includes('value="09:30"')}` };
  });
  await prueba('PF-14', 'RF-05', 'cita de 30 min a las 09:15 (solapa con 09:00–09:30)', 'Rechazada por solape parcial; 1 sola cita activa en la franja', async () => {
    let rechazo = false;
    try { await query(`INSERT INTO citas (cliente_id,barbero_id,servicio_id,inicio,fin) VALUES ($1,$2,$3,(($4::date+'09:15'::time) AT TIME ZONE $5),(($4::date+'09:45'::time) AT TIME ZONE $5))`, [idCC, bA, srv30, F1, config.tz]); }
    catch (e) { rechazo = e.code === '23P01'; }
    return { ok: rechazo, obtenido: `INSERT directo en SQL: ${rechazo ? 'rechazado por restricción EXCLUDE (23P01)' : 'ACEPTADO (error)'}` };
  });

  // ============ RF-06 ============
  await prueba('PF-15', 'RF-06', `cliente B reprograma su cita a ${F2} 10:00; luego C reserva el horario anterior`, 'Cita cambia de horario en BD y el horario anterior queda libre (C puede reservarlo)', async () => {
    const r = await cB.post(`/citas/${citaB}/reprogramar`, { fecha: F2, hora: '10:00' });
    const c = await una(`SELECT to_char(inicio AT TIME ZONE $1,'YYYY-MM-DD HH24:MI') AS i FROM citas WHERE id=$2`, [config.tz, citaB]);
    const r2 = await cC.post('/citas', { barbero_id: bA, servicio_id: srv30, fecha: F1, hora: '09:00' });
    const n = (await una(`SELECT count(*)::int AS n FROM citas WHERE cliente_id=$1 AND estado='pendiente'`, [idCC])).n;
    return { ok: r.status === 302 && c.i === `${F2} 10:00` && r2.status === 302 && n === 1, obtenido: `reprogramación HTTP ${r.status}; BD: ${c.i}; C reservó el horario liberado: ${n === 1}` };
  });
  await prueba('PF-16', 'RF-06 / RNF-08', 'cliente B cancela su cita pendiente', 'Estado «cancelada»; horario libre; auditoría con usuario, fecha y valor anterior', async () => {
    const r = await cB.post(`/citas/${citaB}/cancelar`, {});
    const c = await una('SELECT estado FROM citas WHERE id=$1', [citaB]);
    const a = await una(`SELECT usuario_id, fecha, valor_anterior FROM auditoria WHERE tabla='citas' AND registro_id=$1 AND accion='cancelacion_cita'`, [citaB]);
    const libres = await cB.get(`/citas/nueva?barbero_id=${bA}&servicio_id=${srv30}&fecha=${F2}`);
    return { ok: r.status === 302 && c.estado === 'cancelada' && a?.usuario_id === idCB && a.valor_anterior.estado === 'pendiente' && libres.texto.includes('value="10:00"'), obtenido: `HTTP ${r.status}; BD estado=${c.estado}; auditoría usuario=${a?.usuario_id}, anterior=${a?.valor_anterior?.estado}; 10:00 libre de nuevo: ${libres.texto.includes('value="10:00"')}` };
  });
  await prueba('PF-17', 'RF-06', 'cita pendiente a 1 hora (plazo mínimo 2 h) y cancelación del cliente', 'Rechazada por plazo; la cita sigue «pendiente» en BD', async () => {
    const id = (await query(`INSERT INTO citas (cliente_id,barbero_id,servicio_id,inicio,fin) VALUES ($1,$2,$3, now()+interval '1 hour', now()+interval '90 minutes') RETURNING id`, [idCB, bB, srv30])).rows[0].id;
    const r = await cB.post(`/citas/${id}/cancelar`, {});
    const c = await una('SELECT estado FROM citas WHERE id=$1', [id]);
    const msg = (await cB.get('/citas')).texto.includes('Faltan menos de 2 horas');
    return { ok: c.estado === 'pendiente' && msg, obtenido: `HTTP ${r.status}; estado en BD: ${c.estado}; mensaje de plazo mostrado: ${msg}` };
  });
  await prueba('PF-18', 'RF-06', 'cliente C intenta cancelar la cita de otro cliente', 'No se modifica la cita ajena', async () => {
    const id = (await query(`SELECT id FROM citas WHERE cliente_id=$1 AND estado='pendiente' ORDER BY id LIMIT 1`, [idCB])).rows[0].id;
    await cC.post(`/citas/${id}/cancelar`, {});
    const c = await una('SELECT estado FROM citas WHERE id=$1', [id]);
    return { ok: c.estado === 'pendiente', obtenido: `estado de la cita ajena en BD: ${c.estado}` };
  });

  // ============ RF-07 ============
  await prueba('PF-19', 'RF-07', `barbero A consulta su agenda de ${F1}; barbero B consulta la suya`, 'A ve la cita del cliente C; B no la ve', async () => {
    const a = await barbA.get(`/agenda?fecha=${F1}`), b = await barbB.get(`/agenda?fecha=${F1}`);
    return { ok: a.texto.includes('Cliente C Pruebas') && !b.texto.includes('Cliente C Pruebas'), obtenido: `A ve la cita: ${a.texto.includes('Cliente C Pruebas')}; B ve la cita: ${b.texto.includes('Cliente C Pruebas')}` };
  });
  await prueba('PF-20', 'RF-07', 'barbero A: pendiente→confirmada; pendiente→atendida; barbero B intenta cambiar cita de A', 'Primer cambio guardado; el salto inválido y el cambio ajeno se rechazan', async () => {
    const id = (await una(`SELECT id FROM citas WHERE cliente_id=$1 AND estado='pendiente'`, [idCC])).id;
    await barbA.post(`/agenda/${id}/estado`, { estado: 'confirmada' });
    const e1 = (await una('SELECT estado FROM citas WHERE id=$1', [id])).estado;
    await barbA.post(`/agenda/${id}/estado`, { estado: 'pendiente' });
    await barbA.post(`/agenda/${id}/estado`, { estado: 'atendida' });
    const e2 = (await una('SELECT estado FROM citas WHERE id=$1', [id])).estado;
    const rb = await barbB.post(`/agenda/${id}/estado`, { estado: 'cancelada' });
    const e3 = (await una('SELECT estado FROM citas WHERE id=$1', [id])).estado;
    return { ok: e1 === 'confirmada' && e2 === 'confirmada' && rb.status === 403 && e3 === 'confirmada', obtenido: `tras confirmar: ${e1}; tras salto inválido: ${e2}; barbero B: HTTP ${rb.status}, estado ${e3}` };
  });

  // ============ RF-03 (eliminar) / RN-12 ============
  await prueba('PF-21', 'RF-03 / RN-12', 'eliminar servicio con citas y eliminar servicio sin citas', 'Con citas: no se elimina (se sugiere desactivar). Sin citas: se elimina', async () => {
    const r1 = await admin.post(`/admin/servicios/${srv30}/eliminar`, {});
    const sigue = (await una('SELECT count(*)::int AS n FROM servicios WHERE id=$1', [srv30])).n;
    const r2 = await admin.post(`/admin/servicios/${idSrv}/eliminar`, {});
    const borrado = (await una('SELECT count(*)::int AS n FROM servicios WHERE id=$1', [idSrv])).n;
    return { ok: sigue === 1 && borrado === 0, obtenido: `con citas: HTTP ${r1.status}, sigue en BD: ${sigue === 1}; sin citas: HTTP ${r2.status}, eliminado: ${borrado === 0}` };
  });

  // ============ RNF-13: concurrencia ============
  await prueba('PF-22', 'RNF-13 / RN-01', `20 clientes reservan a la vez barbero B, ${F3} 11:00`, 'Exactamente 1 solicitud aceptada; 1 sola cita activa en BD', async () => {
    const clientes = [];
    for (let i = 0; i < 20; i++) { const co = `conc${i}${run}${DOMINIO}`; await crearUsuario(`Concurrente ${i}`, co, 'cliente'); const c = new Cliente(); await c.login(co); await c.csrf(); clientes.push(c); }
    const resp = await Promise.all(clientes.map((c) => c.post('/citas', { barbero_id: bB, servicio_id: srv30, fecha: F3, hora: '11:00' })));
    const n = (await una(`SELECT count(*)::int AS n FROM citas WHERE barbero_id=$1 AND to_char(inicio AT TIME ZONE $2,'YYYY-MM-DD HH24:MI')=$3 AND estado NOT IN ('cancelada','ausente')`, [bB, config.tz, `${F3} 11:00`])).n;
    const exitos = resp.filter((r) => r.loc === '/citas').length;
    return { ok: n === 1 && exitos === 1, obtenido: `solicitudes aceptadas: ${exitos} de 20; citas activas en BD: ${n}` };
  });

  // ---------- informe ----------
  const aprobadas = filas.filter((f) => f.ok).length;
  const md = [
    '# Resultados de las pruebas funcionales — Barbershop V1.1', '',
    `Ejecución: ${new Date().toISOString()} · PostgreSQL ${(await una('SHOW server_version')).server_version} · Node ${process.version}`, '',
    `**Resultado: ${aprobadas} de ${filas.length} pruebas aprobadas.**`, '',
    '| ID | Requisito | Datos utilizados | Resultado esperado | Resultado obtenido | Estado |', '|---|---|---|---|---|---|',
    ...filas.map((f) => `| ${f.id} | ${f.req} | ${f.datos.replace(/\|/g, '/')} | ${f.esperado.replace(/\|/g, '/')} | ${String(f.obtenido).replace(/\|/g, '/')} | ${f.ok ? 'Aprobada' : '**FALLA**'} |`), '',
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, 'resultados.md'), md);
  fs.writeFileSync(path.join(__dirname, 'resultados.json'), JSON.stringify(filas, null, 2));
  console.log(`\n${aprobadas}/${filas.length} pruebas aprobadas → tests/resultados.md`);
  if (process.argv.includes('--limpiar')) await limpiar();
  server.close(); await pool.end();
  process.exit(aprobadas === filas.length ? 0 : 1);
})().catch(async (e) => { console.error(e); process.exit(2); });
