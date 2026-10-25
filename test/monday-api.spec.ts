import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PluginHttp } from '@sp/plugin-api';
import {
  API_URL,
  backlogItems,
  createItem,
  fetchItemById,
  fetchItemDescriptionMarkdown,
  graphql,
  itemLink,
  loadBoards,
  mapItemToPluginIssue,
  mapSearchResult,
  MondayItem,
  peopleColumnId,
  rememberAccountSlug,
  requireBoardId,
  resetCachesForTests,
  searchItems,
  setItemDescriptionMarkdown,
  updateItem,
} from '../src/monday-api';

const mockItem = (overrides: Partial<MondayItem> = {}): MondayItem => ({
  id: '123',
  name: 'Ship feature',
  url: 'https://bte-germany.monday.com/boards/1/pulses/123',
  state: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T12:00:00Z',
  group: { id: 'g1', title: 'Doing' },
  column_values: [
    {
      id: 'status',
      type: 'status',
      text: 'Working on it',
      label: 'Working on it',
      is_done: false,
    },
    { id: 'person', type: 'people', text: 'Ada Lovelace' },
    { id: 'tags', type: 'tags', text: 'backend, api' },
  ],
  updates: [
    {
      id: 'u1',
      text_body: 'Looks good',
      created_at: '2026-01-03T08:00:00Z',
      creator: { name: 'Ada Lovelace', photo_tiny: 'https://example.com/a.png' },
    },
  ],
  description: { id: 'doc-1' },
  ...overrides,
});

const mockHttp = (response: unknown): PluginHttp =>
  ({
    get: vi.fn(),
    post: vi.fn().mockResolvedValue(response),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  }) as unknown as PluginHttp;

const mockHttpSequence = (responses: unknown[]): PluginHttp => {
  let i = 0;
  return {
    get: vi.fn(),
    post: vi.fn().mockImplementation(async () => {
      const res = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return res;
    }),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as PluginHttp;
};

beforeEach(() => {
  resetCachesForTests();
});

describe('requireBoardId', () => {
  it('throws when boardId is missing', () => {
    expect(() => requireBoardId({})).toThrow('BOARD_REQUIRED');
  });

  it('returns trimmed board id', () => {
    expect(requireBoardId({ boardId: ' 5053322469 ' })).toBe('5053322469');
  });
});

describe('peopleColumnId', () => {
  it('defaults to person', () => {
    expect(peopleColumnId({})).toBe('person');
  });
});

describe('mapSearchResult / mapItemToPluginIssue', () => {
  it('keeps the API item url (account subdomain)', () => {
    expect(mapSearchResult(mockItem()).url).toBe(
      'https://bte-germany.monday.com/boards/1/pulses/123',
    );
  });

  it('maps notes body when provided', () => {
    expect(mapItemToPluginIssue(mockItem(), { body: '## Notes' }).body).toBe('## Notes');
  });
});

describe('itemLink', () => {
  it('uses the account slug subdomain', () => {
    rememberAccountSlug('bte-germany');
    expect(itemLink('3281317798', { boardId: '5053322469' })).toBe(
      'https://bte-germany.monday.com/boards/5053322469/pulses/3281317798',
    );
  });

  it('returns empty without slug so the host can use getById().url', () => {
    expect(itemLink('1', { boardId: '2' })).toBe('');
  });
});

describe('loadBoards', () => {
  it('uses numeric board ids as option values', async () => {
    const http = mockHttpSequence([
      { data: { me: { account: { slug: 'bte-germany' } } } },
      {
        data: {
          boards: [
            { id: '5053322469', name: 'Sprint' },
            { id: '1', name: 'Dup' },
            { id: '2', name: 'Dup' },
          ],
        },
      },
    ]);
    const options = await loadBoards({ apiToken: 'tok' }, http);
    expect(options).toEqual([
      { label: 'Sprint', value: '5053322469' },
      { label: 'Dup (1)', value: '1' },
      { label: 'Dup (2)', value: '2' },
    ]);
  });
});

describe('description markdown', () => {
  it('exports item description as markdown', async () => {
    const http = mockHttp({
      data: {
        export_markdown_from_doc: { success: true, markdown: 'Hello **world**' },
      },
    });
    await expect(fetchItemDescriptionMarkdown('doc-1', http)).resolves.toBe(
      'Hello **world**',
    );
  });

  it('writes description via set_item_description_content', async () => {
    const http = mockHttp({
      data: { set_item_description_content: { success: true } },
    });
    await setItemDescriptionMarkdown('123', '## Notes', http);
    const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      query: string;
    };
    expect(body.query).toContain('set_item_description_content');
  });
});

describe('updateItem', () => {
  it('renames and updates description', async () => {
    const http = mockHttpSequence([
      { data: { change_simple_column_value: { id: '123' } } },
      { data: { set_item_description_content: { success: true } } },
    ]);
    await updateItem(
      '123',
      { title: 'Renamed', body: 'Notes' },
      { boardId: '1' },
      http,
    );
    expect(http.post).toHaveBeenCalledTimes(2);
  });
});

describe('search / backlog / create', () => {
  it('searches by boardId', async () => {
    const http = mockHttpSequence([
      { data: { me: { account: { slug: 'x' } } } },
      {
        data: {
          boards: [{ items_page: { cursor: null, items: [mockItem()] } }],
        },
      },
    ]);
    const results = await searchItems('Ship', { boardId: '1' }, http);
    expect(results[0].id).toBe('123');
  });

  it('requires boardId', async () => {
    const http = mockHttp({ data: {} });
    await expect(searchItems('', {}, http)).rejects.toThrow('BOARD_REQUIRED');
  });

  it('creates an item', async () => {
    const http = mockHttp({ data: { create_item: mockItem({ name: 'New' }) } });
    const item = await createItem('New', { boardId: '1' }, http);
    expect(item.name).toBe('New');
  });

  it('fetches by id', async () => {
    const http = mockHttp({ data: { items: [mockItem()] } });
    await expect(fetchItemById('123', { boardId: '1' }, http)).resolves.toMatchObject({
      id: '123',
    });
  });

  it('filters done items from backlog', async () => {
    const http = mockHttp({
      data: {
        boards: [
          {
            items_page: {
              cursor: null,
              items: [
                mockItem({ id: '1' }),
                mockItem({
                  id: '2',
                  column_values: [
                    { id: 'status', type: 'status', label: 'Done', is_done: true },
                  ],
                }),
              ],
            },
          },
        ],
      },
    });
    const results = await backlogItems({ boardId: '1' }, http);
    expect(results.map((r) => r.id)).toEqual(['1']);
  });
});

describe('graphql', () => {
  it('posts to the monday API', async () => {
    const http = mockHttp({ data: { me: { id: '1' } } });
    await graphql(http, 'query { me { id } }');
    expect(http.post).toHaveBeenCalledWith(API_URL, {
      query: 'query { me { id } }',
      variables: {},
    });
  });
});
