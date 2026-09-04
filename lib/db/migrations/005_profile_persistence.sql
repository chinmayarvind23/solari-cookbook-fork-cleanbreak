BEGIN IMMEDIATE;
ALTER TABLE cancellation_jobs ADD COLUMN profile_state_save_skipped_reason TEXT;
PRAGMA user_version = 5;
COMMIT;
