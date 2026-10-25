/**
 * Small helpers shared with Super Productivity's issue-provider-kit.
 * Vendored here so this community plugin builds outside the monorepo.
 */
import type {
  IssueProviderPluginDefinition,
  PluginAPI as PluginAPIType,
  PluginCommentsConfig,
  PluginFieldMapping,
  PluginIssue,
} from '@sp/plugin-api';

declare const PluginAPI: PluginAPIType;

export const registerIssueProvider = (definition: IssueProviderPluginDefinition): void =>
  PluginAPI.registerIssueProvider(definition);

export const t = (key: string, params?: Record<string, string | number>): string => {
  try {
    return PluginAPI.translate(key, params);
  } catch {
    return key;
  }
};

export const asConfig = <T>(config: Record<string, unknown>): T =>
  config as unknown as T;

export const canConnect = async (
  request: () => Promise<unknown>,
  isOk: (response: unknown) => boolean = () => true,
): Promise<boolean> => {
  try {
    return isOk(await request());
  } catch {
    return false;
  }
};

export const toMs = (date: unknown): number =>
  typeof date === 'string' && date ? new Date(date).getTime() : 0;

export const COMMENTS_CONFIG: PluginCommentsConfig = {
  authorField: 'author',
  bodyField: 'body',
  createdField: 'created',
  avatarField: 'avatarUrl',
};

export const isDoneMapping = ({
  issueField = 'state',
  done = 'closed',
  open = 'open',
  isDone = (value: unknown): boolean => value === done,
}: {
  issueField?: string;
  done?: string;
  open?: string;
  isDone?: (issueValue: unknown) => boolean;
} = {}): PluginFieldMapping => ({
  taskField: 'isDone',
  issueField,
  defaultDirection: 'pullOnly',
  toIssueValue: (taskValue: unknown): string => (taskValue ? done : open),
  toTaskValue: isDone,
});

export const textMapping = (
  taskField: PluginFieldMapping['taskField'],
  issueField: string,
  defaultDirection: PluginFieldMapping['defaultDirection'] = 'pullOnly',
): PluginFieldMapping => ({
  taskField,
  issueField,
  defaultDirection,
  toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
  toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
});

export const pickSyncValues =
  (...fields: string[]) =>
  (issue: PluginIssue): Record<string, unknown> =>
    Object.fromEntries(fields.map((field) => [field, issue[field]]));
