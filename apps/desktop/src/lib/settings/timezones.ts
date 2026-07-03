// Shared timezone option helpers, used by the tasks editor and the model
// runtime-environment settings. Falls back to a curated common list when the
// host `Intl` implementation doesn't expose the full IANA database.
export function commonTimezones(): string[] {
  return ["UTC", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Singapore", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "America/Chicago"];
}

export function timezoneOptions(): string[] {
  try {
    const supported = Intl.supportedValuesOf("timeZone") as string[];
    return [...new Set([...commonTimezones(), ...supported])];
  } catch {
    return commonTimezones();
  }
}
