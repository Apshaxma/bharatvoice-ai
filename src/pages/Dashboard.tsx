import { api } from "@/convex/_generated/api";
import { BharatVoiceMark } from "@/components/brand";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "convex/react";
import {
  Activity,
  LogOut,
  MessageSquareText,
  Mic2,
  ShieldCheck,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    to: "/dashboard",
    label: "Assistant",
    icon: Mic2,
    end: true,
  },
  {
    to: "/dashboard/history",
    label: "History",
    icon: MessageSquareText,
    end: false,
  },
  {
    to: "/dashboard/insights",
    label: "Insights",
    icon: Activity,
    end: false,
  },
  {
    to: "/dashboard/approvals",
    label: "Approvals",
    icon: ShieldCheck,
    end: false,
  },
];

export default function DashboardLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const pendingApprovals = useQuery(api.agentDb.listPendingApprovals);
  const pendingCount = pendingApprovals?.length ?? 0;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="lg:grid lg:min-h-screen lg:grid-cols-[250px_1fr]">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-0 hidden h-screen flex-col border-r border-border/70 bg-card/50 px-4 py-5 lg:flex">
          <NavLink
            to="/"
            className="mb-8 flex flex-col items-start px-2"
            aria-label="BharatVoice home"
          >
            <BharatVoiceMark />
          </NavLink>

          <nav className="flex flex-1 flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-saffron/10 text-saffron"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                <item.icon className="size-4" />
                {item.label}
                {item.label === "Approvals" && pendingCount > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-saffron px-1.5 text-[10px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-border/70 pt-4">
            <div className="flex items-center gap-2.5 px-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-saffron/15 text-sm font-bold text-saffron">
                {(user?.name ?? user?.email ?? "U").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">
                  {user?.name ?? "Guest user"}
                </p>
                <p className="truncate text-[10.5px] text-muted-foreground">
                  {user?.email ?? "anonymous session"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={handleSignOut}
                aria-label="Sign out"
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-h-screen flex-col">
          {/* Mobile header */}
          <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <NavLink to="/" aria-label="BharatVoice home">
                <BharatVoiceMark />
              </NavLink>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 text-muted-foreground hover:text-destructive"
                onClick={handleSignOut}
                aria-label="Sign out"
              >
                <LogOut className="size-4" />
              </Button>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-saffron/10 text-saffron"
                        : "text-muted-foreground hover:bg-muted",
                    )
                  }
                >
                  <item.icon className="size-3.5" />
                  {item.label}
                  {item.label === "Approvals" && pendingCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-saffron px-1 text-[9px] font-bold text-white">
                      {pendingCount}
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>
          </header>

          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto h-full w-full max-w-6xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
