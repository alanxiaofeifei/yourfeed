-- This database is ONLY the hosting registry, never bind it as a reader's DB.
CREATE TABLE hosting_slots (
 id TEXT PRIMARY KEY NOT NULL,
 origin TEXT NOT NULL UNIQUE,
 database_id TEXT NOT NULL UNIQUE,
 token_hash TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'free' CHECK(state IN ('free','reserved','active','revoked','expired')),
 owner_email TEXT UNIQUE,
 member_id TEXT UNIQUE,
 request_id TEXT UNIQUE,
 expires_at INTEGER,
 epoch INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE hosting_admin_nonce (
 nonce TEXT PRIMARY KEY NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX hosting_nonce_expiry ON hosting_admin_nonce(expires_at);
CREATE TABLE hosting_audit (
 id TEXT PRIMARY KEY NOT NULL,
 operation TEXT NOT NULL,
 instance_id TEXT,
 created_at INTEGER NOT NULL
);
