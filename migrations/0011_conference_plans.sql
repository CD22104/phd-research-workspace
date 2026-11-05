-- A reading/following preference does not imply an intention to submit.
ALTER TABLE conference_targets ADD COLUMN planned INTEGER NOT NULL DEFAULT 0 CHECK(planned IN (0,1));
