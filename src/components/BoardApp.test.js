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

describe('BoardApp load progress', () => {
  // Three boards means two background preloads behind the active one; holding
  // the last open keeps the aggregate indicator on screen long enough to assert.
  function mockSlowPreload({ holdActive = false } = {}) {
    const boards = [1, 2, 3].map((id) => ({ ...manageBoard, id, title: `Board ${id}` }));
    let releaseLast = () => {};
    const held = new Promise((resolve) => { releaseLast = () => resolve(json([{ id: 9, cards: [{ id: 91 }, { id: 92 }] }])); });
    let stackRequests = 0;
    const threshold = holdActive ? 0 : 2;

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/boards?')) return Promise.resolve(json(boards));
      if (/\/boards\/\d+\/stacks$/.test(String(url))) {
        stackRequests += 1;
        return stackRequests > threshold ? held : Promise.resolve(json([{ id: 8, cards: [{ id: 81 }] }]));
      }
      return Promise.resolve(json({}));
    });

    return { releaseLast };
  }

  const aggregate = () => screen.getByRole('progressbar', { name: 'Ladefortschritt aller Boards' });

  it('reports the active board by name while it is still loading', async () => {
    const { releaseLast } = mockSlowPreload({ holdActive: true });

    render(BoardApp, { props: { currentUser: 'alice' } });

    // The gap this closes: previously the app rendered bare skeletons here and
    // said nothing at all about what it was fetching.
    // The same bar covers the board-list phase first ("Boardliste wird
    // geladen"), then names the board once there is one to name.
    const bar = await screen.findByRole('progressbar', { name: 'Ladefortschritt des aktuellen Boards' });
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuetext', expect.stringContaining('Board 1')));
    // Indeterminate: Deck returns a board's stacks in one request, so there is
    // no honest fraction to report for the active board.
    expect(bar).not.toHaveAttribute('aria-valuenow');

    releaseLast();

    await waitFor(() =>
      expect(screen.queryByRole('progressbar', { name: 'Ladefortschritt des aktuellen Boards' })).not.toBeInTheDocument()
    );
  });

  it('counts all boards in the topbar and hides the bar once the queue drains', async () => {
    const { releaseLast } = mockSlowPreload();

    render(BoardApp, { props: { currentUser: 'alice' } });

    // Rendered from the first frame, before the board list has arrived, so the
    // total starts unknown and fills in - never a silent shell.
    const bar = await screen.findByRole('progressbar', { name: 'Ladefortschritt aller Boards' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    // Three boards: the active one plus the two behind it.
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuemax', '3'));
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '2'));
    expect(bar).toHaveAttribute('aria-valuetext', '2 von 3 Boards geladen');
    expect(screen.getByText('2/3')).toBeInTheDocument();

    releaseLast();

    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('reveals loaded card and list counts on hover', async () => {
    mockSlowPreload();
    const user = userEvent.setup();

    render(BoardApp, { props: { currentUser: 'alice' } });

    const bar = await screen.findByRole('progressbar', { name: 'Ladefortschritt aller Boards' });
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '2'));

    await user.hover(aggregate());

    const tip = await screen.findByRole('tooltip');
    expect(tip).toBeVisible();
    expect(tip).toHaveTextContent('Boards geladen');
    // A running total, not a fraction: `details=1` carries no card counts, so
    // the denominator is genuinely unknown until every board has arrived.
    expect(tip).toHaveTextContent('Karten geladen');
    expect(tip).toHaveTextContent('Listen geladen');

    await user.unhover(aggregate());
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('renders no progress indicator when there is nothing left to load', async () => {
    mockBoardFetch(manageBoard);

    render(BoardApp, { props: { currentUser: 'alice' } });

    expect(await screen.findByText('Manage board')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });
});
