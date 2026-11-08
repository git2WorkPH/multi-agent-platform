export function urgencyReason(subject: string, priorityReason?: string) {
  if (/\b(urgent|asap|immediate(?:ly)?|final notice|past due|overdue)\b/i.test(subject)) {
    return "The subject contains an explicit urgency cue.";
  }
  if (
    /\b(due today|deadline today|respond by|action required|security alert|payment failed)\b/i.test(
      subject,
    )
  ) {
    return "The subject signals a deadline, security issue, or action request.";
  }
  return priorityReason;
}
