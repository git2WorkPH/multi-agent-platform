import { z } from "zod";

export const urgentEmailDigest = z.object({
  scanned: z.number().int().nonnegative(),
  moreUnread: z.boolean(),
  messages: z.array(
    z.object({
      subject: z.string(),
      sender: z.string(),
      receivedAt: z.iso.datetime(),
      link: z
        .string()
        .regex(
          /^(?:https:\/\/mail\.google\.com\/mail\/u\/\d+\/#all\/[a-zA-Z0-9_-]+|message:\/\/%3C(?:[a-zA-Z0-9_.!~*()'-]|%[A-Fa-f0-9]{2})+%3E)$/,
        )
        .optional(),
      reason: z.string(),
    }),
  ),
});
