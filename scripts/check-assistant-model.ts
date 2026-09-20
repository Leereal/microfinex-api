import 'dotenv/config';

/**
 * Does an organization's model accept the assistant's tools?
 *
 *   npx tsx scripts/check-assistant-model.ts <organizationId>
 *
 * Worth running after adding a tool or changing a provider. Each provider
 * takes a slightly different subset of JSON Schema and refuses the whole
 * request over one keyword it does not know - Gemini, for one, rejects an
 * exclusive bound written the old way and stops the conversation dead.
 *
 * The unit tests check the shape of the schemas; only the provider can say
 * whether it will take them. This sends the tool definitions and a harmless
 * greeting - no client record, no document, nothing about anybody - and
 * reports whether the call was accepted. Any tool call the model returns is
 * thrown away: nothing is run.
 */

import { prisma } from '../src/config/database';
import { readTools } from '../src/services/assistant/tools/read.tools';
import { writeTools } from '../src/services/assistant/tools/write.tools';
import { toolSpec } from '../src/services/assistant/tools/tool-kit';
import { resolveAssistantModel } from '../src/services/assistant/assistant.models';

(async () => {
  const organizationId = process.argv[2];
  if (!organizationId) {
    const organizations = await prisma.organization.findMany({ select: { id: true, name: true }, take: 10 });
    console.log('Pass an organization id. Available:');
    organizations.forEach(org => console.log('  ${org.id}  ${org.name}'));
    await prisma.$disconnect();
    return;
  }

  const tools = [...readTools, ...writeTools].map(toolSpec);
  console.log('Sending ${tools.length} tool definitions, and the word "hello".');

  const adapter = await resolveAssistantModel(organizationId);
  console.log('Model: ${adapter.label}');

  try {
    const reply = await adapter.complete({
      system: 'Reply with the single word: ready.',
      turns: [{ role: 'user', content: 'hello' }],
      tools,
      maxTokens: 50,
    });
    console.log('ACCEPTED. Reply:', JSON.stringify(reply.text.slice(0, 200)));
    console.log('Tokens:', reply.usage);
  } catch (error) {
    console.error('REFUSED:', (error as Error).message);
    process.exitCode = 1;
  }

  await prisma.$disconnect();
})();
