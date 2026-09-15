// Starter templates every new account gets. The first email template is the one the
// campaign page opens with.
const t = (channel, name, subject, body) => ({ channel, name, subject, body });

module.exports = () => [
  t('email', 'Short intro', '[[quick idea|a thought|question]] for {business_name|your team}',
`[[Hi|Hello|Hey]] {first_name|there},

[[I came across|I was looking at|I found]] {business_name|your company} [[today|this week]] and had a quick thought.

A lot of businesses lose good leads simply because nobody replies fast enough, especially after hours. We set up simple automations (WhatsApp and email replies, reminders, follow-ups) so that doesn't happen.

[[Would it be worth a short call next week?|Open to a quick chat to see if it fits?|Is this something you're looking at right now?]]

[[Thanks|Best|Cheers]],
{sender_name}`),
  t('email', 'Follow-up', '[[following up|one more thought|circling back]]',
`Hi {first_name|there},

[[Just bumping this up|Following up on my note from last week]] in case it got buried.

If faster replies to new enquiries is something you're looking at, I can send a short example of how it works for a business like {business_name|yours}. No call needed.

If it's not a priority right now, no worries at all.

{sender_name}`),
  t('email', 'Real estate AI intro', '[[buyer enquiries|weekend enquiries|site visit bookings]] at {business_name|your company}',
`[[Hi|Hello]] {first_name|there},

I was looking at {business_name|your projects} and wanted to ask how your team handles buyer enquiries that come in after hours or over the weekend.

We build WhatsApp assistants and simple CRM follow-ups for property developers, so every enquiry gets a reply within a minute and more of them turn into site visits.

[[If that's relevant, I'm happy to show you a 5-minute example.|Would a short example be useful? Happy to send one over.]]

[[Best|Thanks]],
{sender_name}`),
  t('whatsapp', 'WhatsApp intro', '',
`Hi {first_name|there}! 👋

This is {sender_name}. We help businesses like {business_name|yours} automate WhatsApp replies and lead follow-ups.

Would you like a quick demo?`),
  t('whatsapp', 'WhatsApp follow-up', '',
`Hi {first_name|there}, just checking in on my last message. Happy to share a short demo video if that's easier. 🙂`),
];
