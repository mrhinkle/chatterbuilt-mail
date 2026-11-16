-- A code remembers the token family issued from it, so a second redemption can revoke those tokens.

ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS family_id text;
