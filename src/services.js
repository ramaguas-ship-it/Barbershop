const { query } = require('./db');
const config = require('./config');

const aMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(fecha) {
  if (!FECHA_RE.test(fecha || '')) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

/**
 * RF-05: devuelve los horarios (HH:MM) libres de un barbero para un servicio y fecha.
 * Esta consulta guia al cliente; la garantia final contra cruces es la restriccion
 * EXCLUDE de PostgreSQL (RN-01, RNF-13).
 */
async function horariosLibres({ barberoId, servicioId, fecha, excluirCitaId = null }) {
  if (!fechaValida(fecha)) return [];
  const srv = await query('SELECT duracion_min FROM servicios WHERE id = $1::int AND activo', [servicioId]);
  const barb = await query('SELECT 1 FROM barberos WHERE id = $1::int AND activo', [barberoId]);
  if (!srv.rowCount || !barb.rowCount) return [];
  const dur = srv.rows[0].duracion_min;

  const ahora = (await query(
    `SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS hoy,
            (extract(hour FROM now() AT TIME ZONE $1) * 60 + extract(minute FROM now() AT TIME ZONE $1))::int AS min,
            (($2::date - (now() AT TIME ZONE $1)::date)) AS dias`, [config.tz, fecha])).rows[0];
  if (ahora.dias < 0 || ahora.dias > config.diasMaxReserva) return [];

  const ocupados = (await query(
    `SELECT (extract(hour FROM inicio AT TIME ZONE $3) * 60 + extract(minute FROM inicio AT TIME ZONE $3))::int AS ini,
            (extract(hour FROM fin    AT TIME ZONE $3) * 60 + extract(minute FROM fin    AT TIME ZONE $3))::int AS fin
       FROM citas
      WHERE barbero_id = $1::int
        AND estado NOT IN ('cancelada', 'ausente')
        AND ($4::int IS NULL OR id <> $4::int)
        AND inicio >= ($2::date)::timestamp AT TIME ZONE $3
        AND inicio <  (($2::date + 1))::timestamp AT TIME ZONE $3`,
    [barberoId, fecha, config.tz, excluirCitaId])).rows;

  const libres = [];
  for (let ini = aMin(config.apertura); ini + dur <= aMin(config.cierre); ini += config.pasoMin) {
    if (fecha === ahora.hoy && ini <= ahora.min) continue;           // ya pasó
    if (ocupados.some((o) => ini < o.fin && ini + dur > o.ini)) continue; // se cruza
    libres.push(aHora(ini));
  }
  return libres;
}

module.exports = { horariosLibres, fechaValida };
