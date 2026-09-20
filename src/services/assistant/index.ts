/**
 * Bringing the assistant up.
 *
 * The parts that reach outside the system register themselves here rather than
 * being imported by the runtime, so the loop itself stays free of mailboxes,
 * browsers and MCP servers - and a test can bring up the loop with a fake model
 * and no external anything.
 *
 * Called once from the server at start-up.
 */

import { registerEmailTools } from './composio/email.tools';
import { registerBrowserTools } from './browser/browser.tools';
import { registerMcpTools } from './mcp/mcp.client';
import { registerConnectorTools } from './connectors/api.connectors';
import { registerWhatsAppTools } from './whatsapp/whatsapp.assistant';
import { assistantWorker } from './assistant.worker';

let started = false;

export function startAssistant(): void {
  if (started) return;
  started = true;

  registerEmailTools();
  registerBrowserTools();
  registerMcpTools();
  registerConnectorTools();
  registerWhatsAppTools();

  // ASSISTANT_WORKER=false on an instance that should serve requests but not
  // run the assistant's background work.
  if (process.env.ASSISTANT_WORKER !== 'false') {
    assistantWorker.start();
  }
}

export function stopAssistant(): void {
  assistantWorker.stop();
  started = false;
}

export { assistantWorker };
