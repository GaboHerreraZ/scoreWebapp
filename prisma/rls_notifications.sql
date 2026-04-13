-- ============================================================
-- RLS policies for notifications table
-- Run this in the Supabase SQL Editor to enable Realtime
-- filtering by company_id.
-- ============================================================

-- 1. Enable RLS on the notifications table
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 2. Allow authenticated users to SELECT notifications
--    only from their own companies (via user_companies).
CREATE POLICY "Users can view notifications of their companies"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT uc.company_id
      FROM user_companies uc
      WHERE uc.user_id = auth.uid()
        AND uc.is_active = true
    )
  );

-- 3. Allow the service role (backend) full INSERT access.
--    The backend uses the service_role key, which bypasses RLS,
--    so this policy is optional but explicit.
CREATE POLICY "Service role can insert notifications"
  ON notifications
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 4. Enable RLS on notification_reads
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;

-- 5. Users can only see/create their own read records
CREATE POLICY "Users can manage their own notification reads"
  ON notification_reads
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 6. Enable Realtime for notifications table
-- In Supabase Dashboard: Database → Replication → Enable for "notifications" table
-- Or via SQL:
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
