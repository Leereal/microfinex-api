/**
 * A browser the assistant can drive, and the sign-ins it may use.
 *
 * Lenders check things on websites that have no API: a credit bureau, a
 * company register, a regulator's portal. This opens those pages in a headless
 * Chromium, reads them as text, and - where a sign-in has been saved - signs in
 * first.
 *
 * Passwords are encrypted at rest, never returned by any endpoint, and typed
 * into the page by the server rather than being handed to the model. The model
 * asks to use "the ABC Bureau login"; it never learns what that login is.
 *
 * Every navigation goes through the policy check, and the page's own requests
 * are filtered too, so a redirect cannot walk the browser into the network this
 * server sits on.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { prisma } from '../../../config/database';
import { encryptionService } from '../../security/encryption.service';
import { createAuditLog } from '../../audit.service';
import { AssistantError, truncate } from '../assistant.logic';
import { assertBrowserUrl, subRequestAllowed, type BrowsePolicyOptions } from './policy';

const PAGE_TIMEOUT_MS = 45_000;
/** A session is closed when the run ends, or after this long idle. */
const SESSION_IDLE_MS = 5 * 60_000;

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      })
      .catch(error => {
        browserPromise = null;
        throw error;
      });
  }
  const browser = await browserPromise;
  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

interface Session {
  page: Page;
  policy: BrowsePolicyOptions;
  lastUsed: number;
  timer: NodeJS.Timeout;
}

const sessions = new Map<string, Session>();

/** The page this run is working on, opened on first use. */
export async function sessionFor(runId: string, policy: BrowsePolicyOptions): Promise<Page> {
  const existing = sessions.get(runId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.page;
  }

  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  await page.setRequestInterception(true);

  page.on('request', request => {
    void (async () => {
      // Everything the page fetches is checked too: an image, a script or a
      // redirect is just as good a way into the network as a navigation.
      const allowed = await subRequestAllowed(request.url(), policy);
      if (allowed) await request.continue().catch(() => undefined);
      else await request.abort().catch(() => undefined);
    })();
  });

  const timer = setTimeout(() => void closeSession(runId), SESSION_IDLE_MS);
  timer.unref?.();
  sessions.set(runId, { page, policy, lastUsed: Date.now(), timer });
  return page;
}

export async function closeSession(runId: string) {
  const session = sessions.get(runId);
  if (!session) return;
  clearTimeout(session.timer);
  sessions.delete(runId);
  await session.page.close().catch(() => undefined);
}

/** Readable text, with the links a model may want to follow next. */
export async function readPage(page: Page, maxChars = 12_000) {
  // This runs inside the page, where the DOM exists. The API is built without
  // the DOM type library, so the browser globals are reached through
  // globalThis rather than pulling a second global environment into the server.
  const content = (await page.evaluate(() => {
    const doc = (globalThis as unknown as { document: any }).document;
    for (const selector of ['script', 'style', 'noscript', 'svg']) {
      doc.querySelectorAll(selector).forEach((element: any) => element.remove());
    }
    const text: string = doc.body?.innerText ?? '';
    const links = Array.from(doc.querySelectorAll('a[href]'))
      .slice(0, 60)
      .map((anchor: any) => ({
        text: String(anchor.textContent ?? '').trim().slice(0, 80),
        href: String(anchor.href ?? ''),
      }))
      .filter((link: { text: string }) => link.text);
    return { title: String(doc.title ?? ''), text, links };
  })) as { title: string; text: string; links: Array<{ text: string; href: string }> };

  return {
    title: content.title,
    url: page.url(),
    text: truncate(content.text.replace(/\n{3,}/g, '\n\n'), maxChars),
    links: content.links,
  };
}

// ------------------------------------------------------------------- logins

export interface LoginContext {
  organizationId: string;
  userId: string;
}

