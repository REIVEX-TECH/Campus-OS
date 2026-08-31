import { Badge, Button, Card, Field, Input, Label, Select } from '@campusos/ui';
import { requireAdmin } from '@/lib/admin-auth';
import { getAdminRooms } from '@/lib/admin-rooms';
import { translator } from '@/lib/i18n';
import { requireTenant } from '@/lib/timetable';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ resolved?: string; name?: string; error?: string }>;
};

export default async function AdminRoomsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  await requireAdmin(slug);

  const repo = getAdminRooms(slug);
  const [pending, rooms] = await Promise.all([repo.listPendingRooms(), repo.listRooms()]);
  const resolvedCount = sp.resolved ? Number(sp.resolved) : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{t('admin.rooms.heading')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('admin.rooms.intro')}</p>
        </div>
        <form method="post" action={`/u/${slug}/admin/logout`}>
          <Button type="submit" variant="ghost" size="sm">
            {t('admin.rooms.signOut')}
          </Button>
        </form>
      </header>

      {resolvedCount !== null && sp.name ? (
        <p className="rounded-md bg-surface p-4 text-sm text-surface-foreground">
          {t('admin.rooms.resolved', { count: resolvedCount, name: sp.name })}
        </p>
      ) : null}
      {sp.error ? (
        <p className="rounded-md bg-surface p-4 text-sm text-destructive">
          {t('admin.rooms.error')}
        </p>
      ) : null}

      {pending.length === 0 ? (
        <Card className="p-8 text-center text-sm">{t('admin.rooms.none')}</Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {pending.map((room, i) => (
            <li key={room.rawValue}>
              <Card className="flex flex-col gap-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('admin.rooms.sourceName')}
                    </p>
                    <p className="text-base font-medium">{room.rawValue}</p>
                  </div>
                  <Badge variant="warning">
                    {t('admin.rooms.blocked', { count: room.blockedEntries })}
                  </Badge>
                </div>

                <form
                  method="post"
                  action={`/u/${slug}/admin/rooms/resolve`}
                  className="flex flex-col gap-3"
                >
                  <input type="hidden" name="rawValue" value={room.rawValue} />
                  <fieldset className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        id={`mode-new-${i}`}
                        name="mode"
                        value="new"
                        defaultChecked
                      />
                      <Label htmlFor={`mode-new-${i}`}>{t('admin.rooms.modeNew')}</Label>
                    </div>
                    <Field label={t('admin.rooms.newRoomLabel')} htmlFor={`new-${i}`}>
                      <Input id={`new-${i}`} name="newRoomName" defaultValue={room.rawValue} />
                    </Field>

                    {rooms.length > 0 ? (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            id={`mode-existing-${i}`}
                            name="mode"
                            value="existing"
                          />
                          <Label htmlFor={`mode-existing-${i}`}>
                            {t('admin.rooms.modeExisting')}
                          </Label>
                        </div>
                        <Field label={t('admin.rooms.existingRoomLabel')} htmlFor={`existing-${i}`}>
                          <Select id={`existing-${i}`} name="existingRoomId" defaultValue="">
                            <option value="" disabled>
                              {t('admin.rooms.selectRoom')}
                            </option>
                            {rooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </>
                    ) : null}
                  </fieldset>

                  <div>
                    <Button type="submit" size="sm">
                      {t('admin.rooms.resolve')}
                    </Button>
                  </div>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
