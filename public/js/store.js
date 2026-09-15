// Sender credentials live in memory by default. They are saved in this
// browser only when the user ticks "Remember on this device", separately for each account.
const KEY = 'rd.senders';
const PREFS = 'rd.prefs';

const blank = () => ({ remember: false, smtp: { user: '', pass: '', fromName: '', replyTo: '', host: 'smtp.gmail.com', port: 465 }, wa: { token: '', phoneNumberId: '', version: 'v21.0' } });
let key = KEY;
const read = () => { try { return { ...blank(), ...JSON.parse(localStorage.getItem(key)) }; } catch { return blank(); } };
let senders = blank();
let prefs = (() => { try { return { countryCode: '92', ...JSON.parse(localStorage.getItem(PREFS)) }; } catch { return { countryCode: '92' }; } })();
let serverStatus = { emailFromEnv: false, whatsappFromEnv: false };

export function setAccount(id) {
  key = `${KEY}.${id}`;
  // Details saved before accounts existed go to the first account that signs in on this browser.
  const legacy = localStorage.getItem(KEY);
  if (legacy && !localStorage.getItem(key)) localStorage.setItem(key, legacy);
  localStorage.removeItem(KEY);
  senders = read();
  window.dispatchEvent(new Event('senders-changed'));
}

export const getSenders = () => senders;
export function setSenders(next) {
  senders = next;
  if (next.remember) localStorage.setItem(key, JSON.stringify(next));
  else localStorage.removeItem(key);
  window.dispatchEvent(new Event('senders-changed'));
}
export const getPrefs = () => prefs;
export function setPrefs(next) { prefs = { ...prefs, ...next }; localStorage.setItem(PREFS, JSON.stringify(prefs)); }
export const getServerStatus = () => serverStatus;
export const setServerStatus = (s) => { serverStatus = s; window.dispatchEvent(new Event('senders-changed')); };

export const emailReady = () => Boolean((senders.smtp.user && senders.smtp.pass) || serverStatus.emailFromEnv);
export const whatsappReady = () => Boolean((senders.wa.token && senders.wa.phoneNumberId) || serverStatus.whatsappFromEnv);
export const runtime = () => ({ smtp: senders.smtp, wa: senders.wa });
