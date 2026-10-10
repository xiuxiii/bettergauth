/**
 * Fired on window when account sync changed this device's history (a pull
 * wrote or deleted records, or signing out removed the account's). Lists
 * re-read on it. Its own tiny module so pages can listen without loading
 * the sync engine.
 */
export const HISTORY_SYNCED_EVENT = "mindgap:history-synced";
