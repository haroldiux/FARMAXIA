import type { ReactNode } from "react";

export type NavIconName = "overview" | "catalog" | "inventory" | "report" | "procurement" | "transfer" | "cash" | "sales" | "audit" | "billing" | "tenants" | "plans" | "users" | "account" | "logout" | "menu" | "close" | "collapse" | "search" | "bell" | "chevron" | "sun" | "moon" | "trend" | "alert" | "controlled" | "staff" | "customers";

// Trazos inline (24×24, currentColor) para no añadir una librería de iconos.
const paths: Record<NavIconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>,
  catalog: <><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" /></>,
  inventory: <><path d="M21 8 12 3 3 8v8l9 5 9-5Z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></>,
  report: <><path d="M3 3v18h18" /><path d="M7 16v-4" /><path d="M12 16V8" /><path d="M17 16v-7" /></>,
  procurement: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2.5 3h2.6l2.5 12.2a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 2-1.5L21.5 8H6" /></>,
  transfer: <><path d="M3 8h13" /><path d="m13 4 4 4-4 4" /><path d="M21 16H8" /><path d="m11 12-4 4 4 4" /></>,
  cash: <><rect x="2.5" y="6" width="19" height="13" rx="2.5" /><circle cx="12" cy="12.5" r="2.5" /><path d="M6 10v.01M18 15v.01" /></>,
  sales: <><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2Z" /><path d="M9 8h6M9 12h6" /></>,
  audit: <><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z" /><path d="m9 12 2 2 4-4" /></>,
  billing: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /><path d="M6.5 15h4" /></>,
  tenants: <><path d="M4 21V7l8-4 8 4v14" /><path d="M9 21v-5h6v5" /><path d="M9 10h.01M15 10h.01" /></>,
  plans: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18.5 14.8c1.6.8 2.6 2.6 3 5.2" /></>,
  account: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.2-6.5 8-6.5s7 2.5 8 6.5" /></>,
  logout: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17-5-5 5-5" /><path d="M5 12h11" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  chevron: <><path d="m6 9 6 6 6-6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
  moon: <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></>,
  trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  controlled: <><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M9 8h6M9 12h6" /><path d="M9 16h3" /><path d="M15.5 15.5v3M14 17h3" /></>,
  customers: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="11" r="2.2" /><path d="M5.5 17c.5-2 1.9-3 3.5-3s3 1 3.5 3" /><path d="M15 9h3M15 12h3" /></>,
  staff: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  collapse: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /><path d="m15 10-2 2 2 2" /></>
};

export function NavIcon({ name }: Readonly<{ name: NavIconName }>) {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      {paths[name]}
    </svg>
  );
}
