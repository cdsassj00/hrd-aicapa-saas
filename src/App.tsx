import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FullscreenLoader } from "@/components/FullscreenLoader";
import LoginPage from "@/pages/LoginPage";
import AuthCallback from "@/pages/AuthCallback";
import ApplicantMyPage from "@/pages/applicant/ApplicantMyPage";
import WaitingRoom from "@/pages/applicant/WaitingRoom";
import ExamPage from "@/pages/applicant/ExamPage";
import SubmittedPage from "@/pages/applicant/SubmittedPage";
import ResultsPage from "@/pages/applicant/ResultsPage";
import MonitorDashboard from "@/pages/examiner/MonitorDashboard";
import EventLogPage from "@/pages/examiner/EventLogPage";
import ExamManagePage from "@/pages/admin/ExamManagePage";
import QuestionBankPage from "@/pages/admin/QuestionBankPage";
import GradingPage from "@/pages/admin/GradingPage";
import CertificationsPage from "@/pages/admin/CertificationsPage";
import StatsPage from "@/pages/admin/StatsPage";
import UserManagePage from "@/pages/admin/UserManagePage";
import SettingsPage from "@/pages/admin/SettingsPage";
import FaceppTestPage from "@/pages/admin/FaceppTestPage";
import RecordingReviewPage from "@/pages/admin/RecordingReviewPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import NotFound from "@/pages/NotFound";
import OAuthConsent from "@/pages/OAuthConsent";

const queryClient = new QueryClient();

const routes = {
  applicant: '/applicant',
  examiner: '/examiner/monitor',
  admin: '/admin/exams',
  viewer: '/admin/certifications',
} as const;

function HomeRedirect() {
  const { user, role, loading } = useAuth();

  if (loading) return <FullscreenLoader message="세션 확인 중..." />;
  if (!user) return <Navigate to="/login" replace />;

  return <Navigate to={routes[role] || '/applicant'} replace />;
}

/** Routes always render; per-route guards handle loading state to avoid a
 *  top-level blank screen that the preview iframe mistakes for a blank page
 *  and reloads, causing login/dashboard flicker. */
function AuthGate() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
      <Route path="/" element={<HomeRedirect />} />
      <Route element={<DashboardLayout />}>
        {/* 응시자 */}
        <Route path="/applicant" element={<ProtectedRoute allowedRoles={['applicant', 'admin']}><ApplicantMyPage /></ProtectedRoute>} />
        <Route path="/applicant/waiting-room/:sessionId" element={<ProtectedRoute allowedRoles={['applicant', 'admin']}><WaitingRoom /></ProtectedRoute>} />
        <Route path="/applicant/exam/:sessionId" element={<ProtectedRoute allowedRoles={['applicant', 'admin']}><ExamPage /></ProtectedRoute>} />
        <Route path="/applicant/submitted/:sessionId?" element={<ProtectedRoute allowedRoles={['applicant', 'admin']}><SubmittedPage /></ProtectedRoute>} />
        <Route path="/applicant/results/:sessionId" element={<ProtectedRoute allowedRoles={['applicant', 'admin']}><ResultsPage /></ProtectedRoute>} />
        {/* 감독관 */}
        <Route path="/examiner/monitor" element={<ProtectedRoute allowedRoles={['examiner', 'admin']}><MonitorDashboard /></ProtectedRoute>} />
        <Route path="/examiner/events" element={<ProtectedRoute allowedRoles={['examiner', 'admin']}><EventLogPage /></ProtectedRoute>} />
        {/* 관리자 */}
        <Route path="/admin/exams" element={<ProtectedRoute allowedRoles={['admin']}><ExamManagePage /></ProtectedRoute>} />
        <Route path="/admin/questions" element={<ProtectedRoute allowedRoles={['admin']}><QuestionBankPage /></ProtectedRoute>} />
        <Route path="/admin/grading" element={<ProtectedRoute allowedRoles={['admin']}><GradingPage /></ProtectedRoute>} />
        <Route path="/admin/certifications" element={<ProtectedRoute allowedRoles={['admin', 'viewer']}><CertificationsPage /></ProtectedRoute>} />
        <Route path="/admin/stats" element={<ProtectedRoute allowedRoles={['admin', 'viewer']}><StatsPage /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute allowedRoles={['admin']}><UserManagePage /></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute allowedRoles={['admin']}><SettingsPage /></ProtectedRoute>} />
        <Route path="/admin/recordings" element={<ProtectedRoute allowedRoles={['admin']}><RecordingReviewPage /></ProtectedRoute>} />
        <Route path="/admin/facepp-test" element={<ProtectedRoute allowedRoles={['admin']}><FaceppTestPage /></ProtectedRoute>} />
        <Route path="/admin/facepptest" element={<ProtectedRoute allowedRoles={['admin']}><FaceppTestPage /></ProtectedRoute>} />
        <Route path="/admin/faceapptest" element={<ProtectedRoute allowedRoles={['admin']}><FaceppTestPage /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthGate />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
