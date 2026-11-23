# Firefox Client Architecture

The MCP server drives Firefox with **WebDriver BiDi**. Selenium WebDriver is only used for the WebDriver session (see [Selenium](#selenium)).

## Protocol

**WebDriver BiDi** — WebSocket, JSON-RPC, [W3C spec](https://w3c.github.io/webdriver-bidi/).

Used for tab management, JavaScript evaluation, console events, network monitoring, screenshots, and page content access. All BiDi commands and event subscriptions go through `BiDiFacade` (`src/firefox/bidi.ts`), which sends them on the WebSocket that Selenium opens.

## Selenium

Selenium is only used to create the WebDriver session, read its capabilities, open its BiDi WebSocket, and end the session. Do not use it to talk to Firefox in any other way:

- no WebDriver classic commands, for example `switchTo()`, `getWindowHandle()` or `executeScript()`
- no Selenium BiDi helpers, for example `bidi.send()` or `bidi.subscribe()`

Send BiDi commands with `BiDiFacade.sendCommand()`, and subscribe to events with `BiDiFacade.subscribe()`. Constants such as `Key` from `selenium-webdriver` are fine, as they send nothing. Removing Selenium entirely is tracked in [Bug 2081635](https://bugzilla.mozilla.org/show_bug.cgi?id=2081635).

## Module Structure

**`src/firefox/index.ts`** (`FirefoxClient`) — public facade, delegates to modules below.

| Module | Responsibilities |
|--------|-----------------|
| `core.ts` | WebDriver session lifecycle (launch, connect-existing, close) |
| `bidi.ts` | `BiDiFacade`: BiDi commands, event subscriptions and events |
| `dom.ts` | JS evaluation, element lookup, input actions (click/hover/fill/drag/upload) |
| `pages.ts` | Tab/window management, navigation, history, viewport |
| `events.ts` | Console buffer (BiDi live events), network buffer (BiDi live events) |
| `types.ts` | Shared TypeScript types |

## Initialization Order

`FirefoxClient.connect()` subscribes to events before navigating, so early messages are captured:

```typescript
this.bidi = new BiDiFacade(await this.core.connect()); // WebDriver session with BiDi
// ... create modules and subscribe to console, network and dialog events
await this.pages.selectInitialContext();
await this.pages.navigate(startUrl); // skipped in connect-existing mode
```

## Configuration

CLI flags and their environment variable equivalents are documented in the README. Profile path is passed via Firefox's native `--profile` argument (loaded in-place, not copied).

### Firefox Preferences

In WebDriver BiDi mode, Firefox applies [RecommendedPreferences](https://searchfox.org/firefox-main/source/remote/shared/RecommendedPreferences.sys.mjs) that alter browser behavior for test reliability. Use `--pref` or the runtime preference tools to override them when needed.

**Example:** `browser.ml.enable` is disabled by RecommendedPreferences, which prevents testing ML/AI features like Smart Window. Override it:

```bash
npx @mozilla/firefox-mcp --pref "browser.ml.enable=true"
```

Runtime (requires `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`):

```javascript
await set_firefox_prefs({ prefs: { "browser.ml.enable": true } });
```

Preferences set via CLI are re-applied automatically on subsequent restarts. `restart_firefox` can also set them, but that tool lives in the `launch` module and is only available in the Mozilla-internal build.

## Build Configuration

Selenium must not be bundled — it uses dynamic `require()` for browser drivers:

```typescript
// tsup.config.ts
export default defineConfig({
  external: ['selenium-webdriver'],
});
```
