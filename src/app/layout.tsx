import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { ConnectionMonitor } from "@/components/ConnectionMonitor";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConnectionMonitor />
      {children}
    </ToastProvider>
  );
}
