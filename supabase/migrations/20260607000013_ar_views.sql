-- Accounts-receivable views. Active credits net against unpaid; transactions untouched.
-- Captured from live prod via pg_get_viewdef (repo sync; already applied).

create or replace view public.ar_by_student as
 WITH pending_bills AS (
         SELECT t.teacher_id,
            t.student_id,
            sum(t.amount_billed) AS unpaid_amount,
            count(*) AS unpaid_count
           FROM transactions t
          WHERE t.kind = 'lesson'::text AND t.status = 'pending'::text
          GROUP BY t.teacher_id, t.student_id
        ), paid_bills AS (
         SELECT t.teacher_id,
            t.student_id,
            sum(t.amount_billed) AS paid_amount,
            count(*) AS paid_count
           FROM transactions t
          WHERE t.kind = 'lesson'::text AND t.status = 'paid'::text
          GROUP BY t.teacher_id, t.student_id
        ), active_credits AS (
         SELECT sc.teacher_id,
            sc.student_id,
            sum(sc.amount) AS active_credit_amount
           FROM student_credits sc
          WHERE sc.status = 'active'::text
          GROUP BY sc.teacher_id, sc.student_id
        )
 SELECT COALESCE(pb.teacher_id, pd.teacher_id, ac.teacher_id) AS teacher_id,
    COALESCE(pb.student_id, pd.student_id, ac.student_id) AS student_id,
    COALESCE(pb.unpaid_amount, 0::numeric) AS unpaid_amount,
    COALESCE(pb.unpaid_count, 0::bigint) AS unpaid_count,
    COALESCE(ac.active_credit_amount, 0::numeric) AS active_credit_amount,
    GREATEST(COALESCE(pb.unpaid_amount, 0::numeric) - COALESCE(ac.active_credit_amount, 0::numeric), 0::numeric) AS outstanding_amount,
    COALESCE(pd.paid_amount, 0::numeric) AS paid_amount,
    COALESCE(pd.paid_count, 0::bigint) AS paid_count
   FROM pending_bills pb
     FULL JOIN paid_bills pd ON pd.teacher_id = pb.teacher_id AND pd.student_id = pb.student_id
     FULL JOIN active_credits ac ON ac.teacher_id = COALESCE(pb.teacher_id, pd.teacher_id) AND ac.student_id = COALESCE(pb.student_id, pd.student_id);

create or replace view public.ar_by_teacher as
 SELECT teacher_id,
    sum(unpaid_amount) AS total_unpaid,
    sum(active_credit_amount) AS total_active_credit,
    sum(outstanding_amount) AS total_outstanding,
    sum(paid_amount) AS total_paid,
    count(*) FILTER (WHERE outstanding_amount > 0::numeric) AS students_with_balance
   FROM ar_by_student
  GROUP BY teacher_id;

notify pgrst, 'reload schema';
