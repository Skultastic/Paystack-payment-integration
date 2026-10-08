import PricingCard from "../components/PricingCard";
import PaymentButton from "../components/PaymentButton";

interface PricingPageProps {
  userId: number;
  email: string;
}

function PricingPage({
  userId,
  email,
}: PricingPageProps) {
  return (
    <main className="pricing-page">
      <header className="pricing-header">
        <h1>Choose your plan</h1>

        <p>
          Give your child access to
          engaging stories and learning
          experiences.
        </p>
      </header>

      <section className="pricing-grid">
        <PricingCard
          name="Standard"
          price={99}
          description="Everything you need to get started."
          features={[
            "30 stories per month",
            "5 family characters",
            "All languages",
            "PDF downloads",
            "No AI video",
          ]}
          action={
            <PaymentButton
              userId={userId}
              email={email}
              planId={1}
              mode="trial"
            >
              Start 3-Day Free Trial
            </PaymentButton>
          }
        />

        <PricingCard
          name="Premium"
          price={150}
          description="More characters and your first AI video."
          features={[
            "30 stories per month",
            "10 family characters",
            "All languages",
            "PDF downloads",
            "1 complimentary AI video",
            "Priority queue",
          ]}
          highlighted
          action={
            <PaymentButton
              userId={userId}
              email={email}
              planId={2}
              mode="trial"
            >
              Start 3-Day Free Trial
            </PaymentButton>
          }
        />
      </section>
    </main>
  );
}

export default PricingPage;