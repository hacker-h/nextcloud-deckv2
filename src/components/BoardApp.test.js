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
    if (String(url).includes('/boards?')) return Promise.resolve(json([board]));
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

    expect(screen.getByLabelText('Angemeldet als alice')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('renders the build SHA badge in the header', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));

    render(BoardApp, { props: { currentUser: 'alice' } });

    // A blank or 'unknown' badge is the failure this feature exists to catch,
    // so assert the shape rather than merely that the element rendered.
    expect(__BUILD_SHA__).toMatch(/^[0-9a-f]{7,40}$/);
    expect(screen.getByText(new RegExp(__BUILD_SHA__))).toHaveAttribute('title', expect.stringContaining(__BUILD_TIME__));
  });

  it('calls onSignOut exactly once from the header control', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(BoardApp, { props: { currentUser: 'alice', onSignOut } });

    await user.click(screen.getByRole('button', { name: 'Abmelden' }));

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

describe('BoardApp preload progress', () => {
  // Three boards means two background preloads behind the active one; holding
  // the second open keeps the indicator on screen long enough to assert it.
  function mockSlowPreload() {
    const boards = [1, 2, 3].map((id) => ({ ...manageBoard, id, title: `Board ${id}` }));
    let releaseLast = () => {};
    const held = new Promise((resolve) => { releaseLast = () => resolve(json([])); });
    let stackRequests = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/boards?')) return Promise.resolve(json(boards));
      if (/\/boards\/\d+\/stacks$/.test(String(url))) {
        stackRequests += 1;
        return stackRequests > 2 ? held : Promise.resolve(json([]));
      }
      return Promise.resolve(json({}));
    });

    return { releaseLast };
  }

  it('shows background preload progress and hides it once the queue drains', async () => {
    const { releaseLast } = mockSlowPreload();

    render(BoardApp, { props: { currentUser: 'alice' } });

    // The bar appears at 0/2 the moment the queue is known, then counts up.
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '1'));
    expect(bar).toHaveAttribute('aria-valuetext', '1 von 2 Boards geladen');
    expect(screen.getByText('1/2')).toBeInTheDocument();

    releaseLast();

    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('renders no progress indicator when there is nothing to preload', async () => {
    mockBoardFetch(manageBoard);

    render(BoardApp, { props: { currentUser: 'alice' } });

    expect(await screen.findByText('Manage board')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });
});
