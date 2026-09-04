export type RoleItem = { key: string; name: string; isSystem: boolean; permissions: string[] };

export type RoleListLabels = {
  builtIn: string;
  permissions: string;
  none: string;
  definitionNote: string;
};

/**
 * The roles this university has, and what each may do. Read only.
 *
 * Which roles exist and what they carry is a platform level definition, so
 * there is nothing to save here: a tenant administrator reads this page to know
 * what a role means before granting it on the members page.
 */
export function RoleList({
  roles,
  permissionLabels,
  labels,
}: {
  roles: RoleItem[];
  permissionLabels: Record<string, string>;
  labels: RoleListLabels;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-sm text-muted-foreground">{labels.definitionNote}</p>
      {roles.map((role) => (
        <article key={role.key} className="ios-card flex flex-col gap-3 rounded-2xl p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold">{role.name}</h3>
            {role.isSystem ? (
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {labels.builtIn}
              </span>
            ) : (
              <code className="text-xs text-muted-foreground">{role.key}</code>
            )}
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label={labels.permissions}>
            {role.permissions.length === 0 ? (
              <li className="text-xs text-muted-foreground">{labels.none}</li>
            ) : null}
            {role.permissions.map((p) => (
              <li key={p} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                {permissionLabels[p] ?? p}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
