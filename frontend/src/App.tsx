import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";

import PricingPage from "./pages/PricingPage";
import PaymentCallbackPage from "./pages/PaymentCallbackPage";
import TrialCallbackPage from "./pages/TrialCallbackPage";
import VideoAddOnPage from "./pages/VideoAddOnPage";
import SubscriptionPage from "./pages/SubscriptionPage";
import "./App.css";

function App() {
  // Temporary test user.
  // This will later come from the real authentication system.
  const userId = 1;
  const email = "test@example.com";

  return (
    <BrowserRouter>

<nav className="payment-nav">
  <a href="/">Plans</a>

  <a href="/subscription">
    My Subscription
  </a>

  <a href="/video-addon">
    AI Video
  </a>
</nav>







      <Routes>
        <Route
          path="/"
          element={
            <PricingPage
              userId={userId}
              email={email}
            />
          }
        />

        <Route
          path="/payment/callback"
          element={
            <PaymentCallbackPage />
          }
        />

        <Route
          path="/payment/trial-callback"
          element={
            <TrialCallbackPage />
          }
        />

       <Route
  path="/video-addon"
  element={
    <VideoAddOnPage
      userId={userId}
      email={email}
    />
  }
/>

<Route
  path="/subscription"
  element={
    <SubscriptionPage
      userId={userId}
    />
  }
/>


      </Routes>
    </BrowserRouter>
  );
}

export default App;