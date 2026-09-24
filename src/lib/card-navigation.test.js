import { afterEach, expect, it, vi } from 'vitest';
import { cardHash, createCardNavigation, parseCardRoute } from './card-navigation.js';

let navigation;
afterEach(() => {
  navigation?.destroy();
  navigation = null;
  history.replaceState(null, '', '/');
});

it('round-trips board and card links without encoding a mutable stack id', () => {
  expect(parseCardRoute(cardHash(4, 120))).toEqual({ boardId: 4, cardId: 120 });
  expect(parseCardRoute(cardHash(4))).toEqual({ boardId: 4, cardId: null });
  expect(parseCardRoute('')).toBeNull();
});

it.each(['#/boards/0/cards/1', '#/boards/4/cards/foo', '#/boards/9007199254740992', '#/boards/4/cards/2/extra'])(
  'rejects malformed route %s', (hash) => expect(() => parseCardRoute(hash)).toThrow('ungültig'),
);

it('writes shareable URLs without losing existing query parameters', () => {
  history.replaceState(null, '', '/?source=bookmark');
  navigation = createCardNavigation({ apply: vi.fn(), requestClose: () => true, onError: vi.fn() });
  navigation.write(4, 120);
  expect(location.hash).toBe('#/boards/4/cards/120');
  expect(location.search).toBe('?source=bookmark');
});

it('restores the current URL when closing would discard a draft', async () => {
  history.replaceState(null, '', '/#/boards/4/cards/120');
  const apply = vi.fn();
  navigation = createCardNavigation({ apply, requestClose: () => false, onError: vi.fn() });
  history.replaceState(null, '', '/#/boards/4');
  await navigation.restore();
  expect(location.hash).toBe('#/boards/4/cards/120');
  expect(apply).not.toHaveBeenCalled();
});

it('invalidates a slow route when a new card is opened', async () => {
  let isCurrent;
  navigation = createCardNavigation({
    apply: async (_, current) => { isCurrent = current; },
    requestClose: () => true,
    onError: vi.fn(),
  });
  await navigation.restore();
  expect(isCurrent()).toBe(true);
  navigation.write(4, 121);
  expect(isCurrent()).toBe(false);
});

it('uses the newest destination when navigation overlaps an asynchronous title save', async () => {
  history.replaceState(null, '', '/#/boards/4/cards/120');
  const closings = [];
  const apply = vi.fn();
  navigation = createCardNavigation({
    apply,
    requestClose: () => new Promise((resolve) => closings.push(resolve)),
    onError: vi.fn(),
  });
  history.replaceState(null, '', '/#/boards/5/cards/121');
  const first = navigation.restore();
  history.replaceState(null, '', '/#/boards/4/cards/120');
  const second = navigation.restore();
  closings[0](true);
  await first;
  closings[1](true);
  await second;
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][0]).toEqual({ boardId: 4, cardId: 120 });
});
