-- Drafts keep In-Reply-To and References across an update.
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS in_reply_to text NOT NULL DEFAULT '';
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS references_header text NOT NULL DEFAULT '';
