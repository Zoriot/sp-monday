import type {
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@sp/plugin-api';
import {
  asConfig,
  canConnect,
  COMMENTS_CONFIG,
  isDoneMapping,
  pickSyncValues,
  registerIssueProvider,
  t,
  textMapping,
} from './kit';
import {
  API_VERSION,
  backlogItems,
  createItem,
  fetchItemById,
  fetchItemsByIds,
  itemLink,
  loadBoards,
  MondayConfig,
  searchItems,
  testMe,
  toPluginIssue,
  updateItem,
} from './monday-api';

const translateError = (err: unknown): never => {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'BOARD_REQUIRED') throw new Error(t('ERRORS.BOARD_REQUIRED'));
  if (message === 'ITEM_NOT_FOUND') throw new Error(t('ERRORS.ITEM_NOT_FOUND'));
  throw err instanceof Error ? err : new Error(message);
};

registerIssueProvider({
  configFields: [
    {
      key: 'apiToken',
      type: 'password',
      label: t('CFG.API_TOKEN'),
      required: true,
    },
    {
      key: 'apiTokenHelp',
      type: 'link',
      label: t('CFG.API_TOKEN_HELP'),
      url: 'https://developer.monday.com/api-reference/docs/authentication',
    },
    {
      key: 'boardId',
      type: 'select',
      label: t('CFG.BOARD'),
      description: t('CFG.BOARD_DESC'),
      required: true,
      loadOptions: loadBoards,
    },
    {
      key: 'assignedToMe',
      type: 'checkbox',
      label: t('CFG.ASSIGNED_TO_ME'),
    },
    {
      key: 'peopleColumnId',
      type: 'input',
      label: t('CFG.PEOPLE_COLUMN_ID'),
      advanced: true,
    },
    {
      key: 'filterUsername',
      type: 'input',
      label: t('CFG.FILTER_USERNAME'),
      advanced: true,
    },
  ],

  getHeaders: (config) => {
    const token = (asConfig<MondayConfig>(config).apiToken || '').trim();
    return {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': API_VERSION,
    };
  },

  searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return searchItems(searchTerm, asConfig<MondayConfig>(config), http).catch(
      translateError,
    );
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = asConfig<MondayConfig>(config);
    try {
      const item = await fetchItemById(issueId, cfg, http);
      return await toPluginIssue(item, cfg, http, true);
    } catch (e) {
      return translateError(e);
    }
  },

  async getByIds(
    issueIds: string[],
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue[]> {
    const cfg = asConfig<MondayConfig>(config);
    try {
      const items = await fetchItemsByIds(issueIds, http);
      return Promise.all(items.map((item) => toPluginIssue(item, cfg, http, true)));
    } catch (e) {
      return translateError(e);
    }
  },

  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    return itemLink(issueId, asConfig<MondayConfig>(config));
  },

  testConnection: (_config, http) => canConnect(() => testMe(http)),

  getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return backlogItems(asConfig<MondayConfig>(config), http).catch(translateError);
  },

  // Intentionally no `body` here: notes sync maps description → task notes, and
  // showing it again in the monday section would duplicate the content.
  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'statusLabel', label: t('DISPLAY.STATUS'), type: 'text', hideEmpty: true },
    { field: 'groupTitle', label: t('DISPLAY.GROUP'), type: 'text', hideEmpty: true },
    { field: 'assignee', label: t('DISPLAY.ASSIGNEE'), type: 'text', hideEmpty: true },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
  ],

  commentsConfig: COMMENTS_CONFIG,

  fieldMappings: [
    isDoneMapping({
      issueField: 'statusDone',
      done: 'done',
      open: 'open',
      isDone: (value) => value === true || value === 'done',
    }),
    textMapping('title', 'title'),
    // Default off: description write replaces the whole monday item description.
    textMapping('notes', 'body', 'off'),
  ] satisfies PluginFieldMapping[],

  async createIssue(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ issueId: string; issueData: PluginIssue }> {
    const cfg = asConfig<MondayConfig>(config);
    if (!(cfg.apiToken || '').trim()) {
      throw new Error(t('ERRORS.TOKEN_REQUIRED'));
    }
    try {
      const item = await createItem(title, cfg, http);
      const issueData = await toPluginIssue(item, cfg, http, true);
      return { issueId: String(item.id), issueData };
    } catch (e) {
      return translateError(e);
    }
  },

  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = asConfig<MondayConfig>(config);
    if (!(cfg.apiToken || '').trim()) {
      throw new Error(t('ERRORS.TOKEN_REQUIRED'));
    }
    try {
      await updateItem(id, changes, cfg, http);
    } catch (e) {
      translateError(e);
    }
  },

  extractSyncValues: pickSyncValues('statusDone', 'title', 'body', 'state'),
});
