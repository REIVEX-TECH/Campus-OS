import { Button } from '@campusos/ui';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Campus OS</h1>
      <p className="text-muted-foreground max-w-prose">
        A multi-tenant, open-source campus platform. Tenants resolve by subdomain (
        <code>{'{slug}'}.localhost:3000</code>) or by the <code>/u/&#123;slug&#125;</code> path.
      </p>
      <Button>Get started</Button>
    </main>
  );
}
