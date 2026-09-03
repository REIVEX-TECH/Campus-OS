import Link from 'next/link';
import { Button, Card, Field, Input } from '@campusos/ui';
import { getAdminRooms } from '@/lib/admin-rooms';
import { SignOutButton } from '@/app/_components/sign-out-button';
import { requireTenantAdmin } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ renamed?: string; renamedBuilding?: string; error?: string }>;
};

export default async function AdminRoomsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  await requireTenantAdmin(slug);
  const base = await tenantBase(slug);

  const admin = getAdminRooms(slug);
  const [rooms, buildingsList] = await Promise.all([admin.listRooms(), admin.listBuildings()]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('admin.rooms.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('admin.rooms.intro')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`${base}/admin/verification`}
            className="ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {t('admin.nav.verification')}
          </Link>
          <Link
            href={`${base}/admin/analytics`}
            className="ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {t('admin.nav.analytics')}
          </Link>
          <SignOutButton
            label={t('admin.rooms.signOut')}
            working={t('signin.signingOut')}
            redirectTo={base || '/'}
          />
        </div>
      </header>

      {sp.renamed ? (
        <p className="rounded-xl bg-surface p-4 text-sm text-surface-foreground">
          {t('admin.rooms.renamed', { name: sp.renamed })}
        </p>
      ) : null}
      {sp.renamedBuilding ? (
        <p className="rounded-xl bg-surface p-4 text-sm text-surface-foreground">
          {t('admin.rooms.renamedBuilding', { name: sp.renamedBuilding })}
        </p>
      ) : null}
      {sp.error ? (
        <p className="rounded-xl bg-surface p-4 text-sm text-destructive">
          {t('admin.rooms.error')}
        </p>
      ) : null}

      {buildingsList.length > 0 ? (
        <section aria-labelledby="admin-buildings" className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5 px-1">
            <h2 id="admin-buildings" className="text-base font-semibold">
              {t('admin.rooms.buildings')}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t('admin.rooms.buildingsIntro')}
            </p>
          </div>
          <Card className="flex flex-col gap-4 p-4">
            <ul className="flex flex-col gap-4">
              {buildingsList.map((b) => (
                <li key={b.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-semibold">
                      {b.name}
                      {b.code && b.code !== b.name ? (
                        <span className="ml-2 text-xs font-medium text-muted-foreground">
                          {b.code}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('admin.rooms.buildingMeta', { count: b.roomCount })}
                    </span>
                  </div>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-primary">
                      {t('admin.rooms.rename')}
                    </summary>
                    <form
                      method="post"
                      action={`${base}/admin/rooms/buildings/rename`}
                      className="mt-2 flex items-end gap-2"
                    >
                      <input type="hidden" name="buildingId" value={b.id} />
                      <Field label={t('admin.rooms.buildingName')} htmlFor={`bname-${b.id}`}>
                        <Input id={`bname-${b.id}`} name="name" defaultValue={b.name} required />
                      </Field>
                      <Button type="submit" variant="outline" size="sm">
                        {t('admin.rooms.rename')}
                      </Button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      {rooms.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {t('admin.rooms.none')}
        </Card>
      ) : (
        <Card className="flex flex-col gap-5 p-4">
          <ul className="flex flex-col gap-5">
            {rooms.map((room) => (
              <li key={room.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-semibold">{room.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {t('admin.rooms.meta', { building: room.buildingName, count: room.entryCount })}
                    {room.capacity != null
                      ? `, ${t('admin.rooms.capacity', { count: room.capacity })}`
                      : ''}
                  </span>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-primary">
                    {t('admin.rooms.rename')}
                  </summary>
                  <form
                    method="post"
                    action={`${base}/admin/rooms/rename`}
                    className="mt-2 flex items-end gap-2"
                  >
                    <input type="hidden" name="roomId" value={room.id} />
                    <Field label={t('admin.rooms.renameLabel')} htmlFor={`name-${room.id}`}>
                      <Input id={`name-${room.id}`} name="name" defaultValue={room.name} required />
                    </Field>
                    <Button type="submit" variant="outline" size="sm">
                      {t('admin.rooms.rename')}
                    </Button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
