import type { ReactNode } from "react";

interface PricingCardProps {
  name: string;
  price: number;
  description: string;
  features: string[];
  action: ReactNode;
  highlighted?: boolean;
}

function PricingCard({
  name,
  price,
  description,
  features,
  action,
  highlighted = false,
}: PricingCardProps) {
  return (
    <article
      className={`pricing-card ${
        highlighted
          ? "pricing-card-highlighted"
          : ""
      }`}
    >
      {highlighted && (
        <span className="pricing-badge">
          Most Popular
        </span>
      )}

      <h2>{name}</h2>

      <div className="pricing-price">
        <span>R{price}</span>
        <small>/month</small>
      </div>

      <p>{description}</p>

      <ul>
        {features.map((feature) => (
          <li key={feature}>
            ✓ {feature}
          </li>
        ))}
      </ul>

      <div className="pricing-action">
        {action}
      </div>
    </article>
  );
}

export default PricingCard;