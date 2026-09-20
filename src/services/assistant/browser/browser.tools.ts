/**
 * The browser, as tools.
 *
 * Reading a page is one capability; typing into one is another, and both start
 * switched off. Whatever comes back is wrapped as untrusted - a web page is
 * exactly the kind of place an instruction aimed at the model would be planted
 * - and the run is marked, so anything outbound afterwards needs approval.
 */

import { z } from 'zod';
import { prisma } from '../../../config/database';
import { storageService } from '../../storage.service';
import { AssistantError, untrustedEnvelope } from '../assistant.logic';
import { registerExternalTools, registerRunCleanup } from '../tools';
import type { AssistantTool, ToolContext } from '../tools/tool-kit';
import { assertBrowserUrl } from './policy';
import { browserLoginService, closeSession, readPage, sessionFor } from './browser.service';

function policyFor(ctx: ToolContext) {
  return { allowedDomains: ctx.settings.browserAllowedDomains };
}

export function browserTools(): AssistantTool[] {
  return [
    {
      name: 'browse_page',
      capability: 'browser.read',
      description:
        'Open a web page on one of the sites your organization has allowed, and read it. Returns the text and the links on the page.',
      schema: z.object({
        url: z.string().url(),
        loginId: z
          .string()
          .uuid()
          .optional()
          .describe('Sign in first with one of the saved sign-ins, if the page needs it'),
      }),
      summarise: args => `Open ${args.url}`,
      async execute(args, ctx) {
        const policy = policyFor(ctx);
        const url = await assertBrowserUrl(args.url, policy);
        const page = await sessionFor(ctx.runId, policy);

        if (args.loginId) {
          await browserLoginService.signIn(page, args.loginId, ctx.organizationId, policy.allowedDomains);
        }

        await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
        const content = await readPage(page);
        ctx.markTainted();

        return {
          title: content.title,
          url: content.url,
          links: content.links.slice(0, 30),
          content: untrustedEnvelope(content.url, content.text),
        };
      },
    },

    {
      name: 'browser_screenshot',
      capability: 'browser.read',
      description: 'Take a picture of the page currently open, to keep as evidence of what was seen.',
      schema: z.object({ note: z.string().max(200).optional() }),
      summarise: () => 'Take a screenshot of the page',
      async execute(args, ctx) {
        const page = await sessionFor(ctx.runId, policyFor(ctx));
        const shot = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));
        const fileName = `screenshot-${Date.now()}.png`;
        const upload = await storageService.upload(shot, fileName, 'image/png', shot.length, {
          organizationId: ctx.organizationId,
          entityType: 'organizations',
          entityId: ctx.organizationId,
          fileType: 'NOTE_ATTACHMENT',
          subEntityId: ctx.conversationId ?? ctx.runId,
        });
        const artifact = await prisma.assistantArtifact.create({
          data: {
            organizationId: ctx.organizationId,
            conversationId: ctx.conversationId,
            runId: ctx.runId,
            kind: 'SCREENSHOT',
            fileName,
            mimeType: 'image/png',
            fileSize: shot.length,
            storagePath: upload.path,
            metadata: { url: page.url(), note: args.note ?? null } as never,
          },
        });
        return { artifactId: artifact.id, url: page.url(), fileName };
      },
    },

    {
      name: 'browser_type',
      capability: 'browser.act',
      description: 'Type into a field on the page that is open - a search box, a reference number.',
      schema: z.object({
        selector: z.string().min(1).describe('A CSS selector for the field'),
        text: z.string().max(500),
        pressEnter: z.boolean().optional(),
      }),
      summarise: args => `Type into ${args.selector}`,
      async execute(args, ctx) {
        const page = await sessionFor(ctx.runId, policyFor(ctx));
        const field = await page.$(args.selector);
        if (!field) throw new AssistantError(`Nothing on the page matches ${args.selector}.`, 'ELEMENT_NOT_FOUND');
        await field.type(args.text, { delay: 10 });
        if (args.pressEnter) {
          await field.press('Enter');
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
        }
        const content = await readPage(page, 4000);
        ctx.markTainted();
        return { typed: true, url: content.url, content: untrustedEnvelope(content.url, content.text) };
      },
    },

    {
      name: 'browser_click',
      capability: 'browser.act',
      description: 'Click something on the page that is open.',
      schema: z.object({ selector: z.string().min(1) }),
      summarise: args => `Click ${args.selector}`,
      async execute(args, ctx) {
        const page = await sessionFor(ctx.runId, policyFor(ctx));
        const target = await page.$(args.selector);
        if (!target) throw new AssistantError(`Nothing on the page matches ${args.selector}.`, 'ELEMENT_NOT_FOUND');
        await target.click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
        const content = await readPage(page, 6000);
        ctx.markTainted();
        return { clicked: true, url: content.url, content: untrustedEnvelope(content.url, content.text) };
      },
    },

    {
      name: 'list_saved_logins',
      capability: 'browser.read',
      description: 'The sign-ins saved for the assistant, so you can ask to use one by id.',
      schema: z.object({}),
      summarise: () => 'List the saved sign-ins',
      async execute(_args, ctx) {
        const logins = await prisma.assistantBrowserLogin.findMany({
          where: { organizationId: ctx.organizationId },
          select: { id: true, name: true, domain: true, status: true },
        });
        // Usernames and passwords stay out of the transcript.
        return { logins };
      },
    },
  ];
}

/** Offer browsing only where the organization has allowed some sites. */
export function registerBrowserTools() {
  // A page left open would hold a Chromium tab (and a signed-in session) long
  // after the run that opened it has finished.
  registerRunCleanup(runId => closeSession(runId));
  registerExternalTools(async ctx => {
    if (ctx.clientScopeId) return [];
    if (ctx.settings.browserAllowedDomains.length === 0) return [];
    return browserTools();
  });
}

export { closeSession as closeBrowserSession };
