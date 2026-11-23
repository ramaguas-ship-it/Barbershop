const express = require('express');
const { query, withTx } = require('../db');
const config = require('../config');
const { requireRole } = require('../middleware/auth');
const { fechaValida } = require('../services');

const router = express.Router();

// Transiciones permitidas del estado de una cita (RF-07).
const TRANSICIONES = {
  pendiente:   ['confirmada', 'ausente', 'cancelada'],
  confirmada:  ['en_espera', 'en_atencion', 'ausente', 'cancelada'],
  en_espera:   ['en_atencion', 'ausente', 'cancelada'],
  en_atencion: ['atendida'],
  atendida: [], ausente: [], cancelada: [],
};

router.get('/agenda', requireRole('barbero'), async (req, res) => {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: config.tz });
  const fecha = fechaValida(req.query.fecha) ? req.query.fecha : hoy;
  const { rows } = await query(
    `SELECT c.id, c.inicio, c.fin, c.estado, uc.nombre AS cliente, uc.telefono, s.nombre AS servicio
       FROM citas c
       JOIN barberos b  ON b.id = c.barbero_id AND b.usuario_id = $1      -- el barbero ve solo sus citas
       JOIN usuarios uc ON uc.id = c.cliente_id
       JOIN servicios s ON s.id = c.servicio_id
      WHERE c.inicio >= $2::date::timestamp AT TIME ZONE $3
        AND c.inicio <  ($2::date + 1)::timestamp AT TIME ZONE $3
      ORDER BY c.inicio`, [req.session.user.id, fecha, config.tz]);
  res.render('citas/agenda', { citas: rows, fecha, TRANSICIONES });
});

// Barbero (sus citas) o administrador (solo cancelar, a solicitud del cliente).
router.post('/agenda/:id/estado', requireRole('barbero', 'administrador'), async (req, res) => {
  const nuevo = String(req.body.estado || '');
  const es_admin = req.session.user.rol === 'administrador';
  const destino = es_admin ? '/admin/citas' : '/agenda';
  const cita = (await query(
    `SELECT c.id, c.estado, b.usuario_id FROM citas c JOIN barberos b ON b.id = c.barbero_id WHERE c.id = $1::int`, [req.params.id])).rows[0];
  const err = (t) => { req.session.flash = { tipo: 'error', texto: t }; return res.redirect(destino); };

  if (!cita) return err('La cita no existe.');
  if (!es_admin && cita.usuario_id !== req.session.user.id) return res.status(403).render('error', { titulo: 'Acceso denegado', mensaje: 'Solo puede gestionar sus propias citas.' });
  if (es_admin && nuevo !== 'cancelada') return err('El administrador solo puede cancelar citas.');
  if (!(TRANSICIONES[cita.estado] || []).includes(nuevo)) return err(`No se puede pasar de «${cita.estado}» a «${nuevo}».`);

  // La condicion estado = actual evita pisar un cambio concurrente.
  const r = await withTx(req.session.user.id, (c) => c.query(
    'UPDATE citas SET estado = $1 WHERE id = $2::int AND estado = $3', [nuevo, req.params.id, cita.estado]));
  req.session.flash = r.rowCount ? { tipo: 'ok', texto: 'Estado actualizado.' } : { tipo: 'error', texto: 'La cita cambió mientras la editaba; recargue.' };
  res.redirect(destino);
});

module.exports = router;
