import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CardMetadataEditor from './CardMetadataEditor.svelte';

const labels = [
  { id: 1, title: 'Bug', color: 'ff0000' },
  { id: 2, title: 'Feature', color: '00ff00' },
];

const participants = [
  { id: 'alice', displayName: 'Alice', type: 0 },
  { id: 'bob', displayName: 'Bob', type: 0 },
];

function setup(props = {}) {
  const handlers = {
    onAssignLabel: vi.fn().mockResolvedValue({ ok: true }),
    onRemoveLabel: vi.fn().mockResolvedValue({ ok: true }),
    onAssignUser: vi.fn().mockResolvedValue({ ok: true }),
    onUnassignUser: vi.fn().mockResolvedValue({ ok: true }),
  };
  const card = { id: 10193, labels: [], assignedUsers: [], ...props.card };
  render(CardMetadataEditor, {
    props: { card, labels, participants, ...handlers, ...props },
  });
  return handlers;
}

const openLabels = () => fireEvent.click(screen.getByRole('button', { name: 'Edit labels' }));
const openMembers = () => fireEvent.click(screen.getByRole('button', { name: 'Edit members' }));

describe('CardMetadataEditor', () => {
  it('lists board labels as checkboxes reflecting the assigned state', async () => {
    setup({ card: { labels: [{ id: 1, title: 'Bug', color: 'ff0000' }] } });
    await openLabels();

    expect(screen.getByRole('checkbox', { name: /Bug/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Feature/ })).not.toBeChecked();
  });

  it('assigns an unassigned label', async () => {
    const { onAssignLabel, onRemoveLabel } = setup();
    await openLabels();

    await fireEvent.click(screen.getByRole('checkbox', { name: /Feature/ }));

    expect(onAssignLabel).toHaveBeenCalledWith(2);
    expect(onRemoveLabel).not.toHaveBeenCalled();
  });

  it('removes an already-assigned label', async () => {
    const { onAssignLabel, onRemoveLabel } = setup({
      card: { labels: [{ id: 1, title: 'Bug', color: 'ff0000' }] },
    });
    await openLabels();

    await fireEvent.click(screen.getByRole('checkbox', { name: /Bug/ }));

    expect(onRemoveLabel).toHaveBeenCalledWith(1);
    expect(onAssignLabel).not.toHaveBeenCalled();
  });

  it('never sends a duplicate assign while one is in flight', async () => {
    let release;
    const onAssignLabel = vi.fn(() => new Promise((r) => (release = r)));
    setup({ onAssignLabel });
    await openLabels();

    const option = screen.getByRole('checkbox', { name: /Feature/ });
    await fireEvent.click(option);
    await fireEvent.click(option);
    await fireEvent.click(option);

    expect(onAssignLabel).toHaveBeenCalledTimes(1);
    expect(option).toBeDisabled();
    release?.();
  });

  it('reads assignees from the nested participant shape', async () => {
    setup({
      card: {
        assignedUsers: [{ participant: { uid: 'alice', displayName: 'Alice' }, type: 0 }],
      },
    });
    await openMembers();

    expect(screen.getByRole('checkbox', { name: /Alice/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Bob/ })).not.toBeChecked();
  });

  it('assigns and unassigns a member with the participant type', async () => {
    const { onAssignUser } = setup();
    await openMembers();
    await fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));

    expect(onAssignUser).toHaveBeenCalledWith('bob', 0);
  });

  it('unassigns an already-assigned member', async () => {
    const { onUnassignUser, onAssignUser } = setup({
      card: { assignedUsers: [{ participant: { uid: 'alice', displayName: 'Alice' }, type: 0 }] },
    });
    await openMembers();

    await fireEvent.click(screen.getByRole('checkbox', { name: /Alice/ }));

    expect(onUnassignUser).toHaveBeenCalledWith('alice', 0);
    expect(onAssignUser).not.toHaveBeenCalled();
  });

  it('shows empty states when nothing is assigned', () => {
    setup();

    expect(screen.getByText('No labels')).toBeInTheDocument();
    expect(screen.getByText('No members')).toBeInTheDocument();
  });

  it('surfaces an assignment error', () => {
    setup({ error: 'User is not a member of the board' });

    expect(screen.getByRole('alert')).toHaveTextContent('User is not a member of the board');
  });

  it('renders label titles as text rather than markup', async () => {
    setup({ labels: [{ id: 3, title: '<img src=x>', color: 'ff0000' }] });
    await openLabels();

    const option = screen.getByRole('checkbox', { name: /img/ });
    expect(option.querySelector('img')).toBeNull();
    expect(option).toHaveTextContent('<img src=x>');
  });
});
