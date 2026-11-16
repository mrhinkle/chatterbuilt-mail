import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { ToolError } from "../errors.js";
import type { ReadService, ToolInput } from "../reads/service.js";
import type { SyncService } from "../sync/service.js";
import type { WriteInput, WriteService } from "../writes/service.js";

const accountFields = {
  account: z.string().optional(),
  acct: z.string().optional(),
};

const pageFields = {
  pageSize: z.number().optional(),
  pageToken: z.string().optional(),
};

type Shape = Record<string, z.ZodType>;

interface ToolSpec {
  name: string;
  description: string;
  shape: Shape;
  /** A write is one provider call. The app path must not tell the page it can retry. */
  write: boolean;
  call: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolRegistry {
  call(name: string, input: unknown): Promise<unknown>;
  mount(server: McpServer): void;
  isWrite(name: string): boolean;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function failure(error: unknown) {
  const coded = error instanceof ToolError ? error : new ToolError("tool_error", "The tool failed.");
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ code: coded.code, message: coded.message }) }],
  };
}

function normalize(spec: ToolSpec, error: unknown): unknown {
  if (spec.write && error instanceof ToolError && error.retryable) {
    return new ToolError(error.code, error.message, false);
  }
  return error;
}

function mountOne(server: McpServer, spec: ToolSpec): void {
  server.registerTool(
    spec.name,
    { description: spec.description, inputSchema: spec.shape },
    async (args) => {
      try {
        return ok(await spec.call(args as Record<string, unknown>));
      } catch (error) {
        return failure(normalize(spec, error));
      }
    },
  );
}

const attachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  content: z.string().optional(),
  msgId: z.string().optional(),
  attId: z.string().optional(),
  cid: z.string().optional(),
});

const addressField = z.union([z.string(), z.array(z.string())]).optional();

