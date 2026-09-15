// Builds the final message for one contact from a campaign snapshot.
const { render, buildVars, textToHtml } = require('./template');
const { unsubSig } = require('./auth');
const db = require('./db');

const REPLY_OPT_OUT = 'P.S. If this isn\'t relevant, just reply "no" and I won\'t email you again.';
const UNSUB_TOKEN = /\{\s*unsubscribe_url\s*(\|[^{}]*)?\}/;

function unsubscribeUrl(baseUrl, contact) {
  return contact?.id ? `${baseUrl}/u/${contact.id}/${unsubSig(contact.id)}` : `${baseUrl}/u/preview`;
}

// Recipients can't open localhost or private-network links, and spam filters distrust them.
function isPublicUrl(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return host.includes('.') && !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$)/.test(host) && !/\.(local|localhost|internal)$/i.test(host);
}

function compose(campaign, contact) {
  const m = campaign.message;
  const unsub = unsubscribeUrl(campaign.baseUrl, contact);
  const vars = buildVars(contact, { sender_name: campaign.senderName || '', unsubscribe_url: unsub, campaign_name: campaign.name });

  if (campaign.channel === 'email') {
    const linkWorks = isPublicUrl(campaign.baseUrl);
    const footer = m.footerText || REPLY_OPT_OUT;
    let text = render(m.body, vars);
    // Without a public address the unsubscribe link would be dead, so ask for a reply instead.
    if (m.footer) text += `\n\n${linkWorks || !UNSUB_TOKEN.test(footer) ? render(footer, vars) : REPLY_OPT_OUT}`;
    return {
      subject: render(m.subject, vars),
      text,
      html: m.html ? textToHtml(text) : undefined,
      unsubscribeUrl: linkWorks ? unsub : '',
    };
  }

  let text = render(m.body, vars);
  if (m.footer && m.footerText) text += `\n\n${render(m.footerText, vars)}`;
  const params = (campaign.wa?.params || []).map((p) => render(p, vars).trim() || '-');
  return { text, params };
}

function suppressedSet() {
  return new Set(db.data.suppression.map((s) => s.value));
}

function recipientFor(channel, contact) {
  return channel === 'email' ? contact.email : contact.phone;
}

function contactedSet(channel) {
  return new Set(db.data.messages.filter((m) => m.channel === channel && m.status === 'sent').map((m) => m.to));
}

module.exports = { compose, suppressedSet, recipientFor, contactedSet, unsubscribeUrl, isPublicUrl, REPLY_OPT_OUT };
