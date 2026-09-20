import { clientDeletionRequestService } from '../src/services/client-deletion-request.service';

/**
 * The blocker message is what an approver reads when a deletion is refused, so
 * it has to name what is actually in the way. Everything else in this service
 * needs a database; this is the part worth pinning down here.
 */
describe('describeBlockers', () => {
  const describe_ = clientDeletionRequestService.describeBlockers.bind(
    clientDeletionRequestService
  );

  it('allows the deletion when nothing is in the way', () => {
    expect(describe_({ loans: 0, groupMemberships: 0 })).toBeNull();
  });

  it('names loans, in the singular when there is one', () => {
    expect(describe_({ loans: 1, groupMemberships: 0 })).toContain('1 loan');
    expect(describe_({ loans: 1, groupMemberships: 0 })).not.toContain('1 loans');
  });

  it('names loans in the plural', () => {
    expect(describe_({ loans: 3, groupMemberships: 0 })).toContain('3 loans');
  });

  it('names group memberships on their own', () => {
    const message = describe_({ loans: 0, groupMemberships: 2 });
    expect(message).toContain('2 group memberships');
    expect(message).not.toContain('loan');
  });

  it('names both when both apply', () => {
    const message = describe_({ loans: 2, groupMemberships: 1 });
    expect(message).toContain('2 loans');
    expect(message).toContain('1 group membership');
    expect(message).toContain('and');
  });

  it('tells the approver what to do about it', () => {
    expect(describe_({ loans: 1, groupMemberships: 0 })).toMatch(
      /close or reassign/i
    );
  });
});
