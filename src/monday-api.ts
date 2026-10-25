import type {
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@sp/plugin-api';
import { toMs } from './kit';

export const API_URL = 'https://api.monday.com/v2';
/** Pin a stable monday.com API version (current as of implementation). */
export const API_VERSION = '2026-07';
export const DEFAULT_PEOPLE_COLUMN_ID = 'person';
const SEARCH_LIMIT = 50;
const BACKLOG_LIMIT = 100;
const MAX_GET_BY_IDS = 100;

export interface MondayConfig {
  apiToken?: string;
  boardId?: string;
  assignedToMe?: boolean;
  peopleColumnId?: string;
  filterUsername?: string;
}

export interface MondayGraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  error_code?: string;
  error_message?: string;
}

export interface MondayColumnValue {
  id: string;
  type: string;
  text?: string | null;
  label?: string | null;
  is_done?: boolean | null;
}

export interface MondayUpdate {
  id: string;
  body?: string;
  text_body?: string | null;
  created_at?: string;
  creator?: {
    name?: string | null;
    photo_tiny?: string | null;
  } | null;
}

export interface MondayItem {
  id: string;
  name: string;
  url?: string;
  state?: string;
  created_at?: string;
  updated_at?: string;
  group?: { id: string; title: string } | null;
  column_values?: MondayColumnValue[];
  updates?: MondayUpdate[] | null;
  description?: { id?: string | null } | null;
}

export interface MondayBoard {
  id: string;
  name: string;
}

interface ItemsPage {
  cursor?: string | null;
  items: MondayItem[];
}

/** Session cache for account subdomain links (not persisted). */
let accountSlugCache: string | undefined;

export const rememberAccountSlug = (slug: string): void => {
  const trimmed = slug.trim();
  if (trimmed) accountSlugCache = trimmed;
};

export const cachedAccountSlug = (): string | undefined => accountSlugCache;

const ITEM_FIELDS = `
  id
  name
  url
  state
  created_at
  updated_at
  group { id title }
  column_values {
    id
    type
    text
    ... on StatusValue { label is_done }
  }
`;

const ITEM_DETAIL_FIELDS = `
  ${ITEM_FIELDS}
  description { id }
  updates(limit: 50) {
    id
    body
    text_body
    created_at
    creator { name photo_tiny }
  }
`;

export const requireBoardId = (cfg: MondayConfig): string => {
  const boardId = (cfg.boardId || '').trim();
  if (!boardId) {
    throw new Error('BOARD_REQUIRED');
  }
  return boardId;
};

export const peopleColumnId = (cfg: MondayConfig): string =>
  (cfg.peopleColumnId || '').trim() || DEFAULT_PEOPLE_COLUMN_ID;

