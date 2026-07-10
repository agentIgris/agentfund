/**
 * components/EmptyState.tsx — reusable empty/error state. Every
 * data-driven page renders this when the API is unreachable or has
 * no rows yet, so the app never shows a blank screen or crash.
 */
export interface EmptyStateProps {
  icon?: string;
  title: string;
  message: string;
}

export function EmptyState({ icon = "✦", title, message }: EmptyStateProps) {
  return (
    <div className="af-card af-empty" role="status">
      <div className="af-empty__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="af-empty__title">{title}</div>
      <p className="af-empty__msg">{message}</p>
    </div>
  );
}
