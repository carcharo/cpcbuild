/** <cb-card>: a titled panel (section with aria-labelledby); optionally collapsible like Section. A card never contains a card. */
import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { Icon } from './Icon';

export interface CardProps {
  title: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
  collapsible?: boolean;
  open?: boolean;
  onToggle?(open: boolean): void;
  id?: string;
}

export function Card({ title, actions, children, collapsible, open, onToggle, id }: CardProps) {
  const [own, setOwn] = useState(open ?? true);
  const isOpen = !collapsible || (open ?? own);
  const auto = useId();
  const base = id ?? auto;
  const titleId = `${base}-t`;
  const bodyId = `${base}-b`;
  return (
    <section class="cb-card" id={id} aria-labelledby={titleId}>
      <div class="cb-card-h">
        <h2 class="cb-label" id={titleId}>
          {collapsible ? (
            <button type="button" class="cb-card-toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => (onToggle ? onToggle(!isOpen) : setOwn(!isOpen))}>
              <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        {actions && <div class="cb-card-actions">{actions}</div>}
      </div>
      <div class="cb-card-body" id={bodyId} hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}
