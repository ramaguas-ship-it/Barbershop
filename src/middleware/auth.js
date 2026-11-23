const crypto = require('crypto');

/** Exige sesion iniciada (RF-02). */
function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { tipo: 'error', texto: 'Inicie sesión para continuar.' };
    return res.redirect('/login');
  }
  next();
}

/** Limita el acceso a los roles indicados (RF-02, RNF-03). */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.session.user) return requireLogin(req, res, next);
  if (!roles.includes(req.session.user.rol)) {
    return res.status(403).render('error', { titulo: 'Acceso denegado', mensaje: 'Su rol no tiene permiso para esta opción.' });
  }
  next();
};

/** Token CSRF por sesion para todos los formularios POST. */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const enviado = Buffer.from(String(req.body?._csrf ?? ''));
    const real = Buffer.from(req.session.csrf);
    if (enviado.length !== real.length || !crypto.timingSafeEqual(enviado, real)) {
      return res.status(403).render('error', { titulo: 'Solicitud no válida', mensaje: 'El formulario expiró. Recargue la página e intente de nuevo.' });
    }
  }
  next();
}

module.exports = { requireLogin, requireRole, csrf };
