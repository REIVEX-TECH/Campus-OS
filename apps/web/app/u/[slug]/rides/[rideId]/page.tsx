import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ridePost } from '@campusos/module-rides/posts';
import { mySeatRequests, requestsForRide } from '@campusos/module-rides/seats';
import { DriverRequests } from '@/app/_components/rides/driver-requests';
import { SeatRequestButton } from '@/app/_components/rides/seat-request-button';
import { CancelRideButton } from '@/app/_components/rides/cancel-ride-button';
import { ReportButton } from '@/app/_components/rides/report-button';
import { RateForm } from '@/app/_components/rides/rate-form';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator, type MessageKey } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';
import { requireRides } from '@/lib/rides';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; rideId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('rides.heading'),
    path: `${await tenantBase(slug)}/rides`,
  });
}

export default async function RidePage({ params }: Params) {
  const { slug, rideId } = await params;
  const tenant = await requireTenant(slug);
  requireRides(tenant);
  const t = translator(tenant.locale);
  const ride = await ridePost(slug, rideId);
  if (!ride) notFound();
  const actor = await currentActor();
  const isAuthor = actor?.userId === ride.authorId;
  const isOffer = ride.kind === 'offer';
  const isOpen = ride.status === 'active' || ride.status === 'full';
  const isCompleted = ride.status === 'completed';

  const rateLabels = {
    rating: t('rides.rate.heading'),
    comment: t('rides.rate.commentHint'),
    submit: t('rides.rate.submit'),
    submitting: t('rides.rate.submitting'),
    done: t('rides.rate.done'),
    failed: t('rides.rate.failed'),
  };

  const when = new Intl.DateTimeFormat(tenant.locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tenant.timezone,
  }).format(ride.departAt);

  // The driver sees the request queue; a rider sees their own request control.
  const requests = isAuthor ? await requestsForRide(actor!, slug, rideId) : [];
  const myRequest =
    actor && !isAuthor
      ? ((await mySeatRequests(actor, slug)).find((r) => r.rideId === rideId) ?? null)
      : null;
  const liveStatus =
    myRequest && (myRequest.status === 'pending' || myRequest.status === 'accepted')
      ? myRequest.status
      : null;

  const statusLabelKey = `rides.status.${ride.status}` as MessageKey;

  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                isOffer ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}
            >
              {t(isOffer ? 'rides.kind.offer' : 'rides.kind.request')}
            </span>
            {ride.status !== 'active' ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {t(statusLabelKey)}
              </span>
            ) : null}
            {ride.womenOnly ? (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                {t('rides.womenOnly.badge')}
              </span>
            ) : null}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {ride.originText} <span aria-hidden>&rarr;</span> {ride.destText}
          </h1>
          <p className="text-sm text-muted-foreground">{when}</p>
          {isOffer && ride.seatsAvailable !== null ? (
            <p className="text-sm text-muted-foreground">
              {ride.seatsAvailable > 0
                ? t('rides.seatsLeft').replace('{n}', String(ride.seatsAvailable))
                : t('rides.full')}
            </p>
          ) : null}
          {ride.authorHandle ? (
            <p className="text-sm text-muted-foreground">@{ride.authorHandle}</p>
          ) : null}
        </div>

        {ride.womenOnly ? (
          <p className="rounded-xl bg-accent/10 px-3 py-2 text-[13px] text-accent-foreground">
            {t('rides.womenOnly.note')}
          </p>
        ) : null}

        {ride.notes ? <p className="whitespace-pre-wrap text-[15px]">{ride.notes}</p> : null}

        {isAuthor ? (
          <div className="flex flex-col gap-4">
            {isOffer ? (
              <DriverRequests
                tenant={slug}
                requests={requests.map((r) => ({
                  id: r.id,
                  status: r.status,
                  passengerHandle: r.passengerHandle,
                }))}
                labels={{
                  heading: t('rides.requests.heading'),
                  empty: t('rides.requests.empty'),
                  accept: t('rides.requests.accept'),
                  decline: t('rides.requests.decline'),
                  accepted: t('rides.requests.accepted'),
                  declined: t('rides.requests.declined'),
                  cancelled: t('rides.requests.cancelled'),
                  working: t('rides.requests.working'),
                  failed: t('rides.requests.failed'),
                }}
              />
            ) : null}
            {isOpen ? (
              <CancelRideButton
                tenant={slug}
                rideId={rideId}
                labels={{
                  cancel: t('rides.owner.cancel'),
                  cancelling: t('rides.owner.cancelling'),
                  confirm: t('rides.owner.confirm'),
                  failed: t('rides.owner.failed'),
                }}
              />
            ) : null}
          </div>
        ) : isOffer && isOpen && actor ? (
          <SeatRequestButton
            tenant={slug}
            rideId={rideId}
            requestId={myRequest?.id ?? null}
            requestStatus={liveStatus}
            seatsAvailable={ride.seatsAvailable}
            labels={{
              request: t('rides.seat.request'),
              requesting: t('rides.seat.requesting'),
              pending: t('rides.seat.pending'),
              confirmed: t('rides.seat.confirmed'),
              cancel: t('rides.seat.cancel'),
              cancelling: t('rides.seat.cancelling'),
              failed: t('rides.seat.failed'),
              full: t('rides.full'),
            }}
          />
        ) : null}

        {isCompleted && isAuthor
          ? requests
              .filter((r) => r.status === 'accepted')
              .map((r) => (
                <RateForm
                  key={r.id}
                  tenant={slug}
                  rideId={rideId}
                  ratee={r.passengerId}
                  direction="of_passenger"
                  labels={{
                    heading: t('rides.rate.ofPassenger').replace('{who}', r.passengerHandle ?? '?'),
                    ...rateLabels,
                  }}
                />
              ))
          : null}

        {isCompleted && !isAuthor && myRequest?.status === 'accepted' ? (
          <RateForm
            tenant={slug}
            rideId={rideId}
            ratee={ride.authorId}
            direction="of_driver"
            labels={{ heading: t('rides.rate.ofDriver'), ...rateLabels }}
          />
        ) : null}

        {actor && !isAuthor ? (
          <ReportButton
            tenant={slug}
            targetType="ride_post"
            targetId={rideId}
            labels={{
              button: t('rides.report.button'),
              heading: t('rides.report.heading'),
              reasonLabel: t('rides.report.reason'),
              reasonPlaceholder: t('rides.report.reasonPlaceholder'),
              noteLabel: t('rides.report.note'),
              noteHint: t('rides.report.noteHint'),
              submit: t('rides.report.submit'),
              submitting: t('rides.report.submitting'),
              done: t('rides.report.sent'),
              failed: t('rides.report.failed'),
            }}
          />
        ) : null}
      </div>
    </PageShell>
  );
}
