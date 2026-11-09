/** What staff see when the app cannot start. Plain words, what to do, and where the data is. Their data is never touched. */
export function startupMessage(e: unknown, dataDir: string): { title: string; body: string } {
  const message = e instanceof Error ? e.message : String(e);
  const keep = `Your data has not been changed. It is in:\n${dataDir}\n\nDo not delete that folder.`;
  if (/newer than this app/i.test(message)) return { title: 'Please update the app', body: `This data was made by a newer version of the app. Install the newest version.\n\n${keep}` };
  if (/altered after it was applied/i.test(message)) return { title: 'The app files do not match the data', body: `Reinstall the same version that was running before, then contact support.\n\n${keep}` };
  if (/SQLITE_BUSY|locked/i.test(message)) return { title: 'The app is already open', body: `Close the other window, or restart the computer, and try again.\n\n${keep}` };
  if (/SQLITE_CORRUPT|malformed|not a database/i.test(message)) return { title: 'The data file is damaged', body: `Do not keep trying. Restore the newest backup: see Help, or contact support.\n\n${keep}` };
  return { title: 'The app could not start', body: `Restart the computer and try again. If it happens again, contact support and give them this message: ${message.slice(0, 200)}\n\n${keep}` };
}
