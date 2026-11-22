// Aplica db/01_schema.sql y db/02_seed.sql usando DATABASE_URL.
// Uso: npm run db:init   (agregue --sin-semilla para omitir los datos de demostracion)
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

(async () => {
  const dir = path.join(__dirname, '..', 'db');
  await pool.query(fs.readFileSync(path.join(dir, '01_schema.sql'), 'utf8'));
  console.log('Esquema aplicado.');
  if (!process.argv.includes('--sin-semilla')) {
    const hash = await bcrypt.hash('Barber2026!', 10);
    const seed = fs.readFileSync(path.join(dir, '02_seed.sql'), 'utf8').replaceAll('__HASH__', hash);
    await pool.query(seed);
    console.log('Datos de demostracion cargados (contrasena: Barber2026!).');
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
