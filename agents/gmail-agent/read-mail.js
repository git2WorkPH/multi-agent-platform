// Executed by macOS JavaScript for Automation, with arguments passed separately.
function run([address, mailboxName, limit]) {
  const mail = Application("Mail");
  const accounts = mail
    .accounts()
    .filter((account) =>
      account.emailAddresses().some((email) => email.toLowerCase() === address.toLowerCase()),
    );
  if (accounts.length !== 1)
    return JSON.stringify({ error: "Select one enabled Mail account by its email address." });
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
