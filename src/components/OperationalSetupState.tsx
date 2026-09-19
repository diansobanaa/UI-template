import { Building2, Sprout } from "lucide-react";
import { Link } from "react-router-dom";

export function OperationalSetupState({
  title,
  message,
  actionLabel = "Start Complex Setup",
}: {
  title: string;
  message: string;
  actionLabel?: string;
}) {
  return (
    <div className="min-h-screen bg-[#06131b] px-6 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <div className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
            {title.toLowerCase().includes("greenhouse") ? <Sprout className="h-7 w-7" /> : <Building2 className="h-7 w-7" />}
          </div>
          <h1 className="mt-5 text-xl font-bold text-white">{title}</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">{message}</p>
          <Link
            to="/onboarding/complex"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            {actionLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
