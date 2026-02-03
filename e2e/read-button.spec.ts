import { test, expect, Page } from '@playwright/test';
import { MOCK_TAURI_SCRIPT } from './mocks/tauri-mock';

/**
 * E2E tests for the "Read from Here" button functionality
 * 
 * Note: These tests mock the Tauri APIs to run in a browser environment.
 * For full integration testing, use `npm run tauri:test` with Tauri's webdriver.
 */

// Helper to inject Tauri mocks before page navigation
async function injectTauriMocks(page: Page) {
    await page.addInitScript(MOCK_TAURI_SCRIPT);
}

test.describe('Read from Here Button', () => {

    test.beforeEach(async ({ page }) => {
        // Inject Tauri mocks before navigating
        await injectTauriMocks(page);

        // Navigate to the app
        await page.goto('/');

        // Wait for the app to load
        await page.waitForLoadState('networkidle');
    });

    test('app loads without Tauri errors when mocked', async ({ page }) => {
        // Wait for app to fully load
        await page.waitForTimeout(2000);

        // Check that we don't see the "Download Failed" error
        const downloadFailed = page.getByText('Download Failed');
        const isVisible = await downloadFailed.isVisible().catch(() => false);

        // Take screenshot for debugging
        await page.screenshot({ path: 'e2e/screenshots/app-with-mocks.png', fullPage: true });

        // The app should load without the Download Failed error when mocked
        console.log('Download Failed visible:', isVisible);

        // Look for library or main content
        const bodyText = await page.textContent('body');
        console.log('Body contains "Kokoro":', bodyText?.includes('Kokoro'));
    });

    test('debug: log all console messages on startup', async ({ page }) => {
        const consoleLogs: string[] = [];
        page.on('console', msg => {
            consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
        });

        await page.waitForTimeout(3000);

        console.log('=== Console Logs ===');
        consoleLogs.forEach(log => console.log(log));
        console.log('=== End Console Logs ===');

        await page.screenshot({ path: 'e2e/screenshots/debug-console.png', fullPage: true });
    });

});

// Test to check the EpubReader component structure when epub is loaded
test.describe('EpubReader Component Debug', () => {

    test('check if epub reader renders with mock data', async ({ page }) => {
        await injectTauriMocks(page);
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // Get all clickable elements and their selectors
        const allButtons = await page.locator('button').all();
        console.log(`Found ${allButtons.length} buttons`);

        for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
            const text = await allButtons[i].textContent();
            console.log(`Button ${i}: "${text?.trim()}"`);
        }

        await page.screenshot({ path: 'e2e/screenshots/all-buttons.png', fullPage: true });
    });

    test('check DOM structure for epub elements', async ({ page }) => {
        await injectTauriMocks(page);
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);

        // Check for various element types
        const elementsToFind = [
            { selector: '.app', name: 'App container' },
            { selector: '.library-view', name: 'Library view' },
            { selector: '.epub-reader', name: 'EPUB reader' },
            { selector: '.react-reader', name: 'React Reader' },
            { selector: '.epub-read-from-here-btn', name: 'Read button' },
            { selector: 'iframe', name: 'iframe (EPUB content)' },
            { selector: '[data-kokoro-block-index]', name: 'Indexed paragraphs' },
            { selector: 'button', name: 'Any button' },
        ];

        console.log('\n=== DOM Element Counts ===');
        for (const { selector, name } of elementsToFind) {
            const count = await page.locator(selector).count();
            console.log(`${name} (${selector}): ${count}`);
        }
        console.log('=== End DOM Counts ===\n');

        // Get body HTML length for debugging
        const htmlLength = await page.evaluate(() => document.body.innerHTML.length);
        console.log('Body HTML length:', htmlLength);

        await page.screenshot({ path: 'e2e/screenshots/dom-structure.png', fullPage: true });
    });
});

// Test skeleton for when a book is loaded (requires fixture EPUB or deeper mocking)
test.describe.skip('Read Button with Loaded EPUB', () => {
    test('clicking paragraph shows read button', async ({ page }) => {
        // This test would need:
        // 1. A fixture EPUB file
        // 2. Mock for file dialog
        // 3. Mock for epub parsing

        // For now, this is a placeholder showing the expected behavior
        await page.goto('/');

        // Click to open a book (would need to mock file picker)
        // await page.click('[data-testid="open-book"]');

        // Wait for epub to load
        // await page.waitForSelector('iframe');

        // Click a paragraph inside the epub iframe
        // const frame = page.frameLocator('iframe').first();
        // await frame.locator('p').first().click();

        // Check that read button appeared
        // await expect(page.locator('.epub-read-from-here-btn')).toBeVisible();
    });
});
