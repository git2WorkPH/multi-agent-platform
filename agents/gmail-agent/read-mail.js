// Executed by macOS JavaScript for Automation, with arguments passed separately.
function run([address, mailboxName, limit]) {
  const mail = Application("Mail");
  const normalize = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase();
  const selection = normalize(address);
  const enabled = mail.accounts().filter((account) => account.enabled());
  const matches = enabled.filter(
    (account) =>
      (account.emailAddresses() ?? []).some((email) => normalize(email) === selection) ||
      normalize(account.userName()) === selection,
  );
  const accounts = matches.length
    ? matches
    : enabled.filter((account) => normalize(account.name()) === selection);
  if (accounts.length !== 1) {
    return JSON.stringify({
      error: accounts.length
        ? "Multiple enabled Mail accounts match APPLE_MAIL_ACCOUNT. Use a unique account description or sign-in address."
        : "No enabled Mail account matches APPLE_MAIL_ACCOUNT. Open Mail → Settings → Accounts and use the Gmail sign-in address or exact account description.",
    });
  }
  const inboxes = accounts[0]
    .mailboxes()
    .filter((mailbox) => mailbox.name().toLowerCase() === mailboxName.toLowerCase());
  if (inboxes.length !== 1)
    return JSON.stringify({
      error: "Inbox not found. Set APPLE_MAIL_INBOX to its name in Apple Mail.",
    });
  const unread = inboxes[0].messages.whose({ readStatus: false })();
  const count = unread.length;
  const messages = [];
  for (let i = 0; i < Math.min(count, Number(limit)); i++) {
    const message = unread[i];
    messages.push({
      subject: message.subject(),
      sender: message.sender(),
      receivedAt: message.dateReceived().toISOString(),
      messageId: message.messageId(),
      flagged: message.flaggedStatus(),
    });
  }
  return JSON.stringify({ moreUnread: count > Number(limit), messages });
}
