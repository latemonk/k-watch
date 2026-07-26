import { expect, test } from '@playwright/test';

/**
 * Regression coverage for the safeHtml() unwrap bypass.
 *
 * safeHtml() used to iterate a snapshot of parent.childNodes. Unwrapping a
 * non-allowlisted element hoists its children into the parent, and those
 * hoisted nodes were absent from the snapshot — so they were never visited
 * and kept whatever markup they carried. `<form><img src=x onerror=…></form>`
 * survived sanitization verbatim.
 *
 * This runs the REAL module in a REAL browser (vite dev server transpiles the
 * TS on import). The unit harness in tests/dom-utils.test.mts cannot cover it:
 * its innerHTML stub only parses a single flat <a> tag, so it can't build the
 * nested tree the bug needs, and a hand-rolled parser would be testing the
 * stub rather than the browser's actual tree construction.
 */
test('safeHtml sanitizes markup hoisted out of non-allowlisted elements', async ({ page }) => {
  await page.goto('/tests/runtime-harness.html');

  const result = await page.evaluate(async () => {
    const { safeHtml } = await import('/src/utils/dom-utils.ts');

    const render = (html: string): string => {
      const host = document.createElement('div');
      host.appendChild(safeHtml(html));
      return host.innerHTML;
    };

    return {
      // The bypass: <img> hoisted out of an unwrapped <form>.
      imgUnderUnsafeParent: render('<form><img src=x onerror="alert(1)"></form>'),
      // The bypass: javascript: href hoisted out of an unwrapped <section>.
      jsHrefUnderUnsafeParent: render('<section><a href="javascript:alert(2)">x</a></section>'),
      // Two levels deep — the hoisted node is itself unsafe and must unwrap again.
      nestedUnsafe: render('<figure><picture><img src=x onerror="alert(3)"></picture></figure>'),
      // Protocol-relative href is a cross-origin navigation, not a local path.
      protocolRelativeHref: render('<a href="//evil.example/x">x</a>'),
      // Controls: the same payloads at top level were always handled correctly.
      controlImg: render('<img src=x onerror="alert(1)">'),
      controlJsHref: render('<a href="javascript:alert(2)">x</a>'),
      // Allowlisted markup must still survive untouched.
      preservesSafeMarkup: render('<p>hello <strong>world</strong></p>'),
    };
  });

  expect(result.imgUnderUnsafeParent).not.toContain('onerror');
  expect(result.imgUnderUnsafeParent).not.toContain('<img');
  expect(result.jsHrefUnderUnsafeParent).not.toContain('javascript:');
  expect(result.nestedUnsafe).not.toContain('onerror');
  expect(result.nestedUnsafe).not.toContain('<img');
  expect(result.protocolRelativeHref).not.toContain('evil.example');

  expect(result.controlImg).not.toContain('<img');
  expect(result.controlJsHref).not.toContain('javascript:');

  expect(result.preservesSafeMarkup).toBe('<p>hello <strong>world</strong></p>');
});