function toolSpecs(reads: ReadService, writes: WriteService, sync: SyncService): ToolSpec[] {
  const read = (
    name: string,
    description: string,
    shape: Shape,
    call: (input: ToolInput) => Promise<unknown>,
  ): ToolSpec => ({
    name,
    description,
    shape,
    write: false,
    call: (input) => call(input as ToolInput),
  });
  const write = (
    name: string,
    description: string,
    shape: Shape,
    call: (input: WriteInput) => Promise<unknown>,
  ): ToolSpec => ({
    name,
    description,
    shape,
    write: true,
    call: (input) => call(input as WriteInput),
  });

  return [
    read("search_threads", "Search threads in one account.", {
      query: z.string().optional(),
      view: z.enum(["THREAD_VIEW_SUMMARY", "THREAD_VIEW_IDS_ONLY"]).optional(),
      ...pageFields,
      ...accountFields,
    }, (args) => reads.searchThreads(args)),
    read("get_thread", "Read one thread, oldest message first.", {
      threadId: z.string(),
      messageFormat: z.enum(["PLAIN_TEXT", "FULL_CONTENT"]).optional(),
      ...accountFields,
    }, (args) => reads.getThread(args)),
    read("get_message", "Read one message as raw RFC822.", {
      messageId: z.string(),
      messageFormat: z.literal("RAW").optional(),
      ...accountFields,
    }, (args) => reads.getMessage(args)),
    read("list_labels", "List labels on one account.", { ...accountFields }, (args) => reads.listLabels(args)),
    read("list_drafts", "List drafts on one account.", {
      view: z.enum(["DRAFT_VIEW_METADATA_ONLY", "DRAFT_VIEW_FULL"]).optional(),
      query: z.string().optional(),
      ...pageFields,
      ...accountFields,
    }, (args) => reads.listDrafts(args)),
    read("get_draft", "Read one draft.", {
      draftId: z.string(),
      messageFormat: z.enum(["FULL", "MINIMAL", "RAW"]).optional(),
      ...accountFields,
    }, (args) => reads.getDraft(args)),
    read("list_send_as", "List send-as addresses on one account.", { ...accountFields }, (args) => reads.listSendAs(args)),
    read("list_accounts", "List connected accounts.", {}, () => reads.listAccounts()),
    read("server_info", "Public URL, version, and which sign-in methods are set up.", {}, () => reads.serverInfo()),
    read("list_filters", "List filters on one account.", { ...accountFields }, (args) => reads.listFilters(args)),
    read("search_contacts", "Find people named in mail headers.", {
      query: z.string(),
      limit: z.number().optional(),
      ...accountFields,
    }, (args) => reads.searchContacts(args)),
    write("create_label", "Create a label.", {
      displayName: z.string(),
      ...accountFields,
    }, (args) => writes.createLabel(args)),
    write("label_thread", "Add labels to a thread.", {
      threadId: z.string(),
      labelIds: z.array(z.string()),
      ...accountFields,
    }, (args) => writes.labelThread(args)),
    write("unlabel_thread", "Remove labels from a thread.", {
      threadId: z.string(),
      labelIds: z.array(z.string()),
      ...accountFields,
    }, (args) => writes.unlabelThread(args)),
    write("create_draft", "Create a draft.", {
      to: addressField,
      cc: addressField,
      bcc: addressField,
      subject: z.string().optional(),
      body: z.string().optional(),
      htmlBody: z.string().optional(),
      replyToMessageId: z.string().optional(),
      includeSignature: z.boolean().optional(),
      attachments: z.array(attachmentSchema).optional(),
      ...accountFields,
    }, (args) => writes.createDraft(args)),
    write("update_draft", "Replace a draft's body and recipients. Threading headers stay.", {
      draftId: z.string(),
      to: addressField,
      cc: addressField,
      bcc: addressField,
      subject: z.string().optional(),
      body: z.string().optional(),
      htmlBody: z.string().optional(),
      threadId: z.string().optional(),
      includeSignature: z.boolean().optional(),
      attachments: z.array(attachmentSchema).optional(),
      ...accountFields,
    }, (args) => writes.updateDraft(args)),
    write("delete_draft", "Delete a draft.", {
      draftId: z.string(),
      ...accountFields,
    }, (args) => writes.deleteDraft(args)),
    write("send_message", "Send a draft or a new message.", {
      draftId: z.string().optional(),
      to: addressField,
      cc: addressField,
      bcc: addressField,
      subject: z.string().optional(),
      body: z.string().optional(),
      htmlBody: z.string().optional(),
      fromEmail: z.string().optional(),
      replyToMessageId: z.string().optional(),
      includeSignature: z.boolean().optional(),
      attachments: z.array(attachmentSchema).optional(),
      ...accountFields,
    }, (args) => writes.sendMessage(args)),
    write("reply", "Reply on a thread. Keeps In-Reply-To and References.", {
      messageId: z.string(),
      body: z.string().optional(),
      htmlBody: z.string().optional(),
      replyAll: z.boolean().optional(),
      cc: addressField,
      bcc: addressField,
      includeSignature: z.boolean().optional(),
      attachments: z.array(attachmentSchema).optional(),
      ...accountFields,
    }, (args) => writes.reply(args)),
    write("forward", "Forward a message.", {
      messageId: z.string(),
      to: addressField,
      includeSignature: z.boolean().optional(),
      ...accountFields,
    }, (args) => writes.forward(args)),
    write("create_filter", "Create a filter.", {
      criteria: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        subject: z.string().optional(),
        query: z.string().optional(),
        hasAttachment: z.boolean().optional(),
      }).optional(),
      action: z.object({
        addLabelIds: z.array(z.string()).optional(),
        removeLabelIds: z.array(z.string()).optional(),
        skipInbox: z.boolean().optional(),
      }).optional(),
      ...accountFields,
    }, (args) => writes.createFilter(args)),
    write("delete_filter", "Delete a filter.", {
      filterId: z.string(),
      ...accountFields,
    }, (args) => writes.deleteFilter(args)),
    {
      name: "sync_now",
      description: "Sync mirrored mailboxes up to the time budget. Direct mode does not sync.",
      shape: {},
      write: false,
      call: () => sync.syncNow(),
    },
  ];
}

/** One list of tools. `/mcp` mounts it. `/app/api/call` runs the same handlers. */
export function createToolRegistry(reads: ReadService, writes: WriteService, sync: SyncService): ToolRegistry {
  const specs = toolSpecs(reads, writes, sync);
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  return {
    isWrite(name: string): boolean {
      return byName.get(name)?.write === true;
    },
    async call(name: string, input: unknown): Promise<unknown> {
      const spec = byName.get(name);
      if (!spec) throw new ToolError("tool_error", "Unknown tool.");
      const parsed = z.object(spec.shape).safeParse(input ?? {});
      if (!parsed.success) throw new ToolError("tool_error", "Invalid input.");
      try {
        return await spec.call(parsed.data as Record<string, unknown>);
      } catch (error) {
        throw normalize(spec, error);
      }
    },
    mount(server: McpServer): void {
      for (const spec of specs) mountOne(server, spec);
    },
  };
}
