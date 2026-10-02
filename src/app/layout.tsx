import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { ConnectionMonitor } from "@/components/ConnectionMonitor";
import { AlarmManagerOverlay } from "@/components/AlarmManagerOverlay";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConnectionMonitor />
      <AlarmManagerOverlay />
      {children}
    </ToastProvider>
  );
}

