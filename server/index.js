// Local server. On Vercel, the root app.js runs as a function instead.
const app = require('../app');
const db = require('./lib/db');

const port = Number(process.env.PORT) || 3000;

db.ready().then(() => {
  const server = app.listen(port, (err) => {
    if (err) {
      console.error(`Could not start on port ${port}: ${err.message}`);
      process.exit(1);
    }
    console.log(`ReachDesk running on http://localhost:${port}`);
  });
  const stop = () => {
    server.close();
    db.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}).catch((e) => {
  console.error(`Could not open the database: ${e.message}`);
  process.exit(1);
});

// Express 5 forwards async route errors to the error handler; this is a last-resort guard.
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
