require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./lib/db');

db.load();
const auth = require('./lib/auth');
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(require('./routes/public'));
app.use('/api', auth.requireAuth);
app.use('/api', require('./routes/contacts'));
app.use('/api', require('./routes/misc'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? (err.message || 'Something failed on the server.') : err.message });
});

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => console.log(`ReachDesk running on http://localhost:${port}`));

// Express 5 forwards async route errors to the handler above; this is a last-resort guard.
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { db.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500); });
}
