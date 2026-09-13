import puppeteer, { type Browser } from 'puppeteer';

/**
 * HTML to PDF, through the same engine that renders the print preview.
 *
 * The statement's "Download PDF" used to just reopen the print dialog, so
 * nothing was ever downloaded. Anything that draws the document a second way -
 * a canvas snapshot, a programmatic PDF builder - produces something that is
 * close to the preview rather than identical to it. Rendering the very same
 * HTML in headless Chromium and asking it to print is the only approach where
 * "exactly as the preview" is true by construction.
 */

/**
 * One browser, reused.
 *
 * Launching Chromium takes a second or two and a fair amount of memory; doing
 * it per request would make every download slow and make a handful of
 * concurrent downloads a memory problem.
 */
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      })
      .catch(error => {
        // Let the next call try again rather than caching a failure forever.
        browserPromise = null;
        throw error;
      });
  }

  const browser = await browserPromise;

  // A crashed or closed browser must not be handed out again.
  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }

  return browser;
}

export interface PdfOptions {
  /** Paper size. A4 unless a statement needs something else. */
  format?: 'A4' | 'A5' | 'Letter';
  landscape?: boolean;
}

export async function renderHtmlToPdf(
  html: string,
  options: PdfOptions = {}
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // The document is self-contained: inline styles, no external requests.
    // Disabling JavaScript keeps it that way and removes a whole class of risk
    // from rendering generated markup.
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });

    // Honour the @page and @media print rules the document already carries,
    // which is what makes the output match the preview.
    await page.emulateMediaType('print');

    const pdf = await page.pdf({
      format: options.format ?? 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      // Margins come from the document's own @page rule; setting them here too
      // would add a second margin on top of it.
      preferCSSPageSize: true,
    });

    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {
      // A page that will not close is not worth failing the download over.
    });
  }
}

/** Shut the shared browser down on process exit. */
export async function closePdfBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => {});
}

export default { renderHtmlToPdf, closePdfBrowser };
