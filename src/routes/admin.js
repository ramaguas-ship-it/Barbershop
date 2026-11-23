const express = require('express');
const bcrypt = require('bcryptjs');
const { query, withTx } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use('/admin', requireRole('administrador'));
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TEL_RE = /^[0-9+]{7,15}$/;

const flash = (req, tipo, texto) => { req.session.flash = { tipo, texto }; };

// =============================== RF-03: SERVICIOS ===============================
function validarServicio(b) {
  const d = { nombre: String(b.nombre || '').trim(), duracion_min: Number(b.duracion_min), precio: Number(b.precio) };
  const e = [];
  if (d.nombre.length < 3 || d.nombre.length > 80) e.push('El nombre debe tener entre 3 y 80 caracteres.');
  if (!Number.isInteger(d.duracion_min) || d.duracion_min < 5 || d.duracion_min > 480) e.push('La duración debe ser un número entero de minutos entre 5 y 480.');
  if (!Number.isFinite(d.precio) || d.precio < 0 || d.precio > 9999.99) e.push('El precio debe ser un valor entre 0 y 9999.99.');
  return { d, e };
}

router.get('/admin/servicios', async (req, res) => {
  const { rows } = await query('SELECT * FROM servicios ORDER BY activo DESC, nombre');
  res.render('admin/servicios', { servicios: rows, errores: [], datos: {} });
});

router.post('/admin/servicios', async (req, res) => {
  const { d, e } = validarServicio(req.body);
  const rerender = async (errores, code) => {
    const { rows } = await query('SELECT * FROM servicios ORDER BY activo DESC, nombre');
    res.status(code).render('admin/servicios', { servicios: rows, errores, datos: req.body });
  };
  if (e.length) return rerender(e, 400);
  try {
    await query('INSERT INTO servicios (nombre, duracion_min, precio) VALUES ($1, $2, $3)', [d.nombre, d.duracion_min, d.precio]);
  } catch (err) {
    if (err.code === '23505') return rerender(['Ya existe un servicio con ese nombre.'], 409);
    throw err;
  }
  flash(req, 'ok', `Servicio «${d.nombre}» registrado.`);
  res.redirect('/admin/servicios');
});

router.get('/admin/servicios/:id/editar', async (req, res) => {
  const s = (await query('SELECT * FROM servicios WHERE id = $1::int', [req.params.id])).rows[0];
  if (!s) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El servicio no existe.' });
  res.render('admin/servicio_editar', { s, errores: [] });
});

router.post('/admin/servicios/:id', async (req, res) => {
  const { d, e } = validarServicio(req.body);
  if (e.length) return res.status(400).render('admin/servicio_editar', { s: { id: req.params.id, ...d, activo: true }, errores: e });
  try {
    const r = await withTx(req.session.user.id, (c) => c.query(
      'UPDATE servicios SET nombre = $1, duracion_min = $2, precio = $3 WHERE id = $4::int',
      [d.nombre, d.duracion_min, d.precio, req.params.id]));
    if (!r.rowCount) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El servicio no existe.' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).render('admin/servicio_editar', { s: { id: req.params.id, ...d, activo: true }, errores: ['Ya existe un servicio con ese nombre.'] });
    throw err;
  }
  flash(req, 'ok', 'Servicio actualizado.');
  res.redirect('/admin/servicios');
});

router.post('/admin/servicios/:id/estado', async (req, res) => {
  await query('UPDATE servicios SET activo = NOT activo WHERE id = $1::int', [req.params.id]);
  flash(req, 'ok', 'Estado del servicio actualizado.');
  res.redirect('/admin/servicios');
});

// RN-12: un registro con historial no se elimina; la FK lo impide y se sugiere desactivar.
router.post('/admin/servicios/:id/eliminar', async (req, res) => {
  try {
    const r = await query('DELETE FROM servicios WHERE id = $1::int', [req.params.id]);
    flash(req, r.rowCount ? 'ok' : 'error', r.rowCount ? 'Servicio eliminado.' : 'El servicio no existe.');
  } catch (err) {
    if (err.code !== '23503') throw err;
    flash(req, 'error', 'No se puede eliminar: el servicio tiene citas asociadas. Desactívelo en su lugar.');
  }
  res.redirect('/admin/servicios');
});

// =============================== RF-03: BARBEROS ===============================
const SQL_BARBEROS = `SELECT b.id, b.activo, u.nombre, u.telefono, u.correo
                        FROM barberos b JOIN usuarios u ON u.id = b.usuario_id
                       ORDER BY b.activo DESC, u.nombre`;

router.get('/admin/barberos', async (req, res) => {
  res.render('admin/barberos', { barberos: (await query(SQL_BARBEROS)).rows, errores: [], datos: {} });
});

