import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import BoardApp from './BoardApp.svelte';

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const manageBoard = {
  id: 1,
  title: 'Manage board',
  color: '0055cc',
  archived: false,
  deletedAt: 0,
  order: 0,
  permissions: { PERMISSION_EDIT: true, PERMISSION_MANAGE: true },
};

const editBoard = {
  ...manageBoard,
  permissions: { PERMISSION_EDIT: true, PERMISSION_MANAGE: false },
};

function mockBoardFetch(board) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (String(url).endsWith('/boards')) return Promise.resolve(json([board]));
    if (String(url).endsWith(`/boards/${board.id}/stacks`)) return Promise.resolve(json([]));
    return Promise.resolve(json({}));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BoardApp account header', () => {
  it('renders the signed-in user in the header', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));

    render(BoardApp, { props: { currentUser: 'alice' } });

    expect(screen.getByLabelText('Signed in as alice')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('renders the build SHA badge in the header', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));

    render(BoardApp, { props: { currentUser: 'alice' } });

    // A blank or 'unknown' badge is the failure this feature exists to catch,
    // so assert the shape rather than merely that the element rendered.
    expect(__BUILD_SHA__).toMatch(/^[0-9a-f]{7,40}$/);
    expect(screen.getByText(__BUILD_SHA__)).toHaveAttribute('title', __BUILD_TIME__);
  });

  it('calls onSignOut exactly once from the header control', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(BoardApp, { props: { currentUser: 'alice', onSignOut } });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('renders the current board access badge in the header', async () => {
    mockBoardFetch(manageBoard);

    render(BoardApp, { props: { currentUser: 'alice' } });

    expect(await screen.findByText('Manage board')).toBeInTheDocument();
    expect(screen.getByText('Manage')).toBeInTheDocument();
  });

  it('updates the header badge when server permissions change on rerender', async () => {
    const fetch = mockBoardFetch(manageBoard);
    const view = render(BoardApp, { props: { currentUser: 'alice' } });

    expect(await screen.findByText('Manage')).toBeInTheDocument();

    fetch.mockRestore();
    mockBoardFetch(editBoard);
    view.unmount();
    render(BoardApp, { props: { currentUser: 'alice' } });

    await waitFor(() => expect(screen.queryByText('Manage')).not.toBeInTheDocument());
    expect(await screen.findByText('Edit')).toBeInTheDocument();
  });
});
