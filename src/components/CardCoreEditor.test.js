import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CardCoreEditor from './CardCoreEditor.svelte';

const base = {
  id: 10193,
  title: 'Original title',
  description: '',
  duedate: null,
};

function setup(props = {}) {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(undefined);
  const result = render(CardCoreEditor, { props: { card: base, ...props, onSave } });
  return { ...result, onSave };
}

describe('CardCoreEditor', () => {
  it('saves a title on Enter', async () => {
    const { onSave } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Original title' }));
    const input = screen.getByLabelText('Card title');
    await fireEvent.input(input, { target: { value: 'Detail QA' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ title: 'Detail QA' });
  });

  it('saves a title on blur', async () => {
    const { onSave } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Original title' }));
    const input = screen.getByLabelText('Card title');
    await fireEvent.input(input, { target: { value: 'Blurred title' } });
    await fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledWith({ title: 'Blurred title' });
  });

  it('cancels a title edit on Escape without saving', async () => {
    const { onSave } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Original title' }));
    const input = screen.getByLabelText('Card title');
    await fireEvent.input(input, { target: { value: 'Discarded' } });
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Original title' })).toBeInTheDocument();
  });

  it('blocks a whitespace-only title locally with zero save calls', async () => {
    const { onSave } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Original title' }));
    const input = screen.getByLabelText('Card title');
    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Title cannot be empty');
  });

  it('keeps the recoverable input when a save fails', async () => {
    // The store catches transport failures and surfaces them through `error`
    // rather than rejecting, so a failed save resolves here too.
    const onSave = vi.fn().mockResolvedValue(undefined);
    setup({ onSave, error: 'Could not save the card' });

    await fireEvent.click(screen.getByRole('button', { name: 'Original title' }));
    const input = screen.getByLabelText('Card title');
    await fireEvent.input(input, { target: { value: 'Attempted' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledWith({ title: 'Attempted' });
    // The card prop is unchanged because the store rolled the save back.
    expect(screen.getByRole('button', { name: 'Original title' })).toBeInTheDocument();
    expect(screen.getByText('Could not save the card')).toBeInTheDocument();
  });

  it('saves a multiline description only on explicit Save', async () => {
    const { onSave } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'Add a more detailed description' }));
    const area = screen.getByLabelText('Card description');
    await fireEvent.input(area, { target: { value: 'Line 1\nLine 2' } });
    expect(onSave).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ description: 'Line 1\nLine 2' });
  });

  it('reports an unsaved description draft so the modal can block closing', async () => {
    const onDraftChange = vi.fn();
    setup({ onDraftChange });

    await fireEvent.click(screen.getByRole('button', { name: 'Add a more detailed description' }));
    await fireEvent.input(screen.getByLabelText('Card description'), {
      target: { value: 'unsaved work' },
    });

    expect(onDraftChange).toHaveBeenLastCalledWith(true);

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onDraftChange).toHaveBeenLastCalledWith(false);
  });

  it('reports no pending draft when an edit is cancelled', async () => {
    const onDraftChange = vi.fn();
    setup({ onDraftChange });

    await fireEvent.click(screen.getByRole('button', { name: 'Add a more detailed description' }));
    await fireEvent.input(screen.getByLabelText('Card description'), {
      target: { value: 'abandoned' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDraftChange).toHaveBeenLastCalledWith(false);
  });

  it('preserves line breaks and renders markup as text, never HTML', () => {
    setup({ card: { ...base, description: 'Line 1\n<b>not bold</b>' } });

    const desc = screen.getByTestId('description');
    expect(desc.textContent).toBe('Line 1\n<b>not bold</b>');
    expect(desc.querySelector('b')).toBeNull();
    expect(desc.innerHTML).not.toContain('<b>');
  });

  it('converts a local due date to ISO-8601 without timezone drift', async () => {
    const { onSave } = setup();

    await fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2030-04-05T14:30' } });

    const [[payload]] = onSave.mock.calls;
    // Round-tripping through Date proves the wall-clock time survives the
    // conversion in whatever zone the test host runs in.
    const local = new Date(payload.duedate);
    expect(local.getFullYear()).toBe(2030);
    expect(local.getMonth()).toBe(3);
    expect(local.getDate()).toBe(5);
    expect(local.getHours()).toBe(14);
    expect(local.getMinutes()).toBe(30);
  });

  it('renders an existing due date back into the local input', () => {
    const iso = new Date(2030, 3, 5, 14, 30).toISOString();
    setup({ card: { ...base, duedate: iso } });

    expect(screen.getByLabelText('Due date')).toHaveValue('2030-04-05T14:30');
  });

  it('clears a due date', async () => {
    const iso = new Date(2030, 3, 5, 14, 30).toISOString();
    const { onSave } = setup({ card: { ...base, duedate: iso } });

    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSave).toHaveBeenCalledWith({ duedate: null });
  });

  it('marks a past due date as overdue', () => {
    setup({ card: { ...base, duedate: new Date(2020, 0, 1, 9, 0).toISOString() } });

    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });
});
