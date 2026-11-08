# Gmail urgency agent

## Use Apple Mail on your Mac

Add your Gmail account to Apple Mail and wait for the inbox to sync. Set `GMAIL_SOURCE=apple-mail` and `APPLE_MAIL_ACCOUNT` to the Gmail sign-in address or exact account description from Mail → Settings → Accounts in `.env`. Add `email` to your API project grant and restart the API. Run `pnpm agent:gmail` in your normal macOS terminal, then allow that terminal to control Mail under Privacy & Security → Automation when prompted. Google OAuth credentials are unnecessary in this mode.

The agent reads metadata from the selected account only. It checks unread messages, flags subjects with urgency cues and messages flagged in Apple Mail, and links to Mail when a Message-ID is available. Set `APPLE_MAIL_INBOX` if your inbox uses a name other than INBOX. The scan reflects what Mail has synced.

## Optional direct Gmail API setup

Set `GMAIL_SOURCE=gmail-api` to use Google OAuth instead. Existing installs that only specify `GMAIL_CLIENT_ID` continue to use the Gmail API.

1. In your Google Cloud project, enable the Gmail API and configure the OAuth consent screen. A Workspace administrator may need to allow access.
2. Create an OAuth client of type **Desktop app** and set its client ID as `GMAIL_CLIENT_ID` in your local `.env`. Google still requires a registered client ID.
3. Add `email` to `API_DEV_PROJECTS` and restart the local API, or grant the `email` project in your token configuration. Keep the API and Floci local for this mailbox data.

When you run `pnpm agent:gmail`, the agent opens Google's account chooser. Approve Gmail metadata access in the browser. The agent receives a code on a temporary loopback port and exchanges it with PKCE. It holds the access token in memory for the scan. If Google requires a client secret for your Desktop client, set `GMAIL_CLIENT_SECRET` from that client configuration. No manual refresh-token step is needed for interactive sign-in.

Existing offline setups with a client ID, client secret, and refresh token still use the refresh-token flow. Remove `GMAIL_REFRESH_TOKEN` from your local configuration to switch to browser sign-in.

## Run a scan

With Floci bootstrapped and the result consumer running, run `pnpm agent:gmail`. Open the newest **gmail-urgency** result under **email → Results** in the dashboard. For multiple signed-in Gmail accounts, adjust `GMAIL_ACCOUNT_INDEX` to the correct browser account index. A new invocation creates a new digest in local result history.

The agent scans up to `GMAIL_SCAN_LIMIT` unread inbox messages per invocation (default 15, maximum 20). It flags explicit urgency or action cues in subjects, flagged messages in Apple Mail mode, and Gmail’s Important label in Gmail API mode. The digest indicates when unread messages remain outside the scan. These signals can miss urgent messages or flag routine ones. Run the command again when you want a fresh scan.

The agent reads subject, sender, received timestamp, and the relevant priority marker. The digest stores subject, sender, received date, urgency reason, and a message link when available. Gmail bodies and attachments are outside the requested fields. Mailbox operations are read-only. The digest is excluded from automatic and manual consolidation, so the model providers do not receive this content.

See [Gmail list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [Gmail metadata reads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get), and [Google OAuth offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline).
