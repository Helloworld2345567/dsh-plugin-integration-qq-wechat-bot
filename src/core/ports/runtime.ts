/**
 * Exclusive ownership of one runtime data directory.  The adapter owns the
 * process-alive check and the atomic claim so two consumers cannot share data.
 */
export interface RuntimeOwnershipRepository {
  claim(owner: string): void;
  release(owner: string): void;
}
