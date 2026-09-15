// Safe demo mode: emails are processed but not delivered, WhatsApp sends are faked.
// Works on Windows, macOS and Linux: npm run demo
process.env.MAIL_TRANSPORT = 'json';
process.env.WA_DRY_RUN = '1';
require('./index');