export const graphql = async <T>(
  http: PluginHttp,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> => {
  const res = await http.post<MondayGraphQLResponse<T>>(API_URL, {
    query,
    variables,
  });

  if (res?.error_message) {
    throw new Error(res.error_message);
  }
  if (res?.errors?.length) {
    throw new Error(res.errors[0].message || 'monday.com GraphQL error');
  }
  if (!res?.data) {
    throw new Error('No data returned from monday.com');
  }
  return res.data;
};

export const listBoards = async (http: PluginHttp): Promise<MondayBoard[]> => {
  const data = await graphql<{ boards: MondayBoard[] }>(
    http,
    `query ($limit: Int!) {
      boards(limit: $limit, order_by: used_at) {
        id
        name
      }
    }`,
    { limit: 100 },
  );
  return data.boards || [];
};

export const fetchAccountSlug = async (http: PluginHttp): Promise<string | undefined> => {
  if (accountSlugCache) return accountSlugCache;
  const data = await graphql<{ me: { account?: { slug?: string } | null } }>(
    http,
    `query { me { account { slug } } }`,
  );
  const slug = data.me?.account?.slug;
  if (slug) rememberAccountSlug(slug);
  return slug || undefined;
};

const statusFromColumns = (
  columns: MondayColumnValue[] | undefined,
): { label: string; isDone: boolean } => {
  const status = (columns || []).find((c) => c.type === 'status');
  if (!status) {
    return { label: '', isDone: false };
  }
  const label = status.label || status.text || '';
  return { label, isDone: status.is_done === true };
};

const labelsFromColumns = (columns: MondayColumnValue[] | undefined): string[] => {
  const tags = (columns || []).find((c) => c.type === 'tags' || c.type === 'dropdown');
  if (!tags?.text) return [];
  return tags.text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const peopleText = (columns: MondayColumnValue[] | undefined): string => {
  const people = (columns || []).find(
    (c) => c.type === 'people' || c.type === 'multiple-person',
  );
  return people?.text?.trim() || '';
};

export const fetchItemDescriptionMarkdown = async (
  descriptionId: string | null | undefined,
  http: PluginHttp,
): Promise<string> => {
  if (!descriptionId) return '';
  try {
    const data = await graphql<{
      export_markdown_from_doc: {
        success?: boolean;
        markdown?: string | null;
        error?: string | null;
      };
    }>(
      http,
      `query ($docId: ID!) {
        export_markdown_from_doc(docId: $docId) {
          success
          markdown
          error
        }
      }`,
      { docId: descriptionId },
    );
    const result = data.export_markdown_from_doc;
    if (result?.success === false) return '';
    return (result?.markdown || '').trim();
  } catch {
    // Description is optional; older items / permissions may fail.
    return '';
  }
};

export const setItemDescriptionMarkdown = async (
  itemId: string,
  markdown: string,
  http: PluginHttp,
): Promise<void> => {
  const data = await graphql<{
    set_item_description_content: {
      success?: boolean;
      error?: string | null;
    };
  }>(
    http,
    `mutation ($itemId: ID!, $markdown: String!) {
      set_item_description_content(item_id: $itemId, markdown: $markdown) {
        success
        error
      }
    }`,
    { itemId, markdown },
  );
  const result = data.set_item_description_content;
  if (result?.success === false) {
    throw new Error(result.error || 'Failed to update item description');
  }
};

export const mapSearchResult = (item: MondayItem): PluginSearchResult => {
  const { label, isDone } = statusFromColumns(item.column_values);
  return {
    id: String(item.id),
    title: item.name,
    url: item.url,
    status: isDone ? 'done' : 'open',
    assignee: peopleText(item.column_values) || undefined,
    labels: labelsFromColumns(item.column_values),
    statusLabel: label,
    statusDone: isDone,
  };
};

export const mapItemToPluginIssue = (
  item: MondayItem,
  opts?: { filterUsername?: string; body?: string },
): PluginIssue => {
  const { label, isDone } = statusFromColumns(item.column_values);
  const labels = labelsFromColumns(item.column_values);
  const assignee = peopleText(item.column_values);
  const comments = (item.updates || [])
    .filter((u) => !!(u.text_body || u.body))
    .map((u) => ({
      author: u.creator?.name || 'unknown',
      body: u.text_body || u.body || '',
      created: toMs(u.created_at),
      avatarUrl: u.creator?.photo_tiny || undefined,
    }));

  let lastUpdated = toMs(item.updated_at);
  const filterUsername = opts?.filterUsername;
  if (filterUsername && comments.length > 0) {
    const other = comments.filter(
      (c) => c.author.toLowerCase() !== filterUsername.toLowerCase(),
    );
    if (other.length > 0) {
      lastUpdated = Math.max(lastUpdated, ...other.map((c) => c.created));
    }
  } else if (comments.length > 0) {
    lastUpdated = Math.max(lastUpdated, ...comments.map((c) => c.created));
  }

  const archived = item.state === 'archived' || item.state === 'deleted';
  const done = isDone || archived;
  const body = opts?.body ?? '';

  return {
    id: String(item.id),
    title: item.name,
    body,
    url: item.url,
    state: done ? 'done' : 'open',
    lastUpdated,
    assignee: assignee || undefined,
    labels,
    comments,

    summary: item.name,
    statusLabel: label || (archived ? item.state : ''),
    statusDone: done,
    groupTitle: item.group?.title || '',
    createdAt: toMs(item.created_at),
  };
};

const buildQueryParams = (
  cfg: MondayConfig,
  searchTerm: string,
): Record<string, unknown> | undefined => {
  const rules: Array<Record<string, unknown>> = [];
  const term = searchTerm.trim();
  if (term) {
    rules.push({
      column_id: 'name',
      compare_value: [term],
      operator: 'contains_text',
    });
  }
  if (cfg.assignedToMe) {
    rules.push({
      column_id: peopleColumnId(cfg),
      compare_value: ['assigned_to_me'],
      operator: 'any_of',
    });
  }
  if (rules.length === 0) {
    return undefined;
  }
  return { rules, operator: 'and' };
};

/** Board select options: value = numeric id. Also warms the account-slug cache. */
export const loadBoards = async (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const cfg = config as unknown as MondayConfig;
  if (!(cfg.apiToken || '').trim()) {
    return [];
  }

  const [, boards] = await Promise.all([
    fetchAccountSlug(http).catch(() => undefined),
    listBoards(http),
  ]);

  const nameCounts = new Map<string, number>();
  for (const b of boards) {
    nameCounts.set(b.name, (nameCounts.get(b.name) || 0) + 1);
  }

  return boards.map((b) => {
    const id = String(b.id);
    const duplicate = (nameCounts.get(b.name) || 0) > 1;
    return {
      label: duplicate ? `${b.name} (${id})` : b.name,
      value: id,
    };
  });
};

export const fetchBoardItems = async (
  cfg: MondayConfig,
  http: PluginHttp,
  searchTerm: string,
  limit: number,
): Promise<MondayItem[]> => {
  const boardId = requireBoardId(cfg);
  const queryParams = buildQueryParams(cfg, searchTerm);

  const data = await graphql<{
    boards: Array<{ items_page: ItemsPage }>;
  }>(
    http,
    `query ($boardIds: [ID!], $limit: Int!, $queryParams: ItemsQuery) {
      boards(ids: $boardIds) {
        items_page(limit: $limit, query_params: $queryParams) {
          cursor
          items { ${ITEM_FIELDS} }
        }
      }
    }`,
    {
      boardIds: [boardId],
      limit,
      queryParams: queryParams ?? null,
    },
  );

  return data.boards?.[0]?.items_page?.items || [];
};

export const fetchItemById = async (
  issueId: string,
  _cfg: MondayConfig,
  http: PluginHttp,
): Promise<MondayItem> => {
  const data = await graphql<{ items: MondayItem[] }>(
    http,
    `query ($ids: [ID!]!) {
      items(ids: $ids) {
        ${ITEM_DETAIL_FIELDS}
      }
    }`,
    { ids: [issueId] },
  );
  const item = data.items?.[0];
  if (!item) {
    throw new Error('ITEM_NOT_FOUND');
  }
  return item;
};

export const fetchItemsByIds = async (
  issueIds: string[],
  http: PluginHttp,
): Promise<MondayItem[]> => {
  const ids = issueIds.slice(0, MAX_GET_BY_IDS);
  if (ids.length === 0) return [];

  const data = await graphql<{ items: MondayItem[] }>(
    http,
    `query ($ids: [ID!]!) {
      items(ids: $ids) {
        ${ITEM_DETAIL_FIELDS}
      }
    }`,
    { ids },
  );
  return data.items || [];
};

export const toPluginIssue = async (
  item: MondayItem,
  cfg: MondayConfig,
  http: PluginHttp,
  includeDescription: boolean,
): Promise<PluginIssue> => {
  const body = includeDescription
    ? await fetchItemDescriptionMarkdown(item.description?.id, http)
    : '';
  return mapItemToPluginIssue(item, {
    filterUsername: cfg.filterUsername,
    body,
  });
};

export const searchItems = async (
  searchTerm: string,
  cfg: MondayConfig,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  void fetchAccountSlug(http).catch(() => undefined);
  const items = await fetchBoardItems(cfg, http, searchTerm, SEARCH_LIMIT);
  return items.map(mapSearchResult);
};

export const backlogItems = async (
  cfg: MondayConfig,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  const items = await fetchBoardItems(cfg, http, '', BACKLOG_LIMIT);
  return items
    .filter((item) => !statusFromColumns(item.column_values).isDone)
    .map(mapSearchResult);
};

export const createItem = async (
  title: string,
  cfg: MondayConfig,
  http: PluginHttp,
): Promise<MondayItem> => {
  const boardId = requireBoardId(cfg);
  const data = await graphql<{ create_item: MondayItem }>(
    http,
    `mutation ($boardId: ID!, $itemName: String!) {
      create_item(board_id: $boardId, item_name: $itemName) {
        ${ITEM_FIELDS}
        description { id }
      }
    }`,
    { boardId, itemName: title },
  );
  return data.create_item;
};

export const updateItem = async (
  issueId: string,
  changes: Record<string, unknown>,
  cfg: MondayConfig,
  http: PluginHttp,
): Promise<void> => {
  const boardId = requireBoardId(cfg);

  if ('title' in changes && typeof changes.title === 'string') {
    await graphql(
      http,
      `mutation ($boardId: ID!, $itemId: ID!, $value: String!) {
        change_simple_column_value(
          board_id: $boardId
          item_id: $itemId
          column_id: "name"
          value: $value
        ) { id }
      }`,
      { boardId, itemId: issueId, value: changes.title },
    );
  }

  if ('body' in changes && typeof changes.body === 'string') {
    await setItemDescriptionMarkdown(issueId, changes.body, http);
  }

  // Done write-back is board-specific (status label/index). Pull-only by default.
};

export const testMe = async (
  http: PluginHttp,
): Promise<{ me: { id: string; name: string } }> => {
  const data = await graphql<{
    me: { id: string; name: string; account?: { slug?: string } | null };
  }>(http, `query { me { id name account { slug } } }`);
  if (data.me?.account?.slug) {
    rememberAccountSlug(data.me.account.slug);
  }
  return data;
};

/**
 * Builds an item URL with the account subdomain when known.
 * Returns '' when the slug is unknown so the host falls back to getById().url
 * (which monday returns with the correct host).
 */
export const itemLink = (issueId: string, cfg: MondayConfig): string => {
  const boardId = (cfg.boardId || '').trim();
  const slug = cachedAccountSlug();
  if (!boardId || !slug) {
    return '';
  }
  return `https://${encodeURIComponent(slug)}.monday.com/boards/${encodeURIComponent(boardId)}/pulses/${encodeURIComponent(issueId)}`;
};

/** Reset session caches (tests). */
export const resetCachesForTests = (): void => {
  accountSlugCache = undefined;
};
