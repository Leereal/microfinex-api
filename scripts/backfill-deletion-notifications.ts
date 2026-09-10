import 'dotenv/config';

import { prisma } from '../src/config/database';
import { PERMISSIONS } from '../src/constants/permissions';
import {
  NOTIFICATION_TYPES,
  inAppNotificationService,
} from '../src/services/in-app-notification.service';

/**
 * Raise notifications for deletion requests that never got any.
 *
 * Requests made before the notification rules were corrected have no rows in
 * the inbox, so they sit in the queue with nobody told. This walks the pending
 * ones and notifies whoever should have heard, skipping any request that
 * already has notifications.
 *
 *   npx tsx scripts/backfill-deletion-notifications.ts
 */
async function run() {
  const pending = await prisma.clientDeletionRequest.findMany({
    where: { status: 'PENDING' },
    include: {
      client: {
        select: {
          clientNumber: true,
          firstName: true,
          lastName: true,
          businessName: true,
          branchId: true,
        },
      },
      requestedBy: { select: { firstName: true, lastName: true } },
    },
  });

  console.log(`Pending deletion requests: ${pending.length}\n`);

  for (const request of pending) {
    const existing = await prisma.notification.count({
      where: { resource: 'ClientDeletionRequest', resourceId: request.id },
    });

    if (existing > 0) {
      console.log(`  ${request.id.slice(0, 8)}  already has ${existing} - skipped`);
      continue;
    }

    const name =
      [request.client.firstName, request.client.lastName]
        .filter(Boolean)
        .join(' ') ||
      request.client.businessName ||
      'a client';
    const label = request.client.clientNumber
      ? `${name} (${request.client.clientNumber})`
      : name;
    const requester =
      [request.requestedBy.firstName, request.requestedBy.lastName]
        .filter(Boolean)
        .join(' ') || 'A colleague';

    const sent = await inAppNotificationService.notifyPermissionHolders({
      organizationId: request.organizationId,
      permission: PERMISSIONS.CLIENTS_DELETE,
      branchId: request.client.branchId,
      type: NOTIFICATION_TYPES.CLIENT_DELETION_REQUESTED,
      title: 'Client deletion requested',
      body: `${requester} asked for ${label} to be deleted.${
        request.reason ? ` Reason: ${request.reason}` : ''
      }`,
      link: `/clients/deletion-requests?request=${request.id}`,
      resource: 'ClientDeletionRequest',
      resourceId: request.id,
    });

    console.log(`  ${request.id.slice(0, 8)}  ${label} -> notified ${sent}`);
  }

  const total = await prisma.notification.count();
  console.log(`\n✅ Done. ${total} notification(s) in the inbox.`);
  await prisma.$disconnect();
}

run().catch(async error => {
  console.error('❌ Failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
