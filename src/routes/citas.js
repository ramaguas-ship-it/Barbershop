const express = require('express');
const { query, withTx } = require('../db');
const config = require('../config');
const { requireRole } = require('../middleware/auth');
const { horariosLibres, fechaValida } = require('../services');

const router = express.Router();
router.use('/citas', requireRole('cliente'));

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const flash = (req, tipo, texto) => { req.session.flash = { tipo, texto }; };

const catalogos = async () => ({
  servicios: (await query('SELECT id, nombre, duracion_min, precio FROM servicios WHERE activo ORDER BY nombre')).rows,
  barberos: (await query('SELECT b.id, u.nombre FROM barberos b JOIN usuarios u ON u.id = b.usuario_id WHERE b.activo ORDER BY u.nombre')).rows,
});

// ------------------------------ Mis citas ------------------------------
router.get('/citas', async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.inicio, c.estado, c.estado_pago, s.nombre AS servicio, s.precio, u.nombre AS barbero,
            (c.estado = 'pendiente' AND c.inicio - now() >= make_interval(hours => $2)) AS modificable
       FROM citas c
       JOIN servicios s ON s.id = c.servicio_id
       JOIN barberos b  ON b.id = c.barbero_id
       JOIN usuarios u  ON u.id = b.usuario_id
      WHERE c.cliente_id = $1
      ORDER BY c.inicio DESC`, [req.session.user.id, config.plazoHoras]);
  res.render('citas/lista', { citas: rows, plazo: config.plazoHoras });
});

// ------------------------------ RF-04 / RF-05: reservar ------------------------------
router.get('/citas/nueva', async (req, res) => {
  const { barbero_id = '', servicio_id = '', fecha = '' } = req.query;
  const cat = await catalogos();
  let libres = null;
  if (barbero_id && servicio_id && fecha) libres = await horariosLibres({ barberoId: barbero_id, servicioId: servicio_id, fecha });
  res.render('citas/nueva', { ...cat, sel: { barbero_id, servicio_id, fecha }, libres, hoy: new Date().toLocaleDateString('en-CA', { timeZone: config.tz }) });
});

const SQL_FECHA_HORA = `(($1::date + $2::time) AT TIME ZONE $3)`;

router.post('/citas', async (req, res) => {
  const { barbero_id, servicio_id, fecha, hora } = req.body;
  const volver = `/citas/nueva?barbero_id=${encodeURIComponent(barbero_id || '')}&servicio_id=${encodeURIComponent(servicio_id || '')}&fecha=${encodeURIComponent(fecha || '')}`;
  if (!/^\d+$/.test(barbero_id || '') || !/^\d+$/.test(servicio_id || '') || !fechaValida(fecha) || !HORA_RE.test(hora || '')) {
    flash(req, 'error', 'Complete barbero, servicio, fecha y horario con valores válidos.');
    return res.redirect('/citas/nueva');
  }
  // Verificacion previa (orienta al usuario); la garantia real es la restriccion de la BD.
  const libres = await horariosLibres({ barberoId: barbero_id, servicioId: servicio_id, fecha });
  if (!libres.includes(hora)) {
    flash(req, 'error', 'Ese horario no está disponible. Elija uno de los horarios libres.');
    return res.redirect(volver);
  }
  try {
    await withTx(req.session.user.id, (c) => c.query(
      `INSERT INTO citas (cliente_id, barbero_id, servicio_id, inicio, fin)
       SELECT $4::int, $5::int, s.id, t.i, t.i + make_interval(mins => s.duracion_min)
         FROM servicios s, (SELECT ${SQL_FECHA_HORA} AS i) t
        WHERE s.id = $6::int AND s.activo
          AND EXISTS (SELECT 1 FROM barberos b WHERE b.id = $5::int AND b.activo)`,
      [fecha, hora, config.tz, req.session.user.id, barbero_id, servicio_id]));
  } catch (err) {
    if (err.code === '23P01') { // exclusion_violation: otro cliente reservo primero (RN-01)
      flash(req, 'error', 'Ese horario acaba de ser ocupado. Elija otro de los horarios libres.');
      return res.redirect(volver);
    }
    throw err;
  }
  flash(req, 'ok', 'Cita reservada. Quedó en estado «pendiente».');
  res.redirect('/citas');
});

// ------------------------------ RF-06: reprogramar ------------------------------
async function citaPropia(req) {
  return (await query(
    `SELECT c.*, s.nombre AS servicio, u.nombre AS barbero,
            (c.inicio - now() >= make_interval(hours => $3)) AS en_plazo
       FROM citas c JOIN servicios s ON s.id = c.servicio_id
       JOIN barberos b ON b.id = c.barbero_id JOIN usuarios u ON u.id = b.usuario_id
      WHERE c.id = $1::int AND c.cliente_id = $2`, [req.params.id, req.session.user.id, config.plazoHoras])).rows[0];
}

function motivoNoModificable(c) {
  if (!c) return 'La cita no existe.';
  if (c.estado !== 'pendiente') return 'Solo se pueden modificar citas pendientes.';
  if (c.estado_pago === 'pagado') return 'La cita está pagada en línea; su modificación requiere la gestión de devoluciones (RF-68, pendiente).';
  if (!c.en_plazo) return `Faltan menos de ${config.plazoHoras} horas para la cita; comuníquese con la barbería.`;
  return null;
}

router.get('/citas/:id/reprogramar', async (req, res) => {
  const c = await citaPropia(req);
  const motivo = motivoNoModificable(c);
  if (motivo) { flash(req, 'error', motivo); return res.redirect('/citas'); }
  const fecha = req.query.fecha || '';
  const libres = fecha ? await horariosLibres({ barberoId: c.barbero_id, servicioId: c.servicio_id, fecha, excluirCitaId: c.id }) : null;
  res.render('citas/reprogramar', { c, fecha, libres, hoy: new Date().toLocaleDateString('en-CA', { timeZone: config.tz }) });
});

router.post('/citas/:id/reprogramar', async (req, res) => {
  const { fecha, hora } = req.body;
  const volver = `/citas/${encodeURIComponent(req.params.id)}/reprogramar?fecha=${encodeURIComponent(fecha || '')}`;
  const c = await citaPropia(req);
  const motivo = motivoNoModificable(c);
  if (motivo) { flash(req, 'error', motivo); return res.redirect('/citas'); }
  if (!fechaValida(fecha) || !HORA_RE.test(hora || '')) { flash(req, 'error', 'Indique una fecha y un horario válidos.'); return res.redirect(volver); }
  const libres = await horariosLibres({ barberoId: c.barbero_id, servicioId: c.servicio_id, fecha, excluirCitaId: c.id });
  if (!libres.includes(hora)) { flash(req, 'error', 'Ese horario no está disponible. Elija uno de los horarios libres.'); return res.redirect(volver); }
  try {
    const r = await withTx(req.session.user.id, (cl) => cl.query(
      `UPDATE citas SET inicio = t.i, fin = t.i + make_interval(mins => s.duracion_min)
         FROM servicios s, (SELECT ${SQL_FECHA_HORA} AS i) t
        WHERE citas.id = $4::int AND citas.cliente_id = $5 AND citas.estado = 'pendiente' AND s.id = citas.servicio_id`,
      [fecha, hora, config.tz, req.params.id, req.session.user.id]));
    if (!r.rowCount) { flash(req, 'error', 'No se pudo reprogramar la cita.'); return res.redirect('/citas'); }
  } catch (err) {
    if (err.code === '23P01') { flash(req, 'error', 'Ese horario acaba de ser ocupado. Elija otro.'); return res.redirect(volver); }
    throw err;
  }
  flash(req, 'ok', 'Cita reprogramada. El horario anterior quedó libre.');
  res.redirect('/citas');
});

// ------------------------------ RF-06: cancelar ------------------------------
router.post('/citas/:id/cancelar', async (req, res) => {
  const c = await citaPropia(req);
  const motivo = motivoNoModificable(c);
  if (motivo) { flash(req, 'error', motivo); return res.redirect('/citas'); }
  // El trigger de auditoria guarda usuario, fecha y valor anterior (RNF-08).
  await withTx(req.session.user.id, (cl) => cl.query(
    `UPDATE citas SET estado = 'cancelada' WHERE id = $1::int AND cliente_id = $2 AND estado = 'pendiente'`,
    [req.params.id, req.session.user.id]));
  flash(req, 'ok', 'Cita cancelada. El horario quedó libre.');
  res.redirect('/citas');
});

module.exports = router;
