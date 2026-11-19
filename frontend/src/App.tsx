import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthProvider, RequireAuth } from './components/auth';
import { UiProvider } from './components/ui';
import { LoginPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { AgreementsPage } from './pages/Agreements';
import { SendPage } from './pages/Send';
import { SignDocumentPage } from './pages/SignDocument';
import { PreparePage } from './pages/Prepare';
import { DetailsPage } from './pages/Details';
import { SignPage } from './pages/Sign';
import { ApprovePage } from './pages/Approve';
import { TemplatesPage } from './pages/Templates';
import { ReportsPage } from './pages/Reports';
import { AdminPage } from './pages/Admin';

export default function App() {
  return (
    <BrowserRouter>
      <UiProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* public link pages: no app shell */}
            <Route path="/sign/:token" element={<SignPage />} />
            <Route path="/approve/:token" element={<ApprovePage />} />
            {/* full-screen editor */}
            <Route path="/envelopes/:id/prepare" element={<RequireAuth><PreparePage /></RequireAuth>} />
            <Route element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route index element={<HomePage />} />
              <Route path="agreements/:folder?" element={<AgreementsPage />} />
              <Route path="send" element={<SendPage />} />
              <Route path="sign-document" element={<SignDocumentPage />} />
              <Route path="envelopes/:id" element={<DetailsPage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="admin" element={<AdminPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </UiProvider>
    </BrowserRouter>
  );
}
