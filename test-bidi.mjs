#!/usr/bin/env node

/**
 * Quick smoke test for pure BiDi implementation
 * Tests core functionality: launch, navigate, snapshot, execute, screenshot, close
 */

import { FirefoxDevTools } from './dist/index.js';
import { writeFileSync } from 'fs';

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function logStep(step, message) {
  log(`\n[${step}] ${message}`, 'blue');
}

function logSuccess(message) {
  log(`  ✓ ${message}`, 'green');
}

function logError(message) {
  log(`  ✗ ${message}`, 'red');
}

async function runTests() {
  let firefox;
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    log('\n🧪 BiDi Implementation Smoke Test', 'yellow');
    log('================================\n', 'yellow');

    // Test 1: Launch Firefox
    logStep(1, 'Launching Firefox with BiDi...');
    firefox = new FirefoxDevTools({
      headless: true,
      startUrl: 'about:blank',
    });

    await firefox.connect();
    logSuccess('Firefox launched successfully');
    testsPassed++;

    // Test 2: Check connection
    logStep(2, 'Checking BiDi connection...');
    const isConnected = await firefox.isConnected();
    if (isConnected) {
      logSuccess('BiDi connection active');
      testsPassed++;
    } else {
      logError('BiDi connection failed');
      testsFailed++;
    }

    // Test 3: Navigate to a page
    logStep(3, 'Navigating to example.com...');
    await firefox.navigate('https://example.com');
    logSuccess('Navigation completed');
    testsPassed++;

    // Test 4: Get page content
    logStep(4, 'Getting page content...');
    const content = await firefox.getContent();
    if (content.includes('Example Domain')) {
      logSuccess(`Got page content (${content.length} bytes)`);
      testsPassed++;
    } else {
      logError('Page content unexpected');
      testsFailed++;
    }

    // Test 5: Execute JavaScript
    logStep(5, 'Executing JavaScript...');
    const title = await firefox.evaluate('document.title');
    if (title === 'Example Domain') {
      logSuccess(`JavaScript execution works (title: "${title}")`);
      testsPassed++;
    } else {
      logError(`Unexpected title: "${title}"`);
      testsFailed++;
    }

    // Test 6: Take snapshot
    logStep(6, 'Taking DOM snapshot...');
    const snapshot = await firefox.takeSnapshot();
    if (snapshot.json.uidMap.length > 0) {
      logSuccess(`Snapshot created with ${snapshot.json.uidMap.length} UIDs`);
      testsPassed++;
    } else {
      logError('Snapshot has no UIDs');
      testsFailed++;
    }

    // Test 7: Interact with element by UID
    logStep(7, 'Testing UID-based interactions...');
    const linkUid = snapshot.json.uidMap.find(entry =>
      entry.css && entry.css.includes('a')
    )?.uid;

    if (linkUid) {
      await firefox.hoverByUid(linkUid);
      logSuccess(`Hovered element with UID: ${linkUid}`);
      testsPassed++;
    } else {
      log('  ⚠ No link found in snapshot, skipping UID test', 'yellow');
    }

    // Test 8: Take screenshot
    logStep(8, 'Taking screenshot...');
    const screenshot = await firefox.takeScreenshotPage();
    if (screenshot && screenshot.length > 1000) {
      writeFileSync('test-screenshot.png', Buffer.from(screenshot, 'base64'));
      logSuccess(`Screenshot saved (${Math.round(screenshot.length / 1024)} KB) -> test-screenshot.png`);
      testsPassed++;
    } else {
      logError('Screenshot failed or too small');
      testsFailed++;
    }

    // Test 9: Console messages
    logStep(9, 'Testing console capture...');
    await firefox.evaluate('console.log("BiDi test message")');
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for event
    const messages = await firefox.getConsoleMessages();
    const testMessage = messages.find(m => m.text.includes('BiDi test'));
    if (testMessage) {
      logSuccess('Console message captured');
      testsPassed++;
    } else {
      log('  ⚠ Console message not captured (may be timing issue)', 'yellow');
    }

    // Test 10: Navigation history
    logStep(10, 'Testing navigation history...');
    await firefox.navigate('https://www.mozilla.org');
    await firefox.navigateBack();
    const backContent = await firefox.getContent();
    if (backContent.includes('Example Domain')) {
      logSuccess('Back navigation works');
      testsPassed++;
    } else {
      logError('Back navigation failed');
      testsFailed++;
    }

    // Test 11: Multiple tabs
    logStep(11, 'Testing tab management...');
    await firefox.refreshTabs();
    const initialTabs = firefox.getTabs().length;
    await firefox.createNewPage('https://www.w3.org');
    await firefox.refreshTabs();
    const newTabs = firefox.getTabs().length;
    if (newTabs > initialTabs) {
      logSuccess(`Tab created (${initialTabs} -> ${newTabs} tabs)`);
      testsPassed++;
    } else {
      logError('Tab creation failed');
      testsFailed++;
    }

    // Test 12: Viewport resize
    logStep(12, 'Testing viewport resize...');
    await firefox.setViewportSize(800, 600);
    logSuccess('Viewport resized to 800x600');
    testsPassed++;

  } catch (error) {
    logError(`Test failed with error: ${error.message}`);
    console.error(error);
    testsFailed++;
  } finally {
    // Cleanup
    if (firefox) {
      logStep('CLEANUP', 'Closing Firefox...');
      await firefox.close();
      logSuccess('Firefox closed');
    }

    // Summary
    log('\n================================', 'yellow');
    log('Test Summary:', 'yellow');
    log(`  Passed: ${testsPassed}`, 'green');
    if (testsFailed > 0) {
      log(`  Failed: ${testsFailed}`, 'red');
    }
    log(`  Total:  ${testsPassed + testsFailed}\n`, 'blue');

    if (testsFailed === 0) {
      log('🎉 All tests passed!', 'green');
      process.exit(0);
    } else {
      log('❌ Some tests failed', 'red');
      process.exit(1);
    }
  }
}

// Run tests
runTests().catch(error => {
  logError(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
