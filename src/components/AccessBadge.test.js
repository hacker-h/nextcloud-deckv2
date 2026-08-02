import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AccessBadge from './AccessBadge.svelte';

const cases = [
  ['manage', '★', 'Manage', 'Manage access — you can edit this board and change its settings'],
  ['edit', '✎', 'Edit', 'Edit access — you can edit cards on this board'],
  ['view', '👁', 'View', 'View access — read only'],
];

describe('AccessBadge', () => {
  it.each(cases)('renders distinct visible text for %s access', (level, _icon, text) => {
    render(AccessBadge, { props: { level } });

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each(cases)('renders a distinct icon glyph for %s access', (level, icon) => {
    const { container } = render(AccessBadge, { props: { level } });

    expect(container.querySelector('.icon')).toHaveTextContent(icon);
  });

  it.each(cases)('exposes level-specific aria-label and title for %s access', (level, _icon, _text, label) => {
    render(AccessBadge, { props: { level } });

    const badge = screen.getByLabelText(label);
    expect(badge).toHaveAttribute('title', label);
  });

  it('hides the icon from assistive technology', () => {
    const { container } = render(AccessBadge, { props: { level: 'manage' } });

    expect(container.querySelector('.icon')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([undefined, 'owner'])('falls back to the View badge for %s level', (level) => {
    render(AccessBadge, { props: { level } });

    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByLabelText('View access — read only')).toHaveAttribute('title', 'View access — read only');
  });
});
