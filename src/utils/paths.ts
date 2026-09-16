/**
 * Filesystem layout for the data this server keeps under the user's home.
 *
 * Defined in one place so that the directory tools may write to (`output`) and
 * the directories the server and Firefox read back (profiles, `instances`,
 * `logs`) cannot drift into one another.
 */

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root of the server's own data. Not writable through `saveTo` as a whole. */
export function homeRoot(): string {
  return join(homedir(), '.firefox-devtools-mcp');
}

/** Destination for generated `saveTo` files. */
export function outputDir(): string {
  return join(homeRoot(), 'output');
}

/** Firefox stdout/stderr capture, read back by get_firefox_output. */
export function logsDir(): string {
  return join(homeRoot(), 'logs');
}

/** `<pid>.port` files used to look up the Marionette port. */
export function instancesDir(): string {
  return join(homeRoot(), 'instances');
}

/**
 * Parent directory of the profile used in --auto-profile mode.
 * When a Firefox binary path is given, a short hash of that path is appended
 * so that different builds (Release, Nightly, …) each get their own profile.
 */
export function defaultProfileDir(firefoxPath?: string): string {
  if (!firefoxPath) {
    return join(homeRoot(), 'profile');
  }
  const hash = createHash('sha1').update(firefoxPath).digest('hex').slice(0, 8);
  return join(homeRoot(), `profile-${hash}`);
}
