-- Allow a Microsoft account beside gmail and imap. Existing rows stay valid.
ALTER TABLE accounts DROP CONSTRAINT accounts_kind_check, ADD CONSTRAINT accounts_kind_check CHECK (kind IN ('gmail', 'imap', 'microsoft'));
