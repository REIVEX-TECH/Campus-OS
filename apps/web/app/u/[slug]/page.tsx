import { notFound } from 'next/navigation';
import { Button } from '@campusos/ui';
import { tenantRegistry } from '@campusos/tenants';

export function generateStaticParams(): Array<{ slug: string }> {
  return tenantRegistry.all().map((tenant) => ({ slug: tenant.slug }));
}

type Params = { params: Promise<{ slug: string }> };

export default async function TenantHome({ params }: Params) {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{tenant.displayName}</h1>
      <p className="text-muted-foreground max-w-prose">{tenant.seo.description}</p>
      <Button>View timetable</Button>
    </main>
  );
}
