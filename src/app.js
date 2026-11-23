const path = require('path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const config = require('./config');
const { pool } = require('./db');
const { csrf } = require('./middleware/auth');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// RNF-20: la sesion expira tras 30 minutos de inactividad (rolling).
app.use(session({
  store: new PgStore({ pool, tableName: 'sesiones' }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: true,
  rolling: true,
  cookie: { maxAge: config.sesionMin * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true' },
}));

const fmt = (opts) => new Intl.DateTimeFormat('es-EC', { timeZone: config.tz, ...opts });
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.fechaHora = (d) => fmt({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
  res.locals.hora = (d) => fmt({ timeStyle: 'short' }).format(new Date(d));
  res.locals.dinero = (n) => `$${Number(n).toFixed(2)}`;
  res.locals.ESTADOS = { pendiente: 'Pendiente', confirmada: 'Confirmada', en_espera: 'En espera', en_atencion: 'En atención', atendida: 'Atendida', ausente: 'Ausente', cancelada: 'Cancelada' };
  next();
});

app.use(csrf); // despues de res.locals para que las paginas de error tengan usuario y menu
app.use(require('./routes/auth'));
app.use(require('./routes/admin'));
app.use(require('./routes/citas'));
app.use(require('./routes/agenda'));

app.use((req, res) => res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'La página solicitada no existe.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { titulo: 'Error interno', mensaje: 'Ocurrió un error inesperado. Intente nuevamente.' });
});

if (require.main === module) {
  app.listen(config.port, () => console.log(`Barbershop en http://localhost:${config.port}`));
}
module.exports = app;
