import * as admin from 'firebase-admin';
import { config } from '../config';
import { upsertUser, promoteToAdmin, promoteToAdminByEmail } from '../models/users';

export async function runSeed(): Promise<void> {
  const email = config.superAdminEmail;
  if (!email) return;

  // Path 1: user exists in Firebase — sync their record to the DB then promote
  try {
    const fbUser = await admin.auth().getUserByEmail(email);
    const user   = await upsertUser(
      fbUser.uid,
      fbUser.email!,
      fbUser.displayName ?? undefined,
      fbUser.photoURL    ?? undefined,
    );
    if (user.role !== 'super_admin') {
      await promoteToAdmin(fbUser.uid);
      console.log(`[seed] ${email} promoted to super_admin (via Firebase)`);
    }
    return;
  } catch {
    // User hasn't signed in yet — Firebase has no record. Fall through.
  }

  // Path 2: user already has a local DB record (signed in before, email matches)
  const promoted = await promoteToAdminByEmail(email);
  if (promoted) {
    console.log(`[seed] ${email} promoted to super_admin (via local DB)`);
    return;
  }

  // Path 3: user not in Firebase or DB yet — auth middleware promotes on first login
  console.log(`[seed] ${email} not found yet; will be promoted to super_admin on first login`);
}