router.post('/admin/barberos', async (req, res) => {
  const d = { nombre: String(req.body.nombre || '').trim(), telefono: String(req.body.telefono || '').trim(), correo: String(req.body.correo || '').trim() };
  const password = String(req.body.password || '');
  const e = [];
  if (d.nombre.length < 3 || d.nombre.length > 100) e.push('El nombre debe tener entre 3 y 100 caracteres.');
  if (!TEL_RE.test(d.telefono)) e.push('El teléfono debe tener entre 7 y 15 dígitos.');
  if (!CORREO_RE.test(d.correo)) e.push('Ingrese un correo válido.');
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) e.push('La contraseña inicial debe tener al menos 8 caracteres, con letras y números.');
  const rerender = async (errores, code) => res.status(code).render('admin/barberos', { barberos: (await query(SQL_BARBEROS)).rows, errores, datos: d });
  if (e.length) return rerender(e, 400);
  try {
    const hash = await bcrypt.hash(password, 10);
    // RNF-04: usuario y perfil de barbero se crean juntos o no se crea ninguno.
    await withTx(req.session.user.id, async (c) => {
      const u = await c.query(
        `INSERT INTO usuarios (nombre, telefono, correo, password_hash, rol, consentimiento)
         VALUES ($1, $2, $3, $4, 'barbero', TRUE) RETURNING id`, [d.nombre, d.telefono, d.correo, hash]);
      await c.query('INSERT INTO barberos (usuario_id) VALUES ($1)', [u.rows[0].id]);
    });
  } catch (err) {
    if (err.code === '23505') return rerender(['Ese correo ya está registrado.'], 409);
    throw err;
  }
  flash(req, 'ok', `Barbero «${d.nombre}» registrado.`);
  res.redirect('/admin/barberos');
});

router.get('/admin/barberos/:id/editar', async (req, res) => {
  const b = (await query(`SELECT b.id, u.nombre, u.telefono, u.correo FROM barberos b JOIN usuarios u ON u.id = b.usuario_id WHERE b.id = $1::int`, [req.params.id])).rows[0];
  if (!b) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El barbero no existe.' });
  res.render('admin/barbero_editar', { b, errores: [] });
});

router.post('/admin/barberos/:id', async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const telefono = String(req.body.telefono || '').trim();
  const e = [];
  if (nombre.length < 3 || nombre.length > 100) e.push('El nombre debe tener entre 3 y 100 caracteres.');
  if (!TEL_RE.test(telefono)) e.push('El teléfono debe tener entre 7 y 15 dígitos.');
  if (e.length) {
    const b = (await query('SELECT u.correo FROM barberos b JOIN usuarios u ON u.id = b.usuario_id WHERE b.id = $1::int', [req.params.id])).rows[0] || {};
    return res.status(400).render('admin/barbero_editar', { b: { id: req.params.id, nombre, telefono, correo: b.correo }, errores: e });
  }
  const r = await query(
    `UPDATE usuarios SET nombre = $1, telefono = $2
      WHERE id = (SELECT usuario_id FROM barberos WHERE id = $3::int)`, [nombre, telefono, req.params.id]);
  if (!r.rowCount) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El barbero no existe.' });
  flash(req, 'ok', 'Barbero actualizado.');
  res.redirect('/admin/barberos');
});

router.post('/admin/barberos/:id/estado', async (req, res) => {
  await withTx(req.session.user.id, async (c) => {
    const b = await c.query('UPDATE barberos SET activo = NOT activo WHERE id = $1::int RETURNING usuario_id, activo', [req.params.id]);
    if (b.rowCount) await c.query('UPDATE usuarios SET activo = $1 WHERE id = $2', [b.rows[0].activo, b.rows[0].usuario_id]);
  });
  flash(req, 'ok', 'Estado del barbero actualizado.');
  res.redirect('/admin/barberos');
});

router.post('/admin/barberos/:id/eliminar', async (req, res) => {
  try {
    const r = await withTx(req.session.user.id, async (c) => {
      const b = await c.query('DELETE FROM barberos WHERE id = $1::int RETURNING usuario_id', [req.params.id]);
      if (b.rowCount) await c.query('DELETE FROM usuarios WHERE id = $1', [b.rows[0].usuario_id]);
      return b.rowCount;
    });
    flash(req, r ? 'ok' : 'error', r ? 'Barbero eliminado.' : 'El barbero no existe.');
  } catch (err) {
    if (err.code !== '23503') throw err;
    flash(req, 'error', 'No se puede eliminar: el barbero tiene citas asociadas. Desactívelo en su lugar.');
  }
  res.redirect('/admin/barberos');
});

// =============================== Citas (vista del administrador) ===============================
router.get('/admin/citas', async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.inicio, c.estado, uc.nombre AS cliente, ub.nombre AS barbero, s.nombre AS servicio
       FROM citas c
       JOIN usuarios uc ON uc.id = c.cliente_id
       JOIN barberos b  ON b.id  = c.barbero_id
       JOIN usuarios ub ON ub.id = b.usuario_id
       JOIN servicios s ON s.id  = c.servicio_id
      ORDER BY c.inicio DESC LIMIT 100`);
  res.render('admin/citas', { citas: rows });
});

module.exports = router;