const LOGIN_FIELDS = {
  id: true,
  name: true,
  domain: true,
  loginUrl: true,
  username: true,
  usernameSelector: true,
  passwordSelector: true,
  submitSelector: true,
  status: true,
  lastVerifiedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;

class BrowserLoginService {
  /** Saved sign-ins. The password is never among the fields returned. */
  async list(ctx: LoginContext) {
    const logins = await prisma.assistantBrowserLogin.findMany({
      where: { organizationId: ctx.organizationId },
      select: LOGIN_FIELDS,
      orderBy: { name: 'asc' },
    });
    return {
      logins,
      encryptedAtRest: encryptionService.isEnabled(),
    };
  }

  async create(
    ctx: LoginContext,
    input: {
      name: string;
      loginUrl: string;
      username: string;
      password: string;
      usernameSelector?: string;
      passwordSelector?: string;
      submitSelector?: string;
    }
  ) {
    let url: URL;
    try {
      url = new URL(input.loginUrl);
    } catch {
      throw new AssistantError('The sign-in address is not a web address.', 'INVALID_URL');
    }
    if (url.protocol !== 'https:') {
      throw new AssistantError(
        'A sign-in page must be https - a password would otherwise travel in the clear.',
        'INSECURE_LOGIN_URL'
      );
    }
    if (!input.password) throw new AssistantError('A password is needed.', 'PASSWORD_REQUIRED');

    const login = await prisma.assistantBrowserLogin.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name.slice(0, 120),
        domain: url.hostname.toLowerCase(),
        loginUrl: input.loginUrl,
        username: input.username,
        secret: encryptionService.encrypt(input.password, { organizationId: ctx.organizationId }),
        usernameSelector: input.usernameSelector ?? null,
        passwordSelector: input.passwordSelector ?? null,
        submitSelector: input.submitSelector ?? null,
        createdById: ctx.userId,
      },
      select: LOGIN_FIELDS,
    });

    await createAuditLog({
      action: 'CREATE',
      resource: 'ASSISTANT_BROWSER_LOGIN',
      resourceId: login.id,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      newValue: { name: login.name, domain: login.domain, username: login.username },
    }).catch(() => undefined);

    return login;
  }

  async update(
    ctx: LoginContext,
    id: string,
    input: {
      name?: string;
      username?: string;
      password?: string;
      usernameSelector?: string | null;
      passwordSelector?: string | null;
      submitSelector?: string | null;
    }
  ) {
    const existing = await prisma.assistantBrowserLogin.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!existing) throw new AssistantError('No such sign-in.', 'NOT_FOUND', 404);

    return prisma.assistantBrowserLogin.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.slice(0, 120) } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.password
          ? {
              secret: encryptionService.encrypt(input.password, { organizationId: ctx.organizationId }),
              // A new password invalidates the saved session.
              storageState: null,
              status: 'UNVERIFIED',
            }
          : {}),
        ...(input.usernameSelector !== undefined ? { usernameSelector: input.usernameSelector } : {}),
        ...(input.passwordSelector !== undefined ? { passwordSelector: input.passwordSelector } : {}),
        ...(input.submitSelector !== undefined ? { submitSelector: input.submitSelector } : {}),
      },
      select: LOGIN_FIELDS,
    });
  }

  async remove(ctx: LoginContext, id: string) {
    const existing = await prisma.assistantBrowserLogin.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, name: true },
    });
    if (!existing) throw new AssistantError('No such sign-in.', 'NOT_FOUND', 404);
    await prisma.assistantBrowserLogin.delete({ where: { id } });
    await createAuditLog({
      action: 'DELETE',
      resource: 'ASSISTANT_BROWSER_LOGIN',
      resourceId: id,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      previousValue: { name: existing.name },
    }).catch(() => undefined);
    return { removed: true };
  }

  /**
   * Sign in on a page.
   *
   * The selectors are optional: most sign-in forms are found by looking for an
   * input of the right type, and only an unusual one needs them spelled out.
   */
  async signIn(page: Page, loginId: string, organizationId: string, allowedDomains: string[]) {
    const login = await prisma.assistantBrowserLogin.findFirst({
      where: { id: loginId, organizationId },
    });
    if (!login) throw new AssistantError('No such sign-in.', 'NOT_FOUND', 404);

    await assertBrowserUrl(login.loginUrl, { allowedDomains });
    await page.goto(login.loginUrl, { waitUntil: 'domcontentloaded' });

    const usernameSelector =
      login.usernameSelector ||
      'input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i]';
    const passwordSelector = login.passwordSelector || 'input[type="password"]';

    const usernameField = await page.$(usernameSelector);
    const passwordField = await page.$(passwordSelector);
    if (!usernameField || !passwordField) {
      await this.recordFailure(login.id, 'The sign-in form could not be found on that page.');
      throw new AssistantError(
        'The sign-in form could not be found. Add the field selectors to this saved sign-in.',
        'LOGIN_FORM_NOT_FOUND'
      );
    }

    await usernameField.type(login.username, { delay: 10 });
    // The password goes from the database into the page. It is never put into
    // the transcript, a tool result or a log line.
    await passwordField.type(encryptionService.decrypt(login.secret), { delay: 10 });

    if (login.submitSelector) {
      await page.click(login.submitSelector);
    } else {
      await passwordField.press('Enter');
    }

    await page
      .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
      .catch(() => undefined);

    // Still showing a password box: the sign-in did not take.
    const stillOnForm = await page.$('input[type="password"]');
    if (stillOnForm) {
      await this.recordFailure(login.id, 'The site did not accept the sign-in.');
      throw new AssistantError(
        `Signing in to ${login.name} did not work. Check the username and password saved for it.`,
        'LOGIN_FAILED'
      );
    }

    const cookies = await page.cookies();
    await prisma.assistantBrowserLogin.update({
      where: { id: login.id },
      data: {
        status: 'ACTIVE',
        lastVerifiedAt: new Date(),
        lastError: null,
        // Only cookies for this site, encrypted, so a saved session cannot be
        // replayed anywhere else.
        storageState: encryptionService.encrypt(
          JSON.stringify(cookies.filter(cookie => cookie.domain.includes(login.domain))),
          { organizationId }
        ),
      },
    });

    return { signedIn: true, url: page.url(), name: login.name };
  }

  private async recordFailure(id: string, message: string) {
    await prisma.assistantBrowserLogin
      .update({ where: { id }, data: { status: 'FAILED', lastError: message } })
      .catch(() => undefined);
  }

  /** Check a saved sign-in works, from the settings screen. */
  async verify(ctx: LoginContext, id: string, allowedDomains: string[]) {
    const runId = `verify:${id}:${Date.now()}`;
    try {
      const page = await sessionFor(runId, { allowedDomains });
      const result = await this.signIn(page, id, ctx.organizationId, allowedDomains);
      return result;
    } finally {
      await closeSession(runId);
    }
  }
}

export const browserLoginService = new BrowserLoginService();
