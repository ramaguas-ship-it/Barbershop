const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

/** Consulta parametrizada: los valores viajan separados del SQL ($1, $2...). */
const query = (text, params) => pool.query(text, params);

/**
 * Ejecuta fn dentro de una transaccion (RNF-04) e informa al servidor quien actua,
 * para que los triggers de auditoria (RNF-08) guarden el usuario.
 */
async function withTx(usuarioId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.usuario_id', $1, true)", [String(usuarioId ?? '')]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTx };
