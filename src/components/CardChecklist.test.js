import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import CardChecklist from './CardChecklist.svelte';
import AddChecklistPopover from './AddChecklistPopover.svelte';
import AssigneePopover from './AssigneePopover.svelte';
import DatePickerPopover from './DatePickerPopover.svelte';

describe('CardChecklist component', () => {
  const sampleChecklist = {
    id: 'cl_1',
    title: 'Test Checklist',
    items: [
      { id: 'item_1', text: 'Task 1', done: false, assignee: null, duedate: null },
      { id: 'item_2', text: 'Task 2', done: true, assignee: 'MM', duedate: '2026-08-26' }
    ]
  };

  it('renders checklist title and items', () => {
    const { getByText } = render(CardChecklist, {
      checklist: sampleChecklist,
      members: []
    });

    expect(getByText('Test Checklist')).toBeTruthy();
    expect(getByText('Task 1')).toBeTruthy();
    expect(getByText('Task 2')).toBeTruthy();
    expect(getByText('50%')).toBeTruthy();
  });

  it('toggles item completion state when checkbox clicked', async () => {
    const onUpdateChecklist = vi.fn();
    const { getAllByRole } = render(CardChecklist, {
      checklist: sampleChecklist,
      members: [],
      onUpdateChecklist
    });

    const checkboxes = getAllByRole('checkbox');
    await fireEvent.click(checkboxes[0]);

    expect(onUpdateChecklist).toHaveBeenCalled();
    const updated = onUpdateChecklist.mock.calls[0][0];
    expect(updated.items[0].done).toBe(true);
  });

  it('adds a new item via composer', async () => {
    const onUpdateChecklist = vi.fn();
    const { getByText, getByPlaceholderText } = render(CardChecklist, {
      checklist: sampleChecklist,
      members: [],
      onUpdateChecklist
    });

    await fireEvent.click(getByText('Element hinzufügen'));
    const input = getByPlaceholderText('Element hinzufügen');
    await fireEvent.input(input, { target: { value: 'New Item 3' } });
    await fireEvent.click(getByText('Hinzufügen'));

    expect(onUpdateChecklist).toHaveBeenCalled();
    const updated = onUpdateChecklist.mock.calls[0][0];
    expect(updated.items.length).toBe(3);
    expect(updated.items[2].text).toBe('New Item 3');
  });
});

describe('AddChecklistPopover component', () => {
  it('submits new checklist title', async () => {
    const onAdd = vi.fn();
    const { getByText, getByPlaceholderText } = render(AddChecklistPopover, {
      title: 'New List',
      onAdd
    });

    const input = getByPlaceholderText('Checkliste');
    await fireEvent.input(input, { target: { value: 'Feature Checklist' } });
    await fireEvent.click(getByText('Hinzufügen'));

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Feature Checklist',
      copyFrom: '(keine)'
    });
  });
});

describe('AssigneePopover component', () => {
  it('selects board member assignee', async () => {
    const onSelect = vi.fn();
    const members = [{ uid: 'max', displayname: 'Max Mustermann' }];

    const { getByText } = render(AssigneePopover, {
      members,
      currentAssignee: null,
      onSelect
    });

    await fireEvent.click(getByText('Max Mustermann'));
    expect(onSelect).toHaveBeenCalledWith('max');
  });
});

describe('DatePickerPopover component', () => {
  it('saves chosen due date', async () => {
    const onSave = vi.fn();
    const { getByText } = render(DatePickerPopover, {
      currentDate: '2026-08-26',
      onSave
    });

    await fireEvent.click(getByText('Speichern'));
    expect(onSave).toHaveBeenCalled();
  });
});
