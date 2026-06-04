-- RAN-34: backfill legacy payment validity.
--
-- Safety:
-- - No rows are physically deleted.
-- - Voided payments are not touched and do not count as paid.
-- - Cancelled memberships are not reactivated automatically.
-- - Only safe memberships are backfilled:
--   * exactly one approved payment,
--   * missing payment validity,
--   * non-null frozen memberships.required_amount,
--   * membership status is not cancelled.
-- - Reconciliation is delegated to the existing payment/membership function so
--   future active bookings are cancelled if the program loses valid paid access.

with approved_payment_counts as (
  select
    p.membership_id,
    count(*)::int as approved_count,
    coalesce(sum(p.amount), 0)::numeric(12, 2) as approved_paid
  from public.payments p
  where p.status = 'approved'::public.payment_status
  group by p.membership_id
),
safe_legacy_payments as (
  select
    p.id as payment_id,
    p.membership_id,
    (p.paid_at at time zone 'America/Argentina/Buenos_Aires')::date as paid_date
  from public.payments p
  join public.memberships m on m.id = p.membership_id
  join approved_payment_counts apc on apc.membership_id = p.membership_id
  where p.status = 'approved'::public.payment_status
    and (
      p.membership_start_date is null
      or p.membership_end_date is null
    )
    and apc.approved_count = 1
    and m.required_amount is not null
    and m.status <> 'cancelled'::public.membership_status
),
updated_payments as (
  update public.payments p
  set
    membership_start_date = slp.paid_date,
    membership_end_date = (slp.paid_date + interval '1 month')::date,
    updated_at = now()
  from safe_legacy_payments slp
  where p.id = slp.payment_id
    and p.status = 'approved'::public.payment_status
    and (
      p.membership_start_date is null
      or p.membership_end_date is null
    )
  returning p.id, p.membership_id
),
reconciled_memberships as (
  select
    up.membership_id,
    private.reconcile_membership_payment_state(
      up.membership_id,
      null,
      'Backfill legacy payment validity after PR #91.'
    ) as reconciliation
  from (
    select distinct membership_id
    from updated_payments
  ) up
)
select
  count(*) as reconciled_memberships
from reconciled_memberships;
