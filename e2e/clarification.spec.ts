import { test, expect, Page } from '@playwright/test';
import { MOCK_TAURI_SCRIPT } from './mocks/tauri-mock';
import { Buffer } from 'buffer';

// Helper to inject Tauri mocks including book data
async function injectTauriMocksWithBook(page: Page) {
    // Fetch a real valid EPUB
    console.log('Fetching valid EPUB fixture...');
    const response = await fetch('https://react-reader.metabits.no/files/alice.epub');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64String = buffer.toString('base64');
    console.log('EPUB fetched, size:', buffer.length);

    // Convert base64 to byte array in browser
    const mockScript = MOCK_TAURI_SCRIPT.replace(
        'return new Uint8Array([]);',
        `
        const binaryString = atob('${base64String}');
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
        `
    ).replace(
        'switch (cmd) {',
        `switch (cmd) {
            case 'plugin:dialog|open':
                return '/mock/book.epub';
            case 'get_voices':
                return [];
            case 'plugin:event|listen':
                return () => {};
        `
    );
    await page.addInitScript(mockScript);
}

test.describe('Text Clarifier Integration', () => {

    test('popover appears when text is selected', async ({ page }) => {
        // Enable console log capture
        page.on('console', msg => console.log(`[Browser] ${msg.type()}: ${msg.text()}`));

        await injectTauriMocksWithBook(page);

        await page.goto('/');

        // Wait for app load
        await page.waitForLoadState('networkidle');

        // Click "Open EPUB File" (mocked to just load the fixture)
        await page.getByText('Open EPUB').first().click();

        console.log('Clicked Open EPUB, waiting for content...');

        // Click on the iframe to ensure focus for keyboard events
        await page.locator('iframe').first().click({ position: { x: 10, y: 10 }, force: true });

        // Navigate until we find text (skip cover, title page, etc)
        const frame = page.frameLocator('iframe').first();
        let found = false;
        for (let i = 0; i < 5; i++) {
            console.log(`Checking page ${i}...`);
            try {
                const p = frame.locator('p').first();
                await p.waitFor({ state: 'visible', timeout: 2000 });
                const text = await p.textContent();
                if (text && text.length > 20) {
                    found = true;
                    break;
                }
            } catch (e) {
                // ignore timeout
            }

            console.log('Pressing ArrowRight...');
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(1000);
        }

        if (!found) {
            console.log('Frame content:', await frame.locator('body').innerHTML());
            throw new Error('Could not find text paragraph in ebook');
        }

        const p = frame.locator('p').first();
        try {
            await p.waitFor({ timeout: 5000 });
        } catch (e) {
            console.log('Frame content:', await frame.locator('body').innerHTML());
            throw e;
        }

        const text = await p.textContent();
        console.log('Found text in ebook:', text?.substring(0, 50));
        expect(text?.toLowerCase()).toContain('alice');

        // Select text in the paragraph
        // Note: Playwright's dblclick selects word, or we can use evaluation to select range
        await p.dblclick();

        // Wait for popover to appear
        const popover = page.locator('.clarify-trigger');
        await expect(popover).toBeVisible({ timeout: 5000 });

        // Verify popover functionality
        await popover.click();

        // Should see "Please connect to Text Clarifier" since we haven't mocked AI state to be connected
        // Or "Thinking..." if the state defaults allow it.
        // Based on ClarifyPopover.tsx, if !isConnected, it shows a message.
        // We'll just check that the popover expanded
        await expect(page.locator('.clarify-popover')).toBeVisible();
        await expect(page.locator('.clarify-content')).toContainText('Please connect to Text Clarifier');
    });

});
