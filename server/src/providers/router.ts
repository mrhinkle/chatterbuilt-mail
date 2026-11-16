import { ToolError } from "../errors.js";
import type { Repo } from "../store/repo.js";
import type {
  DraftRecord,
  FilterAction,
  FilterCriteria,
  FilterRecord,
  ForwardInput,
  LabelRecord,
  MailProvider,
  MailThread,
  OutgoingDraft,
  ProviderSearchPage,
  ReplyInput,
  SearchView,
  SendAsRecord,
  SentResult,
} from "./types.js";
import { ACCOUNT_TYPE_UNAVAILABLE } from "./unavailable.js";

export type RoutedKind = "gmail" | "imap" | "microsoft" | "fake";

const GOOGLE_NOT_SET_UP = "Google sign-in is not set up.";

/**
 * Sends each call to the provider registered for that account's kind.
 * `kind` is `live` because this object is the deployment's front door, not a mailbox.
 */
export class ProviderRouter implements MailProvider {
  readonly kind = "live" as const;

  constructor(
    private readonly store: Repo,
    private readonly slots: Map<RoutedKind, MailProvider>,
  ) {}

  /** Adds a provider after boot, when /connect saves a client that was not in the environment. */
  install(kind: RoutedKind, provider: MailProvider): void {
    this.slots.set(kind, provider);
  }

  /** The slot for this account, or undefined when that kind is not configured. */
  providerFor(account: { kind: string }): MailProvider | undefined {
    if (account.kind !== "gmail" && account.kind !== "imap" && account.kind !== "microsoft" && account.kind !== "fake") {
      return undefined;
    }
    return this.slots.get(account.kind);
  }

  listAccounts() {
    return [];
  }

  async searchPage(accountId: string, query: string, pageSize: number, pageToken: string | undefined, view: SearchView): Promise<ProviderSearchPage> {
    return (await this.target(accountId)).searchPage(accountId, query, pageSize, pageToken, view);
  }

  async listThreadMeta(accountId: string): Promise<MailThread[]> {
    return (await this.target(accountId)).listThreadMeta(accountId);
  }

  async getThread(accountId: string, threadId: string): Promise<MailThread | null> {
    return (await this.target(accountId)).getThread(accountId, threadId);
  }

  async getMessageRaw(accountId: string, messageId: string): Promise<{ id: string; raw: string } | null> {
    return (await this.target(accountId)).getMessageRaw(accountId, messageId);
  }

  async listLabels(accountId: string): Promise<LabelRecord[]> {
    return (await this.target(accountId)).listLabels(accountId);
  }

  async listDraftMeta(accountId: string): Promise<DraftRecord[]> {
    return (await this.target(accountId)).listDraftMeta(accountId);
  }

  async getDraft(accountId: string, draftId: string): Promise<DraftRecord | null> {
    return (await this.target(accountId)).getDraft(accountId, draftId);
  }

  async listSendAs(accountId: string): Promise<SendAsRecord[]> {
    return (await this.target(accountId)).listSendAs(accountId);
  }

  async listFilters(accountId: string): Promise<FilterRecord[]> {
    return (await this.target(accountId)).listFilters(accountId);
  }

  async createLabel(accountId: string, displayName: string): Promise<LabelRecord> {
    return (await this.target(accountId)).createLabel(accountId, displayName);
  }

  async labelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    return (await this.target(accountId)).labelThread(accountId, threadId, labelIds);
  }

  async unlabelThread(accountId: string, threadId: string, labelIds: string[]): Promise<void> {
    return (await this.target(accountId)).unlabelThread(accountId, threadId, labelIds);
  }

  async modifyThread(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
    return (await this.target(accountId)).modifyThread(accountId, threadId, add, remove);
  }

  async createDraft(accountId: string, input: OutgoingDraft): Promise<DraftRecord> {
    return (await this.target(accountId)).createDraft(accountId, input);
  }

  async updateDraft(accountId: string, draftId: string, input: OutgoingDraft): Promise<DraftRecord> {
    return (await this.target(accountId)).updateDraft(accountId, draftId, input);
  }

  async deleteDraft(accountId: string, draftId: string): Promise<void> {
    return (await this.target(accountId)).deleteDraft(accountId, draftId);
  }

  async sendMessage(accountId: string, input: OutgoingDraft): Promise<SentResult> {
    return (await this.target(accountId)).sendMessage(accountId, input);
  }

  async reply(accountId: string, input: ReplyInput): Promise<SentResult> {
    return (await this.target(accountId)).reply(accountId, input);
  }

  async forward(accountId: string, input: ForwardInput): Promise<SentResult> {
    return (await this.target(accountId)).forward(accountId, input);
  }

  async createFilter(accountId: string, criteria: FilterCriteria, action: FilterAction): Promise<FilterRecord> {
    return (await this.target(accountId)).createFilter(accountId, criteria, action);
  }

  async deleteFilter(accountId: string, filterId: string): Promise<void> {
    return (await this.target(accountId)).deleteFilter(accountId, filterId);
  }

  private async target(accountId: string): Promise<MailProvider> {
    const accounts = await this.store.listAccounts();
    const account = accounts.find((item) => item.id === accountId);
    if (!account) throw new ToolError("tool_error", "Unknown account.");
    const found = this.providerFor(account);
    if (found) return found;
    if (account.kind === "gmail") throw new ToolError("tool_error", GOOGLE_NOT_SET_UP);
    if (account.kind === "microsoft") throw new ToolError("tool_error", "Microsoft sign-in is not set up.");
    throw new ToolError("tool_error", ACCOUNT_TYPE_UNAVAILABLE);
  }
}

/**
 * The provider that serves this account. Demo rows are stored as `gmail` and
 * served by FakeProvider, so callers branch on this object, not on `MAIL_PROVIDER`
 * and not on the stored kind. A missing slot returns the router.
 */
export function providerServing(root: MailProvider, account: { kind: string }): MailProvider {
  if (!(root instanceof ProviderRouter)) return root;
  return root.providerFor(account) ?? root;
}

/**
 * Account-scoped tools used to stop on a stub before jobs, the store, or the
 * network. IMAP and Microsoft are served now, so this does not refuse either.
 */
export function refuseUnavailable(root: MailProvider, account: { kind: string }): void {
  providerServing(root, account);
}
