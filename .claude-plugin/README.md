# Firefox MCP Plugin for Claude Code

Control Firefox for automated browsing, web testing, and debugging. Navigate pages, fill forms, click elements, take screenshots, and monitor console/network activity.

## What's Included

- **MCP Server** - Connects Claude Code to Firefox via WebDriver BiDi
- **Skill** - Auto-triggers for browser automation, testing, and debugging tasks
- **Agents** - Dedicated `e2e-tester` and `web-extractor` agents for focused tasks
- **Commands** - `/firefox-mcp:navigate`, `/firefox-mcp:screenshot`, `/firefox-mcp:debug`

## Installation

```bash
/plugin marketplace add mozilla/firefox-mcp
/plugin install firefox-mcp@firefox-mcp
```

## Switching from firefox-devtools-mcp

The plugin was renamed from `firefox-devtools-mcp` to `firefox-mcp`. The old plugin still runs the MCP server, but it no longer has the skills, agents and commands. To switch:

```bash
/plugin marketplace update firefox-devtools-plugins
/plugin install firefox-mcp@firefox-devtools-plugins
/plugin uninstall firefox-devtools-mcp@firefox-devtools-plugins
```

If you added the marketplace before the rename, it is still registered as `firefox-devtools-plugins` on your machine, so use that name in these commands. The troubleshoot plugin was renamed too: install it again with `/plugin install firefox-mcp-troubleshoot@firefox-devtools-plugins`.

The tool names change from `mcp__plugin_firefox-devtools-mcp_firefox-devtools__*` to `mcp__plugin_firefox-mcp_firefox__*`, so update any permission rules that use the old names.

## Commands

### /firefox-mcp:navigate

Navigate to a URL and take a DOM snapshot:

```
/firefox-mcp:navigate https://example.com
/firefox-mcp:navigate https://github.com/login
```

### /firefox-mcp:screenshot

Capture the current page or a specific element:

```
/firefox-mcp:screenshot
/firefox-mcp:screenshot e15
```

### /firefox-mcp:debug

Show console errors and failed network requests:

```
/firefox-mcp:debug
/firefox-mcp:debug console
/firefox-mcp:debug network
```

## Agents

Spawn agents to keep your main context clean:

```
spawn e2e-tester to test the login flow on https://app.example.com
spawn web-extractor to extract product prices from https://shop.example.com
```

## Usage Examples

The plugin works automatically when you ask about browser tasks:

- "Navigate to example.com and take a screenshot"
- "Fill out the login form and submit"
- "Check for JavaScript errors on this page"
- "Extract all product prices from this page"

## Key Workflow

1. `take_snapshot` - Creates DOM snapshot with UIDs (e.g., `e42`)
2. Interact using UIDs - `click_by_uid`, `fill_by_uid`, etc.
3. Re-snapshot after DOM changes

## Default Configuration

The plugin enables the following by default:

- **`--enable-script`** — enables JavaScript evaluation and debugging tools (`evaluate_script`, logpoints, script inspection). Requires Firefox 153+.
- **`remote.prefs.recommended=false`** — skips WebDriver's automation preferences so Firefox behaves closer to a regular browser session. See [RecommendedPreferences](https://searchfox.org/firefox-main/source/remote/shared/RecommendedPreferences.sys.mjs) for what those preferences do.

## Requirements

- Firefox 153+ (for script tools) or Firefox 120+ (without script tools)
- Node.js 20.19.0+

## Links

- [Repository](https://github.com/mozilla/firefox-mcp)
- [npm](https://www.npmjs.com/package/@mozilla/firefox-mcp)
