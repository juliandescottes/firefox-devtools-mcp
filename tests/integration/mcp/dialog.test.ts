/**
 * Integration tests for dialog handling, called through the MCP server
 */

import { assert, describe, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mcpTest, type McpTestServer, type ToolResult } from '../../helpers/mcp.js';
import { fixtureUrl, waitFor } from '../../helpers/firefox.js';

mcpTest.override('mcpServerArgs', [
  '--tools',
  'pages',
  'snapshot',
  'input',
  'print',
  'script',
  'utilities',
  'bidi',
  'management',
  'launch',
]);

describe('Dialog handlers', () => {
  describe.each([
    {
      method: 'alert',
      acceptExpectation: 'undefined',
      dismissExpectation: 'undefined',
    },
    {
      method: 'confirm',
      acceptExpectation: 'true',
      dismissExpectation: 'false',
    },
    {
      method: 'prompt',
      acceptExpectation: '"bar"',
      dismissExpectation: 'null',
    },
  ])('$method dialog', ({ method, acceptExpectation, dismissExpectation }) => {
    let context: string | undefined;

    mcpTest.beforeAll(async ({ mcp }) => {
      const tree = await mcp.callTool('send_bidi_command', {
        method: 'browsingContext.getTree',
        params: { maxDepth: 0 },
      });
      context = /"context": "([^"]+)"/.exec(tree.text)?.[1];
      assert(context, 'browsingContext.getTree returns a context');
    });

    mcpTest.beforeEach(async ({ mcp }) => {
      await mcp.callTool('evaluate_script', {
        function: `() => { window.result = 'pending'; setTimeout(() => { window.result = ${method}('foo'); }); }`,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await getResult(mcp)).toContain('"pending"');
    });

    // the evaluate_script tool errors when a dialog is open so we use
    // the send_bidi_command tool with script.evaluate instead
    async function getResult(mcp: McpTestServer) {
      return (
        await mcp.callTool('send_bidi_command', {
          method: 'script.evaluate',
          params: { expression: 'window.result', target: { context }, awaitPromise: false },
        })
      ).text;
    }

    mcpTest('should be left open until it is accepted', async ({ mcp }) => {
      const result = await mcp.callTool(
        'accept_dialog',
        method === 'prompt' ? { promptText: 'bar' } : undefined
      );
      expect(result.isError).toBe(false);
      expect(result.text).toContain('Accepted');

      await waitFor(async () => !(await getResult(mcp)).includes('"pending"'));
      expect(await getResult(mcp)).toContain(acceptExpectation);
    });

    mcpTest('should be left open until it is dismissed', async ({ mcp }) => {
      const result = await mcp.callTool('dismiss_dialog');
      expect(result.isError).toBe(false);
      expect(result.text).toContain('Dismissed');

      await waitFor(async () => !(await getResult(mcp)).includes('"pending"'));
      expect(await getResult(mcp)).toContain(dismissExpectation);
    });
  });

  mcpTest('accept_dialog should fail if there is no dialog', async ({ mcp }) => {
    const result = await mcp.callTool('accept_dialog');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Failed to accept dialog');
  });

  mcpTest('dismiss_dialog should fail if there is no dialog', async ({ mcp }) => {
    const result = await mcp.callTool('dismiss_dialog');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Failed to dismiss dialog');
  });

  describe('tools should return when a dialog opens', () => {
    async function runScript(mcp: McpTestServer, fn: string) {
      const result = await mcp.callTool('evaluate_script', { function: fn });
      expect(result.isError).toBe(false);
    }

    async function getUids(mcp: McpTestServer, ...labels: string[]) {
      const snapshot = await mcp.callTool('take_snapshot');
      return labels.map((label) => {
        const uid = new RegExp(`uid=(\\S+) ${label}`).exec(snapshot.text)?.[1];
        assert(uid, `snapshot contains the uid for ${label}`);
        return uid;
      });
    }

    async function expectDialogOpened(
      mcp: McpTestServer,
      result: ToolResult,
      dialog = 'alert "foo"'
    ) {
      expect(result.isError).toBe(false);
      expect(result.text).toContain(`Dialog opened while tool was running: ${dialog}`);

      const accepted = await mcp.callTool('accept_dialog');
      expect(accepted.isError).toBe(false);
      expect(accepted.text).toContain('Accepted');
    }

    mcpTest('evaluate_script', async ({ mcp }) => {
      const result = await mcp.callTool('evaluate_script', {
        function: `() => alert('foo')`,
      });
      await expectDialogOpened(mcp, result);
    });

    describe('on simple.html', () => {
      mcpTest.beforeEach(async ({ mcp }) => {
        await mcp.callTool('navigate_page', { url: fixtureUrl('simple.html') });
      });

      mcpTest('click_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('clickBtn').addEventListener('click', () => alert('foo'), { once: true })`
        );
        const [uid] = await getUids(mcp, 'button "Click Me"');

        await expectDialogOpened(mcp, await mcp.callTool('click_by_uid', { uid }));
      });

      mcpTest('hover_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('dblClickBtn').addEventListener('mouseover', () => alert('foo'), { once: true })`
        );
        const [uid] = await getUids(mcp, 'button "Double Click Me"');

        await expectDialogOpened(mcp, await mcp.callTool('hover_by_uid', { uid }));
      });

      mcpTest('drag_by_uid_to_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('dblClickBtn').addEventListener('drop', () => alert('foo'), { once: true })`
        );
        const [fromUid, toUid] = await getUids(
          mcp,
          'button "Click Me"',
          'button "Double Click Me"'
        );

        await expectDialogOpened(mcp, await mcp.callTool('drag_by_uid_to_uid', { fromUid, toUid }));
      });

      mcpTest('press_key', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.addEventListener('keydown', () => alert('foo'), { once: true })`
        );

        await expectDialogOpened(mcp, await mcp.callTool('press_key', { key: 'a' }));
      });

      mcpTest('type_text', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.addEventListener('keydown', () => alert('foo'), { once: true })`
        );

        await expectDialogOpened(mcp, await mcp.callTool('type_text', { text: 'abc' }));
      });

      mcpTest('print_page', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => window.addEventListener('beforeprint', () => alert('foo'), { once: true })`
        );

        await expectDialogOpened(mcp, await mcp.callTool('print_page'));
      });

      mcpTest('navigate_history', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => {
            history.pushState(null, '', '#next');
            window.addEventListener('popstate', () => alert('foo'), { once: true });
          }`
        );

        await expectDialogOpened(
          mcp,
          await mcp.callTool('navigate_history', { direction: 'back' })
        );
      });
    });

    describe('on form.html', () => {
      mcpTest.beforeEach(async ({ mcp }) => {
        await mcp.callTool('navigate_page', { url: fixtureUrl('form.html') });
      });

      mcpTest('fill_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('name').addEventListener('input', () => alert('foo'), { once: true })`
        );
        const [uid] = await getUids(mcp, 'input "Name:"');

        await expectDialogOpened(mcp, await mcp.callTool('fill_by_uid', { uid, value: 'bar' }));
      });

      mcpTest('fill_form_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('email').addEventListener('input', () => alert('foo'), { once: true })`
        );
        const [nameUid, emailUid] = await getUids(mcp, 'input "Name:"', 'input "Email:"');

        await expectDialogOpened(
          mcp,
          await mcp.callTool('fill_form_by_uid', {
            elements: [
              { uid: nameUid, value: 'bar' },
              { uid: emailUid, value: 'bar@example.com' },
            ],
          })
        );
      });

      mcpTest('upload_file_by_uid', async ({ mcp }) => {
        await runScript(
          mcp,
          `() => document.getElementById('file').addEventListener('change', () => alert('foo'), { once: true })`
        );
        const [uid] = await getUids(mcp, 'input "File:"');
        const filePath = join(mcp.home, 'upload.txt');
        writeFileSync(filePath, 'bar');

        await expectDialogOpened(mcp, await mcp.callTool('upload_file_by_uid', { uid, filePath }));
      });
    });

    mcpTest('navigate_page', async ({ mcp }) => {
      await expectDialogOpened(
        mcp,
        await mcp.callTool('navigate_page', { url: fixtureUrl('alert.html') })
      );
    });

    mcpTest('new_page', async ({ mcp }) => {
      await expectDialogOpened(
        mcp,
        await mcp.callTool('new_page', { url: fixtureUrl('alert.html') })
      );
      await mcp.callTool('close_page', { pageIdx: 1 });
    });

    mcpTest('close_page', async ({ mcp }) => {
      await mcp.callTool('new_page', { url: fixtureUrl('simple.html') });
      await runScript(
        mcp,
        `() => window.addEventListener('beforeunload', (event) => event.preventDefault())`
      );
      // Firefox only shows beforeunload prompts after a user interaction.
      const [uid] = await getUids(mcp, 'button "Click Me"');
      await mcp.callTool('click_by_uid', { uid });

      await expectDialogOpened(
        mcp,
        await mcp.callTool('close_page', { pageIdx: 1 }),
        'beforeunload'
      );
    });

    mcpTest('close_page on a page that is not selected', async ({ mcp }) => {
      await mcp.callTool('new_page', { url: fixtureUrl('simple.html') });
      await runScript(
        mcp,
        `() => window.addEventListener('beforeunload', (event) => event.preventDefault())`
      );
      const [uid] = await getUids(mcp, 'button "Click Me"');
      await mcp.callTool('click_by_uid', { uid });
      await mcp.callTool('select_page', { pageIdx: 0 });

      const result = await mcp.callTool('close_page', { pageIdx: 1 });
      expect(result.isError).toBe(false);
      expect(result.text).toContain('Dialog opened while tool was running: beforeunload');
      expect(result.text).toContain('Use select_page with pageIdx 1');

      await mcp.callTool('select_page', { pageIdx: 1 });
      const accepted = await mcp.callTool('accept_dialog');
      expect(accepted.isError).toBe(false);
      await waitFor(async () => (await mcp.callTool('list_pages')).text.startsWith('1 page'));
    });

    mcpTest('close_page keeps the page when the dialog is dismissed', async ({ mcp }) => {
      await mcp.callTool('new_page', { url: fixtureUrl('simple.html') });
      await runScript(
        mcp,
        `() => window.addEventListener('beforeunload', (event) => event.preventDefault())`
      );
      const [uid] = await getUids(mcp, 'button "Click Me"');
      await mcp.callTool('click_by_uid', { uid });

      const result = await mcp.callTool('close_page', { pageIdx: 1 });
      expect(result.text).toContain('Dialog opened while tool was running: beforeunload');

      const dismissed = await mcp.callTool('dismiss_dialog');
      expect(dismissed.isError).toBe(false);
      expect((await mcp.callTool('list_pages')).text).toContain('2 pages (selected: 1)');

      await mcp.callTool('close_page', { pageIdx: 1 });
      await mcp.callTool('accept_dialog');
      await waitFor(async () => (await mcp.callTool('list_pages')).text.startsWith('1 page'));
    });

    mcpTest('close_page on a page with an open dialog', async ({ mcp }) => {
      await mcp.callTool('new_page', { url: fixtureUrl('simple.html') });
      await mcp.callTool('evaluate_script', { function: `() => alert('foo')` });
      await mcp.callTool('select_page', { pageIdx: 0 });

      const result = await mcp.callTool('close_page', { pageIdx: 1 });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('A dialog is blocking this tool from running: alert "foo"');
      expect(result.text).toContain('Use select_page with pageIdx 1');

      await mcp.callTool('select_page', { pageIdx: 1 });
      await mcp.callTool('accept_dialog');
      await mcp.callTool('close_page', { pageIdx: 1 });
    });
  });

  describe('tools should fail when a dialog is already open', () => {
    mcpTest.beforeAll(async ({ mcp }) => {
      const result = await mcp.callTool('evaluate_script', { function: `() => alert('foo')` });
      expect(result.isError).toBe(false);
      expect(result.text).toContain('Dialog opened while tool was running: alert "foo"');
    });

    mcpTest.afterAll(async ({ mcp }) => {
      const result = await mcp.callTool('accept_dialog');
      expect(result.isError).toBe(false);
      expect(result.text).toContain('Accepted');
    });

    const toolCalls: Array<[string, (mcp: McpTestServer) => Promise<ToolResult>]> = [
      ['evaluate_script', (mcp) => mcp.callTool('evaluate_script', { function: '() => 1' })],
      ['click_by_uid', (mcp) => mcp.callTool('click_by_uid', { uid: 'e1' })],
      ['hover_by_uid', (mcp) => mcp.callTool('hover_by_uid', { uid: 'e1' })],
      [
        'drag_by_uid_to_uid',
        (mcp) => mcp.callTool('drag_by_uid_to_uid', { fromUid: 'e1', toUid: 'e2' }),
      ],
      ['press_key', (mcp) => mcp.callTool('press_key', { key: 'a' })],
      ['type_text', (mcp) => mcp.callTool('type_text', { text: 'abc' })],
      ['print_page', (mcp) => mcp.callTool('print_page')],
      ['navigate_history', (mcp) => mcp.callTool('navigate_history', { direction: 'back' })],
      ['fill_by_uid', (mcp) => mcp.callTool('fill_by_uid', { uid: 'e1', value: 'bar' })],
      [
        'fill_form_by_uid',
        (mcp) => mcp.callTool('fill_form_by_uid', { elements: [{ uid: 'e1', value: 'bar' }] }),
      ],
      [
        'upload_file_by_uid',
        (mcp) =>
          mcp.callTool('upload_file_by_uid', {
            uid: 'e1',
            filePath: join(mcp.home, 'upload.txt'),
          }),
      ],
      ['navigate_page', (mcp) => mcp.callTool('navigate_page', { url: 'about:blank' })],
      ['new_page', (mcp) => mcp.callTool('new_page', { url: 'about:blank' })],
      ['close_page', (mcp) => mcp.callTool('close_page', { pageIdx: 0 })],
    ];

    mcpTest.for(toolCalls)('%s', async ([, callTool], { mcp }) => {
      const result = await callTool(mcp);
      expect(result.isError).toBe(true);
      expect(result.text).toContain('A dialog is blocking this tool from running: alert "foo"');
    });
  });

  mcpTest(
    `accept_dialog without promptText should use a prompt's default value`,
    async ({ mcp }) => {
      await mcp.callTool('evaluate_script', {
        function: `() => window.result = prompt('foo', 'default value')`,
      });

      const accepted = await mcp.callTool('accept_dialog');
      expect(accepted.isError).toBe(false);
      expect(accepted.text).toBe('Accepted: "default value"');

      const result = await mcp.callTool('evaluate_script', {
        function: '() => window.result',
      });
      expect(result.isError).toBe(false);
      expect(result.text).toContain('default value');
    }
  );

  mcpTest(
    `accept_dialog should override a prompt's default value with an empty string`,
    async ({ mcp }) => {
      await mcp.callTool('evaluate_script', {
        function: `() => window.result = prompt('foo', 'default value')`,
      });

      const accepted = await mcp.callTool('accept_dialog', { promptText: '' });
      expect(accepted.isError).toBe(false);
      expect(accepted.text).toBe('Accepted: ""');

      const result = await mcp.callTool('evaluate_script', {
        function: '() => window.result',
      });
      expect(result.isError).toBe(false);
      expect(result.text).toContain('""');
    }
  );

  mcpTest(
    'accept_dialog should ignore promptText if the current dialog is not a prompt',
    async ({ mcp }) => {
      await mcp.callTool('evaluate_script', {
        function: `() => alert('foo')`,
      });

      const accepted = await mcp.callTool('accept_dialog', { promptText: 'bar' });
      expect(accepted.isError).toBe(false);
      expect(accepted.text).toBe('Accepted');
    }
  );

  describe('tools that close Firefox should fail when a dialog is open', () => {
    mcpTest.beforeEach(async ({ mcp }) => {
      await mcp.callTool('navigate_page', { url: fixtureUrl('simple.html') });
      const opened = await mcp.callTool('new_page', { url: fixtureUrl('alert.html') });
      expect(opened.text).toContain('Dialog opened while tool was running: alert "foo"');

      await mcp.callTool('select_page', { pageIdx: 0 });
      const evaluated = await mcp.callTool('evaluate_script', { function: '() => alert("bar")' });
      expect(evaluated.text).toContain('Dialog opened while tool was running: alert "bar"');
      await mcp.callTool('select_page', { pageIdx: 1 });
    });

    mcpTest.afterEach(async ({ mcp }) => {
      expect((await mcp.callTool('accept_dialog')).isError).toBe(false);
      await mcp.callTool('select_page', { pageIdx: 0 });
      expect((await mcp.callTool('accept_dialog')).isError).toBe(false);
      await mcp.callTool('close_page', { pageIdx: 1 });
    });

    mcpTest.for([
      ['close_firefox_session', 'close the Firefox session'],
      ['restart_firefox', 'restart Firefox'],
    ] as const)('%s', async ([name, action], { mcp }) => {
      const expected =
        `Cannot ${action} while dialogs are open on these pages:\n` +
        ` [0] Simple Test Page (${fixtureUrl('simple.html')}): alert "bar"\n` +
        `>[1] Untitled (${fixtureUrl('alert.html')}): alert "foo"`;
      await waitFor(async () => (await mcp.callTool(name)).text.includes(expected));

      const result = await mcp.callTool(name);
      expect(result.isError).toBe(true);
      expect(result.text).toContain(expected);
    });
  });

  mcpTest(
    'tools that could be blocked by dialogs should run without arguments',
    async ({ mcp }) => {
      await mcp.callTool('navigate_page', { url: fixtureUrl('simple.html') });
      const result = await mcp.callTool('print_page');
      expect(result.isError).toBe(false);
    }
  );
});
