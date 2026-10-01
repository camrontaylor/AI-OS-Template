export async function readApiError(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  try {
    const data = await response.clone().json() as { error?: unknown };
    if (typeof data.error === "string" && data.error.trim().length > 0) {
      return data.error;
    }
  } catch {
    // Ignore parse failures and fall back to the default message.
  }

  return fallbackMessage;
}
