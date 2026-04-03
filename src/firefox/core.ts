/**
 * Core BiDi connection management (Pure BiDi - No Selenium)
 * Uses firefox-bidi-client for low-level protocol communication
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BiDiConnection,
  FirefoxProcessManager,
  setLogger as setBiDiLogger,
} from 'ff-test-firefox-bidi-client';
import type { FirefoxLaunchOptions } from './types.js';
import { log, logDebug, logError } from '../utils/logger.js';
import { generatePrefScript } from './pref-utils.js';

// Set up firefox-bidi-client to use our logger
setBiDiLogger({
  log: (msg) => log(msg),
  debug: (msg) => logDebug(msg),
  error: (msg, err) => logError(msg, err),
});

export class FirefoxCore {
  private connection: BiDiConnection | null = null;
  private processManager: FirefoxProcessManager | null = null;
  private currentContextId: string | null = null;
  private chromeContextId: string | null = null;
  private originalEnv: Record<string, string | undefined> = {};
  private logFilePath: string | undefined;

  constructor(private options: FirefoxLaunchOptions) {}

  /**
   * Connect to Firefox via BiDi
   * - If remoteDebuggingPort is provided, connect to existing instance
   * - Otherwise, launch Firefox and connect
   */
  async connect(): Promise<void> {
    if (this.options.remoteDebuggingPort) {
      await this.connectToExisting();
    } else {
      await this.launchAndConnect();
    }
  }

  /**
   * Connect to existing Firefox instance
   */
  private async connectToExisting(): Promise<void> {
    log(`🔌 Connecting to existing Firefox on port ${this.options.remoteDebuggingPort}...`);

    // Warn about ignored options
    this.warnAboutIgnoredOptions();

    // Create BiDi connection
    this.connection = new BiDiConnection();
    await this.connection.connect(this.options.remoteDebuggingPort!);

    // Discover existing browsing contexts
    await this.discoverContexts();

    log('✅ Connected to existing Firefox');
  }

  /**
   * Launch new Firefox instance and connect
   */
  private async launchAndConnect(): Promise<void> {
    log('🚀 Launching Firefox with BiDi...');

    // Set up output file for capturing Firefox stdout/stderr
    if (this.options.logFile) {
      this.logFilePath = this.options.logFile;
    } else if (this.options.env && Object.keys(this.options.env).length > 0) {
      const outputDir = join(homedir(), '.firefox-devtools-mcp', 'output');
      mkdirSync(outputDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.logFilePath = join(outputDir, `firefox-${timestamp}.log`);
      this.options.logFile = this.logFilePath;
    }

    // Set environment variables (will be inherited by Firefox process)
    if (this.options.env) {
      for (const [key, value] of Object.entries(this.options.env)) {
        this.originalEnv[key] = process.env[key];
        process.env[key] = value;
        logDebug(`Set env ${key}=${value}`);
      }

      if (this.options.env.MOZ_LOG_FILE) {
        logDebug('Note: MOZ_LOG_FILE in env will be used');
      }
    }

    // Launch Firefox process
    this.processManager = new FirefoxProcessManager();
    const port = await this.processManager.launch(this.options);

    // Connect to BiDi WebSocket
    this.connection = new BiDiConnection();
    await this.connection.connect(port);

    log('✅ Firefox launched with BiDi');

    // Discover browsing contexts
    await this.discoverContexts();

    // Navigate to startUrl if provided
    if (this.options.startUrl && this.currentContextId) {
      logDebug(`Navigating to: ${this.options.startUrl}`);
      await this.sendBiDiCommand('browsingContext.navigate', {
        context: this.currentContextId,
        url: this.options.startUrl,
        wait: 'complete',
      });
    }

    // Apply preferences if configured
    if (this.options.prefs && Object.keys(this.options.prefs).length > 0) {
      await this.applyPreferences();
    }

    log('✅ Firefox DevTools ready');
  }

  /**
   * Discover browsing contexts and set current context
   */
  private async discoverContexts(): Promise<void> {
    const result = await this.sendBiDiCommand('browsingContext.getTree', {});

    if (result.contexts && result.contexts.length > 0) {
      this.currentContextId = result.contexts[0].context;
      logDebug(`Browsing context ID: ${this.currentContextId}`);
    } else {
      throw new Error('No browsing contexts found');
    }

    // Try to get chrome context if available
    try {
      const chromeResult = await this.sendBiDiCommand('browsingContext.getTree', {
        'moz:scope': 'chrome',
      });

      if (chromeResult.contexts && chromeResult.contexts.length > 0) {
        this.chromeContextId = chromeResult.contexts[0].context;
        logDebug(`Chrome context ID: ${this.chromeContextId}`);
      }
    } catch (error) {
      logDebug('Chrome context not available (MOZ_REMOTE_ALLOW_SYSTEM_ACCESS not set?)');
    }
  }

  /**
   * Warn about options that are ignored when connecting to existing Firefox
   */
  private warnAboutIgnoredOptions(): void {
    const ignoredOptions: string[] = [];

    if (this.options.firefoxPath) ignoredOptions.push('--firefox-path');
    if (this.options.headless) ignoredOptions.push('--headless');
    if (this.options.viewport) ignoredOptions.push('--viewport');
    if (this.options.profilePath) ignoredOptions.push('--profile-path');
    if (this.options.args && this.options.args.length > 0) ignoredOptions.push('--firefox-arg');
    if (this.options.env) ignoredOptions.push('--env');
    if (this.options.logFile) ignoredOptions.push('--output-file');

    if (ignoredOptions.length > 0) {
      log('⚠️  When using --remote-debugging-port, these options are ignored:');
      log(`   ${ignoredOptions.join(', ')}`);
      log('   Configure these when starting Firefox manually.');
    }
  }

  /**
   * Check if Firefox is still connected and responsive
   * Returns false if Firefox was closed or connection is broken
   */
  async isConnected(): Promise<boolean> {
    if (!this.connection || !this.connection.isConnected()) {
      return false;
    }

    try {
      // Try a simple command to check if Firefox is responsive
      await this.sendBiDiCommand('session.status', {});
      return true;
    } catch (error) {
      // Any error means connection is broken
      logDebug('Connection check failed: Firefox is not responsive');
      return false;
    }
  }

  /**
   * Reset connection state (used when Firefox is detected as closed)
   */
  reset(): void {
    this.connection = null;
    this.processManager = null;
    this.currentContextId = null;
    this.chromeContextId = null;
    logDebug('Connection state reset');
  }

  /**
   * Get current browsing context ID
   */
  getCurrentContextId(): string | null {
    return this.currentContextId;
  }

  /**
   * Update current context ID (used by page management)
   */
  setCurrentContextId(contextId: string): void {
    this.currentContextId = contextId;
  }

  /**
   * Get chrome context ID (for privileged operations)
   */
  getChromeContextId(): string | null {
    return this.chromeContextId;
  }

  /**
   * Get BiDi connection (for event subscriptions)
   */
  getConnection(): BiDiConnection {
    if (!this.connection) {
      throw new Error('Not connected to Firefox');
    }
    return this.connection;
  }

  /**
   * Get log file path
   */
  getLogFilePath(): string | undefined {
    return this.logFilePath;
  }

  /**
   * Get current launch options
   */
  getOptions(): FirefoxLaunchOptions {
    return this.options;
  }

  /**
   * Apply Firefox preferences via Services.prefs API
   * Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 environment variable
   */
  async applyPreferences(): Promise<void> {
    const prefs = this.options.prefs;

    // Return early if no prefs to set
    if (!prefs || Object.keys(prefs).length === 0) {
      return;
    }

    // Check for MOZ_REMOTE_ALLOW_SYSTEM_ACCESS
    if (!process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS) {
      throw new Error(
        'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 environment variable is required to set Firefox preferences at startup. ' +
          'Add --env MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 to your command line.'
      );
    }

    if (!this.connection) {
      throw new Error('Not connected to Firefox');
    }

    // Make sure we have chrome context
    if (!this.chromeContextId) {
      throw new Error(
        'No chrome context available. Ensure MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 is set before starting Firefox.'
      );
    }

    const successes: string[] = [];
    const failures: string[] = [];

    // Set each preference using chrome context
    for (const [name, value] of Object.entries(prefs)) {
      try {
        const script = generatePrefScript(name, value);

        // Execute in chrome context
        await this.sendBiDiCommand('script.evaluate', {
          expression: script,
          target: { context: this.chromeContextId },
          awaitPromise: false,
        });

        successes.push(`${name} = ${JSON.stringify(value)}`);
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Log results
    if (successes.length > 0) {
      log(`✅ Applied ${successes.length} Firefox preference(s)`);
      for (const msg of successes) {
        logDebug(`  ${msg}`);
      }
    }
    if (failures.length > 0) {
      log(`⚠️  Failed to set ${failures.length} preference(s)`);
      for (const msg of failures) {
        logDebug(`  ${msg}`);
      }
    }
  }

  /**
   * Send raw BiDi command and get response
   */
  async sendBiDiCommand(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.connection) {
      throw new Error('Not connected to Firefox');
    }

    return await this.connection.sendCommand(method, params);
  }

  /**
   * Close connection and cleanup
   */
  async close(): Promise<void> {
    // Close BiDi connection
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    // Kill Firefox process if we launched it
    if (this.processManager) {
      await this.processManager.kill();
      this.processManager = null;
      log('✅ Firefox closed');
    } else {
      log('✅ Disconnected from Firefox (still running)');
    }

    // Restore original environment variables
    for (const [key, value] of Object.entries(this.originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    this.originalEnv = {};

    this.currentContextId = null;
    this.chromeContextId = null;
  }
}
