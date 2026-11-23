require('dotenv').config();
const crypto = require('crypto');

const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[aviso] SESSION_SECRET no definido: se usa un valor aleatorio (las sesiones se pierden al reiniciar).');
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/barbershop',
  sessionSecret: secret,
  tz: 'America/Guayaquil',
  apertura: process.env.HORA_APERTURA || '08:00',
  cierre: process.env.HORA_CIERRE || '18:00',
  pasoMin: 30,                                      // separacion entre horarios ofrecidos
  plazoHoras: Number(process.env.PLAZO_MIN_HORAS) || 2, // RF-06
  sesionMin: 30,                                    // RNF-20
  maxIntentos: 5,                                   // RNF-20
  bloqueoMin: 15,                                   // RNF-20
  diasMaxReserva: 60,
};
