// Cloudflare Worker: runs once a day and asks the site to send tomorrow's reminders.
// Deploy separately from the site (see workers/reminders/README.md).
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
};

async function run(env) {
  const res = await fetch(env.SITE_URL + '/api/reminders/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.REMINDER_SECRET },
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Reminder run failed: ' + res.status + ' ' + text);
  console.log('Reminder run: ' + text);
}
