// Public surface of @campusos/db. The raw client is intentionally NOT exported
// here — it lives at '@campusos/db/client' and is banned from app code.
export * from './schema/index';
export * from './repositories/index';
export {
  withActor,
  withActorInTenant,
  withGrantedTenant,
  withPlatformGrant,
  withTenant,
  type PlatformGrant,
  type TenantTransaction,
} from './tenant-context';
