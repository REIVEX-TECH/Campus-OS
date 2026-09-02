import {
  Calendar,
  Car,
  DoorOpen,
  Map,
  MessageCircle,
  PackageSearch,
  Search,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleIconName } from '@/lib/modules';

/**
 * The one place that maps a module's icon name (a stable string, safe to cross
 * the server/client boundary) to a lucide line icon. Used by both the sidebar
 * and the module hub so every surface renders the same glyph at the same weight.
 * Icons inherit `currentColor` and the caller's size, so they theme in light and
 * dark with no per-icon styling.
 */
const ICONS: Record<ModuleIconName, LucideIcon> = {
  calendar: Calendar,
  'door-open': DoorOpen,
  search: Search,
  'shopping-bag': ShoppingBag,
  'message-circle': MessageCircle,
  'package-search': PackageSearch,
  car: Car,
  map: Map,
};

export function ModuleIcon({ name, className }: { name: ModuleIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} strokeWidth={2} aria-hidden="true" />;
}
