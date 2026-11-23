const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TEL_RE = /^[0-9+]{7,15}$/;
// Hash falso para igualar el tiempo de respuesta cuando el correo no existe.
const HASH_FALSO = bcrypt.hashSync('no-existe', 10);

const inicioPorRol = { cliente: '/citas', barbero: '/agenda', administrador: '/admin/servicios' };

router.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect(inicioPorRol[req.session.user.rol]);
});

// ------------------------------ RF-01: registro ------------------------------
router.get('/registro', (req, res) => res.render('auth/registro', { errores: [], datos: {} }));

router.post('/registro', async (req, res) => {
  const { nombre = '', telefono = '', correo = '', password = '', consentimiento } = req.body;
  const datos = { nombre: nombre.trim(), telefono: telefono.trim(), correo: correo.trim() };
  const errores = [];
  if (datos.nombre.length < 3 || datos.nombre.length > 100) errores.push('El nombre debe tener entre 3 y 100 caracteres.');
  if (!TEL_RE.test(datos.telefono)) errores.push('El teléfono debe tener entre 7 y 15 dígitos.');
  if (!CORREO_RE.test(datos.correo) || datos.correo.length > 120) errores.push('Ingrese un correo válido.');
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) errores.push('La contraseña debe tener al menos 8 caracteres, con letras y números.');
  if (!consentimiento) errores.push('Debe aceptar el tratamiento de sus datos personales.');
  if (errores.length) return res.status(400).render('auth/registro', { errores, datos });

  try {
    const hash = await bcrypt.hash(password, 10);
    await query(
      `INSERT INTO usuarios (nombre, telefono, correo, password_hash, rol, consentimiento)
       VALUES ($1, $2, $3, $4, 'cliente', TRUE)`,
      [datos.nombre, datos.telefono, datos.correo, hash]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).render('auth/registro', { errores: ['Ese correo ya está registrado.'], datos });
    }
    throw err;
  }
  req.session.flash = { tipo: 'ok', texto: 'Registro exitoso. Ya puede iniciar sesión.' };
  res.redirect('/login');
});

// ------------------------------ RF-02: login / logout ------------------------------
router.get('/login', (req, res) => res.render('auth/login', { error: null }));

router.post('/login', async (req, res) => {
  const correo = String(req.body.correo || '').trim();
  const password = String(req.body.password || '');
  const fallo = (msg, code = 401) => res.status(code).render('auth/login', { error: msg });

  const u = (await query('SELECT * FROM usuarios WHERE lower(correo) = lower($1)', [correo])).rows[0];
  if (!u) { await bcrypt.compare(password, HASH_FALSO); return fallo('Credenciales inválidas.'); }
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    return fallo('Cuenta bloqueada temporalmente por intentos fallidos. Intente más tarde.', 423);
  }
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok || !u.activo) {
    if (!ok) {
      // RNF-20: al 5.º intento fallido se bloquea la cuenta.
      await query(
        `UPDATE usuarios
            SET intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= $2 THEN 0 ELSE intentos_fallidos + 1 END,
                bloqueado_hasta   = CASE WHEN intentos_fallidos + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE bloqueado_hasta END
          WHERE id = $1`, [u.id, config.maxIntentos, config.bloqueoMin]);
    }
    return fallo('Credenciales inválidas.');
  }
  await query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [u.id]);

  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.user = { id: u.id, nombre: u.nombre, rol: u.rol };
    res.redirect(inicioPorRol[u.rol]);
  });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ------------------------------ Perfil (RF-01: consultar y actualizar) ------------------------------
router.get('/perfil', requireLogin, async (req, res) => {
  const p = (await query('SELECT nombre, telefono, correo, rol, creado_en FROM usuarios WHERE id = $1', [req.session.user.id])).rows[0];
  res.render('auth/perfil', { p, errores: [] });
});

router.post('/perfil', requireLogin, async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const telefono = String(req.body.telefono || '').trim();
  const errores = [];
  if (nombre.length < 3 || nombre.length > 100) errores.push('El nombre debe tener entre 3 y 100 caracteres.');
  if (!TEL_RE.test(telefono)) errores.push('El teléfono debe tener entre 7 y 15 dígitos.');
  const actual = (await query('SELECT nombre, telefono, correo, rol, creado_en FROM usuarios WHERE id = $1', [req.session.user.id])).rows[0];
  if (errores.length) return res.status(400).render('auth/perfil', { p: { ...actual, nombre, telefono }, errores });
  await query('UPDATE usuarios SET nombre = $1, telefono = $2 WHERE id = $3', [nombre, telefono, req.session.user.id]);
  req.session.user.nombre = nombre;
  req.session.flash = { tipo: 'ok', texto: 'Perfil actualizado correctamente.' };
  res.redirect('/perfil');
});

module.exports = router;
