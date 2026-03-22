-- Teacher role: assign groups; Assistant: permissions stored in invite
-- Add teacher_group_ids to center_invites (for pending teacher invites)
ALTER TABLE center_invites ADD COLUMN IF NOT EXISTS teacher_group_ids UUID[] DEFAULT NULL;

-- Add invited_permissions for assistant role (applied when they accept)
ALTER TABLE center_invites ADD COLUMN IF NOT EXISTS invited_permissions JSONB DEFAULT NULL;

-- Add teacher_group_ids to users (which groups a teacher can access)
ALTER TABLE users ADD COLUMN IF NOT EXISTS teacher_group_ids UUID[] DEFAULT NULL;

COMMENT ON COLUMN center_invites.teacher_group_ids IS 'For teacher role: group IDs this teacher will be assigned to when they accept';
COMMENT ON COLUMN center_invites.invited_permissions IS 'For assistant role: permissions to apply when they accept (can_scan, can_view_payments, etc.)';
COMMENT ON COLUMN users.teacher_group_ids IS 'For teacher role: group IDs this teacher can access (scan, add students, view attendance)';
