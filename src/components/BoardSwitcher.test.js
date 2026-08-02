import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import BoardSwitcher from './BoardSwitcher.svelte';

const boards = [
  {
    id: 1,
    title: 'Manage board',
    color: '0055cc',
    permissions: { PERMISSION_EDIT: true, PERMISSION_MANAGE: true },
  },
  {
    id: 2,
    title: 'Edit board',
    color: '00aa55',
    permissions: { PERMISSION_EDIT: true, PERMISSION_MANAGE: false },
  },
];

describe('BoardSwitcher access badges', () => {
  it('renders different row badges from each board permission level', async () => {
    render(BoardSwitcher, { props: { boards, current: boards[0], onselect: vi.fn() } });

    await userEvent.click(screen.getByRole('button', { name: /Manage board/ }));

    const rows = screen.getByRole('list');
    const manageRow = within(rows).getByRole('button', { name: /Manage board/ });
    const editRow = within(rows).getByRole('button', { name: /Edit board/ });

    expect(within(manageRow).getByText('Manage')).toBeInTheDocument();
    expect(within(editRow).getByText('Edit')).toBeInTheDocument();
    expect(within(editRow).queryByText('Manage')).not.toBeInTheDocument();
  });

  it('places the badge after the board label in DOM order', async () => {
    render(BoardSwitcher, { props: { boards, current: boards[0], onselect: vi.fn() } });

    await userEvent.click(screen.getByRole('button', { name: /Manage board/ }));

    const row = within(screen.getByRole('list')).getByRole('button', { name: /Manage board/ });
    const label = row.querySelector('.label');
    const badge = row.querySelector('.access .badge');

    expect(label).toHaveTextContent('Manage board');
    expect(badge).toHaveTextContent('Manage');
    expect(label.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
