# Appointment reminders

A small Cloudflare Worker calls `/api/reminders/send` once a day. That endpoint emails each
**booked** appointment the day before it happens, and records the send so nobody gets two.

## Set up

1. Create a shared secret. Any long random string works, for example from a password manager.
2. In the Pages project (midnight-window-tinting), go to **Settings → Variables and Secrets** and add
   `REMINDER_SECRET` with that value. Redeploy after saving.
3. Deploy the Worker. In the dashboard: **Workers & Pages → Create → Worker**, name it
   `midnight-reminders`, and paste the contents of `index.js`. Then:
   - **Settings → Variables and Secrets:** add `SITE_URL` = `https://midnight-tint.com`, and add
     `REMINDER_SECRET` with the same value as step 2 (mark it as a secret).
   - **Settings → Triggers → Cron Triggers:** add `0 17 * * *`.
4. Run the Worker once with **Trigger** or **Test** to check the reply. It should say `sent` and
   `failed` counts.

Reminders go out only for bookings with status **Booked** and an email address. Requests that
haven't been confirmed yet are not reminded.
