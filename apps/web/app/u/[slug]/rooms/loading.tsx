import { DirectorySkeleton } from '@/app/_components/profile/directory-skeleton';

// Scoped to this route on purpose. A loading boundary commits a 200 as soon as
// it streams, so it must not sit over a route that can still decide to 404. This
// directory cannot: the tenant is already resolved by the layout, and an unknown
// id is a concern of the profile pages, which deliberately have no boundary.
export default function Loading() {
  return <DirectorySkeleton />;
}
