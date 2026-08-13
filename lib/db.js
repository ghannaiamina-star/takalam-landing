// One-shot HTTP queries via Neon's serverless driver. Deliberately not using
// Pool/Client (WebSocket mode): those need an explicit open/close lifecycle
// per invocation, and a Pool created at module scope will leak connections
// across frozen/thawed serverless invocations. This is the only DB access
// pattern Milestone 1 needs (no multi-statement transactions).
const { neon } = require('@neondatabase/serverless');

// Constructed lazily so a missing DATABASE_URL surfaces as a normal caught
// error inside a handler (which can return a clean JSON 500) rather than
// crashing the whole module at require() time.
let client = null;
function sql(strings, ...values) {
  if (!client) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set.');
    }
    client = neon(process.env.DATABASE_URL);
  }
  return client(strings, ...values);
}

module.exports = { sql };
