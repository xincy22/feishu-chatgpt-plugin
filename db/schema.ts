import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const connections = sqliteTable('connections', {
  userId: text('user_id').primaryKey(),
  revision: text('revision').notNull(),
  appId: text('app_id').notNull(),
  configCipher: text('config_cipher').notNull(),
  tokensCipher: text('tokens_cipher'),
  updatedAt: integer('updated_at').notNull(),
  authorizationNonce: text('authorization_nonce'),
});
export const oauthStates = sqliteTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  userId: text('user_id').notNull(),
  revision: text('revision').notNull(),
  verifierCipher: text('verifier_cipher').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const refreshClaims = sqliteTable('refresh_claims', {
  claim: text('claim').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const refreshLeases = sqliteTable('refresh_leases', {
  userId:text('user_id').primaryKey(),revision:text('revision').notNull(),tokenHash:text('token_hash').notNull(),
  owner:text('owner').notNull(),phase:text('phase').notNull(),expiresAt:integer('expires_at').notNull(),
  retryAt:integer('retry_at').notNull().default(0),pendingCipher:text('pending_cipher'),errorKind:text('error_kind'),
});
