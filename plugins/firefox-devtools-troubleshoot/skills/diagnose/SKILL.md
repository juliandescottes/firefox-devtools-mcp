---
name: firefox-devtools-diagnose
description: Diagnose Firefox DevTools MCP setup issues. Activate when the firefox-devtools-mcp plugin fails to connect, its tools are not available, or the user reports Firefox DevTools not working in Cowork.
---

When Firefox DevTools MCP tools are unavailable or the user reports issues with the firefox-devtools-mcp plugin, run this diagnostic sequence automatically. Do not ask the user to do these checks manually.

## Diagnostic Steps

### 1. Check Node.js

Run `node --version` using the Bash tool.

- If the command fails with "command not found": tell the user Node.js is not installed and direct them to download Node.js 20.19.0 or higher from https://nodejs.org.
- If the version is below 20.19.0: tell the user their Node.js version is too old and they need to upgrade to 20.19.0 or higher from https://nodejs.org.
- If the version is 20.19.0 or higher: Node.js is not the issue, continue to the next check.

### 2. Check the Plugin Is Installed

Ask the user to open **Customize > Plugins** in Claude Cowork and confirm that `firefox-devtools-mcp` appears in the list.

- If it is missing: direct them to the installation steps at https://github.com/mozilla/firefox-devtools-mcp.
- If it is present: continue to the next check.

### 3. Check the Active Tab

Ask the user to confirm they are in the **Cowork** tab and not the **Chat** tab. Plugins only work in Cowork.

- If they are in Chat: ask them to switch to Cowork and retry.
- If they are already in Cowork: continue to the next check.

### 4. Escalate

If all checks pass and the plugin still does not work, tell the user to report the issue:

- File a bug on [Bugzilla](https://bugzilla.mozilla.org/enter_bug.cgi?format=__default__&blocked=2026717&product=Developer%20Infrastructure&component=Firefox%20MCP)
- Or ask in the [#firefox-devtools-mcp Matrix room](https://chat.mozilla.org/#/room/#firefox-devtools-mcp:mozilla.org)
