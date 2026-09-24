const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Waits for the newest email to `to` and returns its 6-digit sign-in code. */
export async function readSignInCode(to: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`);
      const { Text } = (await message.json()) as { Text: string };
      const code = Text.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No sign-in code for ${to}`);
}
