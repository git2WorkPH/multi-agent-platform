# Gmail urgency agent

## One-time setup

1. In your Google Cloud project, enable the Gmail API and configure the OAuth consent screen. A Workspace administrator may need to allow access.
2. Create an OAuth web client for your own use. If you use [Google's OAuth Playground](https://developers.google.com/oauthplayground/), register `https://developers.google.com/oauthplayground` as an authorized redirect URI, enable **Use your own OAuth credentials** in the Playground settings, and enter that client's credentials.
3. In the Playground, authorize only `https://www.googleapis.com/auth/gmail.metadata` for the mailbox you want to read. Exchange the authorization code and copy the refresh token into your private `.env`. Set `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` for the same client. Consent and refresh token lifetime depend on your Google app settings.
4. Add `email` to `API_DEV_PROJECTS` and restart the local API, or grant the `email` project in your token configuration. Keep the API and Floci local for this mailbox data.

## Run a scan

With Floci bootstrapped and the result consumer running, run `pnpm agent:gmail`. Open the newest **gmail-urgency** result under **email → Results** in the dashboard. For multiple signed-in Gmail accounts, adjust `GMAIL_ACCOUNT_INDEX` to the correct browser account index. A new invocation creates a new digest in local result history.

The agent scans up to `GMAIL_SCAN_LIMIT` unread inbox messages per invocation (default 15, maximum 20). It flags explicit urgency or action cues in subjects and Gmail's Important label. The digest indicates when unread messages remain outside the scan. These signals can miss urgent messages or flag routine ones. Run the command again when you want a fresh scan.

The agent requests subject and sender headers, Gmail labels, and the received timestamp. The digest stores subject, sender, received date, urgency reason, and a Gmail link for flagged messages. Gmail bodies and attachments are outside the requested fields. Mailbox operations are read-only. The digest is excluded from automatic and manual consolidation, so the model providers do not receive this content.

See [Gmail list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [Gmail metadata reads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get), and [Google OAuth offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline).
