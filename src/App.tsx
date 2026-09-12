import { Route, Routes } from "react-router-dom";
import RootLayout from "@/app/layout";
import Home from "@/app/page";
import CalibrationPage from "@/app/calibration/page";
import ComplexOverviewPage from "@/app/complex/page";
import DashboardPage from "@/app/dashboard/page";
import EventsPage from "@/app/events/page";
import FertigationPage from "@/app/fertigation/page";
import GreenhousePage from "@/app/greenhouse/[ghId]/page";
import SchedulePage from "@/app/schedule/page";

export default function App() {
  return (
    <RootLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/complex" element={<ComplexOverviewPage />} />
        <Route path="/greenhouse" element={<DashboardPage />} />
        <Route path="/greenhouse/:ghId" element={<GreenhousePage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/fertigation" element={<FertigationPage />} />
        <Route path="/calibration" element={<CalibrationPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </RootLayout>
  );
}
