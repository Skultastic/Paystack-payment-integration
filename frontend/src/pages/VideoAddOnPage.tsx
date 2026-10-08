import PaymentButton from "../components/PaymentButton";

interface VideoAddOnPageProps {
  userId: number;
  email: string;
}

function VideoAddOnPage({
  userId,
  email,
}: VideoAddOnPageProps) {
  return (
    <main className="video-addon-page">
      <section className="video-addon-card">
        <div className="video-addon-content">
          <span className="video-addon-label">
            AI VIDEO
          </span>

          <h1>
            Create an AI Video Book
          </h1>

          <p>
            Turn your child's story into
            an engaging AI-powered video.
          </p>

          <div className="video-addon-price">
            <span>R100</span>
            <small>once-off</small>
          </div>

          <ul className="video-addon-features">
            <li>
              ✓ One additional AI video
            </li>

            <li>
              ✓ Once-off payment
            </li>

            <li>
              ✓ No monthly subscription
            </li>

            <li>
              ✓ Secure Paystack checkout
            </li>
          </ul>

          <PaymentButton
            userId={userId}
            email={email}
            planId={3}
            mode="payment"
          >
            Buy AI Video — R100
          </PaymentButton>
        </div>
      </section>
    </main>
  );
}

export default VideoAddOnPage;